#!/usr/bin/env bash
# Local destructive rehearsal: only codex-deploytest resources, no production.
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=codex-deploytest
export COMPOSE_FILE="$PWD/output/codex-t4/deploytest.yml"
export WORKER_GENERATION_PROJECT=codex-deploytest
export WORKER_GENERATION_EXTERNAL_STOPPED=1
mkdir -p output/codex-t4
cat > "$COMPOSE_FILE" <<'YAML'
services:
  app:
    image: alpine:3.21
    command: [sh, -c, 'trap "exit 0" TERM INT; while :; do sleep 1 & wait $$!; done']
  workers:
    image: alpine:3.21
    command: [sh, -c, 'trap "exit 0" TERM INT; while :; do sleep 1 & wait $$!; done']
    environment:
      WORKER_SHUTDOWN_TIMEOUT_MS: '8000'
YAML
cleanup() { docker compose down --remove-orphans >/dev/null; }
trap cleanup EXIT
docker compose up -d --scale workers=2
old=$(docker compose ps -q)
bash scripts/replace-worker-generation.sh app workers >output/codex-t4/d1-order.log
# The old IDs must no longer exist: force-recreate creates a new generation.
for id in $old; do
  if docker inspect "$id" >/dev/null 2>&1; then echo 'FAIL: old generation retained' >&2; exit 1; fi
done
node -e 'const s=require("fs").readFileSync("output/codex-t4/d1-order.log","utf8");if(!(s.indexOf("STOP")<s.indexOf("VERIFY")&&s.indexOf("VERIFY")<s.indexOf("START")))process.exit(1)'
# Simulate a successful stop command that actually leaves old processes alive.
mkdir -p output/codex-t4/docker-shim
real_docker=$(command -v docker)
cat >output/codex-t4/docker-shim/docker <<'SHIM'
#!/usr/bin/env bash
if [[ " $* " == *" stop "* ]]; then exit 0; fi
exec "$REAL_DOCKER" "$@"
SHIM
chmod +x output/codex-t4/docker-shim/docker
before=$(docker compose ps -q | sort)
set +e
REAL_DOCKER="$real_docker" PATH="$PWD/output/codex-t4/docker-shim:$PATH" bash scripts/replace-worker-generation.sh app workers >output/codex-t4/d1-refusal.log 2>&1
status=$?
set -e
[[ "$status" != 0 ]] || { echo 'FAIL: started with live old replicas' >&2; exit 1; }
[[ "$before" == "$(docker compose ps -q | sort)" ]] || { echo 'FAIL: partial start on refusal' >&2; exit 1; }
if grep -q '^START' output/codex-t4/d1-refusal.log; then echo 'FAIL: reached START on refusal' >&2; exit 1; fi
echo 'PASS: stop -> verify -> start; live old replica blocks start (exit nonzero)'