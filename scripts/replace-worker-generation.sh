#!/usr/bin/env bash
# Barrier shared by deploy and rollback. No SSH, build, or image tag changes here.
set -euo pipefail
die() { echo "✖ Смена поколения: $*" >&2; exit 1; }
project="${WORKER_GENERATION_PROJECT:-pilingtrack}"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'неверное имя compose-проекта'
[[ "${WORKER_GENERATION_EXTERNAL_STOPPED:-0}" == 1 ]] || die 'подтвердите остановку внешних standalone/systemd/pm2/других хостов: WORKER_GENERATION_EXTERNAL_STOPPED=1'
services=("$@")
[[ ${#services[@]} -gt 0 ]] || die 'не указаны сервисы для старта'
for service in "${services[@]}"; do
  case "$service" in app|workers) ;; *) die "неизвестный сервис: $service" ;; esac
done
compose=(docker compose -p "$project")
# App has embedded outbox/projection workers by default: always stop both.
old=()
for service in app workers; do
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") || die 'не удалось получить все старые реплики'
  for id in $ids; do old+=("$id"); done
done
timeout="${WORKER_GENERATION_STOP_TIMEOUT_SECONDS:-30}"
[[ "$timeout" =~ ^[0-9]+$ && "$timeout" -ge 10 && "$timeout" -le 3600 ]] || die 'таймаут compose должен быть от 10 до 3600 секунд'
for id in "${old[@]}"; do
  deadline=$(docker inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "WORKER_SHUTDOWN_TIMEOUT_MS"}}{{index (split . "=") 1}}{{end}}{{end}}' "$id") || die 'не удалось проверить дедлайн старой реплики'
  deadline=${deadline:-8000}
  [[ "$deadline" =~ ^[0-9]+$ && "$deadline" -gt 0 && "$deadline" -le 3595000 ]] || die 'некорректный WORKER_SHUTDOWN_TIMEOUT_MS старой реплики'
  [[ $((timeout * 1000)) -ge $((deadline + 5000)) ]] || die 'таймаут compose должен превышать внутренний дедлайн worker минимум на 5 секунд'
  # Prevent automatic resurrection of the old generation during the barrier.
  docker update --restart=no "$id" >/dev/null || die 'не удалось запретить перезапуск старой реплики'
done
echo "STOP: проект $project, старых реплик ${#old[@]}, таймаут ${timeout}с"
"${compose[@]}" stop --timeout "$timeout" app workers || die 'остановка compose не выполнена; новое поколение не запущено'
# Compose may omit one-off replicas; stop these by their captured IDs as well.
for id in "${old[@]}"; do
  running=$(docker inspect --format '{{.State.Running}}' "$id") || die 'старая реплика исчезла до проверки результата остановки'
  if [[ "$running" == true ]]; then docker stop --time "$timeout" "$id" >/dev/null || die 'не удалось остановить старую one-off реплику'; fi
done
for id in "${old[@]}"; do
  state=$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$id") || die 'не удалось проверить завершение старой реплики'
  [[ "$state" == 'exited 0 false' || "$state" == 'created 0 false' ]] || die "реплика $id не завершилась штатно ($state); проверьте drain и журналы, старта не будет"
done
for service in app workers; do
  running=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") || die 'не удалось проверить отсутствие RUNNING'
  [[ -z "$running" ]] || die "осталась RUNNING реплика $service; новое поколение не запущено"
done
echo 'VERIFY: все старые реплики завершены, RUNNING отсутствуют'
# No up (including dependencies) is issued before the whole barrier succeeds.
echo "START: ${services[*]}"
if ! "${compose[@]}" up -d --no-build --force-recreate "${services[@]}"; then
  "${compose[@]}" stop --timeout "$timeout" app workers || die 'запуск и остановка частично поднятых сервисов не выполнены; требуется ручная проверка'
  die 'запуск нового поколения не выполнен; частично поднятые сервисы остановлены'
fi