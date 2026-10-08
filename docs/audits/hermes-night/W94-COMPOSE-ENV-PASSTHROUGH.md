# W94 — Переменные из .env, которых нет в docker-compose.yml

Только чтение. Значения переменных в отчёт не выписаны — только имена.

## Итог

- Обнаружено 31 имя переменной, которое читает код сервисов `app`/`workers`, но которого нет в его блоке `environment:` в `docker-compose.yml` (у сервисов нет `env_file`, поэтому в контейнер попадает только перечисленное).
- По severity: критично — 0, важно — 8, мелочь — 23.
- Критичных нет: все секреты, на которых код падает fail-closed (`SESSION_SECRET`, `ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`, `METRICS_SCRAPE_TOKEN`, `ALERTMANAGER_WEBHOOK_TOKEN`), в `environment:` присутствуют.
- Топ-5:
  1. `MULTI_TENANT_MODE` — не проброшен ни в `app`, ни в `workers`; строку из `.env` код не увидит (tenant-context-service.ts:16, proxy.ts:87).
  2. `IDEMPOTENCY_CLEANUP_ENABLED` — сам код пишет в комментарии, что переменной нет ни в одном сервисе и её туда надо добавить (unified-worker.ts:200-202).
  3. `ENCRYPTION_KEY_VERSION` и `ENCRYPTION_KEY_V*` — ротация ключа шифрования через `.env` молча не сработает: в контейнер попадает только `ENCRYPTION_KEY` (encryption.ts:66-79).
  4. `CORS_ALLOWED_ORIGINS` + `NEXT_PUBLIC_APP_URL` — прод-домен не попадает в список CORS (proxy.ts:26-32); `NEXT_PUBLIC_APP_URL` вообще не задаётся на этапе сборки.
  5. `EMBEDDED_WORKERS` — не задана, значит `app` по умолчанию поднимает встроенные outbox+projection параллельно с сервисом `workers` (embedded-workers.ts:44,47).
- Дополнительно (обратная сторона): `PIN_LOOKUP_SECRET` и `OTEL_*` есть в `.env.production.example` и в стабах Dockerfile, но код их не читает вовсе.

## Методика

Всё воспроизводимо командами из корня `D:\PillingR\wt-night`:

1. Список того, что читает код:
   `grep -rnE "process\.env\.[A-Za-z_][A-Za-z0-9_]*" src scripts *.ts *.mjs | grep -vE "__tests__|\.test\.|generated/"`
   — плюс отдельно проверены обращения через скобки: `grep -rnE "process\.env\[" src` (нашлись health-checks.ts:123, scheduler-registry.ts:49, env-int.ts:25).
2. Список переменных сервисов — глазами по блокам `environment:` в `docker-compose.yml` (сервисы `migrate` стр.41, `app` стр.71, `workers` стр.164) и в оверлее `docker-compose.prod.yml` (добавляет `app`: `HOSTNAME`, `NODE_OPTIONS`).
3. Наличие `env_file` проверено: `grep -rn "env_file\|environment:" docker-compose*.yml` — `env_file` нет нигде, только `environment:` (совпадает с правилом CLAUDE.md).
4. Значения по умолчанию и «включается ли молча» — по исходникам (`positiveIntEnv`, `|| default`, сравнения `=== 'true'`).
5. `.env` не открывался ни разу (запрет AGENTS.md). Имена брались из `.env.example`, `.env.docker.example`, `.env.production.example`, `scripts/validate-env.ts` и из `process.env.*` в коде.
6. Значения в отчёт не вынесены.

Сервис `migrate` отдельно: его `environment:` (DATABASE_URL, DATABASE_URL_POSTGRES, DATABASE_PROVIDER, SKIP_SEED) покрывает всё, что он исполняет (`prisma migrate deploy` + `prisma/seed.ts`). Единственная мелочь — сид читает `DEFAULT_TENANT_ID`, не проброшенную в `migrate` (см. находку 30).

## Находки

Колонка «Сервис»: app / workers / оба.

### Важно

| # | severity | path:line | проблема | чем грозит / сценарий | фикс |
|---|----------|-----------|----------|-----------------------|------|
| 1 | важно | src/services/tenancy/tenant-context-service.ts:16 (и src/proxy.ts:87) | `MULTI_TENANT_MODE` читается кодом `app` и `workers`, но не перечислена ни в одном `environment:` | Пока прод одноарендный (`orion`) — не проявляется. При подключении второй организации строка из `.env` молча останется `false`/пустой, режим не включится: `isMultiTenantMode()` вернёт false и вся логика аренды останется в single-режиме | Добавить `MULTI_TENANT_MODE=${MULTI_TENANT_MODE:-false}` в `app` И `workers` вместе с первой арендой |
| 2 | важно | src/workers/unified-worker.ts:200-202 (сам комментарий), 195-205 | `IDEMPOTENCY_CLEANUP_ENABLED` отсутствует в `app` и `workers`; комментарий в коде прямо это фиксирует | Планировщик уборки воркеров включается только при `='true'`, и в контейнер эта `true` не попадает — уборка не заработает, а `/api/health/deep` в `app` (checkers через scheduler-registry.ts:49) не увидит её пульс. Плюс открытая находка Codex про удаление активных ключей | Сначала починить `src/core/security/idempotency.ts`, затем добавить `IDEMPOTENCY_CLEANUP_ENABLED` (и при желании `_INTERVAL_MS`, `_STARTUP_DELAY_MS`, читаются в idempotency-cleanup-scheduler.ts:32-33) в `workers` И `app` |
| 3 | важно | src/core/security/encryption.ts:79 (и динамически 66-70) | Код читает `ENCRYPTION_KEY_VERSION` и `ENCRYPTION_KEY_V1/V2/...`, но в `environment:` обеих служб передан только `ENCRYPTION_KEY` | Заданная в `.env` ротация ключа не доедет до контейнера: код увидит только legacy `ENCRYPTION_KEY`, новые записи продолжат шифроваться старым ключом. Хуже — при смене на версионированный ключ без проброса расшифровка Telegram-токенов в воркере может упасть | Пробросить `ENCRYPTION_KEY_VERSION` и все `ENCRYPTION_KEY_V*` в `app` и `workers` вместе с планом ротации |
| 4 | важно | src/proxy.ts:26-32 | `CORS_ALLOWED_ORIGINS` и `NEXT_PUBLIC_APP_URL` не заданы в `app` (`NEXT_PUBLIC_APP_URL` не передан даже как build-arg) | Список разрешённых origin'ов для `/api/*` заполняется только `localhost`-значениями; прод-домен туда не попадает → кросс-доменные вызовы API (интеграции, вебвью) получат 403 на префлайте. `NEXT_PUBLIC_*` встраивается в бандл на сборке, поэтому прод-значение не подхватится и постфактум | Добавить `CORS_ALLOWED_ORIGINS` в `environment:` `app`; для `NEXT_PUBLIC_APP_URL` — build-arg в `docker-compose.yml` (args собираются рядом с `APP_VERSION`) |
| 5 | важно | src/workers/embedded-workers.ts:44,47 | `EMBEDDED_WORKERS` читается `app`, но не передан | По умолчанию (переменная не задана) `app` поднимает встроенные `outbox`+`projection`; при развёрнутом сервисе `workers` это второй экземпляр тех же воркеров. Спасает только выбор лидера (leader-election), но отключить это из `.env` нельзя | Если встроенные воркеры в прод-`app` не нужны — добавить `EMBEDDED_WORKERS=none` в `environment:` `app` |
| 6 | важно | src/core/media/media-service.ts:507 | `CDN_BASE_URL` читается `app`, не передан (в `environment:` только S3_*) | Заданный в `.env` CDN молча игнорируется: ссылки на медиа отдаются без CDN-домена. Сам факт CDN надо проверять отдельно (в репозитории он нигде не включён) | Добавить `CDN_BASE_URL=${CDN_BASE_URL:-}` в `app` |
| 7 | важно | src/services/weather/weather-client.ts:82 | `WEATHER_API_BASE` читается `app`, не передан | Комментарий в validate-env.ts:109-116 прямо описывает этот класс отказа: если провайдер погоды заблокирован (как уже было с api.telegram.org), переключиться на прокси через `.env` нельзя — переменная до контейнера не дойдёт, погода на площадке тихо перестанет грузиться. `TELEGRAM_API_BASE` для той же ситуации в compose уже проброшен, погода — нет | Добавить `WEATHER_API_BASE=${WEATHER_API_BASE:-}` в `app` (по аналогии с `TELEGRAM_API_BASE`) |
| 8 | важно | src/lib/db.ts:94-95 | `PRISMA_POOL_TIMEOUT` и `PRISMA_CONNECTION_LIMIT` читаются и `app`, и `workers`, но не переданы | Размер пула соединений к PgBouncer и таймаут соединиться задаются из `.env`, но не доедут: оба сервиса возьмут дефолты 20/10. Это может расходиться с расчётом пула в pgbouncer (`DEFAULT_POOL_SIZE=40`) и с ожиданиями по нагрузке | Добавить обе в `app` и `workers` (имена уже читаются кодом) |

### Мелочь

| # | severity | path:line | проблема | чем грозит / сценарий | фикс |
|---|----------|-----------|----------|-----------------------|------|
| 9 | мелочь | src/proxy.ts:102-103 | `TENANT_DOMAIN` (только `app`) не передан | Релевантно лишь в multi-tenant: маршрутизация по поддомену без неё молча выключена | Добавить вместе с включением мультиаренды |
| 10 | мелочь | src/proxy.ts:21-22, next.config.ts:84 | `ALLOWED_DEV_ORIGIN` (только `app`) не передан — локальная/дев-переменная | На проде не нужна. Перечислено по требованию задания (шаг 4) | Не требует правки |
| 11 | мелочь | src/services/auth/session-service.ts:66, src/services/system/system-service.ts:22 | `AUTH_SECRET` (страховка к `SESSION_SECRET`) не передан — но `SESSION_SECRET` в `environment:` есть | Фолбэк не срабатывает, но и не нужен: `SESSION_SECRET` задан | Не требует правки |
| 12 | мелочь | src/services/system/system-service.ts:63 | `SENTRY_DSN` не передан в `app` (в `workers` есть) | В `app` Sentry всё равно работает: DSN зашит в sentry.server.config.ts:8. Но system-service.ts:63 считает «configured» по `SENTRY_DSN || SENTRY_AUTH_TOKEN` и покажет Sentry как не настроенный | Не требует правки; расхождение в диагностике |
| 13 | мелочь | src/services/system/system-service.ts:64 | `SENTRY_PROJECT` не передан (только `app`) | Только поле диагностики, default null | Не требует правки |
| 14 | мелочь | next.config.ts:154,169-170, src/services/system/system-service.ts:63 | `SENTRY_AUTH_TOKEN` — build-time (загрузка исходных карт), в runtime не нужен | Оставлено как есть; перечислено для полноты | Не требует правки |
| 15 | мелочь | src/lib/db.ts:45 | `DATABASE_LOG_QUERIES` не передан (`app`/`workers`) — дев-переключение логирования запросов | На проде не нужна. Локальная | Не требует правки |
| 16 | мелочь | src/lib/rate-limiter.ts:178-179 | `RATE_LIMIT_BYPASS` не передан — но код включает обход только при `NODE_ENV !== 'production'` | Правильно, что отсутствует: в прод-контейнере обход иначе не включится | Не требует правки |
| 17 | мелочь | src/instrumentation.ts:20-25, src/lib/logger.ts:40 | `LOG_LEVEL` не передан | Уровень логирования на проде берётся по дефолту (`info`), а не из `.env` | Пробросить `LOG_LEVEL`, если хочется управлять из `.env` |
| 18 | мелочь | src/core/cache/response-cache.ts:361, src/instrumentation.ts:21 | `LOG_CACHE_STATS` не передан | Отладочный флаг выключен, дефолт рабочий | Не требует правки (или пробросить) |
| 19 | мелочь | src/workers/embedded-workers.ts:31, src/instrumentation.ts:22 | `LOG_WORKER_STATS`/`LOG_WORKER_LIFECYCLE` не переданы (и `app`, и `workers`) | Отладочные флаги выключены | Не требует правки |
| 20 | мелочь | src/lib/redis-cache.ts:86,92, src/lib/rate-limiter.ts:138, src/instrumentation.ts:23 | `LOG_REDIS_LIFECYCLE` не передан | Отладочный флаг выключен | Не требует правки |
| 21 | мелочь | src/instrumentation.ts:24, src/services/reports/domain-events.ts:18, src/modules/reports/application/projections/projection-worker.ts:109 | `LOG_UNHANDLED_EVENTS`, `LOG_HANDLER_REGISTRATION`, `LOG_PROJECTION_SKIPS` не переданы | Отладочные флаги выключены | Не требует правки |
| 22 | мелочь | src/core/infrastructure/leader-election.ts:15, src/core/event-bus/schema-registry/registry.ts:6, index.ts:25 | `LOG_LEADER_ELECTION`, `LOG_SCHEMA_REGISTRATION` не переданы | Отладочные флаги выключены | Не требует правки |
| 23 | мелочь | src/lib/redis-cache.ts:48 | `CACHE_DEFAULT_TTL` не передан (код есть и у `app`, и у `workers`) | TTL кэша берётся дефолтным (300 с) вместо значения из `.env` | Пробросить, если TTL настраивается |
| 24 | мелочь | src/core/media/media-service.ts:508 | `MEDIA_MAX_FILE_SIZE` не передан (`app`) | Лимит размера файла — всегда дефолтный (10485760), правки из `.env` не действуют | Пробросить, если лимит задаётся из `.env` |
| 25 | мелочь | src/core/observability/health-tracker/checkers/backup.ts:24 (порог thresholds.ts:14) | `BACKUP_DIR` не передан (`app`) | Файловый фолбэк проверки бэкапа читает `/backups/pilingtrack` (в `app` этот путь не смонтирован). Основной путь — метки в Redis, поэтому влияние узкое | Пробросить, если файловый фолбэк нужен |
| 26 | мелочь | src/services/telemetry/mqtt-ingestion-service.ts:50-59 | `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS`, `MQTT_TOPIC_PREFIX` не переданы (только `app`) | Телеметрия спит (по AGENTS.md — dormant, не мёртвый код). При подключении железа канал MQTT включится только после правки compose | Пробросить при подключении железа |
| 27 | мелочь | src/workers/unified-worker.ts:49 | `WORKER_SHUTDOWN_TIMEOUT_MS` не передан (`workers`) | Таймаут мягкого завершения — всегда 8000 мс, значения из `.env` не действуют | Не требует правки (или пробросить) |
| 28 | мелочь | src/workers/unified-worker.ts:174, src/workers/unified-worker/pm-scheduler.ts:16-17 | `PM_SCHEDULER_ENABLED`, `PM_SCHEDULER_INTERVAL_MS`, `PM_SCHEDULER_STARTUP_DELAY_MS` не переданы (`workers`) | Планировщик ТО включён (отключение только при `='false'`), интервалы — дефолтные. Управлять из `.env` нельзя | Пробросить, если интервалы/отключение задаются из `.env` |
| 29 | мелочь | src/workers/unified-worker.ts:180, src/workers/unified-worker/projection-rebuild-scheduler.ts:22-23 | `PROJECTION_REBUILD_ENABLED`, `PROJECTION_REBUILD_INTERVAL_MS`, `PROJECTION_REBUILD_STARTUP_DELAY_MS` не переданы (`workers`) | Планировщик включён, интервалы дефолтные | Пробросить при необходимости |
| 30 | мелочь | src/workers/unified-worker.ts:187, src/workers/unified-worker/readiness-scheduler.ts:21-22 | `READINESS_SCHEDULER_ENABLED`, `READINESS_SCHEDULER_INTERVAL_MS`, `READINESS_SCHEDULER_STARTUP_DELAY_MS` не переданы (`workers`) | Суточный сброс техготовности включён, интервалы дефолтные | Пробросить при необходимости |
| 31 | мелочь | src/lib/seed/equipment.seed.ts:61 (через `migrate` → `prisma/seed.ts`) | Сид читает `DEFAULT_TENANT_ID`, но в `environment:` сервиса `migrate` её нет | Сид использует фолбэк `'orion'`; при другой аренде семена уйдут не туда. Срабатывает только при `SKIP_SEED != 1` (в проде `SKIP_SEED=1` по оверлею) | Добавить `DEFAULT_TENANT_ID` в `migrate`, если сид будет запускаться в проде |

### Обратная сторона (в `.env*` есть, код не читает)

| # | severity | path:line | проблема | фикс |
|---|----------|-----------|----------|------|
| 32 | мелочь | .env.production.example:13; стаб Dockerfile:26 | `PIN_LOOKUP_SECRET` объявлена в prod-примере и стабе сборки, но в коде не читается нигде (проверено `grep -rni "lookup_secret"` и `grep -rn "pinLookup"` — только комментарии/тесты) | Уточнить у владельца: либо имя устарело, либо секрет не подключён к хешированию ПИН-кода |
| 33 | мелочь | .env.production.example:57-60 | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` объявлены, но код их не читает (в src/ нет обращений; только `OTEL_ENABLED` в scripts/generate-env-docker.ps1) | Либо мёртвые в примере, либо трейсинг не подключён |

## Не проверено

- `.env` (боевой) не открывался — по AGENTS.md. Все выводы о том, «что читает код», сделаны по исходникам, а не по фактическому содержимому `.env`; реальный набор заданных на сервере переменных не сверялся.
- Значения переменных нигде не выводились и не сравнивались.
- Не проверялось, заданы ли перечисленные переменные на самом сервере (нет доступа, запрет на прод). Список — «что код читает и что compose пробрасывает», а не «что реально стоит в .env».
- Поведение `docker compose` (слияние оверлея `docker-compose.prod.yml` с базовым) анализировалось по тексту файлов, без запуска `docker compose config`.
- Ветки `.env.example` / `.env.docker.example` / `.env.production.example` читались как перечень имён; соответствие их актуальности коду не проверялось.
- Планировщики `PM`/`READINESS`/`PROJECTION_REBUILD` (находки 28-30): не проверялось, вычисляются ли имена переменных динамически (`prefix + '_...'`) — на это косвенно указывает тест sentry.test.ts:229-230; имена взяты из литералов в исходниках планировщиков.
- Frozen-области (операторские экраны, ORION) не открывались.
