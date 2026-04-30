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

# Optional: send to remote storage. Uncomment + tune as needed.
# rclone copy "$OUT" remote:pilingtrack-backups/

echo "✓ Backup complete: $(du -h "$OUT" | cut -f1)"
