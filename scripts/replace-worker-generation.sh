#!/usr/bin/env bash
# Barrier shared by deploy and rollback. No SSH, build, or image tag changes here.
set -euo pipefail
old=(); old_services=(); policies=(); was_running=(); scales=(); restore_services=()
declare -A images service_policies counts
changed=0; stop_started=0; start_attempted=0; recovery_file=''
die() { echo "✖ Смена поколения: $*" >&2; exit 1; }
recover() {
  local id service current all_present=1
  echo 'ROLLBACK: возврат предыдущего поколения' >&2
  if [[ "$start_attempted" == 1 ]]; then
    "${compose[@]}" stop --timeout "$timeout" app workers || return 1
    for service in app workers; do
      current=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") || return 1
      [[ -z "$current" ]] || return 1
    done
  fi
  for id in "${old[@]}"; do docker inspect --format '{{.Id}}' "$id" >/dev/null 2>&1 || all_present=0; done
  if [[ "$all_present" == 1 ]]; then
    for i in "${!old[@]}"; do
      docker update --restart="${policies[$i]}" "${old[$i]}" >/dev/null || return 1
      if [[ "$stop_started" == 1 && "${was_running[$i]}" == true ]]; then docker start "${old[$i]}" >/dev/null || return 1; fi
    done
  elif [[ ${#restore_services[@]} -gt 0 ]]; then
    # force-recreate may already have removed old IDs: use immutable saved images.
    recovery_file=$(mktemp) || return 1
    echo 'services:' >"$recovery_file"
    for service in "${restore_services[@]}"; do
      printf '  %s:\n    image: "%s"\n    restart: "%s"\n' "$service" "${images[$service]}" "${service_policies[$service]}" >>"$recovery_file"
    done
    recovery_compose="$recovery_file"
    if command -v cygpath >/dev/null 2>&1; then recovery_compose=$(cygpath -m "$recovery_file"); fi
    COMPOSE_PATH_SEPARATOR='|' COMPOSE_FILE="$base_files|$recovery_compose" "${compose[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout "$timeout" "${scales[@]}" "${restore_services[@]}" || return 1
  fi
  for service in "${restore_services[@]}"; do
    current=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") || return 1
    actual=0
    for id in $current; do
      [[ "$(docker inspect --format '{{.Image}}' "$id")" == "${images[$service]}" ]] || return 1
      [[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}{{if eq .HostConfig.RestartPolicy.Name "on-failure"}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}{{end}}' "$id")" == "${service_policies[$service]}" ]] || return 1
      actual=$((actual + 1))
    done
    [[ "$actual" == "${counts[$service]}" ]] || return 1
  done
  echo 'RECOVERED: старые образы, число реплик и restart-политики восстановлены' >&2
}
finish() {
  local result=$?
  trap - EXIT
  if [[ "$result" != 0 && "$changed" == 1 ]]; then
    if ! recover; then
      echo 'OUTAGE: автоматический возврат не выполнен. Проверьте отсутствие новых лидеров перед ручным запуском.' >&2
      echo 'После проверки: cd /opt/pilingtrack && docker compose up -d app workers' >&2
    fi
  fi
  [[ -z "$recovery_file" ]] || rm -f -- "$recovery_file"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
project="${WORKER_GENERATION_PROJECT:-pilingtrack}"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'неверное имя compose-проекта'
[[ "${WORKER_GENERATION_EXTERNAL_STOPPED:-0}" == 1 ]] || die 'подтвердите остановку внешних standalone/systemd/pm2/других хостов: WORKER_GENERATION_EXTERNAL_STOPPED=1'
services=("$@")
[[ ${#services[@]} -gt 0 ]] || die 'не указаны сервисы для старта'
for service in "${services[@]}"; do case "$service" in app|workers) ;; *) die "неизвестный сервис: $service" ;; esac; done
compose=(docker compose -p "$project")
base_files="${COMPOSE_FILE:-}"
if [[ -z "$base_files" ]]; then
  for candidate in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    if [[ -f "$candidate" ]]; then base_files="$candidate"; break; fi
  done
fi
[[ -n "$base_files" ]] || die 'compose-файл не найден'
# Normalize configured separators for the recovery override; never dump config/env.
separator=':'
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then separator=';'; fi
base_files="${base_files//${COMPOSE_PATH_SEPARATOR:-$separator}/|}"
if command -v cygpath >/dev/null 2>&1; then
  IFS='|' read -r -a paths <<<"$base_files"
  base_files=''
  for candidate in "${paths[@]}"; do base_files+="${base_files:+|}$(cygpath -m "$candidate")"; done
fi
timeout="${WORKER_GENERATION_STOP_TIMEOUT_SECONDS:-30}"
[[ "$timeout" =~ ^[0-9]+$ && "$timeout" -ge 10 && "$timeout" -le 3600 ]] || die 'таймаут compose должен быть от 10 до 3600 секунд'
# Preflight ALL replicas before any restart update or STOP.
for service in app workers; do
  counts[$service]=0
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") || die 'не удалось получить все старые реплики'
  for id in $ids; do
    oneoff=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$id") || die 'не удалось проверить one-off'
    [[ "${oneoff,,}" != true ]] || die "внешняя one-off реплика $id; остановите и удалите её до STOP"
    running=$(docker inspect --format '{{.State.Running}}' "$id") || die 'не удалось проверить состояние'
    [[ "$running" == true ]] || die "старая реплика $id не RUNNING; требуется проверка до STOP"
    deadline=$(docker inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "WORKER_SHUTDOWN_TIMEOUT_MS"}}{{index (split . "=") 1}}{{end}}{{end}}' "$id") || die 'не удалось проверить дедлайн'
    deadline=${deadline:-8000}
    [[ "$deadline" =~ ^[0-9]+$ && "$deadline" -gt 0 && "$deadline" -le 3595000 ]] || die 'некорректный WORKER_SHUTDOWN_TIMEOUT_MS'
    [[ $((timeout * 1000)) -ge $((deadline + 5000)) ]] || die 'таймаут compose должен превышать внутренний дедлайн worker минимум на 5 секунд'
    image=$(docker inspect --format '{{.Image}}' "$id") || die 'не удалось сохранить старый образ'
    policy=$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}{{if eq .HostConfig.RestartPolicy.Name "on-failure"}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}{{end}}' "$id") || die 'не удалось сохранить restart-политику'
    [[ "$image" =~ ^sha256:[a-f0-9]{64}$ && "$policy" =~ ^(no|always|unless-stopped|on-failure:[0-9]+)$ ]] || die 'некорректный образ/restart-policy'
    [[ -z "${images[$service]:-}" || ( "${images[$service]}" == "$image" && "${service_policies[$service]}" == "$policy" ) ]] || die 'неоднородные старые реплики; требуется ручная проверка до STOP'
    images[$service]="$image"; service_policies[$service]="$policy"; counts[$service]=$((counts[$service] + 1))
    old+=("$id"); old_services+=("$service"); policies+=("$policy"); was_running+=("$running")
  done
  if [[ "${counts[$service]}" -gt 0 ]]; then restore_services+=("$service"); scales+=(--scale "$service=${counts[$service]}"); fi
done
# Disable resurrection only once all preflight checks have passed.
changed=1
for id in "${old[@]}"; do docker update --restart=no "$id" >/dev/null || die 'не удалось запретить перезапуск'; done
stopped_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
stop_started=1
echo "STOP: проект $project, старых реплик ${#old[@]}, таймаут ${timeout}с"
"${compose[@]}" stop --timeout "$timeout" app workers || die 'остановка compose не выполнена'
for i in "${!old[@]}"; do
  id="${old[$i]}"; service="${old_services[$i]}"
  state=$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$id") || die 'не удалось проверить завершение'
  [[ "$state" == 'exited 0 false' || ( "$service" == app && "$state" == 'exited 143 false' ) ]] || die "реплика $id не завершилась штатно ($state)"
  shutdown_log=$(docker logs --since "$stopped_at" "$id" 2>&1) || die 'журнал остановки недоступен'
  if grep -Eq '(Embedded worker|Worker|Redis|Prisma) shutdown failed|Shutdown deadline exceeded' <<<"$shutdown_log"; then die "реплика $id сообщила об ошибке завершения задач"; fi
done
for service in app workers; do
  running=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") || die 'не удалось проверить отсутствие RUNNING'
  [[ -z "$running" ]] || die "осталась RUNNING реплика $service"
done
echo 'VERIFY: все старые реплики завершены, RUNNING отсутствуют'
echo "START: ${services[*]}"
start_attempted=1
"${compose[@]}" up -d --no-build --force-recreate --wait --wait-timeout "$timeout" "${scales[@]}" "${services[@]}" || die 'запуск нового поколения не выполнен'
