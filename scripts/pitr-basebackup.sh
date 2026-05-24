#!/usr/bin/env bash
# ============================================================
# PilingTrack — Weekly Postgres base backup for PITR
# ============================================================
# Pairs with WAL archiving (archive_command in docker-compose.prod.yml).
# Together they give point-in-time recovery to any second within the
# retention window.
#
# Recovery window = (oldest kept base backup) → now. With 4 weekly base
# backups + WAL files since the oldest, that's ~28 days max.
#
# Usage (from /opt/pilingtrack):
#   COMPOSE_DIR=/opt/pilingtrack BASEBACKUP_DIR=/opt/pilingtrack/basebackups \
#     bash scripts/pitr-basebackup.sh
#
# Env:
#   COMPOSE_DIR       Where docker-compose.yml lives. Default: cwd.
#   ENV_FILE          --env-file passed to docker compose. Default: .env.production
#   BASEBACKUP_DIR    Where to write base backups. Default: /opt/pilingtrack/basebackups
#   RETENTION_COUNT   How many base backups to keep. Default: 4 (= ~4 weeks).
# ============================================================

set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-$PWD}"
ENV_FILE="${ENV_FILE:-.env.production}"
BASEBACKUP_DIR="${BASEBACKUP_DIR:-/opt/pilingtrack/basebackups}"
RETENTION_COUNT="${RETENTION_COUNT:-4}"

cd "$COMPOSE_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found in $COMPOSE_DIR" >&2
  exit 1
fi

POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
: "${POSTGRES_USER:=postgres}"

mkdir -p "$BASEBACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BASEBACKUP_DIR/base-${TS}.tar.gz"

echo "Creating base backup → $OUT"

# pg_basebackup with:
#   -Ft  tar format (single archive)
#   -X fetch  collect required WAL at the END of the backup. We use fetch
#             (not stream) because -D - (stdout) cannot multiplex two
#             output streams. Safe here: our archive_command also keeps
#             every WAL on disk, so if fetch happens to miss a recycled
#             WAL between start and end of backup, the restore process
#             can pull it from the WAL archive directory anyway.
#   -z   gzip-compress on the server
#   -P   show progress to stderr
#   -D - write the resulting tar to stdout
docker compose --env-file "$ENV_FILE" exec -T postgres \
  pg_basebackup -U "$POSTGRES_USER" -h /var/run/postgresql \
  -D - -Ft -X fetch -z -P \
  > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "ERROR: base backup is empty — $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ Base backup complete: $SIZE"

# Retention: keep the N most recent base backups, drop the rest.
# Sort by name (ISO-style timestamp sorts chronologically).
KEEP=$(ls -1 "$BASEBACKUP_DIR"/base-*.tar.gz 2>/dev/null | sort | tail -n "$RETENTION_COUNT" | tr '\n' '|' | sed 's/|$//')
for f in "$BASEBACKUP_DIR"/base-*.tar.gz; do
  case "|$KEEP|" in
    *"|$f|"*) ;;
    *) echo "Pruning old base: $f"; rm -f "$f" ;;
  esac
done

# WAL cleanup: any WAL older than the OLDEST kept base backup is no
# longer needed for restore. pg_archivecleanup is the safe tool — it
# reads the .backup file in the archive and removes WAL files older
# than the named WAL position.
OLDEST_BASE="$(ls -1 "$BASEBACKUP_DIR"/base-*.tar.gz 2>/dev/null | sort | head -1)"
if [ -n "$OLDEST_BASE" ]; then
  # Each pg_basebackup leaves a .backup label file in the WAL archive,
  # named like 000000010000000000000003.00000028.backup. The cleanup tool
  # uses the corresponding WAL filename to decide what's safe to remove.
  OLDEST_LABEL="$(ls -1 /opt/pilingtrack/wal-archive/*.backup 2>/dev/null | sort | head -1 || true)"
  if [ -n "$OLDEST_LABEL" ]; then
    OLDEST_WAL="$(basename "$OLDEST_LABEL" | cut -d. -f1)"
    echo "Cleaning WAL older than $OLDEST_WAL"
    docker compose --env-file "$ENV_FILE" exec -T postgres \
      pg_archivecleanup /var/lib/postgresql/wal-archive "$OLDEST_WAL" || true
  fi
fi

echo "✓ Retention sweep complete (kept $RETENTION_COUNT, current: $(ls -1 "$BASEBACKUP_DIR"/base-*.tar.gz 2>/dev/null | wc -l))"
