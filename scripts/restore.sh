#!/bin/bash
# PilingTrack Database Restore Script
#
# Safely restores database from a backup with pre-flight checks.
#
# Usage:
#   ./restore.sh                     # Restore from latest
#   ./restore.sh /backups/daily/file.dump  # Restore from specific file
#   ./restore.sh --dry-run           # Validate without restoring
#   ./restore.sh --from-s3 s3-key    # Download from S3 and restore
#
# Safety features:
#   - Pre-flight validation
#   - Automatic pre-restore backup
#   - Dry-run mode
#   - Post-restore verification

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

# S3
S3_BUCKET="${S3_BUCKET:-}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

export PGPASSWORD="$DB_PASSWORD"

LATEST_LINK="${BACKUP_DIR}/latest.dump"
RESTORE_DB="${DB_NAME}_restore_$(date +%Y%m%d_%H%M%S)"
DRY_RUN=false
FROM_S3=""

# ============================================================
# Parse Arguments
# ============================================================

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --from-s3=*)
      FROM_S3="${arg#*=}"
      ;;
    --from-s3)
      shift
      FROM_S3="$1"
      ;;
    -*)
      echo "Unknown option: $arg"
      exit 1
      ;;
    *)
      RESTORE_FILE="$arg"
      ;;
  esac
done

# Default to latest if not specified
RESTORE_FILE="${RESTORE_FILE:-$LATEST_LINK}"

# ============================================================
# Functions
# ============================================================

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
  exit 1
}

check_db_connection() {
  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    error "Cannot connect to database at ${DB_HOST}:${DB_PORT}"
  fi
  log "Database connection OK"
}

download_from_s3() {
  if [ -z "$S3_BUCKET" ]; then
    error "S3_BUCKET not set"
  fi

  local s3_url="${S3_BUCKET}/${FROM_S3}"
  local filename=$(basename "$FROM_S3")
  local local_path="/tmp/${filename}"

  log "Downloading from S3: ${s3_url}..."

  if command -v aws &> /dev/null; then
    local aws_opts=()
    if [ -n "$S3_ENDPOINT" ]; then
      aws_opts+=(--endpoint-url "$S3_ENDPOINT")
    fi
    aws s3 cp "$s3_url" "$local_path" "${aws_opts[@]}" || error "S3 download failed"
  elif command -v mc &> /dev/null; then
    mc cp "$s3_url" "$local_path" || error "S3 download failed (via mc)"
  else
    error "Neither aws CLI nor mc found"
  fi

  RESTORE_FILE="$local_path"
  log "Downloaded to: $local_path"
}

validate_backup() {
  if [ ! -f "$RESTORE_FILE" ]; then
    error "Backup file not found: $RESTORE_FILE"
  fi

  local file_size
  file_size=$(du -h "$RESTORE_FILE" | cut -f1)
  log "Backup file: ${RESTORE_FILE} (${file_size})"

  # Validate pg_restore can read the file
  log "Validating backup file..."
  if ! pg_restore -l "$RESTORE_FILE" > /dev/null 2>&1; then
    error "Backup file is corrupted or not a valid pg_dump archive"
  fi
  log "Backup file is valid"

  # Show what's in the backup
  local table_count
  table_count=$(pg_restore -l "$RESTORE_FILE" | grep -c "TABLE " || true)
  log "Backup contains ${table_count} tables"
}

dry_run_restore() {
  log "=== DRY RUN MODE ==="
  log "Would restore from: ${RESTORE_FILE}"
  log "Target database: ${DB_NAME}"
  log ""
  log "Steps that would be executed:"
  log "  1. Backup current database (${DB_NAME})"
  log "  2. Create restore database: ${RESTORE_DB}"
  log "  3. Restore backup to ${RESTORE_DB}"
  log "  4. Verify restore database integrity"
  log "  5. [MANUAL] Swap ${RESTORE_DB} with ${DB_NAME}"
  log ""
  log "To actually restore, run without --dry-run"
}

backup_current_db() {
  local pre_restore_file="${BACKUP_DIR}/pre_restore_$(date +%Y%m%d_%H%M%S).dump"

  log "Creating pre-restore backup: ${pre_restore_file}..."

  pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -F c \
    -b \
    --no-owner \
    --no-privileges \
    -f "$pre_restore_file" 2>&1 | tail -5

  if [ $? -eq 0 ]; then
    log "Pre-restore backup created: ${pre_restore_file}"
  else
    error "Pre-restore backup failed — aborting restore"
  fi
}

restore_database() {
  log "Creating restore database: ${RESTORE_DB}..."

  # Drop if exists
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB}';" 2>/dev/null || true
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -q -c \
    "DROP DATABASE IF EXISTS ${RESTORE_DB};" 2>/dev/null || true

  # Create
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -q -c \
    "CREATE DATABASE ${RESTORE_DB};" || error "Failed to create restore database"

  log "Restoring backup to ${RESTORE_DB}..."

  pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$RESTORE_DB" \
    -v \
    --no-owner \
    --no-privileges \
    "$RESTORE_FILE" 2>&1 | tail -20

  if [ ${PIPESTATUS[0]} -ne 0 ]; then
    log "WARNING: Restore completed with warnings — check log above"
  else
    log "Restore completed successfully"
  fi
}

verify_restore() {
  log "Verifying restored database..."

  # Check tables exist
  local table_count
  table_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$RESTORE_DB" -t -A -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "0")

  if [ "$table_count" -eq 0 ]; then
    error "Restored database has no tables — something went wrong"
  fi

  log "Restored database has ${table_count} tables"

  # Check row counts for key tables
  local key_tables=("Report" "User" "Site" "Equipment" "Crew" "OutboxEvent" "ReportVersion")
  for table in "${key_tables[@]}"; do
    local count
    count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$RESTORE_DB" -t -A -c \
      "SELECT count(*) FROM \"${table}\";" 2>/dev/null || echo "N/A")
    log "  ${table}: ${count} rows"
  done

  log "Verification OK"
}

print_swap_instructions() {
  log ""
  log "========================================="
  log "  DATABASE RESTORED SUCCESSFULLY"
  log "========================================="
  log ""
  log "Database restored to: ${RESTORE_DB}"
  log "Original database: ${DB_NAME} (unchanged)"
  log "Pre-restore backup: ${BACKUP_DIR}/pre_restore_*.dump"
  log ""
  log "To swap with production:"
  log ""
  log "  # 1. Stop application"
  log "  kubectl scale deployment pilingtrack-prod-api --replicas=0"
  log ""
  log "  # 2. Drop production database"
  log "  psql -h ${DB_HOST} -U ${DB_USER} -d postgres -c \"DROP DATABASE ${DB_NAME};\""
  log ""
  log "  # 3. Rename restore to production"
  log "  psql -h ${DB_HOST} -U ${DB_USER} -d postgres -c \"ALTER DATABASE ${RESTORE_DB} RENAME TO ${DB_NAME};\""
  log ""
  log "  # 4. Restart application"
  log "  kubectl scale deployment pilingtrack-prod-api --replicas=3"
  log ""
  log "To rollback (if something is wrong):"
  log "  psql -h ${DB_HOST} -U ${DB_USER} -d postgres -c \"DROP DATABASE ${DB_NAME};\""
  log "  psql -h ${DB_HOST} -U ${DB_USER} -d postgres -c \"ALTER DATABASE ${RESTORE_DB} RENAME TO ${DB_NAME};\""
  log ""
  log "========================================="
}

# ============================================================
# Main
# ============================================================

main() {
  check_db_connection

  # Download from S3 if requested
  if [ -n "$FROM_S3" ]; then
    download_from_s3
  fi

  validate_backup

  if [ "$DRY_RUN" = true ]; then
    dry_run_restore
    return 0
  fi

  # Safety confirmation (skip if running non-interactively)
  if [ -t 0 ]; then
    echo ""
    echo "WARNING: This will create a restore database '${RESTORE_DB}'."
    echo "The original database '${DB_NAME}' will NOT be touched."
    echo "A pre-restore backup will be created automatically."
    echo ""
    read -p "Continue? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log "Restore cancelled by user"
      exit 0
    fi
  fi

  backup_current_db
  restore_database
  verify_restore
  print_swap_instructions
}

main "$@"
