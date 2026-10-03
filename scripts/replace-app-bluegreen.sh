#!/usr/bin/env bash
# Run by the owner on the target host; this helper never uses SSH or builds images.
# HTTP slots never run embedded workers. Dedicated workers retain the F1 barrier.
set -euo pipefail
die() { echo "✖ Blue-green: $*" >&2; exit 1; }
image="${1:-}"; sha="${2:-}"
[[ $# == 2 && "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$ && "$sha" =~ ^[a-f0-9]{7,40}$ ]] || die 'укажите существующий image и SHA'
project="${WORKER_GENERATION_PROJECT:-pilingtrack}"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'неверное имя проекта'
[[ "${WORKER_GENERATION_EXTERNAL_STOPPED:-0}" == 1 ]] || die 'нужно подтверждение остановки внешних workers'
snippet="${BLUEGREEN_CADDY_SNIPPET:-/etc/caddy/app-upstream.caddy}"
source_config="${BLUEGREEN_CADDY_SOURCE:-/etc/caddy/Caddyfile}"
config="${BLUEGREEN_CADDY_CONFIG:-$source_config}"
caddy_container="${BLUEGREEN_CADDY_CONTAINER:-}"
[[ -z "$caddy_container" || "$caddy_container" == codex-* ]] || die 'container Caddy допустим только на codex-стенде'
proxy_host="${BLUEGREEN_PROXY_HOST:-127.0.0.1}"
[[ "$proxy_host" =~ ^[a-zA-Z0-9.-]+$ ]] || die 'неверный proxy host'
public_url="${BLUEGREEN_PUBLIC_URL:-https://orionpiling.ru}"
blue_port="${BLUEGREEN_BLUE_PORT:-3000}"; green_port="${BLUEGREEN_GREEN_PORT:-3001}"
for port in "$blue_port" "$green_port"; do [[ "$port" =~ ^[0-9]+$ && "$port" -gt 1024 && "$port" -lt 65536 ]] || die 'неверный loopback port'; done
[[ "$blue_port" != "$green_port" ]] || die 'порты должны различаться'
timeout="${BLUEGREEN_TIMEOUT_SECONDS:-120}"; drain="${BLUEGREEN_DRAIN_SECONDS:-5}"
[[ "$timeout" =~ ^[0-9]+$ && "$timeout" -ge 1 && "$timeout" -le 3600 ]] || die 'неверный health timeout'
[[ "$drain" =~ ^[0-9]+$ && "$drain" -le 300 ]] || die 'неверный drain delay'
stop_timeout="${WORKER_GENERATION_STOP_TIMEOUT_SECONDS:-30}"
[[ "$stop_timeout" =~ ^[0-9]+$ && "$stop_timeout" -ge 10 && "$stop_timeout" -le 3600 ]] || die 'неверный stop timeout'
worker_helper="${BLUEGREEN_WORKER_HELPER:-$(dirname "$0")/replace-worker-generation.sh}"
[[ -f "$worker_helper" ]] || die 'нет F1 barrier helper'
network="${BLUEGREEN_APP_NETWORK:-${project}_pilingtrack}"
separator=':'; [[ "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* ]] || separator=';'
app_files="${BLUEGREEN_APP_COMPOSE_FILES:-docker-compose.yml${separator}docker-compose.prod.yml${separator}docker-compose.bluegreen.yml}"
worker_files="${BLUEGREEN_WORKER_COMPOSE_FILES:-${COMPOSE_FILE:-docker-compose.yml${separator}docker-compose.prod.yml}}"
run_caddy() {
  if [[ -n "$caddy_container" ]]; then docker exec "$caddy_container" caddy "$@";
  elif [[ "${BLUEGREEN_CADDY_SUDO:-1}" == 1 ]]; then sudo -n caddy "$@";
  else command caddy "$@"; fi
}
install_snippet() {
  if [[ -w "$snippet" ]]; then cp -- "$1" "$snippet.next" && mv -f -- "$snippet.next" "$snippet";
  else sudo -n install -m 644 "$1" "$snippet.next" && sudo -n mv -f -- "$snippet.next" "$snippet"; fi
}
health() {
  local body
  body=$(curl --fail --silent --show-error --max-time 10 "$1/api/health") || return 1
  grep -Eq '"version"[[:space:]]*:[[:space:]]*"'"$2"'"' <<<"$body"
}
smoke() {
  local path code
  health "$1" "$2" || return 1
  curl --fail --silent --show-error --max-time 10 "$1/api/ready" >/dev/null || return 1
  for path in / /login; do
    code=$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' "$1$path") || return 1
    [[ "$code" == 200 || "$code" == 307 || "$code" == 308 ]] || return 1
  done
  for path in /api/reports/all /api/equipment /api/users; do
    code=$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' "$1$path") || return 1
    [[ "$code" == 401 || "$code" == 403 ]] || return 1
  done
}
# Never rewrite an unfamiliar host configuration. One-time import is owner work.
[[ -f "$source_config" && -f "$snippet" && ! -L "$snippet" ]] || die 'владелец должен сначала установить managed upstream snippet'
snippet_name=$(basename "$snippet")
[[ "$snippet_name" =~ ^[a-zA-Z0-9._-]+$ ]] || die 'неверное имя snippet'
grep -Fxq "import $snippet_name" <(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$source_config") || die 'Caddyfile не импортирует managed snippet'
upstream=$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$snippet")
case "$upstream" in
  "reverse_proxy $proxy_host:$blue_port") active=blue; next=green; port="$green_port"; active_port="$blue_port" ;;
  "reverse_proxy $proxy_host:$green_port") active=green; next=blue; port="$blue_port"; active_port="$green_port" ;;
  *) die 'неизвестный upstream; конфиг не менялся' ;;
esac
run_caddy validate --config "$config" --adapter caddyfile >/dev/null || die 'текущий Caddy config невалиден'
docker image inspect "$image" >/dev/null || die 'образ не загружен'
old=(); legacy=()
for slot in blue green; do
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project-$slot") || die 'недоступен Docker'
  for id in $ids; do
    service=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
    embedded=$(docker inspect -f '{{range .Config.Env}}{{if eq (index (split . "=") 0) "EMBEDDED_WORKERS"}}{{index (split . "=") 1}}{{end}}{{end}}' "$id")
    [[ "$service" == app && "$embedded" == disabled ]] || die "слот $slot содержит неизвестный/embedded процесс"
    [[ "$slot" == "$active" ]] || die 'неактивный слот уже занят; требуется ручная проверка'
    old+=("$id")
  done
done
ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=app') || die 'не удалось найти legacy app'
for id in $ids; do legacy+=("$id"); done
[[ ${#old[@]} -le 1 && ${#legacy[@]} -le 1 ]] || die 'неоднородные app реплики'
if [[ ${#legacy[@]} == 1 ]]; then
  [[ ${#old[@]} == 0 && "$active" == blue ]] || die 'legacy app нельзя смешивать с активным HTTP слотом'
  old=("${legacy[@]}")
fi
[[ ${#old[@]} == 1 ]] || die 'не найден ровно один прежний app'
[[ "$(docker inspect -f '{{.State.Running}}' "${old[0]}")" == true ]] || die 'прежний app не RUNNING'
old_health=$(curl --fail --silent --show-error --max-time 10 "$public_url/api/health") || die 'старый proxy не обслуживает'
old_sha=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([a-zA-Z0-9._-]+)".*/\1/p' <<<"$old_health")
[[ -n "$old_sha" ]] || die 'старая версия не определена'
health "http://127.0.0.1:$active_port" "$old_sha" || die 'старый direct app не совпадает с proxy'
assert_shared_storage() {
  docker exec "$1" sh -c 'if [ -d /app/storage ]; then files=$(find /app/storage \( -type f -o -type l \) -print -quit) || exit 1; [ -z "$files" ]; fi' ||
    die 'app содержит local storage/проверка недоступна; сначала решение владельца по общему storage/S3'
  # The disposable HTTP-only stand has no business writes. Host deploy requires
  # S3 to prevent new local PDFs appearing while old in-flight requests drain.
  if [[ "$project" != codex-* ]]; then
    docker exec "$1" node -e 'process.exit(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? 0 : 1)' ||
      die 'blue-green требует S3 backend; локальные business files автоматически не переносятся'
  fi
}
assert_shared_storage "${old[0]}"
worker_ids=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=workers') || die 'workers storage preflight недоступен'
for id in $worker_ids; do assert_shared_storage "$id"; done
lock="${BLUEGREEN_LOCK:-/tmp/${project}-bluegreen.lock}"
mkdir "$lock" 2>/dev/null || die 'другая выкладка удерживает lock'
backup=$(mktemp); staged=$(mktemp)
cp -- "$snippet" "$backup"
printf 'reverse_proxy %s:%s\n' "$proxy_host" "$port" >"$staged"
candidate_started=0; switched=0; committed=0; assets=''
slot_compose() {
  COMPOSE_FILE="$app_files" APP_CONTAINER_NAME="$project-app-$next" APP_HOST_PORT="$port" APP_IMAGE="$image" EMBEDDED_WORKERS=disabled BLUEGREEN_APP_NETWORK="$network" \
    docker compose -p "$project-$next" "$@"
}
finish() {
  local result=$? restored=1
  trap - EXIT
  if [[ "$result" != 0 && "$committed" == 0 ]]; then
    if [[ "$switched" == 1 ]]; then
      if ! install_snippet "$backup" || ! run_caddy reload --config "$config" --adapter caddyfile || ! health "$public_url" "$old_sha"; then
        restored=0; echo 'OUTAGE: proxy rollback не подтверждён; оба app сохранены для ручной проверки' >&2
      else echo 'RECOVERED: прежний upstream обслуживает' >&2; fi
    fi
    if [[ "$candidate_started" == 1 && "$restored" == 1 ]]; then
      slot_compose stop --timeout "$stop_timeout" app >/dev/null || true
      slot_compose rm -f app >/dev/null || true
    fi
  fi
  if [[ -n "$assets" ]]; then
    [[ "$assets" == "$assets_root"/pilingtrack-bluegreen-static.* && -d "$assets" && ! -L "$assets" ]] || die 'небезопасный temporary static path'
    rm -rf -- "$assets"
  fi
  rm -f -- "$backup" "$staged"
  rmdir "$lock"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
candidate_started=1
slot_compose create --no-build app || die 'candidate CREATE отказал'
candidate=$(docker ps -aq --filter "label=com.docker.compose.project=$project-$next" --filter 'label=com.docker.compose.service=app')
[[ -n "$candidate" && "$candidate" != *$'\n'* ]] || die 'candidate должен быть ровно один'
[[ "$(docker inspect -f '{{range .Config.Env}}{{if eq (index (split . "=") 0) "EMBEDDED_WORKERS"}}{{index (split . "=") 1}}{{end}}{{end}}' "$candidate")" == disabled ]] || die 'candidate embedded workers не отключены до START'
# Preserve old tabs' immutable chunks before Next indexes candidate static files.
# Copy only static assets; candidate files take precedence on matching paths.
assets_root=$(realpath "${TMPDIR:-/tmp}")
assets=$(mktemp -d "$assets_root/pilingtrack-bluegreen-static.XXXXXXXX")
assets_path="$assets"
if command -v cygpath >/dev/null 2>&1; then assets_path=$(cygpath -m "$assets"); fi
docker cp "${old[0]}:/app/.next/static/." "$assets_path" || die 'старые static assets недоступны'
docker cp "$candidate:/app/.next/static/." "$assets_path" || die 'новые static assets недоступны'
docker cp "$assets_path/." "$candidate:/app/.next/static/" || die 'candidate static merge отказал'
slot_compose up -d --no-build --no-deps app || die 'candidate START отказал'
accepted=0
for ((attempt=0; attempt<timeout; attempt++)); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$candidate")" == healthy ]] && smoke "http://127.0.0.1:$port" "$sha"; then accepted=1; break; fi
  sleep 1
done
[[ "$accepted" == 1 ]] || die 'candidate health/readiness/version/smoke отказал; старый app сохранён'
[[ "$(docker inspect -f '{{range .Config.Env}}{{if eq (index (split . "=") 0) "EMBEDDED_WORKERS"}}{{index (split . "=") 1}}{{end}}{{end}}' "$candidate")" == disabled ]] || die 'candidate embedded workers не отключены'
assert_shared_storage "$candidate"
assert_shared_storage "${old[0]}"
switched=1
install_snippet "$staged" || die 'snippet install отказал'
run_caddy validate --config "$config" --adapter caddyfile >/dev/null || die 'новый Caddy config невалиден'
run_caddy reload --config "$config" --adapter caddyfile || die 'Caddy reload отказал'
health "$public_url" "$sha" || die 'proxy SHA после reload не совпал'
echo "SWITCH: $active → $next; HTTP $sha обслуживает, embedded disabled"
sleep "$drain"
# Re-check both slots immediately before F1; never infer disabled from a Redis key.
for id in "$candidate" "${old[@]}"; do
  if [[ ${#legacy[@]} == 1 && "$id" == "${legacy[0]}" ]]; then continue; fi
  [[ "$(docker inspect -f '{{range .Config.Env}}{{if eq (index (split . "=") 0) "EMBEDDED_WORKERS"}}{{index (split . "=") 1}}{{end}}{{end}}' "$id")" == disabled ]] || die 'embedded app перед F1'
done
COMPOSE_FILE="$worker_files" WORKER_GENERATION_PROJECT="$project" bash "$worker_helper" workers || die 'F1 worker replacement отказал; возврат proxy'
committed=1
if [[ ${#legacy[@]} == 0 ]]; then
  docker update --restart=no "${old[0]}" >/dev/null || die 'не удалось запретить рестарт old app'
  docker stop --time "$stop_timeout" "${old[0]}" >/dev/null || die 'старый app не остановлен'
fi
state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' "${old[0]}")
[[ "$state" == 'exited 0 false' || "$state" == 'exited 143 false' ]] || die "old app завершился нештатно ($state); candidate сохранён"
docker rm "${old[0]}" >/dev/null || die 'exited old app не удалён'
health "$public_url" "$sha" || die 'финальная HTTP проверка отказала; candidate сохранён'
echo "ACCEPTED: HTTP $sha, worker F1 завершён; active project $project-$next"
