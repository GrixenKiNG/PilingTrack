#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p output/codex-t5
exports=$(bash scripts/test-db-up.sh)
eval "$exports"
unset exports
trap 'bash scripts/test-db-down.sh "$INTEGRATION_DB_CONTAINER" >&2' EXIT
node scripts/test-day-stand.cjs
