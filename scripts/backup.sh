#!/bin/bash
# Automated PostgreSQL Backup Script for PilingTrack
#
# Usage:
#   ./backup.sh                    # Full backup
#   ./backup.sh --restore latest   # Restore from latest backup
#
# Setup cron (daily at 2 AM):
#   0 2 * * * /path/to/backup.sh >> /var/log/pilingtrack-backup.log 2>&1
#
# Retention: 7 daily, 4 weekly, 12 monthly

set -euo pipefail

# ============================================================
# Configuration
# ============================================================

BACKUP_DIR="${BACKUP_DIR:-/backups/pilingtrack}"
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-pilingtrack}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
RETENTION_WEEKS="${RETENTION_WEEKS:-4}"
RETENTION_MONTHS="${RETENTION_MONTHS:-12}"

# S3 / Object Storage (optional — for off-site backups)
S3_BUCKET="${S3_BUCKET:-}"        # e.g., s3://pilingtrack-backups
S3_ENDPOINT="${S3_ENDPOINT:-}"    # e.g., https://storage.yandexcloud.net
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

# Export password for pg_dump
export PGPASSWORD="$DB_PASSWORD"

# Timestamps
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y%m%d)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)

# Backup file paths
BACKUP_FILE="${BACKUP_DIR}/daily/pilingtrack_${TIMESTAMP}.dump"
LATEST_LINK="${BACKUP_DIR}/latest.dump"

# ============================================================
# Functions
# ============================================================

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

ensure_backup_dir() {
  mkdir -p "${BACKUP_DIR}/daily"
  mkdir -p "${BACKUP_DIR}/weekly"
  mkdir -p "${BACKUP_DIR}/monthly"
}

check_db_connection() {
  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    log "ERROR: Cannot connect to database"
    exit 1
  fi
  log "Database connection OK"
}

backup_database() {
  log "Starting backup to ${BACKUP_FILE}..."

  pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -F c \
    -b \
    -v \
    --no-owner \
    --no-privileges \
    -f "$BACKUP_FILE" 2>&1 | tee "${BACKUP_FILE}.log"

  if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log "Backup completed successfully (${BACKUP_SIZE})"

    # Update latest symlink
    ln -sf "$BACKUP_FILE" "$LATEST_LINK"
    log "Updated latest backup symlink"

    # Update Redis with backup metadata for health monitoring
    if command -v redis-cli &> /dev/null && [ -n "$REDIS_URL" ]; then
      redis-cli -u "$REDIS_URL" SET "system:backup:last_timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" EX 172800 2>/dev/null || true
      redis-cli -u "$REDIS_URL" SET "system:backup:last_size" "$BACKUP_SIZE" EX 172800 2>/dev/null || true
      redis-cli -u "$REDIS_URL" SET "system:backup:s3_synced" "false" EX 172800 2>/dev/null || true
    fi
  else
    log "ERROR: Backup failed!"
    exit 1
  fi
}

cleanup_old_backups() {
  log "Cleaning up old backups..."

  # Daily retention
  find "${BACKUP_DIR}/daily" -name "*.dump" -mtime +${RETENTION_DAYS} -delete
  log "Removed daily backups older than ${RETENTION_DAYS} days"

  # Weekly retention (keep Sunday backups)
  if [ "$DAY_OF_WEEK" -eq 7 ]; then
    cp "$BACKUP_FILE" "${BACKUP_DIR}/weekly/pilingtrack_week_${DATE}.dump"
  fi
  find "${BACKUP_DIR}/weekly" -name "*.dump" -mtime +$((RETENTION_WEEKS * 7)) -delete
  log "Removed weekly backups older than ${RETENTION_WEEKS} weeks"

  # Monthly retention (keep 1st of month backups)
  if [ "$DAY_OF_MONTH" -eq "01" ]; then
    cp "$BACKUP_FILE" "${BACKUP_DIR}/monthly/pilingtrack_month_${DATE}.dump"
  fi
  find "${BACKUP_DIR}/monthly" -name "*.dump" -mtime +$((RETENTION_MONTHS * 30)) -delete
  log "Removed monthly backups older than ${RETENTION_MONTHS} months"
}

verify_backup() {
  log "Verifying backup integrity..."

  if pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "pilingtrack_verify" \
    -l "$BACKUP_FILE" > /dev/null 2>&1; then
    log "Backup verification OK"
  else
    log "WARNING: Backup verification failed — manual check required"
  fi
}

upload_to_s3() {
  if [ -z "$S3_BUCKET" ]; then
    log "S3_BUCKET not set — skipping off-site upload"
    return 0
  fi

  if ! command -v aws &> /dev/null && ! command -v mc &> /dev/null; then
    log "WARNING: Neither aws CLI nor mc (MinIO) found — skipping S3 upload"
    return 0
  fi

  local s3_key="postgresql/${DATE}/pilingtrack_${TIMESTAMP}.dump"
  local s3_url="${S3_BUCKET}/${s3_key}"

  log "Uploading to S3: ${s3_url}..."

  if command -v aws &> /dev/null; then
    local aws_opts=()
    if [ -n "$S3_ENDPOINT" ]; then
      aws_opts+=(--endpoint-url "$S3_ENDPOINT")
    fi
    if aws s3 cp "$BACKUP_FILE" "$s3_url" "${aws_opts[@]}" --storage-class STANDARD_IA; then
      log "S3 upload OK"
      # Update Redis s3_synced flag
      if command -v redis-cli &> /dev/null && [ -n "$REDIS_URL" ]; then
        redis-cli -u "$REDIS_URL" SET "system:backup:s3_synced" "true" EX 172800 2>/dev/null || true
      fi
    else
      log "WARNING: S3 upload failed"
    fi
  elif command -v mc &> /dev/null; then
    if mc cp "$BACKUP_FILE" "$s3_url"; then
      log "S3 upload OK (via mc)"
      if command -v redis-cli &> /dev/null && [ -n "$REDIS_URL" ]; then
        redis-cli -u "$REDIS_URL" SET "system:backup:s3_synced" "true" EX 172800 2>/dev/null || true
      fi
    else
      log "WARNING: S3 upload failed (via mc)"
    fi
  fi
}

restore_database() {
  local restore_file="${1:-$LATEST_LINK}"

  if [ ! -f "$restore_file" ]; then
    log "ERROR: Backup file not found: $restore_file"
    exit 1
  fi

  log "Restoring database from ${restore_file}..."

  # Drop and recreate database
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
    "DROP DATABASE IF EXISTS ${DB_NAME}_restore;"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
    "CREATE DATABASE ${DB_NAME}_restore;"

  # Restore
  pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "${DB_NAME}_restore" \
    -v \
    "$restore_file" 2>&1 | tee "${restore_file}.restore.log"

  if [ $? -eq 0 ]; then
    log "Restore completed successfully"
    log "Database restored to: ${DB_NAME}_restore"
    log "To swap with production:"
    log "  1. Stop application: kubectl scale deployment pilingtrack-prod-api --replicas=0"
    log "  2. Drop production: psql -c 'DROP DATABASE ${DB_NAME};'"
    log "  3. Rename restore: psql -c 'ALTER DATABASE ${DB_NAME}_restore RENAME TO ${DB_NAME};'"
    log "  4. Start application: kubectl scale deployment pilingtrack-prod-api --replicas=3"
  else
    log "ERROR: Restore failed!"
    exit 1
  fi
}

# ============================================================
# Main
# ============================================================

main() {
  case "${1:-backup}" in
    backup)
      ensure_backup_dir
      check_db_connection
      backup_database
      verify_backup
      upload_to_s3
      cleanup_old_backups
      log "Backup process completed"
      ;;
    restore)
      check_db_connection
      restore_database "${2:-}"
      ;;
    verify)
      check_db_connection
      verify_backup
      ;;
    list)
      log "Available backups:"
      echo ""
      log "Daily (last ${RETENTION_DAYS} days):"
      ls -lh "${BACKUP_DIR}/daily/"*.dump 2>/dev/null || echo "  None"
      echo ""
      log "Weekly (last ${RETENTION_WEEKS} weeks):"
      ls -lh "${BACKUP_DIR}/weekly/"*.dump 2>/dev/null || echo "  None"
      echo ""
      log "Monthly (last ${RETENTION_MONTHS} months):"
      ls -lh "${BACKUP_DIR}/monthly/"*.dump 2>/dev/null || echo "  None"
      echo ""
      log "Latest: $(readlink -f "$LATEST_LINK" 2>/dev/null || echo 'None')"
      ;;
    *)
      echo "Usage: $0 {backup|restore [file]|verify|list}"
      exit 1
      ;;
  esac
}

main "$@"
