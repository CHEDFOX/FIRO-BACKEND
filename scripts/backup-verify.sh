#!/usr/bin/env bash
#
# Prove the newest backup can actually be restored.
#
# This is the step people skip, and it is the reason backup disasters happen:
# a job that has been producing empty dumps for months looks exactly like a job
# that is working. The only way to know is to restore one and look inside.
#
# Restores into a THROWAWAY database, asserts the core tables exist and hold
# rows, then drops it. Never touches the live database.

set -Eeuo pipefail

CONFIG_FILE="${FIRO_BACKUP_CONFIG:-/etc/firo-backup.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$CONFIG_FILE" && set +a
fi

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-firo-db}"
POSTGRES_USER="${POSTGRES_USER:-firo}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/firo}"
LOG_FILE="${BACKUP_LOG_FILE:-/var/log/firo-backup.log}"
VERIFY_DB="${VERIFY_DB:-firo_verify_$(date -u '+%Y%m%d%H%M%S')}"
AGE_KEY_FILE="${BACKUP_AGE_KEY_FILE:-/root/firo-backup-key.txt}"

# Tables that must exist and contain rows for a restore to be meaningful.
REQUIRED_TABLES=("${VERIFY_TABLES:-users experiences}")

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s  %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE" >&2; }
die() { log "VERIFY FAILED: $*"; cleanup; exit 1; }

psql_run() {
  if command -v docker >/dev/null 2>&1 &&  docker ps --format "{{.Names}}" 2>/dev/null | grep -qx "$POSTGRES_CONTAINER"; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$@"
  else
    psql -U "$POSTGRES_USER" "$@"
  fi
}

cleanup() {
  psql_run -d postgres -c "DROP DATABASE IF EXISTS ${VERIFY_DB};" >/dev/null 2>&1 || true
  rm -f "${WORK:-/nonexistent}" 2>/dev/null || true
}
trap cleanup EXIT

# --- find the newest backup ---------------------------------------------------
NEWEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'firo-*.sql.gz*' -printf '%T@ %p\n' \
          | sort -rn | head -1 | cut -d' ' -f2-)"
[[ -n "$NEWEST" ]] || die "no backup files found in ${BACKUP_DIR}"

# A stale backup is its own kind of failure — the job may have silently stopped.
AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
if (( AGE_HOURS > 48 )); then
  die "newest backup is ${AGE_HOURS}h old — the nightly job is not running"
fi

log "verifying $(basename "$NEWEST") (${AGE_HOURS}h old)"

# --- decrypt + decompress -----------------------------------------------------
WORK="$(mktemp /tmp/firo-verify-XXXXXX.sql)"

if [[ "$NEWEST" == *.age ]]; then
  [[ -f "$AGE_KEY_FILE" ]] || die "encrypted backup but no private key at ${AGE_KEY_FILE}"
  age -d -i "$AGE_KEY_FILE" "$NEWEST" | gunzip > "$WORK" || die "decrypt/decompress failed"
else
  gunzip -c "$NEWEST" > "$WORK" || die "decompress failed"
fi

[[ -s "$WORK" ]] || die "restored SQL is empty"

# --- restore into a scratch database -----------------------------------------
psql_run -d postgres -c "CREATE DATABASE ${VERIFY_DB};" >/dev/null || die "could not create ${VERIFY_DB}"

if ! psql_run -d "$VERIFY_DB" -v ON_ERROR_STOP=1 < "$WORK" >/dev/null 2>&1; then
  die "restore produced SQL errors"
fi

# --- assert it actually holds data -------------------------------------------
# An empty-but-valid schema restores without error, which is exactly the silent
# failure this script exists to catch.
for table in ${REQUIRED_TABLES[*]}; do
  COUNT="$(psql_run -d "$VERIFY_DB" -tAc "SELECT count(*) FROM ${table};" 2>/dev/null || echo "MISSING")"
  [[ "$COUNT" != "MISSING" ]] || die "table '${table}' missing from the restored backup"
  log "  ${table}: ${COUNT} rows"
  if [[ "$table" == "experiences" && "$COUNT" == "0" ]]; then
    die "restored '${table}' is empty — the backup carries no data"
  fi
done

log "OK verified $(basename "$NEWEST") restores cleanly"
