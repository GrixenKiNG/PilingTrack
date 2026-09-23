#!/usr/bin/env bash
#
# Деплой на orionpiling.ru со сборкой образов ЛОКАЛЬНО.
#
#   bash scripts/deploy-prod.sh                 # app + workers
#   bash scripts/deploy-prod.sh app workers ws  # явный список
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

SERVICES=("$@")
[ ${#SERVICES[@]} -eq 0 ] && SERVICES=(app workers)

die() { echo "✖ $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }

dockerfile_of() {
  case "$1" in
    app) echo "Dockerfile runner" ;;
    migrate) echo "Dockerfile migrate" ;;
    workers) echo "Dockerfile.workers runner" ;;
    ws) echo "Dockerfile.ws runner" ;;
    *) die "неизвестный сервис: $1" ;;
  esac
}

# ── 1. Предпроверка ─────────────────────────────────────────
step "Предпроверка"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "не на ветке main"
git diff --quiet && git diff --cached --quiet || die "есть незакоммиченные изменения"
git fetch -q origin main
SHA=$(git rev-parse --short HEAD)
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "HEAD не совпадает с origin/main — сначала git push"
OLD=$("${SSH[@]}" "git -C $DIR rev-parse --short HEAD")
echo "сервер: $OLD → выкатываем: $SHA; сервисы: ${SERVICES[*]}"

# ── 2. Миграции ─────────────────────────────────────────────
NEW_MIGRATIONS=$(git diff --name-only --diff-filter=A "$OLD..$SHA" -- 'prisma/migrations/**' | grep -c 'migration.sql' || true)
if [ "$NEW_MIGRATIONS" -gt 0 ] && [[ ! " ${SERVICES[*]} " =~ " migrate " ]]; then
  echo "⚠ новых миграций: $NEW_MIGRATIONS — добавляю migrate (иначе он молча скажет «No pending migrations»)"
  SERVICES=(migrate "${SERVICES[@]}")
fi

# ── 3. Локальная сборка ─────────────────────────────────────
IMAGES=()
for svc in "${SERVICES[@]}"; do
  read -r file target <<<"$(dockerfile_of "$svc")"
  step "Сборка $svc ($file → $target)"
  docker build -f "$file" --target "$target" --build-arg "APP_VERSION=$SHA" -t "pilingtrack-$svc:$SHA" .
  IMAGES+=("pilingtrack-$svc:$SHA")
done

# ── 4. Откатные теги на сервере ─────────────────────────────
step "Откатные теги (держим один набор)"
ROLLBACK="$OLD-$(date +%Y%m%d)"
"${SSH[@]}" "set -e
  for svc in ${SERVICES[*]}; do
    img=pilingtrack-\$svc
    docker image inspect \$img:latest >/dev/null 2>&1 && docker tag \$img:latest \$img:$ROLLBACK
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
"${SSH[@]}" "set -e
  cd $DIR
  git pull -q origin main
  [ \"\$(git rev-parse --short HEAD)\" = $SHA ] || { echo 'git на сервере не совпал с $SHA'; exit 1; }
  for svc in ${SERVICES[*]}; do docker tag pilingtrack-\$svc:$SHA pilingtrack-\$svc:latest; done
  export APP_VERSION=$SHA
  docker compose up -d --no-build ${UP[*]}"

# ── 6. Проверка ─────────────────────────────────────────────
step "Проверка"
"${SSH[@]}" "cd $DIR
  for svc in ${UP[*]}; do
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
echo "  ssh -i $KEY $HOST \"cd $DIR && for s in ${UP[*]}; do docker tag pilingtrack-\\\$s:$ROLLBACK pilingtrack-\\\$s:latest; done && docker compose up -d --no-build ${UP[*]}\""
