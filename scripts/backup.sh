#!/usr/bin/env bash
#
# Nightly Postgres backup: dump -> compress -> encrypt -> store -> replicate -> prune.
#
# Design notes:
#  - Encrypts BEFORE anything leaves the machine. A dump holds emails, password
#    hashes and behavioural profiles; it is the most sensitive file we produce.
#  - Treats "no off-site copy" as a warning-level failure, because a backup that
#    only exists on the machine it protects is not a backup.
#  - Writes to a temp file and moves into place only on success, so a partial
#    dump can never masquerade as a good one.
#  - Exits non-zero on any failure so cron/monitoring actually notices.

set -Eeuo pipefail

CONFIG_FILE="${FIRO_BACKUP_CONFIG:-/etc/firo-backup.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$CONFIG_FILE" && set +a
fi

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-firo-db}"
POSTGRES_USER="${POSTGRES_USER:-firo}"
POSTGRES_DB="${POSTGRES_DB:-firo}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/firo}"
LOG_FILE="${BACKUP_LOG_FILE:-/var/log/firo-backup.log}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s  %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE" >&2; }
die() { log "FAILED: $*"; exit 1; }

trap 'die "unexpected error on line $LINENO"' ERR

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

DAY="$(date -u '+%Y-%m-%d')"
DOW="$(date -u '+%u')"    # 7 = Sunday
DOM="$(date -u '+%d')"

if [[ "$DOM" == "01" ]]; then
  TIER="monthly"
elif [[ "$DOW" == "7" ]]; then
  TIER="weekly"
else
  TIER="daily"
fi

BASENAME="firo-${TIER}-${DAY}.sql.gz"
TARGET="${BACKUP_DIR}/${BASENAME}"
TMP="${TARGET}.partial"

log "starting ${TIER} backup of ${POSTGRES_DB}"

# --- dump ---------------------------------------------------------------------
# Piped through gzip so a large database never lands uncompressed on disk.
if command -v docker >/dev/null 2>&1 \
   && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$POSTGRES_CONTAINER"; then
  DUMP_CMD=(docker exec -i "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB")
else
  # Fall back to a direct connection (non-containerised Postgres, or running
  # this script from outside the container).
  DUMP_CMD=(pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB")
fi

# PIPESTATUS, not $?, because $? here reports gzip's status, not pg_dump's — a
# failed dump piped into a happy gzip would otherwise look like success.
set +e
"${DUMP_CMD[@]}" 2>"${TMP}.err" | gzip -9 > "$TMP"
DUMP_STATUS=${PIPESTATUS[0]}
set -e
if (( DUMP_STATUS != 0 )); then
  log "pg_dump stderr: $(head -c 500 "${TMP}.err" 2>/dev/null)"
  rm -f "$TMP" "${TMP}.err"
  die "pg_dump exited ${DUMP_STATUS}"
fi
rm -f "${TMP}.err"

# Validate CONTENT, not size. A legitimate dump of a small or brand-new database
# compresses to well under a kilobyte, so any byte threshold produces false
# failures exactly when the product is youngest. Instead check the archive is
# intact and really is a pg_dump.
gzip -t "$TMP" 2>/dev/null || { rm -f "$TMP"; die "dump is not a valid gzip archive"; }

if ! gunzip -c "$TMP" | head -50 | grep -q 'PostgreSQL database dump'; then
  rm -f "$TMP"
  die "dump lacks the pg_dump header — refusing to keep a file we cannot trust"
fi

# A dump with a schema but no COPY/INSERT is the classic silent failure: valid
# SQL that restores into an empty database.
if ! gunzip -c "$TMP" | grep -qE '^(COPY |INSERT INTO )'; then
  log "WARNING: dump contains no row data — expected only if the database is genuinely empty"
fi

# --- encrypt ------------------------------------------------------------------
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null 2>&1 || die "BACKUP_AGE_RECIPIENT set but 'age' is not installed"
  if ! age -r "$BACKUP_AGE_RECIPIENT" -o "${TMP}.age" "$TMP"; then
    rm -f "$TMP" "${TMP}.age"
    die "encryption failed"
  fi
  rm -f "$TMP"
  TMP="${TMP}.age"
  TARGET="${TARGET}.age"
  BASENAME="${BASENAME}.age"
else
  log "WARNING: BACKUP_AGE_RECIPIENT is not set — backup is UNENCRYPTED and contains user PII"
fi

mv "$TMP" "$TARGET"
log "wrote ${TARGET} ($(du -h "$TARGET" | cut -f1))"

# --- off-site -----------------------------------------------------------------
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  command -v rclone >/dev/null 2>&1 || die "BACKUP_REMOTE set but 'rclone' is not installed"
  if rclone copy "$TARGET" "$BACKUP_REMOTE" --no-traverse; then
    log "replicated off-site to ${BACKUP_REMOTE}"
  else
    die "off-site upload failed — the only copy is on this machine"
  fi
else
  log "WARNING: BACKUP_REMOTE is not set — this backup exists ONLY on this server, which will not survive losing it"
fi

# --- prune --------------------------------------------------------------------
# Rotate each tier independently so an old problem is still recoverable.
prune_tier() {
  local tier="$1" keep="$2" file count=0
  # Newest first; delete everything past the retention count.
  while IFS= read -r file; do
    count=$((count + 1))
    if (( count > keep )); then
      rm -f "$file"
      log "pruned local $(basename "$file")"
      if [[ -n "${BACKUP_REMOTE:-}" ]]; then
        rclone deletefile "${BACKUP_REMOTE}/$(basename "$file")" 2>/dev/null \
          && log "pruned remote $(basename "$file")" || true
      fi
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name "firo-${tier}-*" -printf '%T@ %p\n' \
           | sort -rn | cut -d' ' -f2-)
}

prune_tier daily "$KEEP_DAILY"
prune_tier weekly "$KEEP_WEEKLY"
prune_tier monthly "$KEEP_MONTHLY"

log "OK ${TIER} backup complete"
