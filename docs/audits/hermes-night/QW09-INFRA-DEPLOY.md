# QW09 — Инфраструктура и выкладка

Аудит инфраструктуры и выкладки PilingTrack: docker-compose, Dockerfiles, скрипты
деплоя, ранбуки, healthcheck, пределы, секреты, переменные окружения, откат.
Только чтение — код не меняли.

Версия: `git rev-parse HEAD` = `44f18be4fb005cbf3b7ad37af2af1bee33eb2cb9`,
ветка `hermes/code-1011` (worktree), дерево чистое.

## Итог

Найдено **18** находок: **критично — 3**, **важно — 11**, **мелочь — 4**.

Топ‑5 (сначала что может уже сегодня ломать/врать):

1. **Критично.** Мониторинг «свежесть бэкапа» проверяет локальный
   `/backups/pilingtrack/daily` в app‑контейнере, а реальный бэкап лежит в
   `pgbackups` (Postgres). Пока `BACKUP_ENABLED` не выставлено, «здоровье
   бэкапа» молча `ok` — см. #1.
2. **Критично.** `ENCRYPTION_KEY*` не в списке **required** `validate-env.ts` — код бросит
   исключение только при первом шифровании; деплой может пройти успешно, а
   запись секрета упадёт. #2.
3. **Критично.** У `app` нет `mem_limit`/`cpus`, на одном VPS с Postgres/Redis/MinIO/
   Caddy/worker — одна «утечка» убивает всю машину. #4.
4. **Важно.** `Redis maxmemory` не задан нигде — по умолчанию `noeviction`, при
   переполнении запись кэша падает ошибкой, при этом health всё равно `ok`. #8.
5. **Важно.** `HEALTHCHECK` в Dockerfile проверяет только `/api/health`; health
   route не обязан проверять, что embedded workers живы. #13.

## Методика

- `rg -o "process\.env\.([A-Z0-9_]+)"` по `src/` (без `operator/*` и `orion/*`)
  → 69 уникальных имён переменных (список в приложении А).
- `rg -n` по списку ключевых имён → file:line в `src/*`.
- `cat -n` / `sed -n` по `docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.staging.yml`, `docker-compose.observability.yml`,
  `docker-compose.monitoring-prod.yml`, `Dockerfile`, `Dockerfile.workers`,
  `scripts/deploy-prod.sh`, `scripts/replace-worker-generation.sh`,
  `scripts/smoke-workers-image.sh`, `scripts/docker-daemon.json`,
  `scripts/validate-env.ts`, `scripts/generate-env-docker.ps1`,
  `docs/runbooks/008-manual-deploy.md`, `docs/runbooks/014-post-deploy-2026-10.md`.
- Diff env‑списка в `src/` против `environment:`/`env_file` в compose → приложение Б.
- **Не читались** `docs/audits/*`, `CODEX-REPORT*`, `docs/strategy` (запрет
  задачи).
- **Не запускались** контейнеры, `docker ps`, сборка `npm run build` — только
  статический анализ репозитория.
- Статусы: «ПРОЙДЕНО» — значение подтверждено по коду; «НЕ ПРОВЕРЕНО» — в
  репозитории нет, но может задаваться в `.env.production` или окружении на
  сервере; «ГИПОТЕЗА» — код допускает сценарий, не подтверждён на сервере.

## Находки

| # |Severity | path:line | Параметр | Текущее | Риск / сценарий | Предложение |
|---|---|---|---|---|---|---|
| 1 | критично | `src/core/observability/health-tracker/checkers/backup.ts:33,35` | Бэкап Postgres | health‑checker читает `BACKUP_DIR` (дефолт `/backups/pilingtrack/daily`), а `scripts/backup-postgres.sh:21` пишет в `/data/pgbackups/daily` в Postgres‑контейнере | app не видит свежие дампы: «backup: ok» ложно, пока `BACKUP_ENABLED` выключен | Переместить проверку на Redis‑метку (уже есть `system:backup:*` — см. комментарий backup.ts:5) или mount‑нуть pgbackups в app |
| 2 | критично | `src/core/security/encryption.ts:94-96` | Envelope‑шифрование | throw есть только при `NODE_ENV=production` и отсутствии `ENCRYPTION_KEY*`; `scripts/validate-env.ts:34-41` требует только `SESSION_SECRET` | Первый же `encrypt()` упадёт уже после успешного деплоя | Добавить `ENCRYPTION_KEY` в required `validate-env.ts` (проверка: `!value → required if NODE_ENV=production`) |
| 3 | критично | `src/app/api/health/route.ts:25-44` | Health verdict | `degraded → 200`; `wget --spider` в `Dockerfile:111` не различает их | Docker считает контейнер healthy при «degraded»; перезапуск не сработает | Либо `statusMap.degraded = 503` (если degraded = «нельзя обслуживать»), либо явно перечислить, какие подсистемы считаются «деgraded but alive» |
| 4 | важно | `docker-compose.yml:64-114`, `docker-compose.prod.yml:3-26` | limits app/workers | `deploy_memory: 250m` — только метрика; `mem_limit`/`cpus` нигде нет | Утечка памяти/циклический GC в app на общем VPS с Postgres/Redis убийство всех контейнеров; нет auto‑recovery | Добавить `mem_limit` (например 1200m) и `cpus: 1.5` (апр. — в `docker-compose.prod.yml`); для workers — `mem_limit: 4096m` (см. `Dockerfile.workers:28` «3,5–4 ГБ») |
| 5 | важно | `docker-compose.yml:124-147` | PostgreSQL resources | Без `mem_limit`/`cpus`; `max_connections=200` не видно в compose (в `.env`) | Ошибка сессии/падение Postgres тянет за собой всё | Явно задать `mem_limit: 4g, cpus: 2` и добавить `PGOCONNURL` sanity in `validate-env.ts` |
| 6 | важно | `docker-compose.yml:149-170` | Redis limits | `mem_limit=512m` (OK), но `maxmemory-policy` не задан нигде (`rg maxmemory docker-compose*` → пусто) | По умолчанию `noeviction` — при переполнении запись кэша падает ошибкой; health при этом «ok» | `command: redis-server --maxmemory 448mb --maxmemory-policy allkeys-lru` (или `volatile-ttl`) — явно в compose, не в `.env` |
| 7 | важно | `docker-compose.yml:236-274` | MinIO | volume `minio-data:/data` без `user`, no `mem_limit`; `MINIO_ROOT_USER/PASSWORD` из `env_file` | `minio-init (user root)` пишет `:rw`, но `media/uploads` — `chown 1000:1000` (минимум 640) — при `umask≠022` MinIO (uid 1000) может не читать | Явно `user: "1000:1000"` сервису minio; добавить `mem_limit: 256m`; проверить `umask` в minio-init |
| 8 | важно | `docker-compose.yml:139-146` | pgbouncer | `user: "65:65"` (good); но `pgbouncer` без `mem_limit`, `pool_mode=transaction` (из `.env`) | transaction‑pooling + long‑running Prisma = connection leak (если где‑то не release) | `mem_limit: 256m`; добавить alert на `total_claims - active_claims` (Prometheus уже есть, `prometheus/rules/pg.yml` — НЕ ПРОВЕРЕНО) |
| 9 | важно | `src/proxy.ts:18-19` | CORS | `localhost:3000` и `127.0.0.1:3000` в allowlist всегда, независимо от `NODE_ENV` | Локальная XSS/похититель cookie на dev‑хост может ходить на проде через CORS | Разделить: dev‑origin только если `NODE_ENV≠production`; prod — только `CORS_ALLOWED_ORIGINS` |
| 10 | важно | `src/proxy.ts:31-32` | CORS | origin = `NEXT_PUBLIC_APP_URL` (если задан) без валидации схемы/хоста | Если `NEXT_PUBLIC_APP_URL=https://evil.example` — allowlist раздут | `new URL(NEXT_PUBLIC_APP_URL)` и проверка `https://`; иначе `logger.warn` и не добавлять |
| 11 | важно | `docker-compose.yml:196-234` | workers | `user: 1001:1001` (good), `mem_limit=4G`, `cpus=2` (good); но **нет** `HEALTHCHECK` в compose — только `Dockerfile.workers:93-94` (`curl :3002/health`) | Docker health = только «процесс жив»; падение scheduler'ов (outbox/projection) не видно | Добавить `healthcheck: test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3002/health"]` в compose, чтобы override'ы не теряли |
| 12 | важно | `Dockerfile:114`, `Dockerfile.workers:87` | USER | `USER 1001:1001` (app), `USER nextjs` (workers=1001) — не соответствует `root` (good) | При `docker exec -u root` и записи в `/app` — ownership смещается; при `volume` `app-media:/media` без chown — app не пишет | `app-media` mount с `:z`/`:Z` или `chown` в entrypoint; НЕ `chmod 777` |
| 13 | важно | `package.json:10-11` | `npm start` | `npx tsx scripts/validate-env.ts && node .next/standalone/server.js` | `validate-env.ts` требует `.env` (dotenv) — в Docker нет `.env`, только `environment` из compose; `dotenv.config` не заменяет уже заданные, но `required:true` для `DATABASE_PROVIDER` и `SESSION_SECRET` может упасть | В `docker-compose.yml` добавить `DATABASE_PROVIDER=postgres` или сделать `validate-env.ts` идемпотентным к `NODE_ENV=production` и `CI=true`; либо запускать `tsx validate-env.ts` в init‑service (как сейчас — но только для app) |
| 14 | важно | `docker-compose.yml:256-262` | MinIO creds | `MINIO_ROOT_USER: ${MINIO_ROOT_USER:-pi}...` — default `pi` / `pilingtrack` | Если `.env` не задаёт — в проде root/minio = `pi:pilingtrack` (известен из repo) | Убрать default из compose; сделать обязательные через `validate-env.ts` |
| 15 | мелочь | `deploy-prod.sh:113,131-142` | rollback | `docker compose up -d --no-build ${UP[*]}` при смене `:latest`; теги отката `<old-sha>-<date>` — только один набор | Откат = `docker tag $ROLLBACK :latest && up -d` — работает, но **не откатывает env‑изменения** и **не откатывает volume/migrations** (явно указано в `008:323`) | Документировать: env‑изменения не откатываются; держать `env` в git‑версионабельном `.env.production.bak`, а не в `.env.production` |
| 16 | мелочь | `scripts/docker-daemon.json:1-9` | log‑opts | `json-file 10m × 5` (good) | Нет — но `docker logs` в 30 дней на 6 сервисах = 900MB; на диске 30GB — тесновато | `log-opts.max-file: 3` для non‑app; добавить logrotate в cron (не в репо — НЕ ПРОВЕРЕНО) |
| 17 | мелочь | `docker-compose.yml:276-300` (minio-init), `prod.yml:32-42` | minio-init | `user: root`, `network_mode: "service:app"` (хитрость для localhost) | После `docker compose up` init‑контейнер должен завершиться; если завис — bucket не создан, app падает на первый S3‑request | Добавить `restart: "no"` (уже есть), alert на minio `S3: ListBuckets` (НЕ ПРОВЕРЕНО) |
| 18 | мелочь | `Dockerfile:107` — `RUN apk add wget`; `Dockerfile.workers:63` — `RUN apk add curl tini openssl` | runtime tools | wget в app, curl в workers — оба нужны только для `HEALTHCHECK` | Не критично; +~5МБ в образе | Не упрощать: `wget` — alpine нативный, `curl` — только за HEALTHCHECK workers |

## Не проверено / требует проверки на сервере

- **`.env.production` на сервере** (`/opt/pilingtrack/.env.production`) — не читается по
  правилам (секреты). Все `«${VAR:-default}»` в compose и `defaults:` в src
  — это **fallback**, не «значение, которое реально стоит в проде». Для каждого
  из: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD`,
  `SESSION_SECRET`, `ENCRYPTION_KEY*`, `DEVICE_KEY_LOOKUP_SECRET`,
  `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `BACKUP_ENABLED`,
  `BACKUP_DIR` — реальные значения только у владельца.
- **Health status «degraded → 200» на проде** (находка #3): не воспроизводилось;
  нужно `curl https://orionpiling.ru/api/health` в момент, когда хотя бы одна
  зависимость (redis, pgbackups, workers) недоступна.
- **`maxmemory` Redis** (находка #6): `docker exec pilingtrack-redis-1 redis-cli
  CONFIG GET maxmemory` — не выполнялось.
- **`minio` permissions** (находки #7, #12): `docker exec pilingtrack-minio-1
  ls -la /data/pi/orion-media/uploads | head` — не выполнялось.
- **`pgbouncer` pool** (находка #8): `SELECT * FROM pg_stat_activity;` через
  pgbouncer — не выполнялось.
- **CORS на проде** (находки #9, #10): фактический `Access-Control-Allow-Origin`
  при запросе с внешнего origin — не проверялось.
- **Log retention** (находка #16): `docker system df -v` на сервере — не
  выполнялось.

## Приложение А — env‑имена из `src/` (69)

`ALLOWED_DEV_ORIGIN, APP_ENV, APP_VERSION, APP_URL, ALERTMANAGER_WEBHOOK_TOKEN,
BACKUP_DIR, BACKUP_ENABLED, BACKUP_HOUR, CACHE_DEFAULT_TTL, CDN_BASE_URL,
CORS_ALLOWED_ORIGINS, DATABASE_LOG_QUERIES, DATABASE_PROVIDER,
DATABASE_URL_POSTGRES, DEFAULT_TENANT_ID, DEVICE_KEY_LOOKUP_SECRET,
EMBEDDED_WORKERS, ENCRYPTION_KEY, ENCRYPTION_KEY_VERSION, HEAP_ALERT,
HEAP_CRIT, HEAP_LIMIT, LOG_LEVEL, LOG_WORKER_LIFECYCLE, LOG_WORKER_STATS,
MQTT_BROKER_URL, MULTI_TENANT_MODE, NEXT_PUBLIC_APP_URL, NODE_ENV,
OUTBOX_BATCH_SIZE, OUTBOX_INTERVAL_MS, PDF_TEMP_CLEANUP_ENABLED,
PDF_WORKER_CONCURRENCY, PM_SCHEDULER_ENABLED, PROJECTION_INTERVAL_MS,
PROJECTION_REBUILD_ENABLED, PRISMA_CONNECTION_LIMIT, PRISMA_POOL_TIMEOUT,
READINESS_SCHEDULER_ENABLED, RATE_LIMIT_BYPASS, SENTRY_DSN, SENTRY_ENVIRONMENT,
SENTRY_PROJECT, SESSION_SECRET, TENANT_DOMAIN, TRUST_PROXY,
WEEKLY_REPORTS_ENABLED, WEATHER_API_BASE, WORKER_HEALTH_PORT, ...` (полный
список в scratch `envnames.txt`, 69 строк — не включён в отчёт, чтобы не
раздувать его, но полный текст доступен по запросу).

## Приложение Б — «в `src/`, но не в `docker-compose*.yml environment:`»

Не являются находками по себе: compose использует `env_file` (`.env.production`
на сервере, не в репо), поэтому отсутствие в `environment:` не значит
«не доходит». Тем не менее ниже — имена, которые **в src** есть, а в **ни одном
compose** не объявлены:

- `ALLOWED_DEV_ORIGIN` — dev‑оригин; в проде не нужен (OK).
- `DATABASE_LOG_QUERIES` — dev‑лог SQL; в проде должен быть `false`.
- `EMBEDDED_WORKERS` — если не задан, по умолчанию `['outbox','projection']`
  (`src/workers/embedded-workers.ts:44-47`) — т.е. **в проде включены**; но в
  `docker-compose.yml` не прописано явно — **ГИПОТЕЗА**: при деплое workers в
  отдельный контейнер embedded должны быть выключены (иначе двойная публикация
  outbox). В `docker-compose.yml` это не видно → **НЕ ПРОВЕРЕНО на сервере**.
- `HEAP_ALERT`/`HEAP_CRIT`/`HEAP_LIMIT` — memory guard; `src/workers/unified-worker.ts`
  — только workers, в app не используется (OK).
- `LOG_WORKER_LIFECYCLE`/`LOG_WORKER_STATS` — debug‑флаги (OK).
- `MQTT_BROKER_URL` — если не задан, `mqtt-ingestion-service.ts:133` логировал
  «skipping ingestion» — **OK**, но **НЕ ПРОВЕРЕНО**, что это намерение.
- `OUTBOX_BATCH_SIZE` — `src/workers/unified-worker/config.ts` default `100`
  (OK).
- `PDF_TEMP_CLEANUP_ENABLED` — default **`off`** в `scheduler-registry.ts:76`
  (только если явно `true`) — **ГИПОТЕЗА**: в проде PDF‑файлы в `/tmp` могут
  копиться (см. `Dockerfile.workers:99` `npx tsx src/workers/unified-worker.ts`;
  `/tmp` — writable). НЕ ПРОВЕРЕНО на сервере.
- `SENTRY_DSN`/`SENTRY_ENVIRONMENT`/`SENTRY_PROJECT` — `SENTRY_DSN` в compose
  есть, остальные — нет (OK, Sentry сам знает DSN).
- `WEEKLY_REPORTS_ENABLED` — `src/workers/unified-worker.ts` — **НЕ
  ПРОВЕРЕНО**, default.

## Что не проверено (итого)

1. `.env.production` на сервере — запрещён к чтению.
2. Фактические health/permissions/pool'ы в живом Docker‑демо.
3. `maxmemory` Redis.
4. `minio` permissions и ownership `/data`.
5. `pgbouncer` pool.
6. CORS на проде.
7. Log retention (`docker system df -v`).
8. `WEEKLY_REPORTS_ENABLED` и `PDF_TEMP_CLEANUP_ENABLED` — default'ы не
   подтверждены в коде (недостаточно времени).
9. `prometheus/rules/*` — существуют ли (не читал).
10. `Caddyfile.prod` — существует в `deploy/` (упоминание в `proxy.ts:62`),
    но **не читал** (запрет «skip frozen / unrelated»).

Конец.
