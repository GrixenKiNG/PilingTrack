#!/usr/bin/env bash
#
# Локальный проверочный стенд: прогнать версию на копии боевой базы ДО
# выкладки на orionpiling.ru. Решение владельца 26.09.2026 («проверочный
# сервер локально на диске»).
#
#   bash scripts/staging-local.sh               # текущий коммит на стенд
#   bash scripts/staging-local.sh --refresh-db  # сначала свежая копия боевой базы
#   bash scripts/staging-local.sh --down        # остановить (база сохраняется)
#   bash scripts/staging-local.sh --destroy     # остановить и стереть базу стенда
#
# Что делает:
#   1. проверяет: дерево чистое (образ = коммит), Docker запущен;
#   2. при первом запуске заводит D:/PillingR/staging/.env.staging со СВОИМИ
#      случайными секретами (в git не попадает, на экран не выводится);
#   3. собирает образы app/workers/migrate с тегом <sha> теми же командами,
#      что scripts/deploy-prod.sh (уже собранный тег не пересобирает);
#   4. если базы стенда нет или указан --refresh-db — снимает дамп с боевого
#      сервера (только чтение) и разворачивает его: роли, данные, гранты;
#   5. поднимает стенд: migrate накатывает НОВЫЕ миграции на копию боевых
#      данных — ровно то, что случится при выкладке;
#   6. проверяет здоровье, версию, последние миграции и ошибки в журналах.
#
# Стенд: http://localhost:3100 (вход — боевыми email и паролем; ПИН-коды и
# ключи устройств здесь не работают: у стенда свои секреты).
#
# Что заглушено, чтобы стенд ничего не отправил людям:
#   - TELEGRAM_API_BASE указывает в никуда, а ENCRYPTION_KEY свой — токены
#     ботов из боевой базы не расшифровываются;
#   - файлы пишутся в локальный MinIO стенда, не в боевое хранилище;
#   - ошибки уходят в Sentry с меткой environment=staging.
set -euo pipefail

STAGE_DIR="${STAGING_DIR:-D:/PillingR/staging}"
ENV_FILE="$STAGE_DIR/.env.staging"
DUMP="$STAGE_DIR/prod.dump"
HOST="${DEPLOY_HOST:-user1@87.242.102.125}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/orionpiling}"
URL=http://localhost:3100

die() { echo "✖ $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }

REFRESH=0
case "${1:-}" in
  --refresh-db) REFRESH=1 ;;
  --down|--destroy|"") ;;
  *) die "неизвестный ключ: $1" ;;
esac

export STAGING_TAG="${STAGING_TAG:-$(git rev-parse --short HEAD)}"
DC=(docker compose -p pilingtrack-staging --env-file "$ENV_FILE"
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.staging.yml)

if [ "${1:-}" = --down ]; then "${DC[@]}" down; exit 0; fi
if [ "${1:-}" = --destroy ]; then "${DC[@]}" down -v; exit 0; fi

# ── 1. Предпроверка ─────────────────────────────────────────
step "Предпроверка"
docker info >/dev/null 2>&1 || die "Docker не запущен"
git diff --quiet && git diff --cached --quiet || die "есть незакоммиченные изменения — образ не совпадёт с коммитом"
echo "ветка $(git rev-parse --abbrev-ref HEAD), коммит $STAGING_TAG"

# ── 2. Секреты стенда ───────────────────────────────────────
mkdir -p "$STAGE_DIR"
if [ ! -f "$ENV_FILE" ]; then
  step "Секреты стенда → $ENV_FILE"
  r() { openssl rand -hex "$1"; }
  cat > "$ENV_FILE" <<EOF
# Проверочный стенд. Секреты СВОИ, не боевые — сгенерированы staging-local.sh.
POSTGRES_USER=piling
POSTGRES_DB=pilingtrack
POSTGRES_PASSWORD=$(r 24)
APP_DB_USER=pilingtrack_app
APP_DB_PASSWORD=$(r 24)
DB_IDENTITY_ROLE=pilingtrack_identity
REDIS_PASSWORD=$(r 24)
SESSION_SECRET=$(r 32)
ENCRYPTION_KEY=$(r 32)
PIN_LOOKUP_SECRET=$(r 32)
DEVICE_KEY_LOOKUP_SECRET=$(r 32)
DEFAULT_TENANT_ID=orion
SKIP_SEED=1
TELEGRAM_API_BASE=http://127.0.0.1:9
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=pilingtrack-reports
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
# pgadmin на стенде не запускается (профиль dev), но compose требует значение.
PGADMIN_PASSWORD=$(r 16)
EOF
fi

# ── 3. Образы ───────────────────────────────────────────────
for spec in "app Dockerfile runner" "workers Dockerfile.workers runner" "migrate Dockerfile migrate"; do
  read -r svc file target <<<"$spec"
  if docker image inspect "pilingtrack-$svc:$STAGING_TAG" >/dev/null 2>&1; then
    echo "образ pilingtrack-$svc:$STAGING_TAG уже есть"
  else
    step "Сборка $svc ($file → $target)"
    docker build -f "$file" --target "$target" --build-arg "APP_VERSION=$STAGING_TAG" -t "pilingtrack-$svc:$STAGING_TAG" .
  fi
done

# ── 4. База стенда ──────────────────────────────────────────
step "База стенда"
"${DC[@]}" up -d --wait postgres
psql_owner() { "${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -q -U piling -d "${1:-pilingtrack}"; }
HAS_DATA=$("${DC[@]}" exec -T postgres psql -U piling -d pilingtrack -Atc \
  "SELECT to_regclass('public.\"User\"') IS NOT NULL" </dev/null)

if [ "$REFRESH" = 1 ] || [ "$HAS_DATA" != t ]; then
  step "Дамп боевой базы (только чтение) → $DUMP"
  ssh -i "$KEY" -o ConnectTimeout=30 "$HOST" \
    "cd /opt/pilingtrack && docker compose exec -T postgres pg_dump -U piling -d pilingtrack -Fc --no-owner --no-acl" \
    </dev/null > "$DUMP.part"
  [ -s "$DUMP.part" ] || die "дамп пустой"
  mv "$DUMP.part" "$DUMP"
  ls -la "$DUMP"

  step "Разворачивание копии"
  "${DC[@]}" stop app workers pgbouncer >/dev/null 2>&1 || true
  psql_owner postgres <<'SQL'
DROP DATABASE IF EXISTS pilingtrack WITH (FORCE);
CREATE DATABASE pilingtrack;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pilingtrack_app') THEN CREATE ROLE pilingtrack_app LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pilingtrack_identity') THEN CREATE ROLE pilingtrack_identity NOLOGIN; END IF;
END $$;
SQL
  "${DC[@]}" exec -T postgres pg_restore -U piling -d pilingtrack --no-owner --no-acl < "$DUMP"
  psql_owner < scripts/app-role-grants.sql
  psql_owner < scripts/identity-role-grants.sql
  APP_PW=$(grep '^APP_DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2)
  echo "ALTER ROLE pilingtrack_app WITH LOGIN PASSWORD '$APP_PW';" | psql_owner
  "${DC[@]}" exec -T postgres psql -U piling -d pilingtrack -Atc \
    "SELECT 'отчётов '||(SELECT count(*) FROM \"Report\")||', пользователей '||(SELECT count(*) FROM \"User\")" </dev/null
fi

# ── 5. Подъём ───────────────────────────────────────────────
step "Подъём стенда ($STAGING_TAG)"
export APP_VERSION=$STAGING_TAG
# pgbouncer и MinIO не в depends_on у app — на сервере они просто всегда подняты.
"${DC[@]}" up -d --no-build pgbouncer minio minio-init
"${DC[@]}" up -d --no-build --wait app workers
UP_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "migrate:"
"${DC[@]}" logs --no-log-prefix migrate 2>&1 | grep -E 'migration|Applying|applied|No pending|✓|Error' | tail -8

# ── 6. Проверка ─────────────────────────────────────────────
step "Проверка"
echo "  health: $(curl -s "$URL/api/health")"
echo "  deep:   $(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health/deep")"
echo "  /login: $(curl -s -o /dev/null -w '%{http_code}' "$URL/login")"
echo "  последние миграции:"
"${DC[@]}" exec -T postgres psql -U piling -d pilingtrack -Atc \
  'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3;' </dev/null | sed 's/^/    /'
sleep 20  # дать воркерам сделать первые круги
ERRS=$("${DC[@]}" logs --since "$UP_AT" app workers 2>&1 | grep -ciE '"level":"?(error|fatal)|unhandled|ECONNREFUSED.*5432' || true)
echo "  ошибок в журналах app/workers после подъёма: $ERRS"
echo
echo "✔ стенд: $URL  (остановить: bash scripts/staging-local.sh --down)"
