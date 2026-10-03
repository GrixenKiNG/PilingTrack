#!/usr/bin/env bash
#
# Деплой на orionpiling.ru со сборкой образов ЛОКАЛЬНО.
#
#   WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh app workers
#   App: blue-green HTTP (embedded disabled), dedicated workers: F1 barrier.
#   --replace-worker-generation сохраняет legacy STOP→VERIFY→START для отката.
#
# ЗАЧЕМ (23.09.2026). Сборка на VPS временно съедала 5–6 ГБ из 30 и довела
# диск до 100% — рядом с работающей базой. Здесь образы собираются на машине
# разработчика, а на сервер уезжают готовыми (docker save | ssh docker load):
# на сервере занимается ровно размер образа, пика нет. Ранбук 008 остаётся
# запасным путём.
#
# Что делает:
#   1. проверяет: ветка main, дерево чистое, HEAD уже в origin/main;
#   2. новая миграция в диапазоне «версия на сервере → HEAD» ⇒ добавляет migrate;
#   3. собирает образы локально с тегом <sha>;
#   4. на сервере помечает текущие :latest откатным тегом <старый sha>-<дата>
#      и удаляет более старые откатные теги — держим ОДИН набор;
#   5. передаёт образы, делает git pull, переключает :latest и поднимает сервисы;
#   6. проверяет здоровье и версию; печатает команду отката.
set -euo pipefail

HOST="${DEPLOY_HOST:-user1@87.242.102.125}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/orionpiling}"
DIR=/opt/pilingtrack
SSH=(ssh -i "$KEY" -o ConnectTimeout=30 -o ServerAliveInterval=15 "$HOST")

REPLACE_GENERATION=0
if [ "${1:-}" = --replace-worker-generation ]; then REPLACE_GENERATION=1; shift; fi
SERVICES=("$@")
[ ${#SERVICES[@]} -eq 0 ] && SERVICES=(app workers)

die() { echo "✖ $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }

dockerfile_of() {
  case "$1" in
    app) echo "Dockerfile runner" ;;
    migrate) echo "Dockerfile migrate" ;;
    workers) echo "Dockerfile.workers runner" ;;
    *) die "неизвестный сервис: $1" ;;
  esac
}

for svc in "${SERVICES[@]}"; do dockerfile_of "$svc" >/dev/null; done

# Migrate-only cannot start an implicit full compose generation without F1.
if [[ " ${SERVICES[*]} " != *" app "* && " ${SERVICES[*]} " != *" workers "* ]]; then
  die 'migrate-only запрещён: владелец выполняет явную one-off миграцию по ранбуку; для релиза выберите app workers'
fi

# Blue-green app includes worker replacement, retaining the external barrier.
if [[ " ${SERVICES[*]} " == *" workers "* || " ${SERVICES[*]} " == *" app "* ]]; then
  if [[ ! " ${SERVICES[*]} " == *" app "* ]]; then
    [ "$REPLACE_GENERATION" = 1 ] || die 'workers-only требует --replace-worker-generation; для HTTP без простоя выберите app workers'
  fi
  if [[ " ${SERVICES[*]} " == *" migrate "* ]]; then SERVICES=(migrate app workers); else SERVICES=(app workers); fi
  [ "${WORKER_GENERATION_EXTERNAL_STOPPED:-0}" = 1 ] || die 'сначала остановите все внешние воркеры и подтвердите WORKER_GENERATION_EXTERNAL_STOPPED=1'
fi

# ── 1. Предпроверка ─────────────────────────────────────────
step "Предпроверка"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "не на ветке main"
git diff --quiet && git diff --cached --quiet || die "есть незакоммиченные изменения"
git fetch -q origin main
SHA=$(git rev-parse --short HEAD)
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "HEAD не совпадает с origin/main — сначала git push"
# Workers проверяем до первого SSH, чтобы сломанный образ не касался сервера.
if [[ " ${SERVICES[*]} " == *" workers "* ]]; then
  step "Сборка workers (Dockerfile.workers → runner)"
  docker build -f Dockerfile.workers --target runner --build-arg "APP_VERSION=$SHA" -t "pilingtrack-workers:$SHA" .
  if [ "${SKIP_WORKERS_SMOKE:-0}" = 1 ]; then
    echo "⚠ АВАРИЙНЫЙ ОБХОД: SKIP_WORKERS_SMOKE=1 — образ workers НЕ ПРОВЕРЕН" >&2
  else
    bash "$(dirname "${BASH_SOURCE[0]}")/smoke-workers-image.sh" "pilingtrack-workers:$SHA"
  fi
fi
OLD=$("${SSH[@]}" "curl --fail --silent --show-error --max-time 15 https://orionpiling.ru/api/health | sed -nE 's/.*\"version\"[[:space:]]*:[[:space:]]*\"([a-f0-9]+)\".*/\\1/p'")
[[ "$OLD" =~ ^[a-f0-9]{7,40}$ ]] || die 'фактическая версия app не определена; git HEAD не заменяет serving SHA'
if [ "$REPLACE_GENERATION" = 1 ]; then
  "${SSH[@]}" "set -e
    for slot in blue green; do
      ids=\$(docker ps -q --filter label=com.docker.compose.project=pilingtrack-\$slot --filter label=com.docker.compose.service=app)
      [ -z \"\$ids\" ] || { echo 'legacy barrier запрещён после blue-green; используйте default app workers'; exit 1; }
    done" || die 'legacy preflight отказал до удалённых image/tag/git изменений'
fi
# Default blue-green host preflight is self-contained: the new helper may not
# exist on the host yet. Refuse an unprepared proxy before remote tags/git/DDL.
if [ "$REPLACE_GENERATION" = 0 ] && [[ " ${SERVICES[*]} " == *" app "* ]]; then
  "${SSH[@]}" "set -e
    config=/etc/caddy/Caddyfile
    snippet=/etc/caddy/app-upstream.caddy
    [ -f \"\$config\" ] && [ -f \"\$snippet\" ] && [ ! -L \"\$snippet\" ] || { echo 'владелец должен подготовить managed Caddy snippet'; exit 1; }
    grep -Eq '^[[:space:]]*import[[:space:]]+app-upstream[.]caddy[[:space:]]*$' \"\$config\" || { echo 'managed Caddy import отсутствует'; exit 1; }
    case \"\$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \"\$snippet\")\" in
      'reverse_proxy 127.0.0.1:3000'|'reverse_proxy 127.0.0.1:3001') ;;
      *) echo 'неизвестный managed upstream'; exit 1 ;;
    esac
    sudo -n caddy validate --config \"\$config\" --adapter caddyfile >/dev/null" || die 'Caddy preflight отказал до удалённых image/tag/git/migration изменений'
fi
echo "сервер: $OLD → выкатываем: $SHA; сервисы: ${SERVICES[*]}"

# ── 2. Миграции ─────────────────────────────────────────────
NEW_MIGRATIONS=$(git diff --name-only --diff-filter=A "$OLD..$SHA" -- 'prisma/migrations/**' | grep -c 'migration.sql' || true)
if [ "$NEW_MIGRATIONS" -gt 0 ] && [[ ! " ${SERVICES[*]} " =~ " migrate " ]]; then
  echo "⚠ новых миграций: $NEW_MIGRATIONS — добавляю migrate (иначе он молча скажет «No pending migrations»)"
  SERVICES=(migrate "${SERVICES[@]}")
fi
if [ "$REPLACE_GENERATION" = 0 ] && [[ " ${SERVICES[*]} " == *" migrate "* ]]; then
  [ "${BLUEGREEN_MIGRATIONS_COMPATIBLE:-0}" = 1 ] || die 'сначала проверьте совместимость миграций со старым app и подтвердите BLUEGREEN_MIGRATIONS_COMPATIBLE=1'
fi

# ── 3. Локальная сборка ─────────────────────────────────────
IMAGES=()
for svc in "${SERVICES[@]}"; do
  read -r file target <<<"$(dockerfile_of "$svc")"
  step "Сборка $svc ($file → $target)"
  if [ "$svc" != workers ]; then
    docker build -f "$file" --target "$target" --build-arg "APP_VERSION=$SHA" -t "pilingtrack-$svc:$SHA" .
  fi
  IMAGES+=("pilingtrack-$svc:$SHA")
done

# ── 4. Откатные теги на сервере ─────────────────────────────
step "Откатные теги (держим один набор)"
ROLLBACK="$OLD-$(date +%Y%m%d)"
"${SSH[@]}" "set -e
  for svc in ${SERVICES[*]}; do
    img=pilingtrack-\$svc
    if [ \"\$svc\" = app ]; then
      app_id=\$(docker ps -q --filter label=com.docker.compose.project=pilingtrack --filter label=com.docker.compose.service=app)
      if [ -z \"\$app_id\" ]; then
        case \"\$(cat /etc/caddy/app-upstream.caddy)\" in
          'reverse_proxy 127.0.0.1:3000') slot=blue ;;
          'reverse_proxy 127.0.0.1:3001') slot=green ;;
          *) echo 'неизвестный Caddy upstream; rollback не сохранён'; exit 1 ;;
        esac
        app_id=\$(docker ps -q --filter label=com.docker.compose.project=pilingtrack-\$slot --filter label=com.docker.compose.service=app)
      fi
      [ \"\$(printf '%s' \"\$app_id\" | wc -w)\" = 1 ] || { echo 'не найден ровно один serving app'; exit 1; }
      image_id=\$(docker inspect -f '{{.Image}}' \"\$app_id\")
      docker tag \"\$image_id\" \$img:$ROLLBACK
    elif [ \"\$svc\" = workers ]; then
      worker_ids=\$(docker ps -q --filter label=com.docker.compose.project=pilingtrack --filter label=com.docker.compose.service=workers)
      [ -n \"\$worker_ids\" ] || { echo 'прежние workers не RUNNING; rollback не определён'; exit 1; }
      image_id=''
      for id in \$worker_ids; do
        actual=\$(docker inspect -f '{{.Image}}' \"\$id\")
        [ -z \"\$image_id\" ] || [ \"\$image_id\" = \"\$actual\" ] || { echo 'неоднородные worker images'; exit 1; }
        image_id=\$actual
      done
      docker tag \"\$image_id\" \$img:$ROLLBACK
    else
      docker image inspect \$img:latest >/dev/null 2>&1 && docker tag \$img:latest \$img:$ROLLBACK
    fi
    for tag in \$(docker images \$img --format '{{.Tag}}'); do
      case \$tag in latest|$ROLLBACK) ;; *) docker rmi \$img:\$tag >/dev/null 2>&1 && echo \"  удалён \$img:\$tag\" || true ;; esac
    done
  done
  df -h / | tail -1"

# ── 5. Передача и переключение ──────────────────────────────
step "Передача образов (${IMAGES[*]})"
docker save "${IMAGES[@]}" | gzip -1 | "${SSH[@]}" 'gunzip | docker load'

step "Переключение"
UP=()
for svc in "${SERVICES[@]}"; do [ "$svc" != migrate ] && UP+=("$svc"); done
SWITCH="docker compose up -d --no-build ${UP[*]}"
if [ "$REPLACE_GENERATION" = 1 ]; then
  SWITCH="WORKER_GENERATION_EXTERNAL_STOPPED=1 WORKER_GENERATION_PROJECT=pilingtrack bash scripts/replace-worker-generation.sh ${UP[*]}"
elif [[ " ${UP[*]} " == *" app "* ]]; then
  SWITCH="WORKER_GENERATION_EXTERNAL_STOPPED=1 WORKER_GENERATION_PROJECT=pilingtrack bash scripts/replace-app-bluegreen.sh pilingtrack-app:$SHA $SHA"
fi
MIGRATE_FIRST=''
if [ "$REPLACE_GENERATION" = 0 ] && [[ " ${SERVICES[*]} " == *" migrate "* ]]; then MIGRATE_FIRST='docker compose run --rm --no-deps migrate'; fi
"${SSH[@]}" "set -e
  cd $DIR
  git pull -q origin main
  [ \"\$(git rev-parse --short HEAD)\" = $SHA ] || { echo 'git на сервере не совпал с $SHA'; exit 1; }
  for svc in ${SERVICES[*]}; do docker tag pilingtrack-\$svc:$SHA pilingtrack-\$svc:latest; done
  export APP_VERSION=$SHA
  $MIGRATE_FIRST
  $SWITCH"

# ── 6. Проверка ─────────────────────────────────────────────
step "Проверка"
"${SSH[@]}" "cd $DIR
  for svc in ${UP[*]}; do
    if [ \"\$svc\" = app ] && [ $REPLACE_GENERATION = 0 ]; then
      echo '  app: blue-green SHA/health проверены helper; текущий slot в Caddy upstream'
      continue
    fi
    for i in \$(seq 1 30); do
      s=\$(docker inspect -f '{{.State.Health.Status}}' pilingtrack-\$svc 2>/dev/null || echo none)
      [ \"\$s\" = healthy ] && break; sleep 4
    done
    echo \"  \$svc: \$s\"
  done
  echo \"  health: \$(curl -s https://orionpiling.ru/api/health)\"
  echo \"  deep:   \$(curl -s -o /dev/null -w '%{http_code}' https://orionpiling.ru/api/health/deep)\"
  if echo ' ${SERVICES[*]} ' | grep -q ' migrate '; then
    docker compose exec -T postgres psql -U piling -d pilingtrack -Atc \
      'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3;'
  fi
  df -h / | tail -1"

echo
echo "✔ выкачено $SHA. Откат:"
if [ "$REPLACE_GENERATION" = 0 ] && [[ " ${UP[*]} " == *" app "* ]]; then
  echo "  после проверки схемы/внешней остановки: tag workers:$ROLLBACK → latest; WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-app-bluegreen.sh pilingtrack-app:$ROLLBACK $OLD"
else
  echo "  после проверки схемы/внешней остановки: восстановить сохранённые image tags и WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh ${UP[*]}"
fi
