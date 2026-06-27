#!/usr/bin/env bash
# ============================================================
# PilingTrack — Postgres backup
# ============================================================
# Daily pg_dump cron template. Run via /etc/cron.daily/pilingtrack-backup
# or systemd timer. See docs/deployment.md §6.
#
# Usage:
#   COMPOSE_DIR=/opt/pilingtrack BACKUP_DIR=/var/backups/pilingtrack \
#     bash scripts/backup-postgres.sh
#
# Env:
#   COMPOSE_DIR    Where docker-compose.yml lives. Default: cwd.
#   ENV_FILE       --env-file passed to docker compose. Default: .env.production
#   BACKUP_DIR     Where to write dumps. Default: /var/backups/pilingtrack.
#   RETENTION_DAYS How many days of dumps to keep. Default: 30.
# ============================================================

set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-$PWD}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pilingtrack}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

cd "$COMPOSE_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found in $COMPOSE_DIR" >&2
  exit 1
fi

# Read DB name + user from the env file (don't echo passwords).
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=pilingtrack_test}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${POSTGRES_DB}-${TS}.sql.gz"

echo "Dumping ${POSTGRES_DB} → $OUT"

# -F c: custom format (smaller, supports parallel restore).
# -T: do NOT allocate a TTY — required for cron / systemd contexts.
docker compose --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c \
  | gzip > "$OUT"

# Verify the dump is non-empty.
if [ ! -s "$OUT" ]; then
  echo "ERROR: dump is empty — $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

# Retention sweep.
find "$BACKUP_DIR" -name "${POSTGRES_DB}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "✓ Backup complete: $(du -h "$OUT" | cut -f1)"

# Optional off-site copy to Cloudflare R2 (S3-compatible) via rclone.
# Configure by adding R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
# R2_SECRET_ACCESS_KEY to $ENV_FILE. See docs/runbooks/006-postgres-backup-restore.md.
# A failed off-site copy is a warning, not a hard failure — the local dump
# already succeeded and that's what matters for the exit code.
R2_BUCKET="$(grep -E '^R2_BUCKET=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
if [ -z "$R2_BUCKET" ]; then
  echo "Off-site copy skipped (R2_BUCKET not set in $ENV_FILE)"
elif ! command -v rclone &> /dev/null; then
  echo "WARNING: R2_BUCKET is set but rclone is not installed — off-site copy skipped" >&2
else
  R2_ACCOUNT_ID="$(grep -E '^R2_ACCOUNT_ID=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(grep -E '^R2_ACCESS_KEY_ID=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(grep -E '^R2_SECRET_ACCESS_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_REGION=auto

  if rclone copy "$OUT" "R2:${R2_BUCKET}/"; then
    echo "✓ Off-site copy OK: R2:${R2_BUCKET}/$(basename "$OUT")"
  else
    echo "WARNING: off-site copy to R2 failed — local backup is still intact" >&2
  fi
fi
