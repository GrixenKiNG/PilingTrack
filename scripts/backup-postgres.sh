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
# Off-site copy via rclone.
#
# Credentials: prefer dedicated BACKUP_S3_* vars; fall back to the app's own
# S3_* (media) credentials when BACKUP_S3_* are absent, so existing installs
# keep working with no config change.
#
# ⚠️ Why the dedicated vars exist (audit 2026-09-15). On the fallback path ONE
# set of S3 keys opens BOTH the app's primary photo storage (media/) and every
# database dump (db-backups/) — same bucket, same token. A leaked, rotated or
# revoked app key therefore takes the backups with it: the copy is off-site,
# but not off-credential, so the failure modes are correlated. Pointing
# BACKUP_S3_* at a separate bucket with its own token removes that link and
# is the recommended production setup. See docs/audit.md.
#
# A failed off-site copy is a warning, not a hard failure — the local dump
# already succeeded and that's what matters for the exit code.
# NOTE: must never fail. The script runs under `set -euo pipefail`, so a
# grep that finds nothing would return 1, pipefail would surface it, and the
# whole backup would abort — which is exactly what happened on prod when the
# optional BACKUP_S3_* keys were absent (2026-09-16). The trailing `|| true`
# makes a missing key an empty string, not a fatal error.
read_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

S3_ENDPOINT_VAL="$(read_env BACKUP_S3_ENDPOINT)"
S3_BUCKET_VAL="$(read_env BACKUP_S3_BUCKET)"
S3_ACCESS_KEY_ID_VAL="$(read_env BACKUP_S3_ACCESS_KEY_ID)"
S3_SECRET_ACCESS_KEY_VAL="$(read_env BACKUP_S3_SECRET_ACCESS_KEY)"

if [ -n "$S3_ENDPOINT_VAL" ] && [ -n "$S3_BUCKET_VAL" ] && \
   [ -n "$S3_ACCESS_KEY_ID_VAL" ] && [ -n "$S3_SECRET_ACCESS_KEY_VAL" ]; then
  CRED_SOURCE="BACKUP_S3_* (dedicated backup credentials)"
else
  S3_ENDPOINT_VAL="$(read_env S3_ENDPOINT)"
  S3_BUCKET_VAL="$(read_env S3_BUCKET)"
  S3_ACCESS_KEY_ID_VAL="$(read_env S3_ACCESS_KEY_ID)"
  S3_SECRET_ACCESS_KEY_VAL="$(read_env S3_SECRET_ACCESS_KEY)"
  CRED_SOURCE="S3_* (shared with app media — see warning above)"
fi

if [ -z "$S3_ENDPOINT_VAL" ] || [ -z "$S3_BUCKET_VAL" ] || [ -z "$S3_ACCESS_KEY_ID_VAL" ] || [ -z "$S3_SECRET_ACCESS_KEY_VAL" ]; then
  echo "Off-site copy skipped (neither BACKUP_S3_* nor S3_* fully set in $ENV_FILE)"
elif ! command -v rclone &> /dev/null; then
  echo "WARNING: S3 storage is configured but rclone is not installed — off-site copy skipped" >&2
else
  echo "Off-site credentials: $CRED_SOURCE"
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID_VAL"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY_VAL"
  export RCLONE_CONFIG_R2_ENDPOINT="$S3_ENDPOINT_VAL"
  export RCLONE_CONFIG_R2_REGION=auto
  # The token is scoped to this one bucket (no bucket-admin rights), so
  # skip rclone's HeadBucket/exists check — it 403s otherwise and every
  # copy fails. Confirmed against prod's actual token 2026-06-27.
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

  if rclone copy "$OUT" "R2:${S3_BUCKET_VAL}/db-backups/"; then
    echo "✓ Off-site copy OK: R2:${S3_BUCKET_VAL}/db-backups/$(basename "$OUT")"
  else
    echo "WARNING: off-site copy to R2 failed — local backup is still intact" >&2
  fi
fi
