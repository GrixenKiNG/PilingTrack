# W152 — Переменные окружения и docker-compose (независимый аудит)

Аудируемая версия: `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01a264ffae97e3eaa7fea7582d90bf657d`
(«Merge codex/j9-j8-j7-1007»). Каталога `workers/` в репозитории нет — фоновый сервис
живёт в `src/workers/` и запускается из `src/workers/unified-worker.ts` (см. `Dockerfile.workers:99`).

## Итог

- Собрано **96** уникальных имён `process.env.*` (код `src/` + `scripts/`; по «плоской»
  команде `grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*"` — **91** имя, 356 вхождений;
  ещё 5 имён читаются только косвенно — `process.env['NAME']` и обёрткой `positiveIntEnv('NAME', …)`).
- Разобраны блоки `environment:` трёх сервисов в `docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.staging.yml` (app / workers / migrate). `env_file` нигде не объявлен — подтверждено.
- **критично — 0, важно — 9, мелочь — 10** (всего 19 находок в таблице). Ни одна переменная, без которой контейнер
  падал бы, в проброске не пропущена: все обязательные (`DATABASE_URL`, `DATABASE_URL_POSTGRES`,
  `SESSION_SECRET`, `ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`, `REDIS_URL`) есть в нужных
  контейнерах. Все реальные пропуски — «тихо меняет поведение», а не «не стартует».
- Топ-5:
  1. **`ENCRYPTION_KEY_VERSION` и `ENCRYPTION_KEY_V1..Vn`** не проброшены ни в app, ни в workers
     (`src/core/security/encryption.ts:66-79`), в compose их нет вовсе → механизм ротации ключа
     шифрования в Docker нерабочий (нужно #1).
  2. **`MULTI_TENANT_MODE`** не проброшена в app (`src/proxy.ts:87`,
     `src/services/tenancy/tenant-context-service.ts:16`) → значение в `.env` игнорируется
     (важно #2).
  3. **`LOG_LEVEL` и весь набор `LOG_*`** (отладка/диагностика) не проброшены ни в один контейнер →
     включить подробные логи через `.env` нельзя (важно #3).
  4. **`PRISMA_POOL_TIMEOUT` / `PRISMA_CONNECTION_LIMIT`** не проброшены в app/workers →
     настройка пула соединений из `.env` не действует (важно #4).
  5. **`PIN_LOOKUP_SECRET`** — мёртвое имя: не читается ни одной строкой кода, но описано как
     обязательное в `.env.production.example:13` и заведено стаб-ом в `Dockerfile:26` (важно #6).

## Методика

Всё воспроизводимо; `.env*` не открывались (только `*.example`), код читался только на чтение.

1. Сбор имён переменных из кода (node-скрипт, обходит `src/` и `scripts/` по всем
   расширениям `.ts/.tsx/.js/.cjs/.mjs`), три шаблона чтения:
   `process.env.NAME`, `process.env['NAME']`, `positiveIntEnv('NAME', …)`. Число из команды:
   ```
   grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*" src scripts | sort -u | wc -l   # 91
   grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*" src scripts | wc -l             # 356
   ```
2. Обход графа импортов от точки входа контейнера workers (`src/workers/unified-worker.ts`,
   с учётом `import(...)`): 108 файлов, **48** имён переменных, которые реально читает процесс
   workers. Всё остальное в `src/` — это app-контейнер (Next.js) плюс хост-скрипты.
3. Блоки `environment:` трёх сервисов выписаны вручную из
   `docker-compose.yml:41-49,71-129,164-206`, `docker-compose.prod.yml:26-30,142-144`,
   `docker-compose.staging.yml:35-44`. Проверено: `env_file` нет ни у одного сервиса
   (`grep -n "env_file" docker-compose*.yml` → пусто).
4. Для каждого имени из шагов 1-2 — сверка с блоком `environment:` его контейнера; для
   отсутствующих — чтение точки вызова глазами ради значения по умолчанию.
5. Обратный поиск «описано, но не читается»: для имён из `.env.example`,
   `.env.docker.example`, `.env.production.example` — `grep` по всему репозиторию.
6. Redis-ключи: `grep -rn "pilingtrack:" scripts src` и сопоставление с `keyPrefix` ioredis
   (`src/lib/redis-cache.ts:64`).
7. Утечки: `grep -rnE "JSON\.stringify\(process\.env"` и поиск `console.*`/`logger.*` рядом
   с идентификаторами `SECRET|TOKEN|PASSWORD|KEY` (значения не выводились).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | что делать |
|---|---|---|---|---|---|
| 1 | важно | `src/core/security/encryption.ts:79` (+ `:66-67`) | `ENCRYPTION_KEY_VERSION` и `ENCRYPTION_KEY_V1..Vn` читаются динамически (regex `^ENCRYPTION_KEY_V(\d+)$`), но в блоки `environment:` app (`docker-compose.yml:71-129`) и workers (`:164-206`) проброшен только `ENCRYPTION_KEY`; самих `ENCRYPTION_KEY_V*`/`ENCRYPTION_KEY_VERSION` нет ни в compose, ни в шаблонах | Ротация ключа шифрования (скрипт `scripts/rotate-encryption-key.ts`) в контейнере не увидит нового ключа и версии: контейнер всегда останется на `legacy` = `ENCRYPTION_KEY`. `ENCRYPTION_KEY_VERSION=v2` в `.env` молча проигнорируется. Есть default (`legacy`/высшая версия), поэтому падения нет — тихая неработоспособность ротации | Добавить в оба сервиса `- ENCRYPTION_KEY_VERSION=${ENCRYPTION_KEY_VERSION:-}` и (при использовании версий) `- ENCRYPTION_KEY_V1=…`/`V2=…`; имена задокументировать в `.env.production.example` |
| 2 | важно | `src/proxy.ts:87`, `src/services/tenancy/tenant-context-service.ts:16` | `MULTI_TENANT_MODE` не проброшена в app-контейнер (`environment:` app её не содержит) | Значение по умолчанию = single-tenant (не `'multi'`/`'true'`). Сейчас прод одноарендный, поэтому влияния нет, но как только появится тенант №2 — выставление `MULTI_TENANT_MODE=multi` в `.env` не дойдёт до контейнера, и принудительное требование `X-Tenant-ID` не включится. `.env.example:11` описывает имя, контейнер его не видит | Добавить `- MULTI_TENANT_MODE=${MULTI_TENANT_MODE:-false}` в сервис `app` |
| 3 | важно | `src/lib/logger.ts:40`, `src/instrumentation.ts:20-25`, `src/lib/redis-cache.ts:86`, `src/core/infrastructure/leader-election.ts:15`, `src/services/reports/domain-events.ts:18`, `src/core/event-bus/schema-registry/*:6,25`, `src/modules/reports/application/projections/projection-worker.ts:23,109`, `src/workers/embedded-workers.ts:190`, `src/core/observability/health-tracker/tracker.ts:19` | `LOG_LEVEL` и флаги `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE`, `LOG_LEADER_ELECTION`, `LOG_HANDLER_REGISTRATION`, `LOG_SCHEMA_REGISTRATION` не проброшены ни в app, ни в workers | Все имеют default «выключено» (`LOG_LEVEL` → `info` в проде). Включение подробных логов через `.env` не работает → диагностика на бою вслепую. `instrumentation.ts:19-28` печатает «Runtime log flags», где все `LOG_*` будут `null` | Либо пробросить нужные флаги в `environment:`, либо признать их «только через rebuild» и убрать из `.env`-ожиданий |
| 4 | важно | `src/lib/db.ts:94` и `src/lib/db.ts:95` | `PRISMA_POOL_TIMEOUT` (default 10 с) и `PRISMA_CONNECTION_LIMIT` (default 20) не проброшены ни в app, ни в workers | При PgBouncer `DEFAULT_POOL_SIZE=40` на 3 сервиса × 20 = 60 потенциальных клиентов. Тюнинг пула через `.env` не действует — значения всегда дефолтные | Добавить обе переменные в `environment:` `app` и `workers` |
| 5 | важно | `src/proxy.ts:26-27` (+ `:21-22`) | `CORS_ALLOWED_ORIGINS` и `ALLOWED_DEV_ORIGIN` не проброшены в app-контейнер | Белый список CORS из `.env` игнорируется: остаются только `localhost:3000/127.0.0.1` и `NEXT_PUBLIC_APP_URL` (build-time). Если боевой фронт ходит с отдельного origin — CORS-запросы не пройдут, а настройка в `.env` не поможет | Добавить `- CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-}` в сервис `app` |
| 6 | важно | `.env.production.example:13`, `Dockerfile:26`, `README.md:171`, `docs/deployment.md:47-48` | `PIN_LOOKUP_SECRET` описана как обязательный секрет и заведена build-стаб-ом, но **не читается ни одной строкой кода**: `grep -rn "process.env.PIN_LOOKUP_SECRET" src scripts prisma` → пусто; нет её и в `docker-compose*.yml` | Секрет генерируют, хранят и требуют при развёртывании ради ничего (вход по ПИН-коду удалён 27.09.2026 — `docs/deployment.md:47`). Деплой-док «все обязательны, иначе compose упадёт» вводит в заблуждение: compose про неё не знает | Убрать имя из `Dockerfile:26`, `.env.production.example:13`, `README.md:171`, `docs/deployment.md:48` — отдельной задачей владельца |
| 7 | важно | `.env.production.example:58-60`, `scripts/generate-env-docker.ps1` | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` описаны, но `grep -rln "OTEL_" src` → пусто; SDK не инициализируется | Шаблон прода обещает трейсинг, которого нет. Смена endpoint ни на что не влияет | Пометить имена как «не активно» в примере (пакеты не удалять) |
| 8 | важно | `scripts/reset-passwords.ts:48`, `scripts/tg-debug.ts:13-14` | `reset-passwords.ts:48` печатает **пароль открытым текстом** (`console.log(\`${user.email} -> ${user.password}\`)`); `tg-debug.ts:13-14` печатает первые 6 и последние 4 символа расшифрованного **токена бота** (`tok.slice(0,6)`/`tok.slice(-4)`) | Хост-скрипты админские, но это утечка секретов в stdout/историю терминала | Печатать только e-mail/статус и длину, без значений пароля и фрагментов токена |
| 9 | важно | `sentry.server.config.ts:8`, `sentry.edge.config.ts:9` | DSN Sentry **зашит в исходник** (не из `process.env`); при этом `.env.example:17` и `.env.production.example` описывают `SENTRY_DSN` как способ управления | `SENTRY_DSN` в app-контейнере вообще не проброшен, а на рантайме и не нужен — конфиг берёт зашитое значение. Ошибки уходят в Sentry независимо от переменной; комментарий в примере заставляет думать, что DSN можно выключить | Исправить комментарий примера; решить, оставлять ли зашитый DSN (клиентский DSN не секрет, но в VCS) |
| 10 | мелочь | `src/lib/db.ts:45` | `DATABASE_LOG_QUERIES` (default `false`) не проброшена ни в app, ни в workers | Логирование SQL-запросов через `.env` не включается | Пробросить в оба контейнера либо убрать из `.env`-ожиданий |
| 11 | мелочь | `src/lib/redis-cache.ts:48` | `CACHE_DEFAULT_TTL` (default 300 с) не проброшена в app/workers | TTL кэша настраивается только кодом | Пробросить или задокументировать |
| 12 | мелочь | `src/workers/unified-worker/pm-scheduler.ts:16-17`, `projection-rebuild-scheduler.ts:22-23`, `readiness-scheduler.ts:21-22`, `idempotency-cleanup-scheduler.ts:32-33`, `src/workers/unified-worker.ts:174,180,187,49` | `PM_SCHEDULER_*`, `PROJECTION_REBUILD_*`, `READINESS_SCHEDULER_*`, `IDEMPOTENCY_CLEANUP_INTERVAL_MS`, `IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS`, `WORKER_SHUTDOWN_TIMEOUT_MS` (8000) и флаги `*_ENABLED` не проброшены в workers | Все с дефолтами (планировщики включены, пока не `'false'`; уборка идемпотентности — opt-in `'true'`). Настройка периодов/выключение через `.env` не действует. Про отсутствие в compose уже написано в коде (`src/workers/unified-worker.ts:195-205`) | Пробросить нужные, если планируется переключать в бою |
| 13 | мелочь | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:6,14` | `PDF_TEMP_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_DRY_RUN` не проброшены в workers | Включение/dry-run уборки PDF через `.env` не действует | Пробросить при необходимости |
| 14 | мелочь | `src/workers/embedded-workers.ts:44` | `EMBEDDED_WORKERS` (default `['outbox','projection']` в проде) не проброшена в app | В app-контейнере по умолчанию **запускаются** встроенные outbox+projection (уживаются с контейнером `workers` через leader election). Выключить их через `.env` нельзя | Признать дефолт; при желании выключать — добавить имя в сервис `app` |
| 15 | мелочь | `src/services/weather/weather-client.ts:82` | `WEATHER_API_BASE` (default `https://api.open-meteo.com`) не проброшена в app | Прокси для погоды на случай блокировки провайдера не подхватывается из `.env` | Пробросить в `app` либо задокументировать |
| 16 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:50-59` | `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS` (default 1), `MQTT_TOPIC_PREFIX` не проброшены ни в один контейнер | Телеметрия дормантна (железо не подключено), но при подключении оборудования настраивать будет нечем — переменные не доходят | Описать блоком «Телеметрия (dormant)» в `.env.production.example` и добавить в нужный контейнер |
| 17 | мелочь | `src/core/media/media-service.ts:507-508` | `CDN_BASE_URL` (без default) и `MEDIA_MAX_FILE_SIZE` (default 10485760) не проброшены в app | CDN-адрес и лимит размера файла через `.env` не подхватываются | Пробросить или задокументировать |
| 18 | мелочь | `src/core/observability/health-tracker/checkers/backup.ts:24` | `BACKUP_DIR` (default `DEFAULT_BACKUP_DIR`) не проброшена в app | Файловый фолбэк мониторинга бэкапов смотрит в дефолтный каталог, а не в боевой; т.к. основной путь — Redis, влияние мало (дубль к R61) | Прописать боевой каталог или признать фолбэк нерабочим |
| 19 | мелочь | `src/services/auth/session-service.ts:66`, `src/services/system/system-service.ts:22` | `AUTH_SECRET` (запасной к `SESSION_SECRET`) не проброшена в app; `SENTRY_PROJECT` (`system-service.ts:64`) и `SENTRY_AUTH_TOKEN` (`:63`) — тоже | `AUTH_SECRET` — недокументированный алиас (работает, если `SESSION_SECRET` пуст, а он не пуст). `SENTRY_*` влияют только на косметический флаг диагностики | Оставить; упомянуть в шаблоне |

Дополнительно проверено и **не** является находкой:
`NEXT_PUBLIC_APP_URL` (`src/proxy.ts:31`), `NEXT_PUBLIC_SITE_URL` (`src/app/sitemap.ts:10`, ORION — зона заморожена),
`NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` (`src/components/piling/to/to-module.tsx:129`) — инлайнятся Next на сборке,
на рантайме им `environment:` не нужен. `APP_VERSION` — уже обрабатывается через `next.config.ts:22` + `ARG/ENV` в `Dockerfile:33-34,84-85`.
`NEXT_RUNTIME`, `NODE_ENV`, `HOSTNAME`, `NODE_OPTIONS`, `npm_package_version`, `TZ`, `WINDIR`, `ProgramFiles` — служебные (Node/Next/Compose), не проектные.
`RATE_LIMIT_BYPASS` (`src/lib/rate-limiter.ts:178`) в проде всё равно игнорируется (`NODE_ENV !== 'production'`), потому его отсутствие безвредно.

### Сводная таблица: «переменная | читает (файл:строка) | контейнер | в environment: да/нет | значение по умолчанию»

Ниже — все заметные читаемые переменные контейнеров app/workers и факт проброса. Для «да» указан сервис.

| переменная | читает (файл:строка) | контейнер | в environment: | значение по умолчанию |
|---|---|---|---|---|
| DATABASE_URL | `src/lib/db.ts:84` | app, workers | да (оба) | нет — throw без URL |
| DATABASE_URL_POSTGRES | `src/lib/db.ts:84`, `prisma/seed.ts:15` | app, workers, migrate | да | нет (fallback к DATABASE_URL) |
| DATABASE_PROVIDER | `scripts/validate-env.ts:158` | migrate | да | нет |
| SESSION_SECRET | `src/services/auth/session-service.ts:66` | app | да | dev-fallback/throw в проде |
| ENCRYPTION_KEY | `src/core/security/encryption.ts:74` | app, workers | да (оба) | throw в проде |
| ENCRYPTION_KEY_VERSION | `src/core/security/encryption.ts:79` | app, workers | **нет** | `legacy`/высшая версия |
| ENCRYPTION_KEY_V1..Vn | `src/core/security/encryption.ts:66-67` | app, workers | **нет** | — |
| DEVICE_KEY_LOOKUP_SECRET | `src/services/telemetry/device-key-service.ts` (`identity`/device) | app | да | throw вне dev |
| REDIS_URL | `src/lib/redis-cache.ts:47`, `src/lib/pdf-queue.ts:27` | app, workers | да (оба) | `redis://localhost:6379` |
| REDIS_URL_CACHE | `src/lib/redis-cache.ts:45` | app, workers | да (оба) | падает на `REDIS_URL` |
| DEFAULT_TENANT_ID | `src/core/notifications/telegram.ts`, фоновые пути | app, workers | да (оба) | нет (пусто) |
| DB_IDENTITY_ROLE | `src/core/security/identity-role.ts:35` | app, workers | да (оба) | пусто = нет переключения |
| TELEGRAM_API_BASE | `src/core/notifications/telegram.ts` | app, workers | да (оба) | `https://api.telegram.org` |
| S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY | `src/core/storage/s3-service.ts:24-27`, `media-service.ts:502-506` | app, workers | да (оба) | разные (напр. bucket `pilingtrack-reports`/`pilingtrack-media`) |
| SENTRY_DSN | `src/workers/unified-worker/sentry.ts:24`, `system-service.ts:63` | workers | да; **app — нет** | пусто = нет |
| ALERTMANAGER_WEBHOOK_TOKEN | `src/app/api/alerts/webhook/route.ts:77` | app | да | пусто = fail-closed 401 |
| METRICS_SCRAPE_TOKEN | `src/app/api/metrics/route.ts:40` | app | да | пусто = только сессия |
| TRUST_PROXY | `src/lib/rate-limiter.ts:119` | app | да | пусто = все за одним ключом |
| BACKUP_ENABLED | `src/core/observability/health-tracker/checkers/backup.ts:18` | app | да | пусто = выключено |
| MULTI_TENANT_MODE | `src/proxy.ts:87`, `tenant-context-service.ts:16` | app | **нет** | single-tenant |
| LOG_LEVEL, LOG_* | см. находку 3 | app, workers | **нет** | off / `info` |
| PRISMA_POOL_TIMEOUT / PRISMA_CONNECTION_LIMIT | `src/lib/db.ts:94-95` | app, workers | **нет** | 10 / 20 |
| DATABASE_LOG_QUERIES | `src/lib/db.ts:45` | app, workers | **нет** | `false` |
| CACHE_DEFAULT_TTL | `src/lib/redis-cache.ts:48` | app, workers | **нет** | 300 |
| WORKER_HEALTH_PORT / OUTBOX_INTERVAL_MS / PROJECTION_INTERVAL_MS / PDF_WORKER_CONCURRENCY / ENABLED_WORKERS | `src/workers/unified-worker/config.ts:6-12` | workers | да | 3002 / 10000 / 5000 / 2 / `outbox,projection,pdf` |
| PM_SCHEDULER_* / PROJECTION_REBUILD_* / READINESS_SCHEDULER_* / IDEMPOTENCY_CLEANUP_* / WORKER_SHUTDOWN_TIMEOUT_MS | см. находку 12 | workers | **нет** | 24ч/60с/… / 8000 |
| EMBEDDED_WORKERS | `src/workers/embedded-workers.ts:44` | app | **нет** | `outbox,projection` |
| WEATHER_API_BASE / MEDIA_MAX_FILE_SIZE / CDN_BASE_URL / BACKUP_DIR | см. находки 15-18 | app | **нет** | open-meteo / 10485760 / — / дефолт |
| MQTT_* | `src/services/telemetry/mqtt-ingestion-service.ts:50-59` | app | **нет** | dormant |

### Список отсутствующих (читает контейнер — в `environment:` нет)

**workers** (пропущено около 30 имён, все с дефолтами либо служебные): `ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY_V*`,
`DATABASE_LOG_QUERIES`, `CACHE_DEFAULT_TTL`, `PRISMA_POOL_TIMEOUT`, `PRISMA_CONNECTION_LIMIT`,
`PDF_TEMP_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_DRY_RUN`, `PM_SCHEDULER_ENABLED`,
`PM_SCHEDULER_INTERVAL_MS`, `PM_SCHEDULER_STARTUP_DELAY_MS`, `PROJECTION_REBUILD_ENABLED`,
`PROJECTION_REBUILD_INTERVAL_MS`, `PROJECTION_REBUILD_STARTUP_DELAY_MS`,
`READINESS_SCHEDULER_ENABLED`, `READINESS_SCHEDULER_INTERVAL_MS`,
`READINESS_SCHEDULER_STARTUP_DELAY_MS`, `IDEMPOTENCY_CLEANUP_ENABLED`,
`IDEMPOTENCY_CLEANUP_INTERVAL_MS`, `IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS`,
`WORKER_SHUTDOWN_TIMEOUT_MS`, `LOG_LEVEL`, `LOG_*` (8 флагов), `NEXT_RUNTIME` (служебная Next).

**app** (пропущены, все с дефолтами либо build-time): `MULTI_TENANT_MODE`, `CORS_ALLOWED_ORIGINS`,
`ALLOWED_DEV_ORIGIN`, `TENANT_DOMAIN`, `ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY_V*`,
`LOG_LEVEL`, `LOG_*`, `EMBEDDED_WORKERS`, `PRISMA_POOL_TIMEOUT`, `PRISMA_CONNECTION_LIMIT`,
`DATABASE_LOG_QUERIES`, `CACHE_DEFAULT_TTL`, `WEATHER_API_BASE`, `MQTT_*`, `CDN_BASE_URL`,
`MEDIA_MAX_FILE_SIZE`, `BACKUP_DIR`, `AUTH_SECRET`, `SENTRY_DSN`, `SENTRY_PROJECT`,
`SENTRY_AUTH_TOKEN`, `RATE_LIMIT_BYPASS` (в проде игнорируется), `NEXT_PUBLIC_*` (build-time),
`APP_VERSION` (build-time), `NEXT_PHASE`/`NEXT_RUNTIME` (служебные).

**migrate**: читает (`prisma/seed.ts`) `DATABASE_URL`, `DATABASE_URL_POSTGRES`, `NODE_ENV`,
`DEFAULT_TENANT_ID` (`prisma/seed.ts:101`, default `'orion'`). Проброшены первые три + `SKIP_SEED` + `DATABASE_PROVIDER`;
`DEFAULT_TENANT_ID` не проброшена, но дефолт `'orion'` совпадает с боевым → не находка.

### Список мёртвых имён (описаны в `.env*.example`, кодом/скриптами не читаются)

- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG`
  (`.env.production.example:58-60`) — `grep -rln "OTEL_" src` пусто (находка 7).
- `PIN_LOOKUP_SECRET` (`.env.production.example:13`) — кода нет (находка 6).
- `SENTRY_ORG` (`.env.example:14`) — читается динамически только как ключ карты в
  `scripts/validate-env.ts:90`, по существу описательное имя; отдельного потребителя нет.
- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_BUCKET`
  (`.env.production.example:44-48`) — **не мёртвые**: используются хост-скриптом
  `scripts/backup-postgres.sh:89-92` (через `read_env`). Упомянуты для полноты.

### Redis-ключи: расхождения хостовых скриптов и кода

Префикс ioredis задан в одном месте — `src/lib/redis-cache.ts:64` (`keyPrefix: 'pilingtrack:'`),
и `getStateRedisClient()` (`src/lib/redis-cache.ts:136`) использует тот же набор опций, поэтому
все обращения к состоянию получают этот префикс автоматически.

| кто пишет | ключ в скрипте | кто читает | вердикт |
|---|---|---|---|
| `scripts/backup.sh:95` | `pilingtrack:system:backup:last_timestamp` | `checkers/backup.ts:89` (читает `system:backup:last_timestamp` через префикс-клиент) | совпадает |
| `scripts/backup.sh:96` | `pilingtrack:system:backup:last_size` | `checkers/backup.ts:90` | совпадает |
| `scripts/backup.sh:97,167,176` | `pilingtrack:system:backup:s3_synced` (`"false"`/`"true"`) | `checkers/backup.ts:91,111` (`s3Synced === 'true'`) | совпадает |
| `scripts/backup-postgres.sh:161-163` | те же три ключа | те же | совпадает |

Расхождений **не найдено**. Оба скрипта пишут в инстанс состояния (`REDIS_URL`), а
`checkers/backup.ts:83` читает через `getStateRedisClient()` (инстанс `REDIS_URL`);
при заданном `REDIS_URL_CACHE` в проде это `stateSlot`, не кэш — ловушка двух Redis закрыта.

### Риск утечки секретов в логи

- `scripts/reset-passwords.ts:48` — печать пароля открытым текстом (находка 8).
- `scripts/tg-debug.ts:13-14` — печать первых 6 и последних 4 символов расшифрованного
  токена бота (`tok.slice(0,6)` / `tok.slice(-4)`); `:9` печатает длину и признак шифрования.
  Частичная утечка токена в stdout. **важно**.
- `src/workers/unified-worker/env-int.ts:34` — при некорректном целом значении логирует
  `value: raw` (само строковое значение). Если в числовую переменную по ошибке попало
  что-то чувствительное — оно уйдёт в лог. **мелочь**.
- В `src/` поиск `logger.*`/`console.*` рядом с `botToken|password|secret|apiKey|encryptionKey`
  дал только `logger.error(..., err)` (объект ошибки) и предупреждение о dev-fallback —
  печати секретов нет. `JSON.stringify(process.env` в репозитории не встречается.
- Значения секретов, строки подключения и содержимое `.env` в отчёт не выводились.

## Не проверено

- **Реальное содержимое боевого `.env`** — доступа нет (AGENTS.md §1). Все выводы «в проде
  значение X совпадает с дефолтом» — из кода и комментариев compose, не из файла. Поэтому
  утверждение «сейчас пропуски безвредны» опирается на то, что боевые значения равны дефолтам.
- **Запуск docker/compose** не выполнялся (запрещено заданием): факт «`docker compose config`
  сходится» и реальная подстановка `${VAR:-default}` не проверялись — только чтение YAML.
- **Интерполяция в `docker-compose.monitoring-prod.yml` / `-observability.yml` /
  `-monitoring-standalone.yml`** — там нет сервисов app/workers/migrate, поэтому их `environment:`
  построчно не разбирались.
- **Валидность зашитого DSN Sentry** (`sentry.server.config.ts:8`) — не проверялась: значение
  выглядит усечённым («`3954e5...dff0`»), но является ли это настоящим DSN проекта или
  санитизированной копией в этом worktree — не установлено. Только факт «DSN не берётся из env».
- **Миграционный сервис**: полный список переменных, которые читает `prisma migrate deploy`/
  `prisma.config.ts`, не разбирался построчно (вне приоритета задачи).
- **e2e/**, `tests/`, `deploy/`, `observability/` — вне охвата (`src/`, `scripts/`), их переменные
  не собирались.
- Файлы `src/services/auth/**`, `src/core/security/**` открывались только на чтение
  (AGENTS.md §1); правок нет.

## Приложение: сравнение

Сравнение сделано после первого прохода, с отчётом `docs/audits/hermes-night/R61-env-vars.md`
(«Переменные окружения PilingTrack: полный инвентарь», тот же репозиторий, но срез на 29.09.2026;
по SHA не идентифицирован). R61 ставил уклон на «читается, но не описано в `.env*`»; W152 —
на «читается кодом контейнера, но не проброшено в `environment:`». Пересечение большое.

| тема | R61 | W152 (этот отчёт) |
|---|---|---|
| Число имён | 93 (по всем каталогам, включая e2e) | 91/96 (только `src/`+`scripts/`, зато с учётом `process.env[ ]` и `positiveIntEnv`) |
| `BACKUP_ENABLED` | критично, «не описана» | **закрыто**: проброшена в app (`docker-compose.yml:129`); у нас не находка |
| `TRUST_PROXY` | критично, «не описана» | **закрыто**: проброшена (`docker-compose.yml:123`) |
| `TELEGRAM_API_BASE` | критично | **закрыто**: в app и workers (`:91`, `:184`) |
| `DB_IDENTITY_ROLE` | критично | **закрыто**: в app и workers (`:107`, `:200`) |
| `METRICS_SCRAPE_TOKEN` / `ALERTMANAGER_WEBHOOK_TOKEN` | важно | **закрыто** в app (`:112`, `:116`) |
| `ENCRYPTION_KEY_VERSION`/`_V1..Vn` | мелочь («не описана в шаблонах») | поднято до **важно** — не проброшено в контейнеры, ротация в Docker нерабочая |
| `PIN_LOOKUP_SECRET` | важно (мёртвое имя) | подтверждено, **важно** |
| `OTEL_*` | важно (мёртвое) | подтверждено, **важно** |
| `SENTRY_DSN` зашит в код | важно (SENTRY_DSN/SENTRY_ORG) | подтверждено; добавлен факт «в app `environment:` `SENTRY_DSN` нет вообще» |
| `LOG_*` | мелочь (список «только имена») | поднято: не проброшены **в контейнеры** — включение через `.env` не работает (важно) |
| `MULTI_TENANT_MODE` | не выделено | **важно**: не проброшена в app |
| `PRISMA_POOL_TIMEOUT`/`CONNECTION_LIMIT`, `CACHE_DEFAULT_TTL`, `DATABASE_LOG_QUERIES` | мелочь | подтверждено (мелочь) |
| Redis-ключи `pilingtrack:system:backup:*` | не разбирались | проверено: расхождений нет |
| Утечки секретов в логи | не разбирались | `reset-passwords.ts:48`, `tg-debug.ts:13-14` (важно), `env-int.ts:34` (мелочь) |

Новое относительно R61: (а) разделение «читает app» и «читает workers» по графу импортов;
(б) проверка каждого имени против `environment:` конкретного сервиса; (в) сверка Redis-ключей;
(г) находки по печати секретов. Основные критичные пункты R61 к этому SHA уже закрыты в
`docker-compose.yml` — это и есть главный результат сравнения: проброс боевых переменных сделан,
остались «настройки, которые тихо не доезжают».
