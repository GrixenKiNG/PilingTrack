#!/usr/bin/env bash
# Disposable Docker-only rehearsal. Generated credentials stay in process memory.
set -euo pipefail
cd "$(dirname "$0")/.."
exports=$(bash scripts/test-db-up.sh)
eval "$exports"
unset exports
trap 'bash scripts/test-db-down.sh "$INTEGRATION_DB_CONTAINER" >&2' EXIT
node scripts/test-app-bluegreen-stand.cjs
