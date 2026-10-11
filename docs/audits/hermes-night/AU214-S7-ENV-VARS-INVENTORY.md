# AU214-S7-ENV-VARS-INVENTORY — Переменные окружения PilingTrack: опись

Версия кода (git rev-parse HEAD на момент аудита): `085232957b1eeca70607e8448d21caf5f11ca810`
Ветка: `hermes/q4-0926`. Аудит только на чтение, код приложения не менялся.

## Итог

Резюме для владельца (5 строк):

1. Приложение читает из окружения **68 имён напрямую** (`process.env.ИМЯ`) плюс **13 имён через `positiveIntEnv('ИМЯ')`** и динамические шаблоны (`ENCRYPTION_KEY_V<N>`, `process.env[name]`) — команды ниже.
2. В контейнер попадает **только то, что перечислено в `docker-compose.yml`**: `env_file` не объявлен ни у одного сервиса — подтверждено (0 совпадений-объявлений, только упоминания в комментариях). Из 68 имён **22 есть в compose, 46 — нет**.
3. Обязательность в контейнере держится **только на 5 переменных** с `:?` в compose (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`). Скрипт-валидатор `scripts/validate-env.ts` в проде **не запускается** — образ стартует `node server.js` в обход `npm start`.
4. Из-за отсутствия `env_file` молча не доходят до контейнера: `MULTI_TENANT_MODE`, `CORS_ALLOWED_ORIGINS`, `ALLOWED_DEV_ORIGIN`, `TENANT_DOMAIN`, `WEATHER_API_BASE`, `PRISMA_CONNECTION_LIMIT`, `PRISMA_POOL_TIMEOUT`, все `LOG_*`, `EMBEDDED_WORKERS`, `SENTRY_DSN` (для app) и др. Часть из них — рабочие, а не только диагностические.
5. Самый важный вывод: **проверки обязательных переменных при старте контейнера нет**; список в `validate-env.ts` к тому же отстал от кода (в нём нет `ENCRYPTION_KEY`, `ALERTMANAGER_WEBHOOK_TOKEN`, `METRICS_SCRAPE_TOKEN`, `REDIS_URL_CACHE`, `DB_IDENTITY_ROLE`, `TRUST_PROXY`).

Счёт по важности (см. «Находки»): критично — **0**, важно — **6**, мелочь — **14**. Всего находок — **20**.

Статусы: ПРОЙДЕНО = проверено командой/чтением файла с указанием строки; ГИПОТЕЗА = вывод из кода, поведение на бою не наблюдалось; НЕ ПРОВЕРЕНО = доступа/данных не хватило.

## Методика

Что и как искалось (всё выполнялось из корня `D:\PillingR\wt-night`):

1. Опись чтений в коде (без тестов и сгенерированного клиента):
   ```
   rg -o -N --no-filename "process\.env\.[A-Z_][A-Z0-9_]*" \
      src/ --glob '!**/__tests__/**' --glob '!**/generated/**' \
      --glob '!*.test.ts' --glob '!*.test.tsx' | sed 's/process.env.//' | sort -u
   ```
   → 68 имён (одно совпадение `process.env.X` — из комментария в `src/workers/unified-worker/env-int.ts:4`, исключено).
2. Динамические чтения (имя переменной не литерал): `rg -n "positiveIntEnv\(" src/` → 13 вызовов, 13 имён; плюс `process.env[name]` в `src/workers/unified-worker/env-int.ts:25` и `ENCRYPTION_KEY_V<N>` через регулярку в `src/core/security/encryption.ts:67`.
3. Переменные контейнера:
   ```
   rg -o -N --no-filename "\- [A-Z_][A-Z0-9_]*=" docker-compose.yml docker-compose.prod.yml docker-compose.staging.yml | sed 's/- //;s/=//' | sort -u
   ```
   → 46 имён.
4. Разность множеств: `comm -23` → 46 имён из кода отсутствуют в compose; `comm -12` → 22 совпадают.
5. Обязательность: `rg -c ":\?" docker-compose.yml` (+ чтение `docker-compose.prod.yml:16-19`), `scripts/validate-env.ts` (конфиг `ENV_CONFIG`), броски в коде (`src/lib/db.ts:85`, `src/instrumentation.ts:46`, `src/core/security/encryption.ts:94`).
6. Запускается ли валидатор: `package.json` (`start` = `npx tsx scripts/validate-env.ts && node .next/standalone/server.js`) против `Dockerfile:119` (`CMD ["node","server.js"]`).
7. Точечные чтения файлов-источников (`read_file`) для `path:line`.

Ограничения методики: `.env*`-файлы не читались (запрет AGENTS.md §1), поэтому список переменных из хостового `.env` не сверялся. Переменные, читаемые только в `e2e/`, `scripts/`, `prisma/`, в опись приложения не вошли (отмечено отдельно).

## Находки

### Таблица A. Переменные, читаемые кодом приложения/воркеров

Столбцы: переменная | где читается (полный путь от корня) | в compose | обязательна.
«в compose» — присутствует ли имя в блоке `environment:` любого сервиса `docker-compose*.yml`.

| Переменная | Где читается | В compose | Обязательна |
| --- | --- | --- | --- |
| DATABASE_URL | src/lib/db.ts:84 | да (app, workers, migrate, pgbouncer) | Условно (нужен хотя бы один из DATABASE_URL / DATABASE_URL_POSTGRES) |
| DATABASE_URL_POSTGRES | src/lib/db.ts:84; src/core/observability/health-checks.ts:122 | да | да (`db.ts:85` бросает при отсутствии обоих) |
| DATABASE_PROVIDER | src/lib/db.ts:41 (хардкод 'postgres'); scripts/validate-env.ts:23 | да | по коду — нет (значение игнорируется) |
| SESSION_SECRET | src/services/auth/session-service.ts:66; src/instrumentation.ts:46 | да | да (throw при NODE_ENV=production) |
| AUTH_SECRET | src/services/auth/session-service.ts:66; src/services/system/system-service.ts:22 | **нет** | нет (запасной вариант для SESSION_SECRET) |
| ENCRYPTION_KEY | src/core/security/encryption.ts:74 | да | да (throw в production, стр. 94) |
| ENCRYPTION_KEY_V<N> | src/core/security/encryption.ts:67 | нет | нет (для ротации) |
| ENCRYPTION_KEY_VERSION | src/core/security/encryption.ts:79 | нет | нет (иначе автоподбор старшей версии) |
| DEVICE_KEY_LOOKUP_SECRET | src/services/telemetry/device-key-service.ts:16 | да (app) | да (validate-env, production) |
| ALERTMANAGER_WEBHOOK_TOKEN | src/app/api/alerts/webhook/route.ts:80 | да (app) | Условно (fail-closed 401, без него алерты молча теряются) |
| METRICS_SCRAPE_TOKEN | src/app/api/metrics/route.ts:40 | да (app) | Условно (иначе /api/metrics только по сессии) |
| REDIS_URL | src/lib/redis-cache.ts:47; src/lib/pdf-queue.ts:27; src/lib/rate-limiter.ts:119; src/services/auth/session-service.ts:110 | да | да (иначе дефолт localhost, не работает в контейнере) |
| REDIS_URL_CACHE | src/lib/redis-cache.ts:45 | да | нет (падает на REDIS_URL) |
| DEFAULT_TENANT_ID | src/services/tenancy/tenant-context-service.ts:21; src/core/notifications/telegram.ts:49; src/app/api/alerts/webhook/route.ts:124 | да | Условно (нужен для Telegram и алертов) |
| MULTI_TENANT_MODE | src/services/tenancy/tenant-context-service.ts:16; src/proxy.ts:87 | **нет** | нет (дефолт = одноклиентский режим) |
| DB_IDENTITY_ROLE | src/core/security/identity-role.ts:35 | да | Условно (без неё под RLS вход по email/ПИН вернёт пусто) |
| TRUST_PROXY | src/lib/rate-limiter.ts:479 | да | нет (по умолчанию не доверяет X-Forwarded-For) |
| S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | src/core/storage/s3-service.ts:24-27,44; src/lib/pdf-generator/storage.ts:19,47-58; src/core/media/media-service.ts:502-506 | да | Условно (нужны для S3-хранилища; иначе локальный диск) |
| CDN_BASE_URL | src/core/media/media-service.ts:507 | **нет** | нет |
| MEDIA_MAX_FILE_SIZE | src/core/media/media-service.ts:508 | **нет** | нет (дефолт 10485760) |
| TELEGRAM_API_BASE | src/core/notifications/telegram.ts:227,265,397 | да | Условно (на бою провайдер блокирует api.telegram.org) |
| WEATHER_API_BASE | src/services/weather/weather-client.ts:82 | **нет** | нет (дефолт open-meteo) |
| SENTRY_DSN | src/workers/unified-worker/sentry.ts:24; src/services/system/system-service.ts:63 | да (только workers) | нет (app берёт DSN из кода, см. находку 5) |
| SENTRY_AUTH_TOKEN | src/services/system/system-service.ts:63; scripts/validate-env.ts:204 | **нет** | нет (нужен на сборке для source maps) |
| SENTRY_PROJECT | src/services/system/system-service.ts:64 | **нет** | нет |
| BACKUP_ENABLED | src/core/observability/health-tracker/checkers/backup.ts:18 | да (app) | нет (без него мониторинг бэкапов выключен) |
| BACKUP_DIR | src/core/observability/health-tracker/checkers/backup.ts:24 | **нет** | нет |
| APP_VERSION | src/core/observability/health-checks.ts:182; src/app/api/metrics/route.ts:95 | да (build arg) | нет |
| PRISMA_POOL_TIMEOUT | src/lib/db.ts:94 | **нет** | нет (дефолт 10 c) |
| PRISMA_CONNECTION_LIMIT | src/lib/db.ts:95 | **нет** | нет (дефолт 20) |
| DATABASE_LOG_QUERIES | src/lib/db.ts:45 | **нет** | нет (в контейнере логирование запросов всегда выкл.) |
| CACHE_DEFAULT_TTL | src/lib/redis-cache.ts:48 | **нет** | нет (дефолт 300 c) |
| CORS_ALLOWED_ORIGINS | src/proxy.ts:26 | **нет** | нет (но белый список CORS в проде останется пустым) |
| ALLOWED_DEV_ORIGIN | src/proxy.ts:21 | **нет** | нет |
| TENANT_DOMAIN | src/proxy.ts:102 | **нет** | нет (только в multi-tenant) |
| NEXT_PUBLIC_APP_URL | src/proxy.ts:31 | **нет** | нет (встраивается на сборке) |
| NEXT_PUBLIC_SITE_URL | src/app/sitemap.ts:10 (файл замороженной зоны) | **нет** | нет (дефолт домена) |
| NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL | src/components/piling/to/to-module.tsx:129 | **нет** | нет (дефолт «включено») |
| RATE_LIMIT_BYPASS | src/lib/rate-limiter.ts:178 | **нет** | нет (только вне production) |
| EMBEDDED_WORKERS | src/workers/embedded-workers.ts:44 | **нет** | нет (дефолт: outbox+projection в процессе app) |
| ENABLED_WORKERS | src/workers/unified-worker/config.ts:12 | да (workers) | нет (дефолт outbox,projection,pdf) |
| WORKER_HEALTH_PORT | src/workers/unified-worker/config.ts:6 | да (workers) | нет |
| OUTBOX_INTERVAL_MS | src/workers/unified-worker/config.ts:7 | да (workers) | нет |
| PROJECTION_INTERVAL_MS | src/workers/unified-worker/config.ts:8 | да (workers) | нет |
| PDF_WORKER_CONCURRENCY | src/workers/unified-worker/config.ts:9; src/workers/pdf-worker.ts:28 | да (workers) | нет |
| WORKER_SHUTDOWN_TIMEOUT_MS | src/workers/unified-worker.ts:49 | **нет** | нет |
| PROJECTION_REBUILD_ENABLED | src/workers/unified-worker.ts:180; src/core/observability/health-tracker/scheduler-registry.ts:73 | **нет** | нет (по умолчанию включён) |
| PROJECTION_REBUILD_INTERVAL_MS | src/workers/unified-worker/projection-rebuild-scheduler.ts:22 | **нет** | нет |
| PROJECTION_REBUILD_STARTUP_DELAY_MS | src/workers/unified-worker/projection-rebuild-scheduler.ts:23 | **нет** | нет |
| PM_SCHEDULER_ENABLED | src/workers/unified-worker.ts:174 | **нет** | нет (по умолчанию включён) |
| PM_SCHEDULER_INTERVAL_MS | src/workers/unified-worker/pm-scheduler.ts:16 | **нет** | нет |
| PM_SCHEDULER_STARTUP_DELAY_MS | src/workers/unified-worker/pm-scheduler.ts:17 | **нет** | нет |
| READINESS_SCHEDULER_ENABLED | src/workers/unified-worker.ts:187 | **нет** | нет (по умолчанию включён) |
| READINESS_SCHEDULER_INTERVAL_MS | src/workers/unified-worker/readiness-scheduler.ts:21 | **нет** | нет |
| READINESS_SCHEDULER_STARTUP_DELAY_MS | src/workers/unified-worker/readiness-scheduler.ts:22 | **нет** | нет |
| IDEMPOTENCY_CLEANUP_ENABLED | src/core/observability/health-tracker/scheduler-registry.ts:36,50 | **нет** | нет (включение только явным 'true') |
| IDEMPOTENCY_CLEANUP_INTERVAL_MS | src/workers/unified-worker/idempotency-cleanup-scheduler.ts:32 | **нет** | нет |
| IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS | src/workers/unified-worker/idempotency-cleanup-scheduler.ts:33 | **нет** | нет |
| PDF_TEMP_CLEANUP_ENABLED | src/workers/unified-worker/pdf-cleanup-scheduler.ts:8 | **нет** | нет (по умолчанию выкл.) |
| PDF_TEMP_CLEANUP_DRY_RUN | src/lib/pdf-generator/cleanup.ts | **нет** | нет |
| MQTT_BROKER_URL / MQTT_CLIENT_ID / MQTT_USERNAME / MQTT_PASSWORD / MQTT_QOS / MQTT_TOPIC_PREFIX | src/services/telemetry/mqtt-ingestion-service.ts:50,55-59 | **нет** | нет (телеметрия спит до подключения железа) |
| LOG_LEVEL / LOG_CACHE_STATS / LOG_WORKER_STATS / LOG_REDIS_LIFECYCLE / LOG_UNHANDLED_EVENTS / LOG_PROJECTION_SKIPS / LOG_LEADER_ELECTION / LOG_WORKER_LIFECYCLE / LOG_SCHEMA_REGISTRATION / LOG_HANDLER_REGISTRATION | src/lib/logger.ts:40; src/instrumentation.ts:20-25; src/lib/redis-cache.ts:86; src/core/infrastructure/leader-election.ts:15; src/core/event-bus/schema-registry/index.ts:25 | **нет** | нет (диагностика) |
| NODE_ENV / NEXT_RUNTIME / NEXT_PHASE | src/lib/db.ts:19; src/instrumentation.ts:26-27,53; src/lib/redis-cache.ts:28 | NODE_ENV да; NEXT_* — рантайм Next | нет |
| WINDIR | src/lib/pdf-generator/fonts.ts:10 | **нет** | нет (используется только на Windows) |

Итого: 68 имён прочитано напрямую; из них 22 присутствуют в compose, 46 отсутствуют. Переменные, читаемые только тестами/e2e/скриптами (`POST_MERGE_SMOKE`, `QA_RUN_DIR`, `CAPTURE_USERS_UI`, `CAPTURE_DICTIONARIES_UI`, `BASE_URL`, `INTEGRATION_DATABASE_URL_OWNER`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `CI_CAPTURE`, `CODEX_WITH_S3`, `SMOKE_TENANT_ID`, `SEED_TENANT_ID`, `X`), в таблицу не включены.

### Таблица B. Находки

| # | Важность | path:line | Проблема | Сценарий / чем грозит | Предлагаемая правка |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | Dockerfile:119 (`CMD ["node","server.js"]`) против package.json:11 (`start` = `... && node .next/standalone/server.js`) и package.json:8 | Валидатор окружения `scripts/validate-env.ts` НЕ вызывается при старте контейнера: образ стартует `node server.js` напрямую. | Обязательность переменных в проде не проверяется вообще. Если контейнер поднят не через compose (например, `docker run`, k8s, standalone), приложение стартует с неполным окружением и падает позже «где-то в запросе», а не на старте. Статус: ПРОЙДЕНО (команды сравнения). | В `Dockerfile` заменить `CMD ["node","server.js"]` на запуск `scripts/validate-env.ts` перед сервером либо перенести проверку в `src/instrumentation.ts:46` (там уже есть бросок для SESSION_SECRET). |
| 2 | важно | docker-compose.yml:71-129 (app), 164-206 (workers); объявление `env_file` отсутствует (проверено: `rg env_file docker-compose*.yml` даёт только комментарии) | В контейнер попадает только перечисленное в `environment:`; `env_file` не объявлен. 46 из 68 читаемых имён до контейнера не доходят. | Любая переменная, заданная в хостовом `.env`, но не продублированная в compose, молча теряется. Уже приводило к инцидентам (комментарии compose: `TRUST_PROXY` — docker-compose.yml:117-123, `BACKUP_ENABLED` — 124-129, `DB_IDENTITY_ROLE` — 103-107). Остальные 46 имён из таблицы A так и не проброшены. Статус: ПРОЙДЕНО. | Либо объявить единый `env_file` для app/workers, либо осознанно перечислить рабочие (не диагностические) переменные в `environment:`. |
| 3 | важно | src/proxy.ts:26-33 | `CORS_ALLOWED_ORIGINS`, `ALLOWED_DEV_ORIGIN`, `TENANT_DOMAIN` читаются прокси, но НЕ проброшены в контейнер (в compose отсутствуют). | В проде белый список CORS остаётся `["http://localhost:3000","http://127.0.0.1:3000"]` плюс `NEXT_PUBLIC_APP_URL`, который тоже встраивается на сборке (не в build-args). Если у клиента когда-либо появится отдельный домен/поддомен или мобильное приложение с другим origin — браузерные запросы будут отклонены, и включить их можно будет только правкой compose. Статус: ГИПОТЕЗА (для однодоменного прода может быть намеренно). | Пробросить `CORS_ALLOWED_ORIGINS`/`ALLOWED_DEV_ORIGIN` (и `TENANT_DOMAIN` при планах на multi-tenant) в `environment:` app. |
| 4 | важно | src/lib/db.ts:94-95 против docker-compose.yml:260 (`DEFAULT_POOL_SIZE=40`) | `PRISMA_CONNECTION_LIMIT` и `PRISMA_POOL_TIMEOUT` не проброшены; берутся дефолты 20 и 10 c. | Три сервиса (app, workers, embedded) × 20 = до 60 клиентских соединений против pool size 40 у PgBouncer. Под нагрузкой часть запросов встанет в очередь/получит таймаут. Настроить лимит без правки compose нельзя. Статус: ГИПОТЕЗА (зависит от реальной конкурентности). | Пробросить `PRISMA_CONNECTION_LIMIT`/`PRISMA_POOL_TIMEOUT` в app и workers либо согласовать дефолт с `DEFAULT_POOL_SIZE`. |
| 5 | важно | sentry.server.config.ts:8; sentry.edge.config.ts:9 | DSN Sentry зашит в исходники константой (не из окружения); при этом app НЕ получает `SENTRY_DSN` из compose (он есть только у workers — docker-compose.yml:206). | DSN нельзя сменить/отключить без пересборки; проект Sentry привязан жёстко. Комментарий compose (docker-compose.yml:202-205) считает это нормой. Отдельного секрета DSN не раскрывает, но снижает управляемость. Статус: ПРОЙДЕНО (проверено чтением файлов, длина строки 95 символов — не плейсхолдер). | Перевести DSN на `process.env.SENTRY_DSN` с текущим значением как дефолтом и пробросить переменную app. |
| 6 | важно | src/core/observability/health-checks.ts:122 | Health-проверка «environment» требует `DATABASE_URL_POSTGRES` и `SESSION_SECRET`, тогда как рантайм сначала читает `DATABASE_URL` (src/lib/db.ts:84). | Если в окружении окажется только `DATABASE_URL` (валидная конфигурация для `db.ts`), /api/health начнёт показывать `degraded` с missing `DATABASE_URL_POSTGRES` — ложная тревога либо маскировка реальной. Статус: ПРОЙДЕНО. | Привести список `required` в соответствие с тем, что реально требует `db.ts` (любой из двух URL). |
| 7 | мелочь | scripts/validate-env.ts:21-122 | Список `ENV_CONFIG` отстал от кода: нет `ENCRYPTION_KEY`, `ALERTMANAGER_WEBHOOK_TOKEN`, `METRICS_SCRAPE_TOKEN`, `REDIS_URL_CACHE`, `DB_IDENTITY_ROLE`, `TRUST_PROXY`, `DEFAULT_TENANT_ID` (описан, но required:false), S3-полей (кроме трёх), `DEVICE_KEY_LOOKUP_SECRET` описан. `DATABASE_PROVIDER` помечен `required:true` (стр. 23-32), хотя код его игнорирует (src/lib/db.ts:41 возвращает 'postgres' всегда). | Валидатор (когда запускается на хосте/сборке) проверяет не то, что действительно нужно приложению; `ENCRYPTION_KEY` — важнейший секрет — вне проверки. Статус: ПРОЙДЕНО. | Синхронизировать `ENV_CONFIG` с таблицей A; убрать `DATABASE_PROVIDER` из обязательных. |
| 8 | мелочь | src/lib/pdf-generator/storage.ts:19 | Наличие S3 определяется по `S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY`; в compose все три задаются с пустым дефолтом (`${S3_...:-}`). | Пустая строка и «переменная не задана» здесь не различаются — на боевом без S3-ключей проверка проходит, но клиент S3 создаётся и падает «S3 credentials not configured» при первой загрузке. Статус: ГИПОТЕЗА (зависит от того, заданы ли ключи на бою). | Проверять на непустое значение (`!== undefined && !== ''`), либо не создавать клиент при пустых ключах. |
| 9 | мелочь | src/core/observability/health-tracker/checkers/backup.ts:18,24 | `BACKUP_ENABLED` проброшена (docker-compose.yml:129), а `BACKUP_DIR` — нет. | Каталог бэкапов всегда берётся по дефолту; переопределить на бою нельзя без правки compose. Статус: ПРОЙДЕНО. | Пробросить `BACKUP_DIR` при необходимости. |
| 10 | мелочь | src/lib/redis-cache.ts:45-48 | `CACHE_DEFAULT_TTL` не проброшена — TTL кэша жёстко 300 c. | Изменение срока жизни кэша требует правки compose. Статус: ПРОЙДЕНО. | По мере надобности. |
| 11 | мелочь | src/core/media/media-service.ts:507-508 | `CDN_BASE_URL` и `MEDIA_MAX_FILE_SIZE` не проброшены. | Раздача медиа без CDN и лимит файла 10 МБ фиксированы; изменение — только через compose. Статус: ПРОЙДЕНО. | Пробросить при появлении CDN/иной потребности. |
| 12 | мелочь | src/services/weather/weather-client.ts:82 | `WEATHER_API_BASE` не проброшена (в validate-env:112 описана, в PRODUCTION_WARNINGS нет). | Погода всегда идёт на `https://api.open-meteo.com`. Если провайдер заблокирует Open-Meteo (как уже было с api.telegram.org для Telegram — см. validate-env.ts:130-132), переключение на прокси потребует правки compose, а не только `.env`. Статус: ГИПОТЕЗА. | Пробросить `WEATHER_API_BASE` в app либо добавить её в PRODUCTION_WARNINGS. |
| 13 | мелочь | docker-compose.yml:99 (`DEFAULT_TENANT_ID=${DEFAULT_TENANT_ID:-}`) | Пустой дефолт неотличим от «не задано»: код использует `process.env.DEFAULT_TENANT_ID` и в некоторых местах трактует пустую строку как значение. | В `src/app/api/alerts/webhook/route.ts:124` `const tenantId = process.env.DEFAULT_TENANT_ID` — при пустой строке это не `null`, а `''`; в `src/services/tenancy/tenant-context-service.ts:21` есть `|| null`. Разное поведение на пустое значение между вызовами. Статус: ГИПОТЕЗА (на бою переменная задана). | Не пробрасывать пустую строку либо нормализовать (`|| null`) на всех чтениях. |
| 14 | мелочь | src/instrumentation.ts:63-67; src/workers/embedded-workers.ts:26,44-47 | `EMBEDDED_WORKERS` не проброшена → по умолчанию app-контейнер запускает встроенные outbox+projection, и одновременно отдельный сервис `workers` запускает их же. | Разведено лидерством (leader election на Redis, src/workers/embedded-workers.ts:66-75). Если лидерство на Redis откажет, двое могут выполнять outbox параллельно; защита — идемпотентность. Статус: ГИПОТЕЗА (дублирование в нормальных условиях не наблюдалось). | Явно пробросить `EMBEDDED_WORKERS=none` в app (или в workers) и полагаться на один источник. |
| 15 | мелочь | docker-compose.yml:72 (`NODE_ENV=production`), src/lib/db.ts:45 | `DATABASE_LOG_QUERIES` не проброшена. | Логирование SQL-запросов на бою включить нельзя без правки compose (для разбора инцидентов). Статус: ПРОЙДЕНО. | Пробросить при необходимости. |
| 16 | мелочь | src/core/security/encryption.ts:79 | `ENCRYPTION_KEY_VERSION` не проброшена. | Активная версия ключа шифрования определяется автоматически (старшая `ENCRYPTION_KEY_V<N>`); процедура ротации из комментария (стр. 16-23) требует пробросить и `ENCRYPTION_KEY_V2`, и `ENCRYPTION_KEY_VERSION` — обоих в compose нет. Статус: ПРОЙДЕНО. | Дополнить compose при реальной ротации ключа. |
| 17 | мелочь | src/components/piling/to/to-module.tsx:129 | `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` не проброшена и не передана build-arg (в `docker-compose.yml:65-66` передаётся только `APP_VERSION`). | Значение встраивается на сборке; по умолчанию «включено» (`!== 'false'`). Переключить оболочку в проде без пересборки нельзя. Статус: ПРОЙДЕНО (проверено, что в build args только APP_VERSION). | Добавить в build args, если понадобится отключение. |
| 18 | мелочь | src/lib/db.ts:19; src/instrumentation.ts:34,37 | `NEXT_RUNTIME`/`NEXT_PHASE` читаются кодом, но это переменные рантайма Next.js, а не конфигурация; в описи помечены как «не требует проброса». | Может ввести в заблуждение при сверке `env` в контейнере. Статус: ПРОЙДЕНО. | Учесть в документации, не пробрасывать. |
| 19 | мелочь | docker-compose.yml:22-27 (migrate) | Сервис `migrate` не получает `SESSION_SECRET`/`ENCRYPTION_KEY`, но запускает `prisma/seed.ts` (docker-compose.yml:37). | Если сид использует шифрование (Telegram-токены и т.п.) или сессионный секрет, он выполнится без ключей. Прямого чтения этих переменных в seed не проверял. Статус: НЕ ПРОВЕРЕНО (см. раздел ниже). | Проверить, нужны ли секреты сиду, и при необходимости дополнить. |
| 20 | мелочь | src/instrumentation.ts:19-28 | Логируются только `LOG_*`-флаги, `NODE_ENV`, `NEXT_RUNTIME`. Список эффективной конфигурации неполон — нет `DEFAULT_TENANT_ID`, `DB_IDENTITY_ROLE`, `TRUST_PROXY`, `BACKUP_ENABLED`, `EMBEDDED_WORKERS`, `MULTI_TENANT_MODE`. | При разборе «почему функция не работает» оператор не видит по логам, пришли ли до контейнера ключевые переменные (это уже случалось с `TRUST_PROXY`/`BACKUP_ENABLED`). Статус: ПРОЙДЕНО. | Дополнить лог эффективных флагов рабочими переменными (без значений секретов). |

## Не проверено

1. **Содержимое `.env` / `.env.production.example` против реального сервера.** `.env*` не читались (запрет AGENTS.md §1). Нельзя утверждать, какие переменные реально заданы на боевом хосте и расходятся ли они с compose. Опирался только на `.env.example`, `.env.docker.example`, `.env.production.example` (только чтение, без значений). Статус: НЕ ПРОВЕРЕНО.
2. **Стоит ли `npm run build` на боевом образе с валидацией.** Проверено статически, что `Dockerfile:43` вызывает `npm run build` (а он вызывает `validate-env.ts`) в стадии `builder` с build-time заглушками (`Dockerfile:24-26`). Не проверялось, доходят ли заглушки до рантайма — по структуре Dockerfile не должны (стадии `builder` и `runner` раздельны, `runner` начинается с чистого `FROM`), но живого запуска образа не было. Статус: НЕ ПРОВЕРЕНО.
3. **Реальная конкурентность к БД (находка 4).** Соотношение Prisma max=20 × сервисы против `DEFAULT_POOL_SIZE=40` — расчёт по коду и compose, без нагрузочного прогона. Статус: НЕ ПРОВЕРЕНО.
4. **Использование S3 на бою (находка 8).** Заданы ли реально `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` на сервере — не проверялось (нет доступа). Статус: НЕ ПРОВЕРЕНО.
5. **Нужны ли секреты сиду `prisma/seed.ts` (находка 19).** Файл не читался в части использования `process.env` применительно к шифрованию/сессиям. Статус: НЕ ПРОВЕРЕНО.
6. **Переменные окружения, читаемые вне `src/`** (в `e2e/`, `scripts/`, `performance/`, `load-tests/`, `prisma/`) в таблицу A не вошли — они не влияют на рантайм контейнера, но существуют (`BASE_URL`, `QA_RUN_DIR`, `INTEGRATION_DATABASE_URL_OWNER` и т.д.). Статус: ПРОЙДЕНО для перечисления, но полнота описи вне `src/` не гарантирована.
7. **Соответствие `docker-compose.monitoring-*.yml` / `docker-compose.observability.yml`.** Просматривались только имена сервисных переменных базового/prod/staging compose; мониторинговые стеки не инвентаризировались. Статус: НЕ ПРОВЕРЕНО.
