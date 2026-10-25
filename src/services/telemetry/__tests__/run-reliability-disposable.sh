#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
exports="$(bash scripts/test-db-up.sh)"
eval "$exports"
unset exports
trap 'bash scripts/test-db-down.sh "$INTEGRATION_DB_CONTAINER"' EXIT
export DATABASE_URL_POSTGRES="$INTEGRATION_DATABASE_URL_APP"
export DATABASE_URL="$INTEGRATION_DATABASE_URL_APP"
npx --no-install prisma generate --config prisma.integration.config.ts
node --import tsx --test src/services/telemetry/__tests__/telemetry-reliability.integration.ts
