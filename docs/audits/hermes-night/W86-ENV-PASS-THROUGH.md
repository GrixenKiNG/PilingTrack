# W86 — Переменные из `.env`, которых нет в `docker-compose.yml`

Только чтение. Проверено: у сервисов `app` и `workers` в `docker-compose.yml`
**нет `env_file`** (совпадения `env_file` — лишь комментарии `docker-compose.yml:104,120,127,197`),
а `.dockerignore:16-18` исключает `.env*` из образа. Значит переменная из `.env`
попадает в контейнер **только** если перечислена в блоке `environment:`.

## Итог

- Читаемых в `src/`+`scripts/` имён `process.env.*` (без тестов) — 77. Из них
  действительно нужны рантайм-контейнерам `app`/`workers` и **не переданы** — 22 имени
  (сгруппированы в 12 находок). Передано, но кодом контейнера не читается — 2 имени.
- **критично — 0, важно — 3, мелочь — 11** (всего 14 находок в таблице).
- Топ-5 по значимости:
  1. **`ENCRYPTION_KEY_VERSION` + `ENCRYPTION_KEY_V<n>`** (`src/core/security/encryption.ts:79,67`)
     — не проброшены ни в один контейнер: ротация ключа через `.env` молча не применяется,
     активным остаётся `legacy` = `ENCRYPTION_KEY`. Оператор считает ротацию выполненной.
  2. **`BACKUP_DIR`** (`checkers/backup.ts:24`) — не проброшена в `app`; дефолт `/backups/pilingtrack`
     (`thresholds.ts:14`), а дампы пишутся в `/var/backups/pilingtrack` → файловый фолбэк всегда `missing`.
  3. **`EMBEDDED_WORKERS`** (`embedded-workers.ts:44`) — не проброшена; в `app` (NODE_ENV=production)
     по умолчанию поднимаются встроенные outbox+projection параллельно контейнеру `workers`;
     разводит их только leader election по Redis.
  4. **`SENTRY_DSN` в `app`** (`system-service.ts:63`) — в `app` не проброшена (в `workers` — уже да,
     `docker-compose.yml:206`); флаг `sentry.configured` в диагностике всегда `false`.
  5. **12 имён `LOG_*`** (`instrumentation.ts:20-25` и др.) — не проброшены: диагностические логи
     включить правкой `.env` нельзя, только правкой compose.

## Методика

Всё воспроизводимо; значения `.env` не читались и не печатались, читались только имена.
Ничего в репозитории не менялось.

1. Сбор имён из кода:
   `rg -o --no-filename 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' src scripts`
   (отдельно `process\.env\[...\]` — динамические чтения), с исключением `*.test.*`, `__tests__/**`.
   Плюс те же паттерны для `positiveIntEnv('NAME')` (`src/workers/unified-worker/env-int.ts:19`).
2. Имена из шаблонов — `.env.example` (25 строк), `.env.docker.example` (13),
   `.env.production.example` (60) — прочитаны целиком, выписаны только имена (без значений).
3. Блоки `environment:` сервисов `app` (`docker-compose.yml:71-129`) и `workers` (`:164-206`)
   выписаны построчно (`rg -n '^\s*- [A-Z0-9_]+=' docker-compose*.yml`); учтён оверлей
   `docker-compose.prod.yml` (`app`: `HOSTNAME`,`NODE_OPTIONS`, `:27,30`) и
   `docker-compose.staging.yml` (`app`/`workers`: `SENTRY_ENVIRONMENT`, `:36,44`).
4. Дифф множеств «читается контейнером» − «передано compose», и обратный.
5. Точечное чтение точек вызова: `checkers/backup.ts`, `core/security/encryption.ts`,
   `workers/unified-worker/sentry.ts`, `workers/embedded-workers.ts`, `health-tracker/scheduler-registry.ts`,
   `workers/unified-worker.ts`, `instrumentation.ts`, `proxy.ts`, `lib/db.ts`, `lib/redis-cache.ts`,
   `core/media/media-service.ts`, `services/weather/weather-client.ts`, `services/telemetry/mqtt-ingestion-service.ts`.
6. Dockerfile: `rg -n 'ENV |ARG ' Dockerfile Dockerfile.workers` (проверка, что `PIN_LOOKUP_SECRET`
   и `APP_VERSION` — build-time, не рантайм).

Ключевые команды:
```
rg -o --no-filename 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' src scripts -g '!**/*.test.ts' -g '!**/__tests__/**' | sort -u
rg -n '^    environment:' -A 60 docker-compose.yml
rg -n 'env_file|\.env' docker-compose*.yml .dockerignore
```
Близкие прошлые прогоны в том же каталоге, найденные по ходу: `R92-env-passthrough.md`
(та же тема, шире) и `R61-env-vars.md` (инвентарь). Отличия этой задачи: сравнение ведётся
с **текущим** `docker-compose.yml`, где часть прежних находок уже закрыта —
`BACKUP_ENABLED` (`docker-compose.yml:129`), `SENTRY_DSN` в `workers` (`:206`),
`DB_IDENTITY_ROLE` (`:107,200`), `DEFAULT_TENANT_ID` (`:99,192`), `TELEGRAM_API_BASE` (`:91,184`)
теперь в блоках `environment:`.

## Находки

Колонки: `# | severity | переменная | читается (файл:строка) | в environment app/workers | нужен контейнеру | проблема и что делать`.
Порядок: сначала «нужна контейнеру и не передана», затем «передана, но не читается».
`severity`: **важно** = отсутствие тихо выключает функцию/риск на бою; **мелочь** = остальное.

| # | severity | переменная | читается (файл:строка) | в environment app / workers | нужен контейнеру | проблема и что делать |
|---|---|---|---|---|---|---|
| 1 | важно | `ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY_V<n>` | `src/core/security/encryption.ts:79`; перебор `^ENCRYPTION_KEY_V(\d+)$` — там же `:67` | нет / нет (передан только `ENCRYPTION_KEY`: `docker-compose.yml:84,191`) | app и workers | Ротацию делают добавлением `ENCRYPTION_KEY_V2`+`ENCRYPTION_KEY_VERSION=v2` в `.env`. В контейнер это не попадёт: активным останется `legacy`, новые секреты (Telegram-токены в БД) шифруются старым ключом, а при удалении старого ключа чтение бросает (`encryption.ts:117`). → Пробросить `ENCRYPTION_KEY_VERSION=${ENCRYPTION_KEY_VERSION:-}` в оба сервиса (версионные ключи — перечислить явно или задокументировать ограничение) |
| 2 | важно | `BACKUP_DIR` | `src/core/observability/health-tracker/checkers/backup.ts:24` | нет / не нужна | app | Дефолт `/backups/pilingtrack` (`thresholds.ts:14`), а `scripts/backup-postgres.sh` пишет в `/var/backups/pilingtrack` → файловый фолбэк (`backup.ts:27-73`) всегда `source:'missing'`. Трекер стартует в `app` (`src/instrumentation.ts:70-71`). → Пробросить `BACKUP_DIR=${BACKUP_DIR:-}` в `app` либо признать фолбэк нерабочим |
| 3 | важно | `EMBEDDED_WORKERS` | `src/workers/embedded-workers.ts:44` | нет / — | app | При `NODE_ENV=production` (`docker-compose.yml:72`) дефолт `['outbox','projection']` → в контейнере `app` поднимаются встроенные outbox+projection параллельно сервису `workers` (`ENABLED_WORKERS=outbox,projection,pdf`, `:178`). Разводит только leader election по Redis; при его сбое обе стороны начнут дублировать обработку. Старт — `src/instrumentation.ts:63-64`. → Задокументировать `EMBEDDED_WORKERS=off` как рубильник; решить, нужен ли embedded outbox на бою |
| 4 | мелочь | `SENTRY_DSN` (в `app`) | `src/services/system/system-service.ts:63` | **нет** / да (`:206`) | app (косметика) | В `workers` уже проброшена. В `app` читается только для флага `sentry.configured` в диагностике; флаг всегда `false` (DSN зашит в `sentry.server.config.ts`). Проект `SENTRY_PROJECT` (`system-service.ts:64`) тоже не проброшен → `sentry.project` всегда `null`. → Пробросить `SENTRY_DSN` в `app` либо считать флаг из бандла |
| 5 | мелочь | `IDEMPOTENCY_CLEANUP_ENABLED` | `src/core/observability/health-tracker/scheduler-registry.ts:35,49` | нет / нет | app и workers | Уборка opt-in (`=== 'true'`), сейчас выключена — поведение верное. Но включить через `.env` нельзя: комментарий в коде прямо предписывает добавить имя в оба сервиса (`src/workers/unified-worker.ts:201-202`). → Добавить имя в оба сервиса вместе с включением уборки |
| 6 | мелочь | `PM_SCHEDULER_ENABLED/INTERVAL_MS/STARTUP_DELAY_MS`, `PROJECTION_REBUILD_ENABLED/INTERVAL_MS/STARTUP_DELAY_MS`, `READINESS_SCHEDULER_ENABLED/INTERVAL_MS/STARTUP_DELAY_MS`, `WORKER_SHUTDOWN_TIMEOUT_MS` | `src/workers/unified-worker.ts:49,174,180,187`; `pm-scheduler.ts:16-17`; `projection-rebuild-scheduler.ts:22-23`; `readiness-scheduler.ts:21-22` | — / нет | workers | Все с безопасными дефолтами (`env-int.ts:19-45`), планировщики включены, пока не `'false'`. Настроить периоды/выключить через `.env` нельзя — только правкой compose. → Описать набор комментарием в `.env.production.example` |
| 7 | мелочь | `IDEMPOTENCY_CLEANUP_INTERVAL_MS`, `IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS` | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:32-33` | — / нет | workers | То же: периоды уборки настраиваются только кодом/через compose. → Описать вместе с #5 |
| 8 | мелочь | `PDF_TEMP_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_DRY_RUN` | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:6,14` | — / нет | workers | Очистка временных PDF выключена, пока не `'true'`; dry-run по умолчанию. Включить через `.env` нельзя. → Пробросить или задокументировать |
| 9 | мелочь | 12 имён `LOG_*`: `LOG_LEVEL`, `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE`, `LOG_LEADER_ELECTION`, `LOG_HANDLER_REGISTRATION`, `LOG_SCHEMA_REGISTRATION` | `src/instrumentation.ts:20-25`; `src/lib/logger.ts:40`; `core/cache/response-cache.ts:361`; `lib/redis-cache.ts:86,92`; `lib/rate-limiter.ts:138`; `workers/embedded-workers.ts:31,190`; `core/observability/lag-monitor.ts:37`; `core/observability/health-tracker/tracker.ts:19`; `core/infrastructure/leader-election.ts:15`; `services/reports/domain-events.ts:18`; `core/event-bus/schema-registry/registry.ts:6`; `modules/reports/application/projections/projection-worker.ts:23,109` | нет / нет | app и workers | Диагностические логи выключены, включить правкой `.env` нельзя — только compose. `logEffectiveRuntimeFlags()` (`instrumentation.ts:19-28`) печатает `null` по всем флагам и создаёт впечатление, что они не читаются. → Пробросить или описать комментарием |
| 10 | мелочь | `PRISMA_POOL_TIMEOUT`, `PRISMA_CONNECTION_LIMIT` | `src/lib/db.ts:94-95` | нет / нет | app и workers | Дефолты 10 с / 20 согласованы с `DEFAULT_POOL_SIZE=40` (`docker-compose.yml:260`). Менять числа через `.env` — иллюзия. → Пробросить или задокументировать |
| 11 | мелочь | `CACHE_DEFAULT_TTL` | `src/lib/redis-cache.ts:48` | нет / нет | app и workers | TTL кэша (дефолт 300 с) меняется только кодом. → Описать |
| 12 | мелочь | `MEDIA_MAX_FILE_SIZE`, `CDN_BASE_URL` | `src/core/media/media-service.ts:507-508` | нет / не нужна | app | Лимит загрузки (10 МБ) и база CDN настраиваются только кодом; при пустом `CDN_BASE_URL` ссылки строятся относительно приложения (рабочее поведение). → Пробросить, если появится CDN |
| 13 | мелочь | `WEATHER_API_BASE` | `src/services/weather/weather-client.ts:82` | нет / не нужна | app | Прокси для погоды (дефолт `api.open-meteo.com`) не проброшен, хотя в `validate-env.ts` имя есть. → Добавить в `.env.production.example` |
| 14 | мелочь | `AUTH_SECRET` | `src/services/auth/session-service.ts:66`; `src/services/system/system-service.ts:22` | нет / — | app | Недокументированный алиас `SESSION_SECRET`; `SESSION_SECRET` в `app` задан (`docker-compose.yml:83`), поэтому алиас не нужен → убрать алиас или описать |

### Передано в compose, но код контейнера не читает (мусор)

| # | severity | переменная | где передано | нужен контейнеру | замечание |
|---|---|---|---|---|---|
| 15 | мелочь | `DATABASE_PROVIDER` | `docker-compose.yml:80,170` | нет | Рантайм читает провайдер константой: `getDatabaseProvider()` (`src/lib/db.ts:40`), имя в `src/` не встречается. Безвредно, но мёртвое имя. → Убрать из обоих сервисов или оставить с комментарием «для scripts/» |
| 16 | мелочь | `SENTRY_ENVIRONMENT` | `docker-compose.staging.yml:36,44` | нет | Ни одной строки `process.env.SENTRY_ENVIRONMENT` в `src/`; `next.config.ts:165` читает только `SENTRY_RELEASE`. Стенд задаёт имя, которое ни на что не влияет. → Убрать либо начать читать в конфиге Sentry |

### Справочно (не находки): читается контейнером, но настраивать через `.env` не требуется

`MULTI_TENANT_MODE` (`src/proxy.ts:87`, `services/tenancy/tenant-context-service.ts:16`),
`TENANT_DOMAIN` (`proxy.ts:102-103`), `CORS_ALLOWED_ORIGINS` (`proxy.ts:26-27`),
`ALLOWED_DEV_ORIGIN` (`proxy.ts:21-22`), `NEXT_PUBLIC_APP_URL` (`proxy.ts:31-32`, build-time) —
не проброшены; для однотенантного прода (`orion`) режим и так выключен, риск отложенный
(перед тенантом #2). `RATE_LIMIT_BYPASS` (`lib/rate-limiter.ts:178`) — защищён
`NODE_ENV !== 'production'`. `MQTT_*` (`services/telemetry/mqtt-ingestion-service.ts:50-59`) —
дормантная телеметрия. `DATABASE_LOG_QUERIES` (`lib/db.ts:45`) — отладка. `APP_VERSION` —
в `app` запекается build-arg (`Dockerfile:33-34,84-85`), `Dockerfile.workers` своего `ARG` не имеет,
но воркер её не читает (`aggregate.ts:120`/`health-checks.ts:182` — пути `app`), поэтому не проброс
неполный, а чтения нет. `TZ` кодом через `process.env` не читается, но контейнеру не задаётся
(комментарии `src/core/notifications/telegram.ts:178`, `src/modules/readiness/application/operator-shift-query.ts:128`).

## Не проверено

- **Значения боевого `.env` / `.env.production`** (`/opt/pilingtrack/.env`) — доступа нет
  (AGENTS.md §1), файл не читался. Все выводы про прод-поведение — следствия из кода и compose,
  а не измерение.
- **Применяется ли `docker-compose.prod.yml` на сервере** (`COMPOSE_FILE` в боевом `.env`) —
  не проверено, доступа нет. От этого зависит, проброшены ли `HOSTNAME`/`NODE_OPTIONS` и закрыты ли
  порты (сравн. `R92 #17`).
- **Реальный состав графа воркера с учётом динамических `import()`** — не просчитан заново в этой
  задаче; для каждого имени вывод «нужен ли воркеру» опирается на прямую точку чтения, а не на
  полный обход зависимостей. Спорные (читаются в каталоге `src/workers/**` или вызываются из
  воркера) отнесены к `workers`.
- **`docker compose config` на сервере не запускался** — Docker в этой среде не вызывался; слияние
  base+overlay и подстановки `${VAR:?}` не проверялись вживую.
- **`migrate`-сервис** по существу не разбирался (вне рамок «app и workers»): он получает
  `SKIP_SEED` (`docker-compose.prod.yml:144`).
- Замороженные зоны (`src/app/orion/**`, `src/components/piling/to/to-module.tsx`,
  `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL`) упомянуты только как читатели `NEXT_PUBLIC_*`;
  внутрь логики не заглядывал.
- Файлы `src/services/auth/**` и `src/core/security/**` открывались только на чтение
  (правило AGENTS.md §1), ничего не менялось.
```
