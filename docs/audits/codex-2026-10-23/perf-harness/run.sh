#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/mingw64/bin:$PATH"
cd "$(dirname "$0")/../.."
mkdir -p output/perf-1023
current_db=''
redis_name=''
cleanup() {
  local original_exit=$?
  if [[ -n "$current_db" ]]; then
    bash scripts/test-db-down.sh "$current_db" >&2 || original_exit=1
    printf 'removed %s\n' "$current_db" >> output/perf-1023/cleanup.log
  fi
  if [[ "$redis_name" =~ ^codex-perf-redis-[a-f0-9]{12}$ ]]; then
    local label
    label=$(docker inspect --format '{{ index .Config.Labels "pilingtrack.codex.perf-1023" }}' "$redis_name")
    if [[ "$label" = 1 ]]; then docker rm -f "$redis_name" >/dev/null || original_exit=1; else original_exit=1; fi
    printf 'removed %s\n' "$redis_name" >> output/perf-1023/cleanup.log
  fi
  exit "$original_exit"
}
trap cleanup EXIT
redis_name="codex-perf-redis-$(node -e "process.stdout.write(require('node:crypto').randomBytes(6).toString('hex'))")"
docker run -d --name "$redis_name" --label pilingtrack.codex.perf-1023=1 -p 127.0.0.1::6379 redis:7-alpine redis-server --maxmemory 32mb --maxmemory-policy allkeys-lru >/dev/null
redis_port=$(docker port "$redis_name" 6379/tcp); redis_port=${redis_port##*:}
export REDIS_URL="redis://127.0.0.1:$redis_port" REDIS_URL_CACHE="redis://127.0.0.1:$redis_port"
export PRISMA_CONNECTION_LIMIT=20 PRISMA_POOL_TIMEOUT=10
for scale in 1 5 20; do
  printf 'START scale=%s\n' "$scale"
  exports=$(bash scripts/test-db-up.sh 2>"output/perf-1023/db-x$scale.log")
  eval "$exports"
  unset exports
  current_db=$INTEGRATION_DB_CONTAINER
  printf '%s\n' "$current_db" > "output/perf-1023/container-x$scale.txt"
  if [[ "$scale" = 1 ]]; then
    npx --no-install prisma generate --config prisma.integration.config.ts > output/perf-1023/generate.log 2>&1
    node scripts/patch-postgres-client.js >> output/perf-1023/generate.log 2>&1
  fi
  node output/perf-1023/seed.mjs "$scale" > "output/perf-1023/seed-x$scale.log" 2>&1
  export DATABASE_URL
  DATABASE_URL=$(node -e "const u=new URL(process.env.INTEGRATION_DATABASE_URL_APP);u.searchParams.set('options','-c statement_timeout=15000 -c lock_timeout=5000 -c application_name=codex-perf-1023');process.stdout.write(u.toString())")
  export DATABASE_URL_POSTGRES="$DATABASE_URL"
  node --conditions=react-server --expose-gc --import tsx output/perf-1023/measure.ts "$scale" > "output/perf-1023/measure-x$scale.log" 2>&1
  printf 'MEASURE scale=%s exit=0\n' "$scale"
  bash scripts/test-db-down.sh "$current_db"
  printf 'removed %s\n' "$current_db" >> output/perf-1023/cleanup.log
  current_db=''
done
