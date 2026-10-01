#!/usr/bin/env bash
# Smoke настоящего runner-образа: только загрузка кода и запуск планировщиков.
set -euo pipefail
[ "$#" -eq 1 ] || { echo 'Использование: smoke-workers-image.sh <image:tag>' >&2; exit 1; }
image=$1
container="codex-workers-smoke-$$-$RANDOM"
log=$(mktemp)
run_pid=''
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [ -n "$run_pid" ]; then
    kill "$run_pid" 2>/dev/null || true
    wait "$run_pid" 2>/dev/null || true
  fi
  rm -f "$log"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
fail() { echo "✖ workers smoke: $*" >&2; tail -n 40 "$log" >&2; exit 1; }

# --rm может удалить упавший контейнер раньше docker logs: сохраняем stdout/stderr
# присоединённого docker run. Сеть закрыта, адреса и ключ — только фиктивные.
MSYS_NO_PATHCONV=1 docker run --rm --name "$container" --network none \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:1/smoke \
  -e DATABASE_URL_POSTGRES=postgresql://smoke:smoke@127.0.0.1:1/smoke \
  -e REDIS_URL=redis://127.0.0.1:1 \
  -e REDIS_URL_CACHE=redis://127.0.0.1:1 \
  -e ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
  "$image" >"$log" 2>&1 &
run_pid=$!
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  if grep -Eq 'Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError' "$log"; then
    fail 'ошибка загрузки или исполнения кода'
  fi
  kill -0 "$run_pid" 2>/dev/null || fail 'контейнер завершился до успешного smoke'
  running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)
  [ "$running" != false ] || fail 'контейнер остановился'
  if [ "$running" = true ] && grep -q 'Unified Worker Service starting' "$log" && grep -q 'Arming' "$log"; then
    echo "✔ workers smoke: $image — старт и Arming подтверждены"
    exit 0
  fi
  sleep 1
done
fail 'нет старта и Arming за 60 секунд'
