# R92 — Проброс переменных окружения в контейнеры `app` и `workers`

Повод: 01.10.2026 (ранбук 014, шаг 4) выяснилось, что у сервисов `app` и `workers`
в `docker-compose.yml` **нет `env_file`** — в контейнер попадает только то, что
перечислено в блоке `environment:`. `BACKUP_ENABLED` и `SENTRY_DSN` поэтому не
заданы на бою, хотя лежат в `.env`. Задача — найти ВСЕ такие тихие пропуски,
а также имена, проброшенные в compose, но не читаемые кодом.

Отчёт только на чтение: код, `docker-compose*.yml` и `.env` не менялись,
значения переменных не печатались и не искались.

## Итог

- Разобрано **86** уникальных имён, читаемых кодом контейнеров (`app` — **85**,
  `workers` приблизительно — **73**, пересечение — **72**), плюс **27** имён,
  которые compose подставляет только сервисам `app`/`workers` (источник —
  `docker-compose.yml` и `docker-compose.prod.yml`).
- Находок **24**: **важно — 4**, **мелочь — 20**. Разделы «по умолчанию годится»
  и «не нужен контейнеру» — справочные (§4), в число находок не входят.
- Механизм подтверждён: `env_file` не объявлен ни в одном compose-файле
  (`docker-compose.yml:104,120,191` — только комментарии), `.dockerignore:16-18`
  исключает `.env*` из образа, поэтому и `import 'dotenv/config'`
  (`src/workers/unified-worker.ts:17`) внутри воркера — пустышка: файла `.env`
  в `/app` нет.
- Топ-5:
  1. **`BACKUP_ENABLED`** (`checkers/backup.ts:16`) — нет в `app` → мониторинг
     бэкапов тихо выключен (`source:'disabled'`), метрики печатают жёсткий `0`,
     алерт `OffsiteBackupNotSynced` сработать не может. Ровно шаг 4 ранбука 014.
  2. **`BACKUP_DIR`** (`checkers/backup.ts:22`) — нет в `app`; дефолт
     `/backups/pilingtrack`, а дампы пишутся в `/var/backups/pilingtrack`
     (`scripts/backup-postgres.sh:23`) → файловый фолбэк всегда `missing`.
  3. **`SENTRY_DSN` в контейнере `workers`** (`workers/unified-worker/sentry.ts:24`)
     — нет в `environment:` сервиса `workers` → `initWorkerSentry()` выходит сразу,
     падения планировщиков и outbox уходят только в docker-лог с ротацией.
  4. **`ENCRYPTION_KEY_VERSION` + `ENCRYPTION_KEY_V*`** (`core/security/encryption.ts:66-79`)
     — не проброшены ни в один контейнер: ротация ключа через `.env` молча не
     применяется (активным остаётся `legacy` = `ENCRYPTION_KEY`).
  5. **`IDEMPOTENCY_CLEANUP_ENABLED`** (`scheduler-registry.ts:49`) — нет ни в
     `app`, ни в `workers`, хотя `unified-worker.ts:193-195` прямо предписывает
     добавить её в оба сервиса при включении уборки.

## Методика

Всё воспроизводимо; скрипты обхода — во временном каталоге, в репозиторий не
добавлялись. Значения `.env` не читались, только имена.

1. **Кто читает.** Node-скрипт обходил:
   - **app**: `src/**` кроме `src/workers/**` + `next.config.ts`,
     `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`
     (нет) + `src/instrumentation*.ts` (внутри `src`);
   - **workers (точно)**: статический граф импортов от `src/workers/unified-worker.ts`
     — тот же алгоритм, что в `src/workers/__tests__/no-next-in-workers.test.ts`
     (`import`/`export from`/`import =`, без `import type` и без динамических
     `import()`): получено **124 файла**;
   - **workers (приблизительно)**: `src/workers/**` + `src/lib/**` + `src/core/**`
     + `src/modules/**` + `src/services/**` (524 файла) — нужно, потому что
     telegram/encryption в воркере подключаются **динамическим** `import()`
     (`src/core/outbox/dead-letter-queue.ts:100`, `src/services/reports/event-handlers.ts:365,563`,
     `src/workers/unified-worker/pm-scheduler.ts:53`), и статический граф их не видит.
   Шаблоны: `process\.env\.([A-Z])`, `process\.env\[['"]([A-Z])['"]\]`,
   `positiveIntEnv\(\s*['"]([A-Z])` (обёртка `src/workers/unified-worker/env-int.ts:19`),
   плюс чтения через константу (`process.env[IDEMPOTENCY_CLEANUP_ENABLED_ENV]`,
   `scheduler-registry.ts:49`) и через перебор `Object.entries(process.env)`
   (`encryption.ts:66`, regex `^ENCRYPTION_KEY_V(\d+)$`).
   Файлы `*.test.*` и `__tests__/**` из «читает контейнер» исключены.
2. **Что проброшено.** Из `docker-compose.yml` выписаны блоки `environment:`
   сервисов `app` (`:71-123`) и `workers` (`:158-194`); из `docker-compose.prod.yml` —
   оверлей (`app`: `HOSTNAME`, `NODE_OPTIONS`, `:26-30`; `workers` — оверлея
   `environment:` нет, `:42-56`; `migrate`: `SKIP_SEED`, `:142-147`).
3. **Сверка.** Скрипт-дифф `множество(читается) − множество(проброшено)` и
   обратный `множество(проброшено) − множество(читается)`.
4. Точечное чтение точки вызова для каждой находки: `read_file` по
   `checkers/backup.ts`, `workers/unified-worker/sentry.ts`, `core/security/encryption.ts`,
   `lib/rate-limiter.ts`, `core/security/identity-role.ts`, `workers/embedded-workers.ts`,
   `lib/pdf-generator/storage.ts`, `lib/db.ts`, `lib/redis-cache.ts`, `proxy.ts`.
5. Шаблоны имён: `.env.example` (25 строк), `.env.docker.example` (13),
   `.env.production.example` (60) — прочитаны целиком, выписаны только имена.
6. Прод-путь выкладки: `scripts/deploy-prod.sh:90-96` (`docker compose up -d --no-build`,
   **без `-f`**), `scripts/prod-audit-readonly.sh:46-53,150`.

Ключевые команды:
```
node <scratch>/envscan.js src next.config.ts sentry.*.config.ts
node <scratch>/envside.js          # app vs граф воркера
node <scratch>/envapprox.js        # приблизительный набор воркера
node <scratch>/envdiff.js          # дифф с блоками environment:
grep -rn "env_file" docker-compose*.yml
grep -n "APP_VERSION\|ENV \|ARG " Dockerfile Dockerfile.workers
```

## Находки

severity: **важно** = отсутствие тихо выключает функцию на бою (мониторинг,
уведомления, бэкапы, безопасность); **мелочь** = остальное.

| # | severity | path:line | проблема | сценарий / почему важно | что делать |
|---|---|---|---|---|---|
| 1 | важно | `src/core/observability/health-tracker/checkers/backup.ts:16,76`; блок `app` `docker-compose.yml:71-123` (имени нет) | `BACKUP_ENABLED` читается в app (трекер стартует там: `src/instrumentation.ts:70-71` → `health-tracker/aggregate.ts:94` → `checkBackupStatus()`), но не проброшена | Пусто → `isBackupMonitoringEnabled()` = false → `checkBackupStatus()` возвращает `{status:'up', source:'disabled'}`; `src/app/api/metrics/route.ts:108-118` печатает `backup_age_hours 0` и `backup_s3_synced 0`, а алерт `OffsiteBackupNotSynced` (условие `> 0`) не сработает никогда. Даже положив `BACKUP_ENABLED=true` в `.env`, ничего не изменится | Добавить `- BACKUP_ENABLED=${BACKUP_ENABLED:-}` в `app` (и имя в `.env.production.example`) |
| 2 | важно | `src/core/observability/health-tracker/checkers/backup.ts:22`; `src/core/observability/health-tracker/thresholds.ts:14`; блок `app` (имени нет) | `BACKUP_DIR` не проброшена; дефолт `DEFAULT_BACKUP_DIR='/backups/pilingtrack'` — каталога с таким путём в контейнере нет | Файловый фолбэк (`backup.ts:25-73`) читает `/backups/pilingtrack/daily`, тогда как `scripts/backup-postgres.sh:23` пишет в `/var/backups/pilingtrack` → всегда `source:'missing'` | Пробросить `BACKUP_DIR=${BACKUP_DIR:-}` в `app` (либо признать фолбэк нерабочим) |
| 3 | важно | `src/workers/unified-worker/sentry.ts:24,31`; блок `workers` `docker-compose.yml:158-194` | `SENTRY_DSN` читается воркером, но не проброшен в сервис `workers` (`initWorkerSentry()` — `unified-worker.ts:135`) | `if (!process.env.SENTRY_DSN) return;` → ошибки планировщиков (ТО, перестройка проекций, техготовность), outbox и PDF-воркера не попадают в Sentry вообще, остаётся только `docker logs` с ротацией `20m × 5` (чтобы понять причину сбоя, нужно успеть до перезаписи). В `app` этой проблемы нет: DSN зашит в `sentry.server.config.ts:8` | Добавить `- SENTRY_DSN=${SENTRY_DSN:-}` в `workers` (и в `app` — см. #8) |
| 4 | важно | `src/core/security/encryption.ts:66-79`; блоки `environment:` обоих сервисов | `ENCRYPTION_KEY_VERSION` (имена `ENCRYPTION_KEY_V1..Vn` перебираются из `Object.entries(process.env)`) не проброшены ни в `app`, ни в `workers` | Ротация ключа выполняется добавлением `ENCRYPTION_KEY_V2=` + `ENCRYPTION_KEY_VERSION=v2` в `.env`. В контейнер это не попадёт: активным останется `legacy` (`ENCRYPTION_KEY`), новые секреты Telegram шифруются старым ключом, а оператор считает ротацию выполненной. Восстановление зашифрованных данных после удаления старого ключа из `.env` станет невозможным (`encryption.ts:114-119` бросает) | Пробросить `ENCRYPTION_KEY_VERSION=${ENCRYPTION_KEY_VERSION:-}` в оба сервиса; версионные ключи — либо перечислить явно, либо задокументировать ограничение |
| 5 | мелочь | `src/workers/unified-worker.ts:193-198`, `src/core/observability/health-tracker/scheduler-registry.ts:35,49`; блоки обоих сервисов | `IDEMPOTENCY_CLEANUP_ENABLED` не проброшена; комментарий в коде прямо предписывает добавить её в `workers` и `app` | Уборка — opt-in (`=== 'true'`), по умолчанию выключена, так что сейчас поведение верное. Но включить её через `.env` нельзя: значение не дойдёт до контейнера, а `/api/health/deep` (пульс планировщиков) останется согласован с выключенным состоянием | Вместе с включением (`F-IDEMP-CLEANUP-OPTIN`) добавить имя в оба сервиса |
| 6 | мелочь | `src/workers/unified-worker/sentry.ts:24`; блок `workers` | Граф статической зависимости до `telegram.ts` в воркере не доходит (динамический `import()`), поэтому проверка «а есть ли `TELEGRAM_API_BASE`/`ENCRYPTION_KEY` в воркере» по графу даёт ложно-отрицательный ответ | Это ловушка методики, а не дефект конфигурации: оба имени в `workers` **есть** (`docker-compose.yml:178,185`), и уведомления о сдаче наряда работают. Но любой будущий прогон «сверь граф с compose» без учёта динамических импортов объявит их отсутствующими — и наоборот, может не заметить реального пропуска | Учесть динамические `import()` при следующей сверке; в самом графе ничего менять не нужно |
| 7 | мелочь | `Dockerfile:33-34,84-85`; `Dockerfile.workers` (нет `ARG/ENV APP_VERSION`); `src/core/observability/health-tracker/aggregate.ts:120` | `APP_VERSION` в `app` запекается на сборке (`next.config.ts:22`), а в образ воркера не передаётся вовсе — а воркер читает её из окружения | Метрика воркера деградирует до `npm_package_version` вместо SHA выкладки; расхождение версий app/workers в диагностике незаметно | Пробросить `APP_VERSION` как build-arg и в `Dockerfile.workers` (или убрать чтение) |
| 8 | мелочь | `src/services/system/system-service.ts:63-64` | `SENTRY_DSN`/`SENTRY_PROJECT` в `app` читаются только для косметического флага `sentry.configured` в диагностике | Флаг всегда `false` (DSN зашит в `sentry.server.config.ts:8`), `sentry.project` всегда `null` — диагностика врёт о состоянии мониторинга | Пробросить `SENTRY_DSN` в `app` либо считать флаг из бандла |
| 9 | мелочь | `src/workers/embedded-workers.ts:44-47`; блок `app` (имени нет) | `EMBEDDED_WORKERS` не проброшена; при `NODE_ENV=production` (`docker-compose.yml:72`) дефолт — `['outbox','projection']` | В контейнере `app` по умолчанию поднимаются встроенные outbox+projection параллельно контейнеру `workers` (его `ENABLED_WORKERS=outbox,projection,pdf`, `docker-compose.yml:172`). Разводит их только leader election по Redis (`core/infrastructure/leader-election.ts`); при недоступном Redis `tryAcquire()` молча теряет лидерство (`:127-135`) и обе стороны начнут дублировать обработку | Задокументировать `EMBEDDED_WORKERS=off` как способ выключить; решить, нужен ли embedded outbox на бою |
| 10 | мелочь | `docker-compose.prod.yml:26-30`; `src/core/infrastructure/leader-election.ts:22`; `Dockerfile:91` | `HOSTNAME` переопределён в `0.0.0.0` (для привязки Next.js) и попадает в `nodeId` leader election: `0.0.0.0-<pid>` | В одном инстансе (app + workers) ID различаются только PID. При масштабировании `app` до нескольких реплик (одинаковый PID 1 в каждом контейнере) два процесса получат одинаковый `nodeId` → оба сочтут себя лидером и удвоят обработку outbox | Использовать для `nodeId` что-то уникальное (стабильный ID контейнера/случайный суффикс) вместо `HOSTNAME` |
| 11 | мелочь | блоки `app`/`workers`; `src/core/security/tenant-enforcement.ts:77`, `src/proxy.ts:87,102`, `src/proxy.ts:21,26,31` | `MULTI_TENANT_MODE`, `TENANT_DOMAIN`, `CORS_ALLOWED_ORIGINS`, `ALLOWED_DEV_ORIGIN`, `NEXT_PUBLIC_APP_URL` не проброшены | Для однотенантного прода (`orion`) поведение верное: `MULTI_TENANT_MODE` пусто → `isMultiTenant=false` (`proxy.ts:88-93`), проверки тенанта пропускаются. Опасность отложенная: при переходе на мультитенантность включение режима через `.env` не сработает, и выделение тенанта из поддомена молча выключится | Задокументировать или пробросить вместе с `MULTI_TENANT_MODE` |
| 12 | мелочь | `src/instrumentation.ts:20-25`, `src/lib/logger.ts:40`, `src/core/cache/response-cache.ts:361`, `src/lib/redis-cache.ts:86`, `src/lib/rate-limiter.ts:138`, `src/workers/embedded-workers.ts:31,190`, `src/core/observability/lag-monitor.ts:30`, `src/core/infrastructure/leader-election.ts:12`, `src/services/reports/domain-events.ts:18`, `src/core/event-bus/schema-registry/registry.ts:6`, `src/modules/reports/application/projections/projection-worker.ts:23,109` | 12 имён `LOG_*` не проброшены ни в один сервис | Диагностические логи выключены, и включить их на бою правкой `.env` нельзя — только правкой compose. Само по себе не поломка (флаги именно так и задуманы), но это «недокументированный рубильник»: `logEffectiveRuntimeFlags()` (`instrumentation.ts:19-28`) печатает `null` по всем флагам и создаёт впечатление, что они не читаются | Добавить строку-комментарий в `.env.production.example` |
| 13 | мелочь | `src/workers/unified-worker.ts:167,173,180`; `src/workers/unified-worker/pm-scheduler.ts:16-17`; `projection-rebuild-scheduler.ts:22-23`; `readiness-scheduler.ts:21-22`; `idempotency-cleanup-scheduler.ts:32-33`; блок `workers` | `PM_SCHEDULER_*`, `PROJECTION_REBUILD_*`, `READINESS_SCHEDULER_*`, `IDEMPOTENCY_CLEANUP_INTERVAL_MS/STARTUP_DELAY_MS`, `WORKER_SHUTDOWN_TIMEOUT_MS` не проброшены | Все имеют безопасный дефолт (`positiveIntEnv`, `env-int.ts:19-45`), планировщики включены, пока значение не `'false'`. Настроить периоды/выключить планировщик через `.env` нельзя — только через compose | Описать набор в `.env.production.example` (комментарием) |
| 14 | мелочь | `src/lib/db.ts:94-95`, `src/lib/redis-cache.ts:48`, `src/core/media/media-service.ts:508`, `src/services/weather/weather-client.ts:82` | `PRISMA_POOL_TIMEOUT`(10 с), `PRISMA_CONNECTION_LIMIT`(20), `CACHE_DEFAULT_TTL`(300 с), `MEDIA_MAX_FILE_SIZE`(10 МБ), `WEATHER_API_BASE` не проброшены | Дефолты согласованы с боем (`DEFAULT_POOL_SIZE=40` в `docker-compose.yml:248`, 3 сервиса × 20 = 60). Менять эти числа через `.env` — иллюзия: значение не дойдёт до контейнера | Пробросить или задокументировать, что меняется только compose |
| 15 | мелочь | `src/core/media/media-service.ts:507`; `src/app/api/media/[id]/download/route.ts:42-50` | `CDN_BASE_URL` не проброшена | При пустом значении ссылки на медиа строятся относительно приложения (`media-service.ts:507`, в API-роутах дефолтов на CDN вообще нет) — это рабочее поведение, CDN просто не используется | Пробросить, если CDN появится |
| 16 | мелочь | `src/lib/pdf-generator/storage.ts:9-13,24-28`; `docker-compose.yml:173-177,86-90` | `S3_*` проброшены **пустыми** дефолтами (`${S3_ENDPOINT:-}`); при пустом `S3_ENDPOINT` воркер пишет PDF в `process.cwd()/storage/pdf-results` своего контейнера | `app` читает результат из **своего** `/app/storage` — файла там нет, если S3 не настроен: сгенерированный PDF «есть», но скачать его нельзя. Плюс `/app/storage` не в томе (`docker-compose.yml:431-437`) — теряется при пересоздании контейнера. **Значения боевого `.env` не читались**, поэтому настроен ли S3 на проде — «не проверено» | Проверить, что на бою заданы `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`; иначе смонтировать общий том для `storage/` |
| 17 | мелочь | `scripts/deploy-prod.sh:90-96`; `docker-compose.prod.yml:1-20` | Прод-выкладка выполняет `docker compose up -d --no-build` **без `-f`**, то есть оверлей `docker-compose.prod.yml` применяется только если на сервере задан `COMPOSE_FILE` | Если оверлей не применён — `app` не получает `NODE_OPTIONS=--max-old-space-size=512` (тогда проверка памяти в `/api/health` висит в `warn`, см. комментарий `docker-compose.prod.yml:28-30`) и порты БД/Redis/MinIO остаются опубликованными на хост. Прямо на проброс прочих переменных это не влияет (блоки `environment:` в оверлее только добавляют `HOSTNAME`/`NODE_OPTIONS`). Наличие `COMPOSE_FILE` в боевом `.env` — **не проверено** (доступа нет; проверяется скриптом `scripts/prod-audit-readonly.sh:46-53`) | Запускать выкладку с явным `-f docker-compose.yml -f docker-compose.prod.yml` или зафиксировать `COMPOSE_FILE` документально |
| 18 | мелочь | `src/lib/rate-limiter.ts:178-179`, `src/services/telemetry/mqtt-ingestion-service.ts:50-59` | `RATE_LIMIT_BYPASS` и 6 имён `MQTT_*` не проброшены | Корректно: `RATE_LIMIT_BYPASS` защищён `NODE_ENV !== 'production'`, телеметрия дормантна (нет железа). Это не пропуск, а осознанное отсутствие | Не трогать; описать блоком «дормантно» при подключении оборудования |
| 19 | мелочь | `next.config.ts:21-23,128,154,164-170`; `src/instrumentation-client.ts:8` | `SENTRY_AUTH_TOKEN`, `SENTRY_RELEASE`, `SENTRY_ORG`, `CI`, `APP_VERSION`, `NEXT_PUBLIC_*` — build-time | Читаются во время `next build`/`withSentryConfig`, в рантайм-контейнер их пробрасывать не нужно (и нельзя — `NEXT_PUBLIC_*` запекаются в бандл). `SENTRY_ORG` не читается вообще (org зашит в `next.config.ts:122`) | Оставить как есть; `SENTRY_ORG` — кандидат на удаление из шаблонов |
| 20 | мелочь | `src/proxy.ts:21,26,31,102`; `src/app/sitemap.ts:10`; `src/app/orion/page.tsx:12`; `src/components/piling/to/to-module.tsx:125` | `ALLOWED_DEV_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` | CORS-настройки и публичный URL сайта не проброшены. `orion/page.tsx` и `to-module.tsx` — замороженные зоны/флаги сборки, здесь только фиксация | Пробросить CORS-имена, если появится второй домен |
| 21 | мелочь | `src/lib/logger.ts:42`, `src/workers/unified-worker/sentry.ts:32`, `src/instrumentation.ts:26-27`, `src/lib/db.ts:19`, `src/lib/redis-cache.ts:28` | `NODE_ENV`/`NEXT_RUNTIME` — системные | `NODE_ENV=production` задан в обоих сервисах (`docker-compose.yml:72,159`), `NEXT_RUNTIME` проставляет Next.js. Проброс не требуется | — |
| 22 | мелочь | `src/services/auth/session-service.ts:66`, `src/services/system/system-service.ts:22` | `AUTH_SECRET` — недокументированный алиас `SESSION_SECRET` | `SESSION_SECRET` в `app` задан (`docker-compose.yml:83`), поэтому алиас не нужен; в `workers` секрет не задан и не читается (session-service не в графе воркера) | Убрать алиас или описать |

### Переменные, проброшенные в compose, но не читаемые кодом контейнера (мусор)

| # | severity | path:line | что | сценарий | что делать |
|---|---|---|---|---|---|
| 23 | мелочь | `docker-compose.yml:80,164` | **`DATABASE_PROVIDER`** — проброшено в `app` и `workers`, но в рантайм-коде контейнеров не читается: `grep DATABASE_PROVIDER` по `src/` даёт только `scripts/*.ts`; `getDatabaseProvider()` (`src/lib/db.ts:40-42`) возвращает `'postgres'` константой | Безвредно, но мёртвое имя: читатель переменной — только `scripts/apply-postgres-hardening.ts:21`, который в контейнерах не запускается. Создаёт ложное впечатление, что провайдер настраивается | Убрать из обоих сервисов (или оставить с комментарием «для scripts/») |
| 24 | мелочь | `docker-compose.prod.yml:27,30` | `HOSTNAME`, `NODE_OPTIONS` — не читаются кодом как переменные окружения | `HOSTNAME` использует Next.js для привязки и `leader-election.ts:22` для `nodeId` (см. #10); `NODE_OPTIONS` — стандартная переменная Node. Мусором не являются, но в «читает код» не попадают | Оставить |

Замечание: имена, проброшенные и **действительно читаемые** — `DATABASE_URL`,
`DATABASE_URL_POSTGRES`, `REDIS_URL`, `REDIS_URL_CACHE`, `SESSION_SECRET`,
`ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`, `S3_*`, `TELEGRAM_API_BASE`,
`DEFAULT_TENANT_ID`, `DB_IDENTITY_ROLE`, `ALERTMANAGER_WEBHOOK_TOKEN`,
`METRICS_SCRAPE_TOKEN`, `TRUST_PROXY` (только `app`), `ENABLED_WORKERS`,
`WORKER_HEALTH_PORT`, `OUTBOX_INTERVAL_MS`, `PROJECTION_INTERVAL_MS`,
`PDF_WORKER_CONCURRENCY` (только `workers`) — подробная сверка в §4.

## §4. Полная сверка «имя → кто читает → проброшено → поведение при отсутствии»

Колонки: `app?` / `workers?` — есть ли имя в блоке `environment:` соответствующего
сервиса (`docker-compose.yml` + `docker-compose.prod.yml`).
`*.test.*` / `__tests__/**` из колонки «кто читает» исключены.

### 4.1. Проброшено и читается (эталон)

| имя | кто читает (файл:строка) | app? | workers? | поведение при отсутствии | вывод |
|---|---|---|---|---|---|
| `DATABASE_URL` | `src/lib/db.ts:84` | да | да | `throw`, если нет и `DATABASE_URL_POSTGRES` | ок |
| `DATABASE_URL_POSTGRES` | `src/lib/db.ts:84`, `src/core/observability/health-checks.ts:122` | да | да | фолбэк для db; `checkEnv()` → `warn` | ок |
| `REDIS_URL` | `src/lib/redis-cache.ts:45,47` | да | да | `redis://localhost:6379` → подключение не установится | ок |
| `REDIS_URL_CACHE` | `src/lib/redis-cache.ts:45,137` | да | да | фолбэк на `REDIS_URL` (единый инстанс) | ок |
| `SESSION_SECRET` | `src/instrumentation.ts:46` | да | (не читается) | `throw` в production | ок |
| `ENCRYPTION_KEY` | `src/core/security/encryption.ts:74` | да | да | `throw` в production | ок |
| `DEVICE_KEY_LOOKUP_SECRET` | `src/services/telemetry/device-key-service.ts:16` | да | (не в графе) | dev-фолбэк / `throw` вне dev | ок |
| `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` | `src/core/media/media-service.ts:502-506`, `src/lib/pdf-generator/storage.ts:11,35-46` | да | да | локальная ФС (см. #16) | ок |
| `TELEGRAM_API_BASE` | `src/core/notifications/telegram.ts:203,237,325` | да | да | `https://api.telegram.org` | ок |
| `DEFAULT_TENANT_ID` | `src/core/notifications/telegram.ts:44`, `src/core/outbox/dead-letter-queue.ts:95` | да | да | конфиг бота не найден, уведомления не уходят | ок |
| `DB_IDENTITY_ROLE` | `src/core/security/identity-role.ts:35` | да | да | переключения роли нет (запросы опознания под RLS) | ок |
| `ALERTMANAGER_WEBHOOK_TOKEN` | `src/app/api/alerts/webhook/route.ts:75` | да | (не нужен) | fail-closed 401 | ок |
| `METRICS_SCRAPE_TOKEN` | `src/app/api/metrics/route.ts:39-40` | да | (не нужен: `/metrics` воркера без токена, `health-server.ts:41`) | fail-closed 401 для скрейпера | ок |
| `TRUST_PROXY` | `src/lib/rate-limiter.ts:479,504` | да | (не нужен) | ключ лимита = `host-<домен>`, общий счётчик на всех | ок |
| `ENABLED_WORKERS` | `src/workers/unified-worker/config.ts:12` | (в app своё — `EMBEDDED_WORKERS`) | да | `outbox,projection,pdf` | ок |
| `WORKER_HEALTH_PORT` | `src/workers/unified-worker/config.ts:6` | — | да (+ `Dockerfile.workers:90`) | 3002 | ок |
| `OUTBOX_INTERVAL_MS` / `PROJECTION_INTERVAL_MS` / `PDF_WORKER_CONCURRENCY` | `src/workers/unified-worker/config.ts:7-9` | — | да | 10000 / 5000 / 2 | ок |

### 4.2. Читается, но НЕ проброшено — требует решения

| имя | кто читает (файл:строка) | app? | workers? | поведение при отсутствии | вывод |
|---|---|---|---|---|---|
| `BACKUP_ENABLED` | `checkers/backup.ts:16` | нет | нет (и не вызывается — см. ниже) | `source:'disabled'`, метрика `0` | **нужен проброс** в `app` (#1) |
| `BACKUP_DIR` | `checkers/backup.ts:22` | нет | нет | `/backups/pilingtrack` | **нужен проброс** в `app` (#2) |
| `SENTRY_DSN` | `workers/unified-worker/sentry.ts:24,31`; `services/system/system-service.ts:63` | нет | **нет** | в воркере Sentry не инициализируется; в app — косметический флаг | **нужен проброс** в `workers` (#3, #8) |
| `ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY_V<n>` | `core/security/encryption.ts:66-79` | нет | нет | активным остаётся `legacy` | **нужен проброс** в оба (#4) |
| `IDEMPOTENCY_CLEANUP_ENABLED` | `health-tracker/scheduler-registry.ts:49` | нет | нет | `false` (opt-in) | нужен при включении уборки (#5) |
| `EMBEDDED_WORKERS` | `workers/embedded-workers.ts:44` | нет | — | `['outbox','projection']` включены | нужен проброс, если встроенные воркеры не нужны (#9) |
| `APP_VERSION` | `health-tracker/aggregate.ts:120`, `health-checks.ts:182` | build-arg | нет своего | `npm_package_version` | мелочь (#7) |
| `MULTI_TENANT_MODE`, `TENANT_DOMAIN`, `CORS_ALLOWED_ORIGINS`, `ALLOWED_DEV_ORIGIN`, `NEXT_PUBLIC_APP_URL` | `core/security/tenant-enforcement.ts:77`, `proxy.ts:21-31,87,102` | нет | нет | однотенантный режим | мелочь (#11, #20) |
| `LOG_LEVEL`, `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE`, `LOG_LEADER_ELECTION`, `LOG_HANDLER_REGISTRATION`, `LOG_SCHEMA_REGISTRATION` | `instrumentation.ts:20-25`, `lib/logger.ts:40`, `core/cache/response-cache.ts:361`, `lib/redis-cache.ts:86-92`, `lib/rate-limiter.ts:138`, `core/observability/lag-monitor.ts:30`, `core/infrastructure/leader-election.ts:12`, `services/reports/domain-events.ts:18`, `core/event-bus/schema-registry/registry.ts:6`, `modules/reports/application/projections/projection-worker.ts:23,109` | нет | нет | тишина | мелочь (#12) |
| `PM_SCHEDULER_ENABLED/INTERVAL/STARTUP_DELAY`, `PROJECTION_REBUILD_ENABLED/INTERVAL/STARTUP_DELAY`, `READINESS_SCHEDULER_ENABLED/INTERVAL/STARTUP_DELAY`, `IDEMPOTENCY_CLEANUP_INTERVAL_MS`, `IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS`, `WORKER_SHUTDOWN_TIMEOUT_MS` | `workers/unified-worker.ts:47,167,173,180`, `unified-worker/pm-scheduler.ts:16-17`, `projection-rebuild-scheduler.ts:22-23`, `readiness-scheduler.ts:21-22`, `idempotency-cleanup-scheduler.ts:32-33` | — | нет | безопасные дефолты | мелочь (#13) |
| `PRISMA_POOL_TIMEOUT`, `PRISMA_CONNECTION_LIMIT`, `CACHE_DEFAULT_TTL`, `MEDIA_MAX_FILE_SIZE`, `CDN_BASE_URL`, `WEATHER_API_BASE` | `lib/db.ts:94-95`, `lib/redis-cache.ts:48`, `core/media/media-service.ts:507-508`, `services/weather/weather-client.ts:82` | нет | нет | дефолты 10/20/300/10 МБ / — / open-meteo | мелочь (#14, #15) |
| `AUTH_SECRET` | `services/auth/session-service.ts:66`, `services/system/system-service.ts:22` | нет | — | используется `SESSION_SECRET` | мелочь (#22) |
| `HOSTNAME` | `core/infrastructure/leader-election.ts:22` | да (оверлей) | да (Docker) | `unknown-<pid>` | мелочь (#10) |

### 4.3. Только для разработки / тестов / системные

| имя | кто читает | поведение |
|---|---|---|
| `RATE_LIMIT_BYPASS` | `lib/rate-limiter.ts:178` | защищено `NODE_ENV !== 'production'` — на бою не сработает |
| `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS`, `MQTT_TOPIC_PREFIX` | `services/telemetry/mqtt-ingestion-service.ts:50-59` | дормантная телеметрия, нужны при подключении железа |
| `CI`, `SENTRY_AUTH_TOKEN`, `SENTRY_RELEASE`, `SENTRY_ORG`, `NEXT_PHASE`, `npm_lifecycle_event`, `npm_package_version` | `next.config.ts:128,154,164-170`, `instrumentation.ts:53-54` | build-time |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` | `app/sitemap.ts:10`, `components/piling/to/to-module.tsx:125` | `NEXT_PUBLIC_*` запекаются в бандл на сборке |
| `NEXT_RUNTIME`, `NODE_ENV` | `instrumentation.ts:26-27`, `lib/db.ts:19`, `lib/redis-cache.ts:28` | проставляет Next.js / compose |
| `WINDIR` | `lib/pdf-generator/fonts.ts:10` | системная переменная Windows |
| `TZ` | только тесты (`modules/readiness/application/__tests__/operator-shift-query.test.ts:74-84`) | в рантайме не читается |

### 4.4. Не нужен контейнеру

| имя | почему |
|---|---|
| `DATABASE_PROVIDER` (проброшено в оба) | рантайм-код читает `getDatabaseProvider()` константой (`lib/db.ts:40-42`); имя нужно только `scripts/*.ts` |
| `NODE_OPTIONS` (оверлей `app`) | стандартная переменная Node |
| `SENTRY_ORG` | нигде в коде не читается, org зашит в `next.config.ts:122` |
| `POSTGRES_*`, `REDIS_PASSWORD`, `PGADMIN_*`, `MINIO_*`, `SKIP_SEED`, `GRAFANA_PASSWORD` | читаются Compose/сервисами инфраструктуры и `migrate`, не приложением |

## Не проверено

- **Значения боевого `.env` / `.env.production`** (`/opt/pilingtrack/.env`) — доступа
  нет (AGENTS.md §1), файл не читался. Поэтому выводы «на бою метрика всегда 0»,
  «S3 не настроен», «`TRUST_PROXY` пуст» — следствия из кода и compose, а не измерение.
  Не проверено и **наличие `COMPOSE_FILE`** в боевом `.env`, то есть применяется ли
  `docker-compose.prod.yml` вообще (косвенно проверяется `scripts/prod-audit-readonly.sh:46-53`).
- **Точный состав графа воркера при динамических `import()`**: статический обход даёт
  124 файла, приблизительный набор (524 файла, `src/workers|lib|core|modules|services`)
  — верхняя оценка. Итоговый список для воркера собран объединением двух подходов;
  файлы, попадающие в «приблизительный» набор, но недостижимые в рантайме воркера
  (`session-service`, `rate-limiter`, `media-service`, `mqtt-ingestion-service`,
  `weather-client`, `modules/operator-mobile`), в вердикты не засчитывались.
- `BACKUP_ENABLED`/`BACKUP_DIR` **загружаются** в графе воркера (через статический
  реэкспорт `health-tracker/index.ts:23` → `aggregate.ts:5`), но в контейнере
  `workers` `startHealthTracker()` не вызывается (`unified-worker.ts` его не импортирует),
  поэтому проверка бэкапа там не выполняется. Вердикт «нужен проброс только в `app`»
  опирается на это чтение вызовов, а не на прогон контейнера.
- Файлы `src/services/auth/**` и `src/core/security/**` открывались только на чтение
  (правило AGENTS.md §1); `src/core/security/identity-role.ts` и `encryption.ts`
  читались целиком, изменения не вносились.
- Замороженные зоны (`src/app/orion/**`, `src/components/piling/to/to-module.tsx`
  — флаг `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL`) упомянуты только как
  читатели переменных; внутрь логики не заглядывал.
- Проброс в **`migrate`**-сервис не разбирался по существу: он не относится к
  `app`/`workers`, но именно он единственный получает `SKIP_SEED`
  (`docker-compose.prod.yml:142-147`) и роль-владелец (`docker-compose.yml:46-47`).
- Реальное поведение `docker compose config` на сервере (слияние base+overlay,
  подстановки `${VAR:?}`) не запускалось — Docker в этой среде не вызывался.
