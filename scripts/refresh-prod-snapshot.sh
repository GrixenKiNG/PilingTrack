#!/usr/bin/env bash
# Pull a fresh snapshot of the prod DB into the local
# `pilingtrack_prod_copy` database.
#
# Run periodically (weekly is enough) so your local "prod-like"
# environment doesn't drift too far from reality.
#
# Usage: bash scripts/refresh-prod-snapshot.sh
set -euo pipefail

SSH_KEY="$HOME/.ssh/orionpiling"
SSH_USER="user1"
SSH_HOST="87.242.102.125"
PROD_PATH="/opt/pilingtrack"
LOCAL_DUMP="scripts/prod-dump.sql.gz"
LOCAL_DB="pilingtrack_prod_copy"
LOCAL_PG_CONTAINER="pilingtrack-postgres"

echo "==> 1/3 dumping prod..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
  "cd $PROD_PATH && docker compose exec -T postgres pg_dump -U piling --no-owner --no-acl --clean --if-exists pilingtrack | gzip > /tmp/prod-dump.sql.gz"

echo "==> 2/3 downloading..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  "$SSH_USER@$SSH_HOST:/tmp/prod-dump.sql.gz" "$LOCAL_DUMP"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
  "rm /tmp/prod-dump.sql.gz"

echo "==> 3/3 restoring into $LOCAL_DB..."
docker exec "$LOCAL_PG_CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS $LOCAL_DB;"
docker exec "$LOCAL_PG_CONTAINER" psql -U postgres -c "CREATE DATABASE $LOCAL_DB;"
gunzip -c "$LOCAL_DUMP" | docker exec -i "$LOCAL_PG_CONTAINER" psql -U postgres -d "$LOCAL_DB" > /dev/null

echo ""
echo "==> done. counts:"
docker exec "$LOCAL_PG_CONTAINER" psql -U postgres -d "$LOCAL_DB" -c \
  "SELECT (SELECT COUNT(*) FROM \"Report\") AS reports, (SELECT COUNT(*) FROM \"User\") AS users, (SELECT COUNT(*) FROM \"Equipment\") AS equipment;"
echo ""
echo "Switch to prod snapshot:   npm run db:use-prod"
echo "Back to dev DB:            npm run db:use-dev"
