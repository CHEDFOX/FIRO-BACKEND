# Backups

Self-hosting Postgres means backups are our responsibility. This is the design
that makes that safe rather than a gamble.

## Three rules

1. **A backup on the same server is not a backup.** If the VPS dies, it dies
   with it. Every backup is copied **off the machine**.
2. **An untested backup is not a backup.** The classic disaster is discovering
   months of empty dumps on the day you need one. Restores are verified
   **automatically**, and the check fails loudly.
3. **Backups are the most sensitive data we hold.** A dump contains emails,
   password hashes and detailed behavioural profiles — everything an attacker
   wants, in one file. It is **encrypted before it leaves the server**.

## What runs

| When | What |
|---|---|
| Nightly | `pg_dump` → compress → encrypt → store locally → upload off-site → prune old copies |
| Weekly | Restore the newest backup into a scratch database and assert it contains real data |
| On failure | Non-zero exit + a log line the monitor can alert on |

## Retention

Kept in a grandfather-father-son rotation, so a problem noticed late is still
recoverable:

- **7** daily
- **4** weekly
- **6** monthly

Old files are pruned locally and off-site together.

## Encryption

Uses [`age`](https://github.com/FiloSottile/age) — modern, small, no GnuPG
key-management pain.

```bash
age-keygen -o /root/firo-backup-key.txt        # generate ONCE
grep 'public key' /root/firo-backup-key.txt    # this is BACKUP_AGE_RECIPIENT
chmod 600 /root/firo-backup-key.txt
```

> **Store the private key somewhere other than the VPS.** A password manager is
> fine. If the server burns down and the only copy of the key was on it, your
> encrypted backups are permanently unreadable — which is the same as having no
> backups at all.

Encryption uses only the **public** key, so the private key never needs to sit
on the server at all. It is needed solely to restore.

## Off-site destination

Any S3-compatible object store, via [`rclone`](https://rclone.org). Recommended:

- **Cloudflare R2** — 10 GB free, no egress fees
- **Backblaze B2** — 10 GB free, very cheap beyond

Both are far cheaper than S3 for this. Configure once:

```bash
rclone config    # create a remote named "firo-backup"
```

If `BACKUP_REMOTE` is unset the script still runs and keeps local backups, but
it **warns loudly** — local-only is a single point of failure, not a backup.

Hostinger's own VPS snapshots are a useful *extra* layer, not a replacement:
they are tied to the same provider account and are far coarser than a nightly
database dump.

## Setup

```bash
sudo ./scripts/backup-setup.sh          # installs deps, creates dirs, adds cron
```

Then fill in `/etc/firo-backup.env`:

```bash
POSTGRES_CONTAINER=firo-db
POSTGRES_USER=firo
POSTGRES_DB=firo
BACKUP_DIR=/var/backups/firo
BACKUP_AGE_RECIPIENT=age1... # public key from above
BACKUP_REMOTE=firo-backup:firo-db-backups   # rclone remote:path
```

## Restoring

```bash
# 1. fetch (from off-site if needed)
rclone copy firo-backup:firo-db-backups/firo-2026-09-12.sql.gz.age /tmp/

# 2. decrypt with the PRIVATE key
age -d -i /root/firo-backup-key.txt /tmp/firo-2026-09-12.sql.gz.age \
  | gunzip > /tmp/firo.sql

# 3. restore into a FRESH database first — never straight over production
docker exec -i firo-db psql -U firo -d postgres -c "CREATE DATABASE firo_restore;"
docker exec -i firo-db psql -U firo -d firo_restore < /tmp/firo.sql

# 4. check it, then swap
```

`scripts/backup-verify.sh` performs exactly steps 1-3 automatically each week
against a throwaway database, then drops it.

## Monitoring

Silent failure is the real enemy — a backup job that has been broken for weeks
looks identical to one that is working. Every run appends to
`/var/log/firo-backup.log` with a timestamp and outcome, and exits non-zero on
failure so `cron` mails it or your monitor catches it.

Check health at any time:

```bash
tail -20 /var/log/firo-backup.log
ls -lh /var/backups/firo/
```

If the newest file is older than ~48 hours, something is wrong.
