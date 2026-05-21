#!/usr/bin/env bash
#
# Wrapper around scripts/backfill-report-analytics.sql.
#
# Usage:
#   bash scripts/backfill-report-analytics.sh [--days=N]
#   npm run backfill:analytics -- --days=N
#
# Defaults to last 7 days. Reads POSTGRES_USER + POSTGRES_DB from inside
# the running postgres container, so it works against whatever DB the
# `postgres` docker-compose service is configured for — locally
# (postgres / pilingtrack_test) and on prod (piling / pilingtrack)
# without needing per-environment configuration here.
#
# Pre-requisites:
#   - Run from the project root (where docker-compose.yml lives).
#   - The `postgres` compose service must be running.
#   - On prod: run after `git pull` so the .sql file is current.

set -euo pipefail

DAYS=7
for arg in "$@"; do
  case "$arg" in
    --days=*) DAYS="${arg#--days=}";;
    -h|--help)
      sed -n '3,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Use --days=N (default 7)" >&2
      exit 2
      ;;
  esac
done

if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
  echo "--days must be a positive integer, got: $DAYS" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/backfill-report-analytics.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "Missing SQL file: $SQL_FILE" >&2
  exit 1
fi

# Auto-detect the postgres container. Tries the common compose-managed
# names; we use `docker exec` (not `docker compose exec`) so we don't
# pull in compose validation of unrelated services (e.g. PGADMIN_PASSWORD
# being required for the dev pgadmin profile).
CONTAINER=""
for name in pilingtrack-postgres pilingtrack_postgres_1; do
  if docker inspect "$name" >/dev/null 2>&1; then
    CONTAINER="$name"
    break
  fi
done

if [ -z "$CONTAINER" ]; then
  echo "No running postgres container found. Tried: pilingtrack-postgres, pilingtrack_postgres_1" >&2
  exit 1
fi

echo "Backfilling ReportAnalytics for last $DAYS day(s) against container: $CONTAINER"
docker exec -i -e "BACKFILL_DAYS=$DAYS" "$CONTAINER" \
  bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=on' \
  < "$SQL_FILE"
