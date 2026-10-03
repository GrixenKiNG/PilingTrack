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
    command: [sh, -c, 'trap "exit 143" TERM INT; while :; do sleep 1 & wait $!; done']
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
# Exit 0 alone is insufficient: worker shutdown catches can hide failed drain.
cat >output/codex-t4/docker-shim/docker <<'SHIM'
#!/usr/bin/env bash
if [[ "$1" == logs ]]; then echo 'Worker shutdown failed'; exit 0; fi
exec "$REAL_DOCKER" "$@"
SHIM
set +e
REAL_DOCKER="$real_docker" PATH="$PWD/output/codex-t4/docker-shim:$PATH" bash scripts/replace-worker-generation.sh app workers >output/codex-t4/d1-drain-refusal.log 2>&1
status=$?
set -e
[[ "$status" != 0 ]] || { echo 'FAIL: ignored failed drain with exit 0' >&2; exit 1; }
if grep -q '^START' output/codex-t4/d1-drain-refusal.log; then echo 'FAIL: START after failed drain' >&2; exit 1; fi
# Workers must still reject 143, unlike the app's conventional SIGTERM exit.
docker compose up -d
cat >output/codex-t4/docker-shim/docker <<'SHIM'
#!/usr/bin/env bash
if [[ "$1" == inspect && "$3" == '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' ]]; then
  service=$("$REAL_DOCKER" inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$4")
  if [[ "$service" == workers ]]; then echo 'exited 143 false'; exit 0; fi
fi
exec "$REAL_DOCKER" "$@"
SHIM
set +e
REAL_DOCKER="$real_docker" PATH="$PWD/output/codex-t4/docker-shim:$PATH" bash scripts/replace-worker-generation.sh app workers >output/codex-t4/e0a-workers-refusal.log 2>&1
status=$?
set -e
[[ "$status" != 0 ]] || { echo 'FAIL: accepted workers exit 143' >&2; exit 1; }
if grep -q '^START' output/codex-t4/e0a-workers-refusal.log; then echo 'FAIL: START after workers 143' >&2; exit 1; fi
grep -q 'WORKER_GENERATION_EXTERNAL_STOPPED=1' output/codex-t4/e0a-workers-refusal.log || { echo 'FAIL: missing recovery command' >&2; exit 1; }
echo 'PASS: app 143 accepted; workers 143, live old replica and failed drain block start with recovery instructions'