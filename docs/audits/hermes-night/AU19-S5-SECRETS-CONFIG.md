# AU19-S5: Секреты и переменные окружения — куда попадают и что пишется в логи

Версия кода (рабочая папка D:\PillingR\wt-night, ветка `hermes/q4-0926`):

```
$ git rev-parse HEAD
eb2a2d7da861e5d77c4d6e4b3c587230d67779cb
```

Аудит только по коду. Файлы `.env*` не читались, значения переменных не печатаются.
Прочитанные отчёты в `docs/audits/` в работу не брались (кроме этого файла).

## Резюме для владельца (5 строк)

1. **Главная проблема.** Журнал аудита пишется в лог целиком, без маскирования: в контейнерный лог (и дальше в Loki) попадают email сотрудников, телефон, ФИО и данные отчёта — `src/services/audit/audit-service.ts:1000`. Модуль маскирования в проекте есть (`src/modules/readiness/domain/audit/mask.ts:7`), но к этому пути он не подключён.
2. **Проверка окружения не работает на проде.** `validate-env.ts` запускается локальным `npm start`, но контейнер стартует напрямую `node server.js` (`Dockerfile:119`), поэтому обязательные секреты в контейнере заранее не проверяются.
3. **Секреты идут через `environment` compose** (пароли БД/Redis внутри строк подключения, `SESSION_SECRET`, `ENCRYPTION_KEY`): они видны в `docker inspect` / `/proc/1/environ` любому, у кого есть доступ к хосту или к `docker`.
4. **При `DATABASE_LOG_QUERIES=true`** Prisma пишет в лог текст запросов вместе с параметрами (`src/lib/db.ts:45`) — туда попадают email и хеши паролей.
5. Плюс мелочи: захардкоженный `admin`-пароль Grafana в двух compose-файлах, слабые пароли реальных учёток в скрипте `reset-passwords.ts`, «мёртвый» секрет `PIN_LOOKUP_SECRET` в Dockerfile.

## Методика (как повторить)

```
$ git rev-parse HEAD
$ grep -rhoE 'process\.env\.[A-Za-z0-9_]+' src next.config.ts sentry.server.config.ts sentry.edge.config.ts | sed 's/process\.env\.//' | sort -u   # список имён
$ grep -rhoE 'process\.env\.[A-Za-z0-9_]+' src next.config.ts | sed 's/process\.env\.//' | sort -u | wc -l   # 99 имён (src + next.config)
$ grep -oE '\$\{[A-Z_]+' docker-compose.yml | sed 's/\${//' | sort -u      # имена из compose
$ grep -oE '\$\{[A-Z_]+' docker-compose.prod.yml | sed 's/\${//' | sort -u
$ grep -rho 'process\.env\[' src scripts                                  # доступ по индексу (динамические ключи)
$ grep -rn 'PIN_LOOKUP_SECRET' .
```

Просмотрены (через `read_file`) и используются как доказательства: `src/lib/logger.ts`, `src/services/audit/audit-service.ts`,
`src/modules/readiness/domain/audit/mask.ts`, `src/modules/readiness/infrastructure/audit/append-audit.ts`,
`src/services/feedback/feedback-event-service.ts`, `src/core/api-wrapper.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`,
`sentry.server.config.ts`, `sentry.edge.config.ts`, `src/workers/unified-worker/sentry.ts`, `src/lib/db.ts`,
`src/app/api/auth/login/route.ts`, `src/app/api/users/route.ts`, `src/app/api/metrics/route.ts`, `src/app/api/health/route.ts`,
`src/app/api/alerts/webhook/route.ts`, `src/services/system/system-service.ts`, `src/services/auth/session-service.ts`,
`src/services/auth/auth-service.ts`, `src/lib/auth.ts`, `src/proxy.ts`, `src/lib/rate-limiter.ts`, `src/lib/redis-cache.ts`,
`src/services/telemetry/mqtt-ingestion-service.ts`, `src/services/reports/event-handlers.ts`, `src/services/users/user-service.ts`,
`src/workers/unified-worker/config.ts`, `src/workers/outbox-worker.ts`, `scripts/validate-env.ts`, `scripts/reset-passwords.ts`,
`scripts/tg-send.ts`, `Dockerfile`, `next.config.ts`, `package.json`, `docker-compose.yml`, `docker-compose.prod.yml`,
`docker-compose.observability.yml`, `docker-compose.monitoring-standalone.yml`, `docker-compose.monitoring-prod.yml`.

## Таблица переменных окружения

Колонки: **имя** | где читается (файл:строка) | обязательна? | что будет, если не задана | в `environment` compose | может ли попасть в лог / ответ API.

| Имя | Где читается | Обяз. | Если не задана | В compose (app/workers) | Лог / API |
|---|---|---|---|---|---|
| `DATABASE_URL` | `src/lib/db.ts:84` | да* | провайдер падает с исключением `DATABASE_URL ... is required` (`db.ts:85-88`) | да (`docker-compose.yml:78`) — ПАРОЛЬ внутри строки | строка с паролем видна в `docker inspect`; в логи приложения не пишется |
| `DATABASE_URL_POSTGRES` | `src/lib/db.ts:84` (fallback), `scripts/apply-full-ddl.ts:27` | условно | берётся `DATABASE_URL`; иначе то же исключение | да (`docker-compose.yml:79`) | как выше |
| `DATABASE_PROVIDER` | `scripts/validate-env.ts:23,158`; `scripts/apply-postgres-hardening.ts:21` | да (в валидаторе) | валидатор падает; **код приложения не читает** — `src/lib/db.ts:40` всегда возвращает `'postgres'` | да (`:80`) | нет |
| `SESSION_SECRET` | `src/services/auth/session-service.ts:66`; `src/instrumentation.ts:46` | да (прод) | в проде `throw` (`instrumentation.ts:46-49`, `session-service.ts:82`); в dev — ключ-заглушка `dev-only-session-secret-change-me` (`session-service.ts:79`) | да (`:83`), обязательна `:?` | нет |
| `AUTH_SECRET` | `src/services/auth/session-service.ts:66`; `src/services/system/system-service.ts:22` | нет | fallback-секрет для сессии | **нет** | нет |
| `ENCRYPTION_KEY` | `src/core/security/encryption.ts:74` | да (прод) | без него в проде бросается ошибка (`encryption.ts:94`); расшифровка токена бота невозможна | да (`:84`, workers `:191`) | нет (в `scripts/tg-send.ts:5` печатается только ДЛИНА) |
| `ENCRYPTION_KEY_VERSION` | `src/core/security/encryption.ts:79` | нет | используется `legacy`-ключ | **нет** | нет |
| `DEVICE_KEY_LOOKUP_SECRET` | `src/services/telemetry/device-key-service.ts:16` | да (прод) | `device-key-service.ts:25` бросает в не-dev/test; `validate-env.ts:176-182` | да (`:85`) | нет |
| `METRICS_SCRAPE_TOKEN` | `src/app/api/metrics/route.ts:40` | нет (fail-closed) | `isValidScrapeToken` → false, остаётся сессионная проверка (`route.ts:49-53`) | да (`:116`) | нет (сравнение constant-time, значение не логируется) |
| `ALERTMANAGER_WEBHOOK_TOKEN` | `src/app/api/alerts/webhook/route.ts:80` | нет (fail-closed) | `isAuthorized` → false, вебхук отвечает 401 (`route.ts:81,90`) | да (`:112`) | нет |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | `src/core/storage/s3-service.ts:24,25,45` | нет | локальный ФС-фолбэк; бакет по умолчанию `pilingtrack-reports` | да (`:86-88`) | нет |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `src/core/storage/s3-service.ts:26-27`; `src/core/observability/s3-health-check.ts:14` | нет | ЛОКАЛЬНОЕ хранилище; health сообщает «disabled» (`storage.ts:5`) | да (`:89-90`) | нет; исключения AWS SDK не проверялись (см. «Не проверено») |
| `REDIS_URL` | `src/lib/redis-cache.ts:47`; `src/lib/rate-limiter.ts:119`; `src/services/auth/session-service.ts:110` | нет | rate limit → in-memory, очереди/отзыв сессий деградируют | да (`:81`), ПАРОЛЬ в строке | строка видна в `docker inspect`; сообщения ошибок ioredis не содержат пароль (ГИПОТЕЗА) |
| `REDIS_URL_CACHE` | `src/lib/redis-cache.ts:45,137` | нет | кеш берёт `REDIS_URL` | да (`:82`) | как выше |
| `TELEGRAM_API_BASE` | `src/core/notifications/telegram.ts:227,265,397` | нет | запросы идут на `https://api.telegram.org` | да (`:91`, workers `:184`) | нет |
| `DEFAULT_TENANT_ID` | `src/services/tenancy/tenant-context-service.ts:21`; `src/app/api/alerts/webhook/route.ts:113,124` | нет | фоновые пути без тенанта молча пропускают уведомления | да (`:99`, workers `:192`) | нет |
| `DB_IDENTITY_ROLE` | `src/core/security/identity-role.ts:35` | нет | вход по email/ПИН и поиск ключа устройства идут без переключения роли (под RLS — пусто) | да (`:107`, workers `:200`) | нет |
| `TRUST_PROXY` | `src/lib/rate-limiter.ts:479` | нет | все клиенты считаются одним (общий счётчик попыток входа) | да (`:123`) | нет |
| `BACKUP_ENABLED` | `src/core/observability/health-tracker/checkers/backup.ts:18` | нет | мониторинг бэкапов «disabled», метрики бэкапа нулевые | да (`:129`) | нет |
| `BACKUP_DIR` | `src/core/observability/health-tracker/checkers/backup.ts:24` | нет | каталог по умолчанию | **нет** | нет |
| `MULTI_TENANT_MODE` | `src/services/tenancy/tenant-context-service.ts:16`; `src/proxy.ts:87` | нет | режим single-tenant | **нет** | нет |
| `TENANT_DOMAIN` | `src/proxy.ts:102-103` | нет | поддомены не разбираются как тенант | **нет** | нет |
| `ALLOWED_DEV_ORIGIN` | `src/proxy.ts:21-22` | нет | Origin не добавляется в allowlist | **нет** | нет |
| `CORS_ALLOWED_ORIGINS` | `src/proxy.ts:26-27` | нет | только localhost-Origins | **нет** | нет |
| `NEXT_PUBLIC_APP_URL` | `src/proxy.ts:31-32` | нет | Origin из env не добавляется | **нет** | нет (публичная переменная) |
| `NEXT_PUBLIC_SITE_URL` | `src/app/sitemap.ts:10`; `src/app/orion/page.tsx:12` | нет | дефолт `https://orionpiling.ru` | **нет** | нет (публичная) |
| `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` | `src/components/piling/to/to-module.tsx:129` | нет | shell включён по умолчанию | **нет** | нет (публичная) |
| `APP_VERSION` | `next.config.ts:22`; `src/app/api/health/route.ts:52`; `src/app/api/metrics/route.ts:95` | нет | «unknown» | build-arg `docker-compose.yml:66`, prod не пробрасывает | **да**: отдаётся в `/api/health` и `/api/metrics` (не секрет) |
| `LOG_LEVEL` | `src/lib/logger.ts:40` | нет | `info` в проде, `debug` иначе | **нет** | нет |
| `LOG_CACHE_STATS` / `LOG_WORKER_STATS` / `LOG_REDIS_LIFECYCLE` / `LOG_UNHANDLED_EVENTS` / `LOG_PROJECTION_SKIPS` | `src/instrumentation.ts:21-25`; `src/lib/redis-cache.ts:86`; `src/core/cache/response-cache.ts:361` | нет | подробные логи выключены | **нет** | нет |
| `LOG_WORKER_LIFECYCLE` / `LOG_LEADER_ELECTION` / `LOG_SCHEMA_REGISTRATION` / `LOG_HANDLER_REGISTRATION` | `src/core/observability/lag-monitor.ts:37`; `src/core/infrastructure/leader-election.ts:15`; `src/core/event-bus/schema-registry/registry.ts:6`; `src/services/reports/domain-events.ts:18` | нет | выключено | **нет** | нет |
| `SENTRY_DSN` | `src/workers/unified-worker/sentry.ts:24`; `src/services/system/system-service.ts:63` | нет | Sentry воркера — no-op; диагностика показывает `configured:false` | workers `:206` | нет (только булево в `/api/system`) |
| `SENTRY_AUTH_TOKEN` | `next.config.ts:154,169-170`; `scripts/validate-env.ts:204` | нет (build) | карты исходников не выгружаются | **нет** | нет |
| `SENTRY_PROJECT` / `SENTRY_ORG` / `SENTRY_RELEASE` | `src/services/system/system-service.ts:64`; `next.config.ts:122,165` | нет | значения по умолчанию | **нет** | имя проекта в `/api/system` (админский) |
| `WEATHER_API_BASE` | `src/services/weather/weather-client.ts:82` | нет | `https://api.open-meteo.com` | **нет** | нет |
| `MQTT_BROKER_URL` | `src/services/telemetry/mqtt-ingestion-service.ts:50` | нет | ingestion выключен, пишется `logger.info('MQTT: no MQTT_BROKER_URL configured')` (`:133`) | **нет** | нет |
| `MQTT_USERNAME` / `MQTT_PASSWORD` / `MQTT_CLIENT_ID` / `MQTT_QOS` / `MQTT_TOPIC_PREFIX` | `src/services/telemetry/mqtt-ingestion-service.ts:55-59` | нет | MQTT не подключается | **нет** | нет (пароль брокера не логируется) |
| `PRISMA_POOL_TIMEOUT` / `PRISMA_CONNECTION_LIMIT` | `src/lib/db.ts:94-95` | нет | 10 с / 20 соединений | **нет** | нет |
| `DATABASE_LOG_QUERIES` | `src/lib/db.ts:45` | нет | уровень `warn,error` | **нет** | **да, при `=true`**: Prisma логирует запросы с параметрами (см. находку #3) |
| `RATE_LIMIT_BYPASS` | `src/lib/rate-limiter.ts:178-180` | нет | лимиты работают | **нет** | нет; учитывается только при `NODE_ENV!=='production'` — на проде безвредна |
| `CACHE_DEFAULT_TTL` | `src/lib/redis-cache.ts:48` | нет | 300 с | **нет** | нет |
| `CDN_BASE_URL` / `MEDIA_MAX_FILE_SIZE` | `src/core/media/media-service.ts:507-508` | нет | без CDN, лимит 10 МБ | **нет** | нет |
| `ENABLED_WORKERS` | `src/workers/unified-worker/config.ts:12` | нет | `outbox,projection,pdf` | workers `:178` | нет |
| `WORKER_HEALTH_PORT` / `OUTBOX_INTERVAL_MS` / `PROJECTION_INTERVAL_MS` / `PDF_WORKER_CONCURRENCY` | `src/workers/unified-worker/config.ts:6-9` | нет | 3002 / 10000 / 5000 / 2 | workers `:173-176` | нет |
| `EMBEDDED_WORKERS` | `src/workers/embedded-workers.ts:44` | нет | дефолтный набор воркеров | **нет** | нет |
| `PM_SCHEDULER_ENABLED` / `PROJECTION_REBUILD_ENABLED` / `READINESS_SCHEDULER_ENABLED` | `src/workers/unified-worker.ts:174-187`; `src/core/observability/health-tracker/scheduler-registry.ts:72-74` | нет | планировщик включён (кроме `=false`) | **нет** | нет |
| `IDEMPOTENCY_CLEANUP_ENABLED` и парные `*_INTERVAL_MS` / `*_STARTUP_DELAY_MS` | `src/core/observability/health-tracker/scheduler-registry.ts:50` | нет | очистка выключена | **нет** | нет |
| `PDF_TEMP_CLEANUP_ENABLED` / `PDF_TEMP_CLEANUP_DRY_RUN` | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:8,16` | нет | очистка выключена | **нет** | нет |
| `WINDIR` | `src/lib/pdf-generator/fonts.ts:10` | нет | `C:\Windows\Fonts` | **нет** | нет |

\* `DATABASE_URL` обязательна по факту (бросается исключение), но в `validate-env.ts` её нет — там проверяется `DATABASE_URL_POSTGRES`.

## Где пишутся тела запросов, заголовки, токены, пароли, email, телефон

| Место | Что пишется | Маскирование | Оценка |
|---|---|---|---|
| `src/services/audit/audit-service.ts:1000` — `logger.info('audit', event as unknown as Record<string, unknown>)` | **весь объект события**, включая `metadata` | **нет** | ПИИ в лог: email, телефон, ФИО, данные отчёта |
| `src/app/api/auth/login/route.ts:62,78,90` | `metadata: { email }` при входе (успех/отказ/лимит) | нет | email уходит в `recordAuditEvent` → в лог (см. выше) |
| `src/services/users/user-service.ts:182-186` | `metadata: { email, role, isActive }` | нет | email в лог |
| `src/services/users/user-service.ts:311-314` | `metadata: { before, after }` — объекты с `email, name, phone` (`:244,294`) | нет | email + телефон + ФИО в лог |
| `src/services/reports/event-handlers.ts:474-480` | `metadata: { ..., data: event.data }` — данные отчёта | нет | данные отчёта в лог (через #1) |
| `src/services/feedback/feedback-event-service.ts:128` | `metadata` сохраняется в БД как есть | нет | в БД ленты метаданные не маскируются (админский экран — по замыслу) |
| `src/modules/readiness/domain/audit/mask.ts:7-11` | список ключей для маскирования: `password, pin, token, secret, apikey, cookie, authorization, email, phone, mobile, address` | **есть** | применяется только к цепочке readiness (`append-audit.ts:65-71`), не к `recordAuditEvent` |
| `src/core/api-wrapper.ts:122` | `logger.warn(..., { message: error.message })` для ошибок Prisma | нет | текст ошибки Prisma называет таблицы/поля схемы |
| `src/core/api-wrapper.ts:128-129` | `logger.error('API handler failed', error, { domain })` + `Sentry.captureException(error, ...)` | нет | `logger` пишет `message` и `stack`; клиенту — общая фраза (ПРОЙДЕНО) |
| `src/lib/logger.ts:64-104` | JSON-строка из `message` + произвольных `data` | **нет** | в логгере нет универсального редактора секретов/ПИИ |
| `src/lib/logger.ts:126-146` — `withRequestLogging` | метод/путь/`userId` | — | **нигде не используется** (мёртвый код) |
| `src/app/api/alerts/webhook/route.ts:117,167,171,178` | только числа/`alertname` | — | токен не логируется (ПРОЙДЕНО) |
| `src/app/api/metrics/route.ts:40-44` | токен сравнивается constant-time | — | не логируется (ПРОЙДЕНО) |
| `src/instrumentation.ts:19-28` | значения флагов `LOG_*`, `NODE_ENV`, `NEXT_RUNTIME` | — | раскрытие конфигурации, не секрет |
| `scripts/tg-send.ts:5` | `ENCRYPTION_KEY len: N` | — | печатается только длина |
| Sentry: `sentry.server.config.ts:17`, `sentry.edge.config.ts:12`, `instrumentation-client.ts:24`, `src/workers/unified-worker/sentry.ts:34` | `sendDefaultPii: false`, `enableLogs: false` | — | тела/заголовки в Sentry не уходят (ПРОЙДЕНО); `beforeSend` не задан, но PII отключён на уровне SDK |

## Находки

Статусы: **ПРОЙДЕНО** — проверено и подтверждено как корректное; **ГИПОТЕЗА** — вероятно, но не доказано; иначе — подтверждённый дефект.

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | `src/services/audit/audit-service.ts:1000` | Вся запись аудита пишется в лог без маскирования, хотя модуль `mask.ts` есть | Вход пользователя пишет email (`api/auth/login/route.ts:62,78,90`), правка пользователя — email+телефон+ФИО (`user-service.ts:311-314`), события отчёта — `data` (`event-handlers.ts:474-480`). Всё это уходит в stdout → docker json-file → Loki. Это ПИИ сотрудников и данные производства, а проект осознанно держит `sendDefaultPii:false` в Sentry. | Маскировать `event` перед `logger.info` (например, прогнать `maskOptionalAuditPayload` из `modules/readiness/domain/audit/mask`) или логировать только `action/scope/requestId/actorId` |
| 2 | важно | `Dockerfile:119` vs `package.json:10` | В контейнере `validate-env.ts` не запускается | `npm start` = `npx tsx scripts/validate-env.ts && node .next/standalone/server.js`, а образ стартует `CMD ["node","server.js"]` без валидатора. Обязательные секреты (в т.ч. условные для `postgres`) на проде заранее не проверяются; неудачная конфигурация проявляется в рантайме по частям. | Вызвать `validate-env` из `instrumentation.ts` на старте (или добавить в CMD образа) |
| 3 | важно | `src/lib/db.ts:45` | `DATABASE_LOG_QUERIES=true` включает логирование Prisma с параметрами | `getPrismaLogLevels()` возвращает `['query','warn','error']`; Prisma пишет текст запроса и его параметры. Через параметры в лог попадают email (поиск пользователя) и хеши паролей; в докере это stdout. | Не включать на проде; если нужен, документировать риск и не смешивать с прод-логом |
| 4 | важно | `docker-compose.observability.yml:50`; `docker-compose.monitoring-standalone.yml:49` | `GF_SECURITY_ADMIN_PASSWORD=admin` захардкожен | Пароль админа Grafana в репозитории; на стендах, поднятых по этим файлам, доступ к дашбордам — с публично известным паролем. | Убрать в `${GRAFANA_PASSWORD:?…}` (как уже сделано в `docker-compose.monitoring-prod.yml:60`) |
| 5 | важно | `docker-compose.yml:78-85,168-172` | Секреты передаются как `environment` | `DATABASE_URL`, `DATABASE_URL_POSTGRES`, `REDIS_URL`, `REDIS_URL_CACHE` содержат пароли; плюс `SESSION_SECRET`, `ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`. Значения видны в `docker inspect`, `/proc/1/environ`, а при утечке хост-доступа дают прямой вход в БД/Redis и расшифровку токена бота. | Учитывать как принятый риск либо перейти на `secrets:`/файлы в контейнере |
| 6 | важно | `scripts/reset-passwords.ts:19-30` | Хардкод паролей реальных учёток | `admin123`, `dispatch123`, `sas02password` для email `admin@piling.ru`, `sas02@rambler.ru` и др. Скрипт сбрасывает пароли на известные; запуск против любой живой базы открывает вход. | Убрать список из репозитория; пароли — из env/промпта; скрипт пометить как запрещённый к запуску вне одноразового стенда |
| 7 | мелочь | `Dockerfile:26` | `ENV PIN_LOOKUP_SECRET=…` объявлен, но код его не читает | Имени нет ни в одном чтении `process.env` (см. команду в «Методике»: в списке из 99 имён его нет). Стаб существует только в builder-стадии (в runner не копируется) — но документация/деплой ждут этот «секрет». | Удалить имя или явно пометить устаревшим |
| 8 | мелочь | `sentry.server.config.ts:8`; `sentry.edge.config.ts:9`; `src/instrumentation-client.ts:8` | DSN Sentry захардкожен в трёх файлах | DSN — не «секрет» доступа, но публичный ключ проекта в гите; при желании сменить проект/ключ придётся править код. | Вынести в env (`SENTRY_DSN`) с дефолтом |
| 9 | мелочь | `src/core/api-wrapper.ts:122` | В лог пишется текст ошибки Prisma (`error.message`) | Сообщения Prisma называют таблицы и поля схемы; клиенту при этом отдаётся общая фраза (это правильно). Для логов — приемлемо, но стоит знать. | Оставить либо урезать до `error.code` |
| 10 | мелочь | `src/lib/logger.ts:126-146` | `withRequestLogging` экспортируется, но не используется | Мёртвый код: логировал бы `method/path/userId`, но ни один маршрут его не вызывает. | Удалить (или начать использовать осознанно) |
| 11 | мелочь | `src/services/system/system-service.ts:62-65`; `src/app/api/system/route.ts:18` | Диагностика отдаёт `sentry.project`, `nodeEnv`, `platform` | Эндпоинт защищён `assertCan(user,'users.manage')` (админ), значения не секретные, но это лишняя карта конфигурации в API. | По желанию сократить набор полей |
| 12 | мелочь | `scripts/smoke-auth-access.js:203`; `scripts/quick-load-test.js:94`; `scripts/stress-test-100.js:27` | Хардкод тестовых секретов/паролей | `SESSION_SECRET: 'smoke-test-session-secret-minimum-32-characters'`, `password: 'loadtest123'`. Для локальных нагрузочных скриптов не критично, но это ещё три места с «секретом» в репозитории. | Брать из env |
| 13 | мелочь | `docker-compose.monitoring-prod.yml:161` | `REDIS_PASSWORD=${REDIS_PASSWORD}` без `:?` | В отличие от app-сервиса (`docker-compose.yml:81`), здесь пустое значение по умолчанию допустимо — redis-exporter поднимется с пустым паролем и промолчит о проблеме. | Добавить `:?REDIS_PASSWORD must be set` |
| 14 | мелочь | `src/instrumentation.ts:19-28` | На старте логируются значения флагов окружения | Раскрывает конфигурацию (`LOG_*`, `NODE_ENV`) в логе; не секрет, но без пользы для эксплуатации. | По желанию логировать только имена включённых флагов |
| 15 | ПРОЙДЕНО | `src/app/api/health/route.ts:34-35`; `src/app/api/metrics/route.ts:40-44,95`; `src/app/api/alerts/webhook/route.ts:80-85` | Публичные эндпоинты не раскрывают секретов | `/api/health` отдаёт только `status/version/uptime`; `/api/metrics` — метрики и `app_version`; токены сравниваются constant-time и не логируются. | — |
| 16 | ГИПОТЕЗА | `src/lib/rate-limiter.ts:188`; `src/services/auth/session-service.ts:124` | Сообщения ошибок Redis попадают в лог (`error.message`) | ioredis обычно отдаёт «connect ECONNREFUSED host:port», без пароля из строки подключения, но полного перебора сообщений на реальном прогоне не делалось; строка `REDIS_URL` содержит пароль (`session-service.ts:110`). | Убедиться, что ioredis не эхоит URL с креденшелами; при сомнении — маскировать |

## Что не проверено

- **Значения переменных.** Не читались ни `.env*`, ни реальные секреты — только имена и места чтения по коду.
- **`src/app/api/orion/**`, `src/app/orion/**`, `src/components/orion/**`, `public/orion*`** — заморожены по `AGENTS.md`, не разбирались. Публичная форма заявки там собирает `name/phone/email` (`src/components/orion/orion-handoff-site.tsx:92`), а серверный маршрут `/api/orion/lead` пишет `logger.error(... { leadId, error })` — содержимое этого лога и тела заявки не проверено.
- **Реальный вывод логов.** Логи в живом контейнере не смотрелись: вывод про Loki/json-file построен по коду (`logger.ts:69-79` → `console.log`), а не по фактическому логу.
- **Поведение AWS SDK / ioredis при ошибках.** Не проверено, эхоят ли они `S3_SECRET_ACCESS_KEY` / пароль из `REDIS_URL` (см. находку 16).
- **Файлы примеров окружения** (`.env.example`, `.env.production.example`, `README.md`, `docs/deployment.md`) не читались — правило «не читать `.env*`».
- **Код-файлы `docker-compose.staging.yml`** отдельно не разбирались (вне задания).
- **Числа.** Единственные числа, приведённые в отчёте (99 имён чтений `process.env` в `src/`+`next.config.ts`), получены командой из раздела «Методика»; остальные утверждения — построчные ссылки, не подсчёты.
