# AU163-S7-ENV-DOCKER-COMPOSE-DRIFT — расхождение .env.example и docker compose

Версия (git rev-parse HEAD): `3b1c647b035a88b412f018f702b28306dc3c6c52`
Только чтение. Код приложения не менялся. Секреты не читались (в .env.example только имена и placeholder-значения).

## Итог

- Разобраны 3 источника: `.env.example` (11 переменных), `docker-compose.yml` + `docker-compose.prod.yml` (39 переменных в блоках `environment:`), `src/` (82 различных `process.env.*`).
- Критично: 1 — структурный разрыв: `env_file` у сервисов не объявлен, поэтому в контейнер попадает ТОЛЬКО явно перечисленное в `environment:`. Код читает 82 переменные, в контейнеры проброшено 39. Из-за этого молча ломались уже три функции (Telegram, TRUST_PROXY, BACKUP_ENABLED) — это не гипотеза, причина записана в самом compose.
- Важно: 10 — среди непроброшенных: `CORS_ALLOWED_ORIGINS`, ротационные `ENCRYPTION_KEY_V1/V2` + `ENCRYPTION_KEY_VERSION`, `BACKUP_DIR`, `MULTI_TENANT_MODE`, `NEXT_PUBLIC_APP_URL`, лимиты пула `PRISMA_*`, все `LOG_*`; плюс `.env.example` не содержит `DATABASE_PROVIDER`, без которого `validate-env` роняет запуск.
- Мелочь: 19 — `MQTT_*` (дремлющая телеметрия), `WEATHER_API_BASE`, `CACHE_DEFAULT_TTL`, `TENANT_DOMAIN`, `AUTH_SECRET`, `SENTRY_*`, флаги планировщиков и т. п.
- Самый важный вывод: `src/proxy.ts:26` читает `CORS_ALLOWED_ORIGINS`, а `docker-compose.yml` его не пробрасывает — на боевом контейнере список разрешённых origin задать нельзя (тот же класс, что TRUST_PROXY/SEC-10).

Топ-5 по значимости:
1. `docker-compose.yml:104,120,127` — `env_file` не объявлен: ~40 переменных, читаемых кодом, до контейнеров не доходят.
2. `.env.example:1-25` — нет `DATABASE_PROVIDER`, который `scripts/validate-env.ts:23` требует всегда → копия примера не поднимается.
3. `src/proxy.ts:26` `CORS_ALLOWED_ORIGINS` — нет в compose.
4. `src/core/security/encryption.ts:79` `ENCRYPTION_KEY_VERSION` (и `ENCRYPTION_KEY_V1/V2`) — нет в compose → ротация ключа через `.env` молча не сработает.
5. `src/core/observability/health-tracker/checkers/backup.ts:24` `BACKUP_DIR` — нет в compose → проверка бэкапов смотрит внутрь контейнера, а не на хостовый каталог.

## Методика

Все команды выполнены из корня `D:\PillingR\wt-night`. Переменные извлекались только по ИМЕНАМ; значения (кроме placeholder-ов в примерах) не читались.

```
git rev-parse HEAD                                   # 3b1c647b...

# все чтения env в коде (количество и список)
rg -o --no-filename 'process\.env\.[A-Z_][A-Z0-9_]*' src/ | sort | uniq -c | sort -rn
rg -o --no-filename 'process\.env\.[A-Z_][A-Z0-9_]*' src/ | sort -u

# переменные, реально попадающие в контейнеры
rg -o '^\s+- [A-Z_]+=' docker-compose.yml docker-compose.prod.yml | sed 's/.*- //;s/=//' | sort -u

# объявлен ли env_file (массовый проброс) — оказалось, НЕ объявлен
rg -n 'env_file' docker-compose*.yml

# построчная привязка каждой подозрительной переменной к файлу:строке
rg -n 'process\.env\.(CORS_ALLOWED_ORIGINS|RATE_LIMIT_BYPASS|BACKUP_DIR|MULTI_TENANT_MODE|TENANT_DOMAIN|ENCRYPTION_KEY_VERSION|PRISMA_POOL_TIMEOUT|PRISMA_CONNECTION_LIMIT|...)\b' src/ | grep -v '__tests__'

# проверка «мёртвых» переменных (есть в шаблонах, нет в коде)
rg -rn 'WS_URL|WS_PORT|NEXT_PUBLIC_WS_URL|OTEL_ENABLED|S3_FORCE_PATH_STYLE|ASYNC_OUTBOX|DATABASE_URL_PGBOUNCER' src/
```

Файлы, открытые целиком или диапазоном: `.env.example`, `.env.docker.example`, `.env.production.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `scripts/validate-env.ts`, `Dockerfile`, `Dockerfile.workers`, `src/proxy.ts:1-115`, `src/lib/db.ts:30-110`, `src/lib/rate-limiter.ts:170-195`, `src/core/observability/health-tracker/scheduler-registry.ts`, `src/core/observability/health-tracker/checkers/backup.ts:1-30`, `src/workers/embedded-workers.ts:40-60`, `src/services/system/system-service.ts:20-64`, `prisma/seed.ts` (grep по env).

Числа только из команд: в `src/` — 82 уникальных `process.env.*`; в блоках `environment:` обоих compose — 39 уникальных имён; в `.env.example` — 11 строк с `=`; `env_file:` — 0 объявлений (только упоминания в комментариях).

## Матрица: переменная | .env.example | compose environment | читается в коде

Обозначения столбца «compose»: `app` / `workers` / `migrate` — в каком сервисе проброшена; `образа` — задана в Dockerfile (ENV/ARG); `—` — отсутствует. `prod` = есть только в `docker-compose.prod.yml`.

| Переменная | .env.example | compose environment | читается в коде (path:line) |
|---|---|---|---|
| DATABASE_PROVIDER | — | app, workers, migrate | `scripts/validate-env.ts:23` (required:true), `Dockerfile:23` |
| DATABASE_URL | — | app, workers, migrate, pgbouncer | `src/lib/db.ts:90` |
| DATABASE_URL_POSTGRES | да | app, workers, migrate | `src/lib/db.ts:90`, `prisma.config.ts:7`, `prisma/seed.ts:15` |
| DATABASE_LOG_QUERIES | да | — | `src/lib/db.ts:45` |
| PRISMA_POOL_TIMEOUT | — | — | `src/lib/db.ts:94` |
| PRISMA_CONNECTION_LIMIT | — | — | `src/lib/db.ts:95` |
| SESSION_SECRET | да | app | `src/services/auth/session-service.ts:66`, `scripts/validate-env.ts:33` |
| AUTH_SECRET | — | — | `src/services/auth/session-service.ts:66`, `src/services/system/system-service.ts:22` |
| DEVICE_KEY_LOOKUP_SECRET | — | app | `scripts/validate-env.ts:46` |
| ENCRYPTION_KEY | да | app, workers | `src/core/security/encryption.ts` (grep: 3) |
| ENCRYPTION_KEY_VERSION (+ _V1/_V2) | — | — | `src/core/security/encryption.ts:79,82` |
| MULTI_TENANT_MODE | да | — | `src/proxy.ts:87`, `src/services/tenancy/tenant-context-service.ts:16` |
| DEFAULT_TENANT_ID | да («default») | app, workers | `src/…` (43 совпадения), `prisma/seed.ts:101` |
| REDIS_URL | да | app, workers | `src/lib/redis-cache.ts`, `src/lib/rate-limiter.ts` (grep: 8) |
| REDIS_URL_CACHE | — | app, workers | `src/lib/redis-cache.ts:…` (grep: 4) |
| REDIS_PASSWORD | — | redis, redis-cache (прочие сервисы) | не читается кодом (интерполяция в URL) |
| TRUST_PROXY | — | app | `src/lib/rate-limiter.ts:…` |
| METRICS_SCRAPE_TOKEN | — | app | `src/app/api/metrics/route.ts` (grep: 5) |
| ALERTMANAGER_WEBHOOK_TOKEN | — | app | `src/app/api/alerts/webhook/route.ts` (grep: 15) |
| BACKUP_ENABLED | — | app | `src/core/observability/health-tracker/checkers/backup.ts:18` |
| BACKUP_DIR | — | — | `src/core/observability/health-tracker/checkers/backup.ts:24` |
| DB_IDENTITY_ROLE | — | app, workers | `src/core/security/identity-role.ts` (grep: 1) |
| CORS_ALLOWED_ORIGINS | — | — | `src/proxy.ts:26` |
| ALLOWED_DEV_ORIGIN | — | — | `src/proxy.ts:22`, `next.config.ts:84` |
| NEXT_PUBLIC_APP_URL | — | — (не build-arg) | `src/proxy.ts:31` |
| NEXT_PUBLIC_SITE_URL | — | — (не build-arg) | `src/app/sitemap.ts:10`, `src/app/orion/page.tsx:12` |
| NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL | — | — (не build-arg) | `src/components/piling/to/to-module.tsx:129` |
| TENANT_DOMAIN | — | — | `src/proxy.ts:102` |
| RATE_LIMIT_BYPASS | — | — | `src/lib/rate-limiter.ts:178` |
| S3_ENDPOINT | — | app, workers | `src/core/storage/s3-service.ts` (grep: 12) |
| S3_REGION | — | app, workers | `src/core/storage/s3-service.ts` (grep: 7) |
| S3_BUCKET | — | app, workers, minio-init | (grep: 12) |
| S3_ACCESS_KEY_ID | — | app, workers | (grep: 10) |
| S3_SECRET_ACCESS_KEY | — | app, workers | (grep: 9) |
| TELEGRAM_API_BASE | — | app, workers | `src/core/notifications/telegram.ts` (grep: 3) |
| SENTRY_DSN | да | workers | `src/…` (grep: 4) |
| SENTRY_ORG | да | — | `scripts/validate-env.ts:90` (объявлена, потребителя в `src/` нет) |
| SENTRY_PROJECT | да | — | `src/services/system/system-service.ts:64` |
| SENTRY_AUTH_TOKEN | да | — | `next.config.ts:154,169,170` (build-time) |
| SENTRY_RELEASE | — | — | `next.config.ts:165` |
| APP_VERSION | — | build-arg (образа) | `next.config.ts:22` |
| OUTBOX_INTERVAL_MS | — | workers | `src/…` (grep: 3) |
| PROJECTION_INTERVAL_MS | — | workers | `src/workers/unified-worker.ts` (grep: 2) |
| PDF_WORKER_CONCURRENCY | — | workers (hardcode =2) | потребителя `process.env.PDF_WORKER_CONCURRENCY` в `src/` нет |
| ENABLED_WORKERS | — | workers | `src/workers/unified-worker/config.ts` (grep: 12) |
| EMBEDDED_WORKERS | — | — | `src/workers/embedded-workers.ts:44` |
| WORKER_HEALTH_PORT | — | workers, образа | `src/workers/…` (grep: 2) |
| WORKER_SHUTDOWN_TIMEOUT_MS | — | — | `src/workers/unified-worker.ts:49` |
| PM_SCHEDULER_ENABLED | — | — | `src/workers/unified-worker.ts:174`, `scheduler-registry.ts:72` |
| PM_SCHEDULER_INTERVAL_MS / _STARTUP_DELAY_MS | — | — | `src/workers/unified-worker/pm-scheduler.ts:16-17` |
| PROJECTION_REBUILD_ENABLED | — | — | `src/workers/unified-worker.ts:180`, `scheduler-registry.ts:73` |
| READINESS_SCHEDULER_ENABLED | — | — | `src/workers/unified-worker.ts:187`, `scheduler-registry.ts:74` |
| READINESS_SCHEDULER_INTERVAL_MS / _STARTUP_DELAY_MS | — | — | `src/workers/unified-worker/readiness-scheduler.ts:21-22` |
| IDEMPOTENCY_CLEANUP_ENABLED | — | — | `scheduler-registry.ts:36,50` |
| IDEMPOTENCY_CLEANUP_INTERVAL_MS / _STARTUP_DELAY_MS | — | — | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:32-33` |
| PDF_TEMP_CLEANUP_ENABLED | — | — | `pdf-cleanup-scheduler.ts:8`, `scheduler-registry.ts:76` |
| PDF_TEMP_CLEANUP_DRY_RUN | — | — | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:16` |
| LOG_LEVEL | — | — | `src/lib/logger.ts:40`, `src/instrumentation.ts:20` |
| LOG_CACHE_STATS | — | — | `src/lib/redis-cache.ts:361`, `src/instrumentation.ts:21` |
| LOG_WORKER_STATS | — | — | `src/workers/embedded-workers.ts:190`, `instrumentation.ts:22` |
| LOG_REDIS_LIFECYCLE | — | — | `src/lib/redis-cache.ts:86`, `rate-limiter.ts:138` |
| LOG_UNHANDLED_EVENTS | — | — | `src/instrumentation.ts:24` |
| LOG_PROJECTION_SKIPS | — | — | `src/modules/reports/application/projections/projection-worker.ts:109` |
| LOG_WORKER_LIFECYCLE | — | — | `src/workers/embedded-workers.ts:31`, `core/observability/lag-monitor.ts:37` |
| LOG_LEADER_ELECTION | — | — | `src/core/infrastructure/leader-election.ts:15` |
| LOG_HANDLER_REGISTRATION | — | — | `src/services/reports/domain-events.ts:18` |
| LOG_SCHEMA_REGISTRATION | — | — | `src/core/event-bus/schema-registry/registry.ts:6` |
| CACHE_DEFAULT_TTL | — | — | `src/lib/redis-cache.ts:48` |
| CDN_BASE_URL | — | — | `src/core/media/media-service.ts:507` |
| MEDIA_MAX_FILE_SIZE | — | — | `src/core/media/media-service.ts:508` |
| WEATHER_API_BASE | — | — | `src/services/weather/weather-client.ts:82` |
| MQTT_BROKER_URL/CLIENT_ID/USERNAME/PASSWORD/QOS/TOPIC_PREFIX | — | — | `src/services/telemetry/mqtt-ingestion-service.ts:50-59` |
| POSTGRES_USER/PASSWORD/DB | — | postgres, migrate, pgbouncer | не читается кодом (compose-интерполяция) |
| MINIO_ROOT_USER/PASSWORD | — | minio, minio-init | не читается кодом |
| PGADMIN_EMAIL/PASSWORD | — | pgadmin (profile dev), prod-обёртки | не читается кодом |
| SKIP_SEED | — | migrate | используется только в команде compose |
| HOSTNAME, NODE_OPTIONS, NODE_ENV | — | app(prod), образа | `NODE_ENV` — `next.config.ts`, `instrumentation.ts` |
| NEXT_RUNTIME, NEXT_PHASE, WINDIR, TZ, P, X | — | — | фреймворк/тесты (`NEXT_RUNTIME` — Next; `TZ` — только в `*.test.*`) |
| WS_URL, WS_PORT, NEXT_PUBLIC_WS_URL | — | — | потребителя в `src/` нет (WebSocket-сервис удалён) |
| OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, S3_FORCE_PATH_STYLE, ASYNC_OUTBOX, DATABASE_URL_PGBOUNCER, PROMETHEUS_ENDPOINT | — | — | потребителя в `src/` нет (есть в `scripts/generate-env-docker.ps1`) |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | `docker-compose.yml:104`, `docker-compose.yml:120`, `docker-compose.yml:127` | `env_file` у сервисов не объявлен; в контейнер попадает только `environment:`. Код читает 82 переменные, в контейнеры проброшено 39 | Любая переменная, добавленная в `.env` но не продублированная в `environment:`, молча не доходит. Так уже потерялись Telegram (`DEFAULT_TENANT_ID`), `TRUST_PROXY` (SEC-10, 24.09.2026) и `BACKUP_ENABLED` (ранбук 014, 01.10.2026) — это записанная история, не гипотеза | Явно добавить `env_file: [.env]` в `app`/`workers` (с осознанным allow-list) либо внедрить в CI проверку «каждая читаемая переменная либо в `environment:`, либо в исключении» |
| 2 | важно | `.env.example:1-25` | В примере нет `DATABASE_PROVIDER` | `scripts/validate-env.ts:23-25` требует его ВСЕГДА (`required:true`); копирование `.env.example` в `.env` роняет `npm run dev`/`build` с ошибкой валидации | Добавить `DATABASE_PROVIDER="postgres"` в `.env.example` |
| 3 | важно | `src/proxy.ts:26` | `CORS_ALLOWED_ORIGINS` читается кодом, но НЕ проброшен ни в `app`, ни в `workers` | На боевом контейнере список разрешённых origin задать нельзя — только правкой compose. Тот же класс, что TRUST_PROXY/SEC-10 | Добавить `- CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-}` в `app` |
| 4 | важно | `src/core/security/encryption.ts:79,82` | `ENCRYPTION_KEY_VERSION` (+ `ENCRYPTION_KEY_V1/V2`) читаются кодом, но compose пробрасывает только `ENCRYPTION_KEY` | Ротация ключа шифрования Telegram-токенов через `.env` не сработает в контейнере — молча. При выставленном VERSION без V2 код бросает исключение в рантайме | Пробросить `ENCRYPTION_KEY_VERSION` и `ENCRYPTION_KEY_V1/V2` в `app` и `workers` |
| 5 | важно | `src/core/observability/health-tracker/checkers/backup.ts:24` | `BACKUP_DIR` читается, но не проброшен; по умолчанию берётся `DEFAULT_BACKUP_DIR` (путь внутри образа) | Бэкапы на хосте; контейнер их не видит → /api/health/deep может показывать «бэкап несвеж» при живых бэкапах (или наоборот). `BACKUP_ENABLED` при этом проброшен — то есть проверка включена, но смотрит не туда | Пробросить `BACKUP_DIR` в `app` (или зафиксировать, что проверка должна идти по Redis-метке, а не по ФС) |
| 6 | важно | `src/proxy.ts:87`, `src/services/tenancy/tenant-context-service.ts:16` | `MULTI_TENANT_MODE` есть в `.env.example` и читается кодом, но не проброшен в контейнеры | Включить мультитенантность на боевом контейнере, выставив значение в `.env`, нельзя — флаг останется выключенным | Пробросить `MULTI_TENANT_MODE` в `app` |
| 7 | важно | `src/proxy.ts:31`, `src/app/sitemap.ts:10`, `src/components/piling/to/to-module.tsx:129` | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` — это `NEXT_PUBLIC_*`, вшиваются на СБОРКЕ, но не переданы как build-args в `Dockerfile` | На боевом образе они всегда `undefined`; `proxy.ts:31` не добавит prod-origin в CORS, sitemap уйдёт на хардкод `orionpiling.ru` | Добавить `ARG`/`ENV` для этих переменных в builder-стадию `Dockerfile` и передавать через `build.args` |
| 8 | важно | `src/lib/db.ts:94-95` | `PRISMA_POOL_TIMEOUT`, `PRISMA_CONNECTION_LIMIT` не проброшены | Дефолты 10с/20 вшиты; согласование с `DEFAULT_POOL_SIZE=40` PgBouncer (`docker-compose.yml:260`) можно менять только пересборкой образа, а не конфигом | Пробросить обе в `app` и `workers` |
| 9 | важно | `src/lib/logger.ts:40`, `src/instrumentation.ts:20-25` и др. | Ни одна `LOG_*` (`LOG_LEVEL`, `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE`, `LOG_LEADER_ELECTION`, `LOG_HANDLER_REGISTRATION`, `LOG_SCHEMA_REGISTRATION`) не проброшена | Диагностику на бою нельзя включить без пересборки; при разборе инцидента это удлиняет простой | Пробросить набор `LOG_*` в `app` и `workers` (по умолчанию пусто) |
| 10 | важно | `.env.example:1-25` | В примере нет `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `DEVICE_KEY_LOOKUP_SECRET`, `APP_DB_USER`/`APP_DB_PASSWORD`, `S3_*`, `TELEGRAM_API_BASE`, `TRUST_PROXY`, `DB_IDENTITY_ROLE`, `BACKUP_ENABLED` | `docker compose up` по `:?`-контракту (`docker-compose.yml:83,84,85,293,354`) падает без пароля; остальные функции тихо выключаются. Пример не является рабочим стартовым набором для compose | Синхронизировать `.env.example` (или явно указать, что для compose используйте `.env.docker.example`) |
| 11 | важно | `.env.docker.example:1-13` | Docker-пример тоже неполон: есть `DATABASE_PROVIDER`/`POSTGRES_*`, но нет `REDIS_PASSWORD`, `DEVICE_KEY_LOOKUP_SECRET`, `APP_DB_USER`, `ENCRYPTION_KEY`, `TRUST_PROXY`, `DB_IDENTITY_ROLE`, `BACKUP_ENABLED`, `TELEGRAM_API_BASE`, `S3_*` | Копия примера пройдёт `validate-env` (dev), но `docker compose up` упадёт на `REDIS_PASSWORD`/`ENCRYPTION_KEY` (`:?`) | Дополнить `.env.docker.example` до реального набора compose |
| 12 | мелочь | `src/lib/rate-limiter.ts:178` | `RATE_LIMIT_BYPASS` читается, но не проброшен | Безопасно: код применяет bypass только при `NODE_ENV !== 'production'` (`rate-limiter.ts:179`), а в контейнерах всегда `production` (`docker-compose.yml:72,165`). Риска нет, но переменная недоступна для отладки в контейнере | Оставить как есть; при желании пробросить с оговоркой |
| 13 | мелочь | `prisma/seed.ts:101` | `.env.example` задаёт `DEFAULT_TENANT_ID="default"`, а сид по умолчанию использует `'orion'` | Если взять пример за основу на боевом стенде, данные уедут под тенант «default» вместо «orion» | Привести placeholder к ожидаемому значению и прокомментировать |
| 14 | мелочь | `src/services/auth/session-service.ts:66`, `src/services/system/system-service.ts:22` | `AUTH_SECRET` — второй источник секрета сессии, не проброшен | В контейнере секрет всегда берётся из `SESSION_SECRET` (что и нужно). Риск только если кто-то ожидает `AUTH_SECRET` | Оставить; упомянуть как fallback |
| 15 | мелочь | `src/proxy.ts:102` | `TENANT_DOMAIN` не проброшен | Влияет только в мультитенантном режиме (см. №6), который в контейнере тоже выключен | Пробросить вместе с `MULTI_TENANT_MODE`, если включат |
| 16 | мелочь | `src/workers/unified-worker.ts:49` | `WORKER_SHUTDOWN_TIMEOUT_MS` не проброшен | Дефолт 8с; при медленном корректном завершении PDF-задач нельзя увеличить без пересборки | Пробросить в `workers` |
| 17 | мелочь | `src/core/observability/health-tracker/scheduler-registry.ts:72-76` | Флаги `PM_SCHEDULER_ENABLED`, `PROJECTION_REBUILD_ENABLED`, `READINESS_SCHEDULER_ENABLED`, `IDEMPOTENCY_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_ENABLED` не проброшены | Нельзя выключить «забарахливший» планировщик на бою без пересборки образа. Дефолты безопасны (`IDEMPOTENCY` по умолчанию ВЫКЛ, см. `scheduler-registry.ts:41-47`) | Пробросить флаги в `workers` |
| 18 | мелочь | `src/workers/unified-worker/pm-scheduler.ts:16-17`, `readiness-scheduler.ts:21-22`, `idempotency-cleanup-scheduler.ts:32-33` | `*_INTERVAL_MS` / `*_STARTUP_DELAY_MS` не проброшены | Интервалы планировщиков фиксированы дефолтами; тонкая настройка под бой невозможна из env | Пробросить при управлении планировщиками |
| 19 | мелочь | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:8,16` | `PDF_TEMP_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_DRY_RUN` не проброшены | Уборка по умолчанию выключена (`!== 'true'`), dry-run включён; изменить поведение на бою нельзя из env | Пробросить в `workers` |
| 20 | мелочь | `src/workers/embedded-workers.ts:44`, `src/instrumentation.ts:63` | `EMBEDDED_WORKERS` не проброшен в `app` | В `app` по умолчанию стартуют встроенные outbox+projection (`embedded-workers.ts:46-47`); вместе с контейнером `workers` это два конкурента, разводимых только leader-election. Отключить встроенных воркеров на бою через env нельзя | Явно задать `EMBEDDED_WORKERS` в `app` (например `none`, если воркеры вынесены) — или задокументировать намеренность |
| 21 | мелочь | `src/lib/redis-cache.ts:48` | `CACHE_DEFAULT_TTL` не проброшен | TTL кэша фиксирован (300с) | Пробросить при необходимости |
| 22 | мелочь | `src/core/media/media-service.ts:507-508` | `CDN_BASE_URL`, `MEDIA_MAX_FILE_SIZE` не проброшены | Нельзя переключить отдачу медиа на CDN или изменить лимит размера файла без правки кода/образа | Пробросить в `app` |
| 23 | мелочь | `src/services/weather/weather-client.ts:82` | `WEATHER_API_BASE` не проброшен | На боевом контейнере прокси для погоды (по образцу Telegram) не задать из env — только пересборкой | Пробросить в `app` (и `scripts/validate-env.ts:112` его знает) |
| 24 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:50-59` | `MQTT_*` (6 переменных) не проброшены | Подсистема телеметрии дремлющая (нет железа), поэтому сейчас безвредно; при подключении железа переменные придётся добавлять в compose | Пробросить перед включением телеметрии |
| 25 | мелочь | `src/lib/db.ts:45`, `.env.example:8` | `DATABASE_LOG_QUERIES` есть в примере, но не проброшен | Логирование SQL-запросов на бою нельзя включить из env (и это, вероятно, намеренно — шумно) | Оставить; при необходимости — через `LOG_*`-набор |
| 26 | мелочь | `next.config.ts:154,165,169-170` | `SENTRY_AUTH_TOKEN` (build-time) и `SENTRY_RELEASE` не передаются как build-args | На боевом образе загрузка source-map в Sentry и читаемые стектрейсы не настроить без пересборки с env | Передавать как build-args в `Dockerfile` |
| 27 | мелочь | `scripts/validate-env.ts:90-91` | `SENTRY_ORG` объявлен в валидаторе и есть в примерах, но потребителя в `src/` нет; `SENTRY_PROJECT` читается лишь в статусе (`system-service.ts:64`) | Валидатор и `.env.example` описывают переменную, которая почти ни на что не влияет — риск ложного ожидания, что её установка что-то включает | Уточнить назначение либо убрать из примера/валидатора |
| 28 | мелочь | `.env.example`, `.env.production.example:58-60` | Мёртвые имена переменных: `OTEL_*`, `S3_FORCE_PATH_STYLE`, `ASYNC_OUTBOX`, `DATABASE_URL_PGBOUNCER`, `WS_URL`/`WS_PORT`/`NEXT_PUBLIC_WS_URL` | Потребителя в `src/` нет (проверено `rg`); WebSocket-сервис удалён. Примеры/`scripts/generate-env-docker.ps1:81,89,119,158` описывают несуществующие оси и путают при настройке | Не удалять вслепую, но пометить как неиспользуемые и вынести из шаблонов (отдельной задачей) |
| 29 | мелочь | `docker-compose.yml:243-266` | В сервисе `pgbouncer` в `environment:` лежит `DATABASE_URL` с паролем (`${...}`), а `ADMIN_USERS`/`AUTH_TYPE` — служебные имена, не читаемые кодом приложения | Это не приложение, а конфигурация инфраструктуры; вынесено для полноты матрицы. Отдельно отмечу: секрет подставляется через интерполяцию compose, а не через файл | Оставить (вне области правки) |
| 30 | мелочь | `docker-compose.prod.yml:24-56,124-147` | Прод-оверлей добавляет только `HOSTNAME`, `NODE_OPTIONS`, `SKIP_SEED` и лимиты — НИ ОДНОЙ из непроброшенных переменных из находок №3-9 | Ожидание «на проде можно донастроить окружение оверлеем» не выполняется: все дырки базового compose остаются | Пробрасывать недостающие переменные в базовом `docker-compose.yml` (они общие для dev/prod) |

Итого по таблице: 30 находок — 1 критично, 10 важно, 19 мелочь.

## Не проверено

- Реальные значения боевых `.env`/`.env.production` на сервере — не читались (нельзя и неуместно). Отсюда статус «ГИПОТЕЗА» для утверждений вида «на боевом стенде эта переменная пустая»: выводы о последствиях для прода основаны только на коде дефолтов и контракте compose.
- Реальный вывод `docker compose config` (сборка эффективного окружения с оверлеем) не запускался: требуется Docker и заполненный env с секретами, которых здесь нет. Поэтому колонка «compose environment» построена статическим разбором `environment:`-блоков, а не рендером compose. НЕ ПРОВЕРЕНО.
- Фактическое поведение Next.js 16 по встраиванию `NEXT_PUBLIC_*` при отсутствии build-arg (находка №7) — по документации Next.js `NEXT_PUBLIC_*` инлайнятся на сборке; точный результат для Turbopack `next build` в этом проекте не воспроизводился. ГИПОТЕЗА.
- `SENTRY_ORG`/`SENTRY_PROJECT` могут дополнительно читаться плагином Sentry вне `src/` (`.env.sentry-build-plugin`) — это не проверялось (файла может не быть). НЕ ПРОВЕРЕНО.
- Список переменных в `scripts/` и `deploy/` (не `src/`) просмотрен частично (только по конкретным именам) — полный аудит shell-окружения не входил в область задачи. НЕ ПРОВЕРЕНО.
- Существующие отчёты в `docs/audits/` не читались (запрет задачи). В `docs/audits/hermes-night/` обнаружены прежние файлы (например `R61-env-vars.md`), но их содержимое в этот отчёт не заимствовано; все выводы получены независимыми `rg`/чтением файлов выше.

Статус по разделам: матрица — ПРОЙДЕНО (каждая ячейка «читается в коде» подтверждена `path:line`); находки №1-11 — ПРОЙДЕНО; №12-30 — ПРОЙДЕНО по факту «нет в compose / нет потребителя», но последствия на боевом стенде — ГИПОТЕЗА (см. выше).
