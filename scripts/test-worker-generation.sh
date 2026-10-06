#!/usr/bin/env bash
# Local destructive rehearsal: only codex-* resources, no production.
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME="codex-deploytest-$(date +%s)-$$"
export WORKER_GENERATION_PROJECT="$COMPOSE_PROJECT_NAME"
export WORKER_GENERATION_EXTERNAL_STOPPED=1
export COMPOSE_FILE="$PWD/output/codex-t6/deploytest.yml"
mkdir -p output/codex-t6
image=codex-nextlike-t6:f1
# Reuse a local Node runtime; never run or change pilingtrack containers/images.
docker tag pt-audit-app:a8567732 "$image"
cleanup() { docker compose down --remove-orphans >/dev/null; docker image rm "$image" >/dev/null; }
trap cleanup EXIT
write_compose() {
  cat > "$COMPOSE_FILE" <<YAML
services:
  app:
    image: $image
    restart: unless-stopped
    healthcheck:
      disable: true
    entrypoint: [node, -e]
    command: ['const http=require("http");const s=http.createServer((q,r)=>r.end("ok"));s.listen(3000);process.on("SIGTERM",()=>s.close(()=>process.exit(143)));']
  workers:
    image: $image
    restart: unless-stopped
    healthcheck:
      disable: true
    entrypoint: [node, -e]
    command: ['setInterval(()=>{},1000);process.on("SIGTERM",()=>process.exit($1));']
    environment:
      WORKER_SHUTDOWN_TIMEOUT_MS: '8000'
YAML
}
expect_refusal() {
  set +e
  bash scripts/replace-worker-generation.sh app workers >"output/codex-t6/$1.log" 2>&1
  status=$?
  set -e
  [[ "$status" != 0 ]] || { echo "FAIL: $1 accepted" >&2; exit 1; }
}
write_compose 0
docker compose up -d --scale workers=2
sleep 2
old=$(docker compose ps -q)
bash scripts/replace-worker-generation.sh app workers >output/codex-t6/f1-order.log
for id in $old; do
  if docker inspect "$id" >/dev/null 2>&1; then echo 'FAIL: old generation retained' >&2; exit 1; fi
done
node -e 'const s=require("fs").readFileSync("output/codex-t6/f1-order.log","utf8");if(!(s.indexOf("STOP")<s.indexOf("VERIFY")&&s.indexOf("VERIFY")<s.indexOf("START")))process.exit(1)'
echo 'PASS: real Node app SIGTERM 143 accepted'
# A real worker exits 143: old running replicas and policies must return.
write_compose 143
docker compose up -d --force-recreate --scale workers=2
sleep 2
before=$(docker compose ps -q | sort)
expect_refusal f1-workers-refusal
[[ "$before" == "$(docker compose ps -q | sort)" ]] || { echo 'FAIL: old workers not restored' >&2; exit 1; }
for id in $before; do
  [[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}} {{.State.Running}}' "$id")" == 'unless-stopped true' ]] || { echo 'FAIL: policy/running not restored' >&2; exit 1; }
done
echo 'PASS: real workers 143 refuses new generation and restores old'
# A live one-off is outside normal compose lifecycle: refuse before mutation.
extra=$(docker compose run -d --no-deps workers)
before=$(docker compose ps -aq | sort)
expect_refusal f1-live-refusal
[[ "$before" == "$(docker compose ps -aq | sort)" ]] || { echo 'FAIL: changed live generation' >&2; exit 1; }
if grep -q '^STOP' output/codex-t6/f1-live-refusal.log; then echo 'FAIL: STOP before one-off refusal' >&2; exit 1; fi
[[ "$(docker inspect --format '{{.State.Running}}' "$extra")" == true ]] || exit 1
docker rm -f "$extra" >/dev/null
echo 'PASS: live one-off refused before STOP'
# Preflight failure must not disable an earlier replica restart policy.
WORKER_GENERATION_STOP_TIMEOUT_SECONDS=10 expect_refusal f1-deadline-refusal
for id in $(docker compose ps -q); do
  [[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}} {{.State.Running}}' "$id")" == 'unless-stopped true' ]] || exit 1
done
echo 'PASS: preflight failure changes no containers'
# Real docker performs failed partial up; shim only injects command failure.
write_compose 0
docker compose up -d --force-recreate --scale workers=2
sleep 2
real_docker=$(command -v docker)
mkdir -p output/codex-t6/docker-shim
cat >output/codex-t6/docker-shim/docker <<'SHIM'
#!/usr/bin/env bash
if [[ " $* " == *" up "* && " $* " == *" --force-recreate "* && -z "${COMPOSE_PATH_SEPARATOR:-}" ]]; then
  "$REAL_DOCKER" "$@"
  exit 1
fi
exec "$REAL_DOCKER" "$@"
SHIM
chmod +x output/codex-t6/docker-shim/docker
REAL_DOCKER="$real_docker" PATH="$PWD/output/codex-t6/docker-shim:$PATH" expect_refusal f1-start-refusal
[[ "$(docker compose ps -q | wc -l)" -eq 3 ]] || { echo 'FAIL: rollback replica count' >&2; exit 1; }
for id in $(docker compose ps -q); do
  [[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}} {{.State.Running}}' "$id")" == 'unless-stopped true' ]] || exit 1
done
grep -q 'RECOVERED' output/codex-t6/f1-start-refusal.log
echo 'PASS: partial START failure stops new generation and recreates captured old images/policies'
# An exit code alone must not hide a failed drain.
cat >output/codex-t6/docker-shim/docker <<'SHIM'
#!/usr/bin/env bash
if [[ "$1" == logs ]]; then echo 'Worker shutdown failed'; exit 0; fi
exec "$REAL_DOCKER" "$@"
SHIM
REAL_DOCKER="$real_docker" PATH="$PWD/output/codex-t6/docker-shim:$PATH" expect_refusal f1-drain-refusal
if grep -q '^START' output/codex-t6/f1-drain-refusal.log; then echo 'FAIL: START after failed drain' >&2; exit 1; fi
grep -q 'RECOVERED' output/codex-t6/f1-drain-refusal.log
echo 'PASS: failed drain refuses START and restores old generation'
