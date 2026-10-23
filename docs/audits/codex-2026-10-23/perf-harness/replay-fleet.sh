#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/mingw64/bin:$PATH"
cd "$(dirname "$0")/../.."
current_db=''
cleanup() {
  local original_exit=$?
  if [[ -n "$current_db" ]]; then
    bash scripts/test-db-down.sh "$current_db" >&2 || original_exit=1
    printf 'removed replay %s\n' "$current_db" >> output/perf-1023/cleanup.log
  fi
  exit "$original_exit"
}
trap cleanup EXIT
exports=$(bash scripts/test-db-up.sh 2>output/perf-1023/db-fleet-explain-replay.log)
eval "$exports"
unset exports
current_db=$INTEGRATION_DB_CONTAINER
printf '%s\n' "$current_db" > output/perf-1023/container-fleet-explain-replay.txt
node output/perf-1023/seed.mjs 20 explain-replay > output/perf-1023/seed-fleet-explain-replay.log 2>&1
node output/perf-1023/explain-fleet.mjs
