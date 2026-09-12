#!/usr/bin/env bash
#
# One-time backup setup: installs tooling, creates the config and encryption
# key, and schedules the nightly backup + weekly restore verification.
#
# Safe to re-run — it never overwrites an existing key or config.

set -Eeuo pipefail

CONFIG_FILE="/etc/firo-backup.env"
KEY_FILE="/root/firo-backup-key.txt"
BACKUP_DIR="/var/backups/firo"
LOG_FILE="/var/log/firo-backup.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }

echo "==> Installing tooling"
apt-get update -qq
# postgresql-client provides pg_dump/psql on the host; age does the encryption.
apt-get install -y -qq postgresql-client age cron >/dev/null

if ! command -v rclone >/dev/null 2>&1; then
  echo "==> Installing rclone (off-site copies)"
  curl -fsSL https://rclone.org/install.sh | bash >/dev/null 2>&1 \
    || echo "    rclone install failed — install manually for off-site backups"
fi

echo "==> Creating directories"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"          # dumps contain PII; keep them owner-only
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "==> Generating encryption key"
  age-keygen -o "$KEY_FILE" 2>/dev/null
  chmod 600 "$KEY_FILE"
else
  echo "==> Encryption key already exists, leaving it alone"
fi

RECIPIENT="$(grep 'public key' "$KEY_FILE" | sed 's/.*: //')"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "==> Writing $CONFIG_FILE"
  cat > "$CONFIG_FILE" <<EOF
# Firo backup configuration.
POSTGRES_CONTAINER=firo-db
POSTGRES_USER=firo
POSTGRES_DB=firo

BACKUP_DIR=$BACKUP_DIR
BACKUP_LOG_FILE=$LOG_FILE

# Public key — encrypts backups. The PRIVATE key lives in $KEY_FILE.
BACKUP_AGE_RECIPIENT=$RECIPIENT
BACKUP_AGE_KEY_FILE=$KEY_FILE

# Off-site destination, e.g. "firo-backup:firo-db-backups".
# Configure a remote first with: rclone config
# LEAVING THIS EMPTY MEANS BACKUPS ONLY EXIST ON THIS SERVER.
BACKUP_REMOTE=

KEEP_DAILY=7
KEEP_WEEKLY=4
KEEP_MONTHLY=6
EOF
  chmod 600 "$CONFIG_FILE"
else
  echo "==> $CONFIG_FILE already exists, leaving it alone"
fi

echo "==> Scheduling cron jobs"
CRON_FILE="/etc/cron.d/firo-backup"
cat > "$CRON_FILE" <<EOF
# Firo backups. Output is mailed to root on failure and always appended to
# $LOG_FILE by the scripts themselves.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Nightly backup at 03:17 UTC (odd minute: avoids the top-of-hour stampede).
17 3 * * *   root  $SCRIPT_DIR/backup.sh
# Weekly restore verification, Sundays at 04:30 UTC.
30 4 * * 0   root  $SCRIPT_DIR/backup-verify.sh
EOF
chmod 644 "$CRON_FILE"
systemctl restart cron 2>/dev/null || service cron restart 2>/dev/null || true

cat <<EOF

==> Done.

  Backups:  $BACKUP_DIR
  Log:      $LOG_FILE
  Config:   $CONFIG_FILE

  !! TWO THINGS YOU MUST STILL DO !!

  1. SAVE THE PRIVATE KEY SOMEWHERE OTHER THAN THIS SERVER.
       $KEY_FILE
     Put it in a password manager. If this VPS is lost and that key was only
     on it, every encrypted backup becomes permanently unreadable.

  2. SET AN OFF-SITE DESTINATION.
       rclone config                      # e.g. Cloudflare R2 or Backblaze B2
       then set BACKUP_REMOTE in $CONFIG_FILE
     Until then backups live only on the machine they are meant to protect.

  Test it now:
       $SCRIPT_DIR/backup.sh && $SCRIPT_DIR/backup-verify.sh
EOF
