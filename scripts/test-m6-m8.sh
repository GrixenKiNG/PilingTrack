#!/usr/bin/env bash
# Disposable DB only; credentials stay in memory, never written to .env.
set -euo pipefail
cd "$(dirname "$0")/.."
exports=$(bash scripts/test-db-up.sh)
eval "$exports"
unset exports
trap 'bash scripts/test-db-down.sh "$INTEGRATION_DB_CONTAINER"' EXIT
npx --no-install vitest run --config vitest.integration.config.ts tests/integration/disposable-m6-m8.spec.ts --maxWorkers=1 "$@"