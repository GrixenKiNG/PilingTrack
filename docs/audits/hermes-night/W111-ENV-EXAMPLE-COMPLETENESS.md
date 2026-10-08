# W111 — полнота `.env.example` относительно кода

## Итог

`.env.example` (25 строк, 11 переменных) описывает лишь малую часть того, что читает код.
Из переменных, которые читает код в `src/`, `scripts/`, `prisma/`, **45 семейств/имён
отсутствуют** в `.env.example`; обратных (есть в примере, код не читает) — практически нет,
единственный кандидат `SENTRY_ORG` читается только динамически (`validate-env.ts:161`, ключ
`ENV_CONFIG`) и плагином Sentry, прямого `process.env.SENTRY_ORG` в коде нет.

Сводка по severity (список A):

- **критично — 3**: `DEVICE_KEY_LOOKUP_SECRET`, `DATABASE_PROVIDER`, `DB_IDENTITY_ROLE`.
- **важно — 18**: секреты доступа/развёртывания без значения по умолчанию (`METRICS_SCRAPE_TOKEN`,
  `ALERTMANAGER_WEBHOOK_TOKEN`, `TRUST_PROXY`, `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`),
  ключи шифрования с версиями, S3, флаги воркеров.
- **мелочь — 24**: отладочные флаги, интервалы планировщиков, скриптовые переменные.

Топ-5 по последствиям молчаливой потери:

1. `DEVICE_KEY_LOOKUP_SECRET` (`src/services/telemetry/device-key-service.ts:16`) — обязательна на
   бою, при отсутствии хеширование ключей устройств падает `ServiceError` (fail-closed).
2. `DB_IDENTITY_ROLE` (`src/core/security/identity-role.ts:35`) — без неё вход (email/ПИН/ключ
   устройства) идёт без переключения роли и под RLS возвращает пусто → пользователи не войдут.
3. `DATABASE_PROVIDER` (`scripts/validate-env.ts:23,158`) — `required: true` в валидаторе; копия
   `.env.example` без неё роняет проверку окружения (`npm run build`/старт).
4. `METRICS_SCRAPE_TOKEN` (`src/app/api/metrics/route.ts:40`) и `ALERTMANAGER_WEBHOOK_TOKEN`
   (`src/app/api/alerts/webhook/route.ts:77`) — fail-closed: без переменной Prometheus/Alertmanager
   молча получают 401, метрики и алерты пропадают.
5. `TRUST_PROXY` (`src/lib/rate-limiter.ts:479`) — без неё счётчик попыток входа общий на домен;
   `validate-env.ts:133` прямо предупреждает об этом на бою.

Дополнительно: `OTEL_*` из `.env.production.example:58-60` не читаются нигде в репозитории
(см. §Не проверено).

## Методика

Только чтение. Скрипты не создавались, значения не выводились — только имена.

1. Список имён из кода:
   `grep -rnEo 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' src scripts prisma | awk -F: '{v=$3; sub(/^process\.env\./,"",v); print v"\t"$1":"$2}' | sort -u`
2. Динамические чтения, которые grep по точкам не видит:
   - `grep -rnE 'process\.env\[' src scripts prisma` — доступ по ключу (массивы-константы);
   - `grep -rnE 'positiveIntEnv\(|parseIntEnv\(' src scripts` — имена переданы строкой;
   - `grep -rn 'ENCRYPTION_KEY_V' src` — версии ключа перебираются регуляркой
     (`src/core/security/encryption.ts:66-67`).
3. Имена из `docker-compose*.yml`: `grep -rhoE '\$\{[A-Za-z_][A-Za-z0-9_]*' docker-compose*.yml`.
4. Шаблоны окружения: `.env.example`, `.env.docker.example`, `.env.production.example`
   (`git ls-files | grep -i '^\.env'`).
5. `src/generated/postgres-client/**` — сгенерированный Prisma-клиент, из находок исключён
   (переменные `PRISMA_*`, `DOTENV_*`, `DEBUG`, `NO_COLOR`, `DATABASE_URL`, `COMPUTERNAME`,
   `_CLUSTER_NETWORK_NAME_` там — внутренние для рантайма Prisma, не конфиг проекта).
6. Исключены ОС/рантайм-переменные, которые ставит сам Node/Next/CI: `NODE_ENV`, `NEXT_RUNTIME`,
   `NEXT_PHASE`, `npm_lifecycle_event`, `npm_package_version`, `WINDIR`, `ProgramFiles`, `TZ`,
   `CI_CAPTURE`, `CODEX_WITH_S3`, `X` (буква в комментарии).
7. Тестовые/e2e-переменные собраны отдельно (§Приложение), в основной список не входят.

## Находки

Список A — читается кодом, но отсутствует в `.env.example`.
Колонка «обяз.» — требуется ли значение (нет).

| # | severity | path:line | проблема | сценарий / чем важно | правка |
|---|----------|-----------|----------|----------------------|--------|
| 1 | критично | `src/services/telemetry/device-key-service.ts:16` | `DEVICE_KEY_LOOKUP_SECRET` — обязательна вне dev/test, падение `ServiceError:500` (`:25-30`) | Новый разработчик копирует `.env.example` → хеширование ключей устройств падает; на б. dev-fallback `SESSION_SECRET` работает, на бою нет | Добавить в `.env.example` с пометкой «обязательно, fail-closed» |
| 2 | критично | `src/core/security/identity-role.ts:35` | `DB_IDENTITY_ROLE` — без неё переключение роли пропускается (`:36,59`) | Вход по email/ПИН/ключу устройства под RLS вернёт пусто → пользователи не войдут; `validate-env.ts:137` предупреждает на бою | Добавить в `.env.example` (и в проде-шаблон) |
| 3 | критично | `scripts/validate-env.ts:23,158` | `DATABASE_PROVIDER` — `required:true` в валидаторе | Копия `.env.example` (где её нет) валит проверку окружения на сборке/старте; при этом `src/lib/db.ts:40` всегда отдаёт `postgres` | Добавить `DATABASE_PROVIDER="postgres"` |
| 4 | важно | `src/services/auth/session-service.ts:66`; `src/services/system/system-service.ts:22` | `AUTH_SECRET` — легаси-алиас `SESSION_SECRET` (`SESSION_SECRET \|\| AUTH_SECRET`) | В `.env.example` его нет; при миграции со старого имени секрет теряется молча | Либо задокументировать как алиас, либо убрать |
| 5 | важно | `src/core/security/encryption.ts:79` | `ENCRYPTION_KEY_VERSION` — выбор активной версии ключа | В примере только `ENCRYPTION_KEY`; ротация (`:17-23`) невыполнима без знания переменной | Добавить в комментарий к `ENCRYPTION_KEY` |
| 6 | важно | `src/core/security/encryption.ts:66-67` | `ENCRYPTION_KEY_V1`, `_V2`, … — перебираются регуляркой `^ENCRYPTION_KEY_V(\d+)$` | Версии ключей вообще не упомянуты; при переносе сервера зашифрованные данные не расшифруются | Описать шаблон `ENCRYPTION_KEY_V<n>` в примере |
| 7 | важно | `src/lib/rate-limiter.ts:479` | `TRUST_PROXY` — без значения `true` `x-forwarded-for` игнорируется | Общий счётчик попыток входа на домен → блокировка всех сразу (`validate-env.ts:133`) | Добавить в `.env.example` |
| 8 | важно | `src/app/api/metrics/route.ts:40` | `METRICS_SCRAPE_TOKEN` — fail-closed (`:41`) | Без неё Prometheus получает 401, метрики исчезают без явной ошибки | Добавить в `.env.example` |
| 9 | важно | `src/app/api/alerts/webhook/route.ts:77` | `ALERTMANAGER_WEBHOOK_TOKEN` — fail-closed (`:78`) | Без неё вебхук Alertmanager отклоняет всё (`:89`) — алерты не доходят | Добавить в `.env.example` |
| 10 | важно | `src/core/notifications/telegram.ts:227,265,397` | `TELEGRAM_API_BASE` — отказоустойчивый прокси к api.telegram.org | `validate-env.ts:130-132`: на бою api.telegram.org заблокирован, без переменной уведомления не уходят | Добавить в `.env.example` |
| 11 | важно | `src/proxy.ts:26` | `CORS_ALLOWED_ORIGINS` — список origin для API | Дефолт пуст → браузерные клиенты на боевом домене получают CORS-отказ | Добавить в `.env.example` |
| 12 | важно | `src/proxy.ts:31` | `NEXT_PUBLIC_APP_URL` — доверенный origin | Не задокументирован, хотя участвует в CORS-whitelist | Добавить в `.env.example` |
| 13 | важно | `src/lib/db.ts:84` | `DATABASE_URL` — предпочтительный URL рантайма (pgbouncer), фолбэк на `DATABASE_URL_POSTGRES`; без обоих — throw `:86` | В примере только `DATABASE_URL_POSTGRES`; в проде `DATABASE_URL` указывает на pgbouncer — при копии шаблона пул pgbouncer не задействуется | Добавить `DATABASE_URL` с пояснением |
| 14 | важно | `src/core/storage/s3-service.ts:24-27,45`; `src/core/media/media-service.ts:502-506`; `src/core/observability/s3-health-check.ts:14` | `S3_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET` — без них фото/PDF не грузятся | В `.env.example` их нет; в проде-шаблоне есть. Медиа-загрузка молча деградирует до пустых креденшелов (`media-service.ts:505-506`) | Перенести S3-блок в `.env.example` |
| 15 | важно | `src/workers/embedded-workers.ts:44` | `EMBEDDED_WORKERS` — список встроенных воркеров, дефолт `outbox,projection` (`:26,47`) | Владение воркерами (встроенные vs отдельный контейнер) не задокументировано | Добавить в `.env.example` |
| 16 | важно | `src/workers/unified-worker/config.ts:12` | `ENABLED_WORKERS` — дефолт `outbox,projection,pdf` | При переносе контейнера `workers` легко забыть — воркеры берут дефолт | Добавить в `.env.example` |
| 17 | важно | `src/workers/unified-worker/config.ts:6` | `WORKER_HEALTH_PORT` — дефолт 3002, влияет на health-gate compose | Порт health-чека воркеров не задокументирован | Добавить в `.env.example` |
| 18 | важно | `src/workers/unified-worker.ts:174` | `PM_SCHEDULER_ENABLED` — выключатель планировщика ТО (`!== 'false'`) | Не задокументирован; при отладке неочевиден | Добавить в `.env.example` |
| 19 | важно | `src/workers/unified-worker.ts:187` | `READINESS_SCHEDULER_ENABLED` — выключатель суточного сброса техготовности | Как №18: без него вчерашние смены висят «в работе» | Добавить в `.env.example` |
| 20 | важно | `src/core/observability/health-tracker/scheduler-registry.ts:35` | `IDEMPOTENCY_CLEANUP_ENABLED` — читается динамически, opt-in (`=== 'true'`) | Комментарий `src/workers/unified-worker.ts:195-202` прямо требует внести её и в `workers`, и в `app`; в `.env.example` её нет вовсе | Добавить в `.env.example` |
| 21 | важно | `src/lib/rate-limiter.ts:178` | `RATE_LIMIT_BYPASS` — обход лимитера (для тестов) | Опасный флаг не задокументирован: его назначение и область действия неизвестны читателю | Задокументировать как тестовый |
| 22 | мелочь | `src/lib/redis-cache.ts:45,137` | `REDIS_URL_CACHE` — отдельный кэш-инстанс, фолбэк на `REDIS_URL` | В `.env.example` нет, в `.env.production.example:35` есть → при копии dev-шаблона теряется | Добавить в `.env.example` |
| 23 | мелочь | `src/lib/redis-cache.ts:48` | `CACHE_DEFAULT_TTL` — дефолт 300 c | Тюнинг кэша не задокументирован | Добавить в `.env.example` |
| 24 | мелочь | `src/proxy.ts:21` | `ALLOWED_DEV_ORIGIN` — доп. dev-origin для CORS | Только для разработки, но в примере отсутствует | Добавить в `.env.example` |
| 25 | мелочь | `src/proxy.ts:102` | `TENANT_DOMAIN` — subdomain-режим тенанта | Будущая мультитенантность; пока не задействована | Добавить с пометкой «зарезервировано» |
| 26 | мелочь | `src/app/sitemap.ts:10` | `NEXT_PUBLIC_SITE_URL` — public URL сайта | В `src/app/orion/page.tsx:12` (заморожено) тоже читается | Добавить в `.env.example` |
| 27 | мелочь | `src/components/piling/to/to-module.tsx:129` | `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` — флаг UI-оболочки | В сборке клиента; отсутствие меняет UI-ветку молча | Добавить в `.env.example` |
| 28 | мелочь | `src/core/media/media-service.ts:508` | `MEDIA_MAX_FILE_SIZE` — дефолт 10 МБ | Предел размера файла не задокументирован | Добавить в `.env.example` |
| 29 | мелочь | `src/core/media/media-service.ts:507` | `CDN_BASE_URL` — база CDN (`undefined` по умолчанию) | Раздача медиа через CDN не задокументирована | Добавить в `.env.example` |
| 30 | мелочь | `src/services/weather/weather-client.ts:82` | `WEATHER_API_BASE` — прокси погоды, дефолт open-meteo | Аналогично Telegram: на бою может понадобиться прокси (`validate-env.ts:109-116`) | Добавить в `.env.example` |
| 31 | мелочь | `src/core/observability/health-tracker/checkers/backup.ts:18,24` | `BACKUP_ENABLED` / `BACKUP_DIR` — контроль бэкапов | `validate-env.ts:140-142` предупреждает на бою; в примере нет | Добавить в `.env.example` |
| 32 | мелочь | `src/lib/db.ts:94-95` | `PRISMA_POOL_TIMEOUT` / `PRISMA_CONNECTION_LIMIT` — пул, дефолты 10/20 | Тюнинг пула не задокументирован | Добавить в `.env.example` |
| 33 | мелочь | `src/workers/unified-worker/config.ts:7-9` | `OUTBOX_INTERVAL_MS`, `PROJECTION_INTERVAL_MS`, `PDF_WORKER_CONCURRENCY` (`src/workers/pdf-worker.ts:28`) — интервалы воркеров | Все с дефолтами, но не задокументированы | Добавить в `.env.example` |
| 34 | мелочь | `src/workers/unified-worker.ts:49` | `WORKER_SHUTDOWN_TIMEOUT_MS` — дефолт 8000 | Таймаут graceful shutdown не задокументирован | Добавить в `.env.example` |
| 35 | мелочь | `src/workers/unified-worker/pm-scheduler.ts:16-17` | `PM_SCHEDULER_INTERVAL_MS`, `PM_SCHEDULER_STARTUP_DELAY_MS` | Тюнинг планировщика ТО | Добавить в `.env.example` |
| 36 | мелочь | `src/workers/unified-worker/projection-rebuild-scheduler.ts:22-23` | `PROJECTION_REBUILD_INTERVAL_MS`, `_STARTUP_DELAY_MS` | Тюнинг перестройки проекций | Добавить в `.env.example` |
| 37 | мелочь | `src/workers/unified-worker/readiness-scheduler.ts:21-22` | `READINESS_SCHEDULER_INTERVAL_MS`, `_STARTUP_DELAY_MS` | Тюнинг планировщика техготовности | Добавить в `.env.example` |
| 38 | мелочь | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:32-33` | `IDEMPOTENCY_CLEANUP_INTERVAL_MS`, `_STARTUP_DELAY_MS` | Тюнинг уборки ключей | Добавить в `.env.example` |
| 39 | мелочь | `src/workers/unified-worker.ts:180` | `PROJECTION_REBUILD_ENABLED` — выключатель (`!== 'false'`) | Не задокументирован | Добавить в `.env.example` |
| 40 | мелочь | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:6,14` | `PDF_TEMP_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_DRY_RUN` | Уборка временных PDF не задокументирована | Добавить в `.env.example` |
| 41 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:50-59` | `MQTT_BROKER_URL/CLIENT_ID/USERNAME/PASSWORD/QOS/TOPIC_PREFIX` — телеметрия (спит до железа) | Не в примере; при подключении железа имена неизвестны | Добавить в `.env.example` как «зарезервировано» |
| 42 | мелочь | `src/instrumentation.ts:20-25`; `src/lib/logger.ts:40`; `src/core/infrastructure/leader-election.ts:15`; `src/services/reports/domain-events.ts:18`; `src/core/event-bus/schema-registry/registry.ts:6` | Флаги логов: `LOG_LEVEL`, `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE`, `LOG_HANDLER_REGISTRATION`, `LOG_LEADER_ELECTION`, `LOG_SCHEMA_REGISTRATION` | Отладочные переключатели; часть дефолт off/on неочевидна | Свести в один блок в `.env.example` |
| 43 | мелочь | `src/app/api/health/route.ts:52`; `src/app/api/metrics/route.ts:95`; `src/core/observability/health-checks.ts:182` | `APP_VERSION` — вшивается при сборке (`next.config.ts:22`) | В `Dockerfile:29` build-стаб; в пример не входит | Пояснить в комментарии |
| 44 | мелочь | `scripts/seed-checklist-blocks.ts:941`; `scripts/app-role-smoke.ts:27`; `scripts/dev/smoke-fleet-monitoring.ts:33`; `scripts/verify-readiness.ts:22`; `scripts/republish-readiness-rules.ts:30`; `scripts/seed-user-document-types.ts:102` | `SEED_TENANT_ID`, `SMOKE_TENANT_ID` — скриптовые, фолбэк на `DEFAULT_TENANT_ID`/`orion` | Только для скриптов, но имена не задокументированы | Добавить в комментарий `.env.example` |
| 45 | мелочь | `scripts/validate-env.ts:204`; `src/services/system/system-service.ts:63-64` | `SENTRY_AUTH_TOKEN/DSN/PROJECT` — только часть в примере; комбинация веток (`src/workers/unified-worker/sentry.ts:24`) не описана | Воркер шлёт ошибки планировщиков в Sentry только при `SENTRY_DSN` (ср. R92) | Пояснить в `.env.example` |

Список B — есть в `.env.example`, но код их не читает напрямую.

| # | severity | path:line | переменная | статус |
|---|----------|-----------|------------|--------|
| B1 | мелочь | `scripts/validate-env.ts:90,161` | `SENTRY_ORG` | Прямого `process.env.SENTRY_ORG` в `src/`, `scripts/`, `prisma/` нет. Читается только динамически через ключ `ENV_CONFIG` (`validate-env.ts:161`) и, вероятно, плагином `@sentry/nextjs` (`next.config.ts:154-170` работает с `SENTRY_AUTH_TOKEN`) — не проверено. Формально «код читает», поэтому в список B с оговоркой. |

Вывод по списку B: **0 переменных, которые код гарантированно не читает**. Остальные 10 имён
`.env.example` читаются напрямую или динамически.

### Прочие шаблоны (важно для сценария «скопировал не тот файл»)

`.env.example` — самый бедный из трёх шаблонов. В `.env.docker.example` есть `DATABASE_PROVIDER`,
`POSTGRES_DB/USER/PASSWORD`; в `.env.production.example:2-59` дополнительно `DEVICE_KEY_LOOKUP_SECRET`,
`PIN_LOOKUP_SECRET`, `REDIS_PASSWORD`, `REDIS_URL_CACHE`, S3-блок, `BACKUP_S3_*`. Следствие:
разработчик, копирующий `.env.example` в докере/на сервере, теряет и их. `PIN_LOOKUP_SECRET`
(`.env.production.example:13`) кодом не читается (ср. R61) — упомянуто, не проверялось заново.

### Переменные, читаемые shell-скриптами (вне заявленного `process.env`-охвата)

`scripts/backup-postgres.sh` читает `BACKUP_S3_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET`
(`:89-92`), `REDIS_PASSWORD` (`:144`), `POSTGRES_DB/USER` (`:34-35`). Из них ничего нет в
`.env.example`; `BACKUP_S3_*` и `REDIS_PASSWORD` есть только в `.env.production.example`.

## Не проверено

- **Значения переменных** не читались и не выводились — только имена (по требованию задачи).
- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG`
  (`.env.production.example:58-60`): текстовый поиск по `src/`, `scripts/`, `prisma/`, `docker-compose*.yml`
  не нашёл ни одного чтения — похоже на мёртвую конфигурацию. Полный обход всего репозитория
  (включая возможное чтение библиотекой OpenTelemetry) не делал.
- Чтение `SENTRY_ORG` плагином Sentry — предположение, исходники плагина не открывал.
- Обязательность переменных оценивалась по видимому дефолту на месте чтения и по
  `scripts/validate-env.ts`; полный путь «что именно падает при старте» для каждой переменной
  не прогонял (нет собранного/запущенного окружения — это только чтение).
- Переменные из `process.env[<динамическое имя>]` с полностью вычисляемым ключом (не строковым
  литералом) не выявлялись; проверены только литеральные ключи, `positiveIntEnv('...')` и regex
  по `ENCRYPTION_KEY_V<n>`.
- `.env` (не `.example`) намеренно не открывался.
- Замороженные области (operator-варианты, ORION) пропущены, кроме упоминания `orion/page.tsx`.
