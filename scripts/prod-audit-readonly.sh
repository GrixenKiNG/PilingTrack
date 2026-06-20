#!/usr/bin/env bash
# ============================================================
# PilingTrack — READ-ONLY production diagnostics
# ------------------------------------------------------------
# Ничего не меняет: только ps / df / ss / logs / SELECT / INFO / openssl.
# Безопасно запускать на боевом сервере.
#
# Как запустить (НЕ копируя файл на сервер):
#   ssh -i $HOME\.ssh\orionpiling user1@87.242.102.125 'bash -s' < scripts/prod-audit-readonly.sh
#
# Или скопировать и запустить на сервере:
#   scp -i ~/.ssh/orionpiling scripts/prod-audit-readonly.sh user1@87.242.102.125:/tmp/
#   ssh -i ~/.ssh/orionpiling user1@87.242.102.125 'bash /tmp/prod-audit-readonly.sh'
# ============================================================

# НЕ ставим `set -e` — хотим пройти все проверки, даже если часть упадёт.
APP_DIR="/opt/pilingtrack"
DOMAIN="orionpiling.ru"
if cd "$APP_DIR" 2>/dev/null; then APP_DIR_OK=1; else
  APP_DIR_OK=0
  echo "!! Нет каталога $APP_DIR — это точно нужный сервер?"
  echo "   Секции, зависящие от приложения (.env/Postgres/Redis), будут помечены как ПРОПУЩЕНО."
fi

line() { printf '\n=================== %s ===================\n' "$1"; }
# sudo без запроса пароля: если нельзя — тихо отдаём пустоту, проверка просто без процессов.
SUDO=""; if sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi

# ------------------------------------------------------------
line "1. ХОСТ: аптайм / нагрузка"
uptime
echo "Ядра: $(nproc 2>/dev/null)"

line "2. ДИСК (порог тревоги 85%)"
df -h / /var/lib/docker 2>/dev/null | sort -u
echo "--- топ-5 каталогов в $APP_DIR ---"
du -sh "$APP_DIR"/* 2>/dev/null | sort -rh | head -5
echo "--- использование Docker ---"
docker system df 2>/dev/null

line "3. ПАМЯТЬ / SWAP"
free -m

# ------------------------------------------------------------
line "4. COMPOSE: какой стек запущен"
echo "--- COMPOSE_FILE в .env (есть ли prod-overlay?) ---"
if grep -qE '^COMPOSE_FILE' "$APP_DIR/.env" 2>/dev/null; then
  grep -E '^COMPOSE_FILE' "$APP_DIR/.env"
  HAS_OVERLAY=1
else
  echo ">> COMPOSE_FILE НЕ задан — docker compose берёт только базовый docker-compose.yml"
  HAS_OVERLAY=0
fi
echo "--- docker compose ps ---"
docker compose ps 2>/dev/null || docker ps --format 'table {{.Names}}\t{{.Status}}'

# ------------------------------------------------------------
line "5. ПОРТЫ КОНТЕЙНЕРОВ (ищем 0.0.0.0 = наружу)"
docker ps --format 'table {{.Names}}\t{{.Ports}}'
echo
echo "--- публичные публикации портов (0.0.0.0 / ::) ---"
EXPOSED=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0:|:::' )
if [ -n "$EXPOSED" ]; then echo "$EXPOSED"; else echo "(нет публикаций на 0.0.0.0 — всё на loopback)"; fi

line "6. СЛУШАЮЩИЕ СОКЕТЫ хоста (НЕ loopback = доступно из сети)"
$SUDO ss -tlnp 2>/dev/null | grep -vE '127\.0\.0\.1|\[::1\]' || ss -tln | grep -vE '127\.0\.0\.1|\[::1\]'

line "7. ФАЕРВОЛ"
$SUDO ufw status verbose 2>/dev/null || echo "(ufw недоступен или нет sudo — проверь security-group у провайдера вручную)"

# ------------------------------------------------------------
line "8. РЕСУРСЫ КОНТЕЙНЕРОВ (snapshot)"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null

line "9. HEALTH КОНТЕЙНЕРОВ"
docker ps --format '{{.Names}}' | while read -r c; do
  hs=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$c" 2>/dev/null)
  rc=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)
  printf '  %-28s health=%-12s restarts=%s\n' "$c" "$hs" "$rc"
done

line "10. HTTP HEALTH-ЭНДПОИНТЫ"
for url in \
  "http://127.0.0.1:3000/api/health" \
  "http://127.0.0.1:3000/api/ready" \
  "https://$DOMAIN/api/health"; do
  code_time=$(curl -ksS -o /dev/null -w '%{http_code}  %{time_total}s' --max-time 10 "$url" 2>/dev/null)
  printf '  %-45s -> %s\n' "$url" "${code_time:-НЕ ОТВЕТИЛ}"
done
echo "--- тело /api/health (локально) ---"
curl -ksS --max-time 10 http://127.0.0.1:3000/api/health 2>/dev/null | head -c 800; echo

line "11. TLS-СЕРТИФИКАТ ($DOMAIN)"
echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates 2>/dev/null \
  || echo "(openssl недоступен или сертификат не получен)"

# ------------------------------------------------------------
line "12. ЛОГИ: ошибки за 24ч (по каждому контейнеру, последние 25 строк)"
docker ps --format '{{.Names}}' | while read -r c; do
  errs=$(docker logs --since 24h "$c" 2>&1 | grep -iE 'error|fatal|exception|unhandled|ECONNREFUSED|ETIMEDOUT|timeout|panic|OOM' | tail -25)
  if [ -n "$errs" ]; then
    echo "----- $c -----"; echo "$errs"
  else
    echo "----- $c -----  (чисто)"
  fi
done

# ------------------------------------------------------------
line "13. POSTGRES: соединения / размер / долгие запросы"
# Имя контейнера резолвим от запущенных (на случай иного префикса compose-проекта);
# дефолт — задокументированный pilingtrack-postgres. Пусто ⇒ явное ПРОПУЩЕНО, а не тихий ноль.
PG_CT=$(docker ps --filter 'name=postgres' --format '{{.Names}}' 2>/dev/null | head -1)
PG_CT=${PG_CT:-pilingtrack-postgres}
if ! docker inspect "$PG_CT" >/dev/null 2>&1; then
  echo "(контейнер postgres не найден — ПРОПУЩЕНО; см. имена в 'docker compose ps' секции 4)"
else
  [ "$PG_CT" != "pilingtrack-postgres" ] && echo "(контейнер: $PG_CT — не дефолтный)"
  PSQL="docker exec -i $PG_CT psql -U piling -d pilingtrack -t -A"
  $PSQL -c "SELECT 'connections', count(*), 'of max', current_setting('max_connections') FROM pg_stat_activity;" 2>/dev/null
  $PSQL -c "SELECT 'db_size', pg_size_pretty(pg_database_size('pilingtrack'));" 2>/dev/null
  $PSQL -c "SELECT 'long_queries(>30s)', count(*) FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '30 seconds';" 2>/dev/null
  echo "--- последняя применённая миграция ---"
  $PSQL -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;" 2>/dev/null
fi

line "14. REDIS: память / клиенты / отказы"
RD_CT=$(docker ps --filter 'name=redis' --format '{{.Names}}' 2>/dev/null | head -1)
RD_CT=${RD_CT:-pilingtrack-redis}
if ! docker inspect "$RD_CT" >/dev/null 2>&1; then
  echo "(контейнер redis не найден — ПРОПУЩЕНО)"
else
  [ "$RD_CT" != "pilingtrack-redis" ] && echo "(контейнер: $RD_CT — не дефолтный)"
  RP=$(grep -E '^REDIS_PASSWORD=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')
  RCLI="docker exec -i $RD_CT redis-cli"
  [ -n "$RP" ] && RCLI="$RCLI -a $RP --no-auth-warning"
  $RCLI info memory 2>/dev/null | grep -E 'used_memory_human|maxmemory_human|mem_fragmentation_ratio'
  $RCLI info stats 2>/dev/null | grep -E 'rejected_connections|evicted_keys|keyspace_misses'
  $RCLI info clients 2>/dev/null | grep -E 'connected_clients'
fi

# ------------------------------------------------------------
line "ВЕРДИКТ ПО ПОРТАМ (главный вопрос аудита)"
if [ -n "$EXPOSED" ]; then
  echo "⚠️  Есть публикации на 0.0.0.0 (см. секцию 5). Проверь, закрыты ли они фаерволом (секция 7)."
  echo "   Если в ufw НЕ deny на эти порты — БД/Redis/MinIO доступны из интернета. Закрыть."
else
  echo "✅ Контейнеры не публикуют портов на 0.0.0.0 — БД/Redis на внутренней сети. Хорошо."
fi
[ "$HAS_OVERLAY" = "0" ] && echo "ℹ️  COMPOSE_FILE не задан — overlay docker-compose.prod.yml НЕ применяется (см. секцию 4)."
echo
if [ "$APP_DIR_OK" = "0" ]; then
  echo "=========== ГОТОВО (ЧАСТИЧНО — каталог приложения не найден) ==========="
  echo "⚠️  $APP_DIR отсутствует: проверки .env/Postgres/Redis ПРОПУЩЕНЫ. Это нужный сервер?"
else
  echo "=================== ГОТОВО ==================="
fi
