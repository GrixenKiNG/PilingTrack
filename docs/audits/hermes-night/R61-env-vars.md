# R61 — Переменные окружения PilingTrack: полный инвентарь и сверка с шаблонами

Повод: 29.09.2026 `BACKUP_ENABLED` не нашлась ни в одном `.env*`-шаблоне, и мониторинг
бэкапов неделю молчал. Задача — собрать все переменные, которые читает код, сверить с
`.env.example` / `.env.production.example` / `.env.docker.example` / `scripts/validate-env.ts`
и назвать те, что читаются без описания, описаны без чтения и тихо выключают функцию.

## Итог

- Собрано **93** уникальных имени `process.env.*` в `src/`, `scripts/*.ts`, `e2e/`, а также
  ~20 инфраструктурных имён в `docker-compose*.yml` / `Dockerfile*`, которые код не читает,
  а подставляет Compose.
- **критично — 5**, **важно — 11**, **мелочь — 29** (полный разбор ниже; остаток в приложении).
- Топ-5:
  1. **`BACKUP_ENABLED` / `BACKUP_DIR`** (`backup.ts:16,22`) — читаются, нигде не описаны;
     без них метрики `backup_age_hours`/`backup_s3_synced` печатают жёсткий `0`, а алерт
     `OffsiteBackupNotSynced` не может сработать никогда. Ровно повод к задаче (дубль к R56).
  2. **`PIN_LOOKUP_SECRET`** — описан в `.env.production.example:13`, `Dockerfile:26`,
     `docs/deployment.md:48` («обязательна, иначе compose упадёт»), но **не читается ни одной
     строкой кода** и не проверяется в `validate-env.ts`. Деплой-документ требует секрет,
     которого нет в `docker-compose.yml` и который ничего не делает.
  3. **`TRUST_PROXY`** (`rate-limiter.ts:479`) — читается, не описана; без неё все посетители
     делят один счётчик попыток входа (ключ от `host`), т.е. 21-я попытка блокирует вход всей
     компании. Ровно инцидент SEC-10, 24.09.2026.
  4. **`TELEGRAM_API_BASE`** (`telegram.ts:197,231,319`) — читается, в шаблонах нет; без неё
     запросы уходят на `api.telegram.org`, заблокированный на боевом VPS → уведомления молча
     не доходят.
  5. **`DB_IDENTITY_ROLE`** (`identity-role.ts:35`) — читается, в шаблонах нет; пустая = нет
     переключения роли, и три запроса опознания (вход по email, по ПИН-коду, ключ устройства)
     идут под обычной ролью с RLS.

## Методика

Все шаги воспроизводимы одной командой; ничего в репозитории не менялось, `.env*` не открывались
(только `*.example`).

1. Сбор имён из кода (node-скрипт по `src/**`, `scripts/**`, `e2e/**`, `tests/**`, `prisma/**`,
   `config/**`, `next.config.ts`, `prisma.config.ts`, `middleware`/`proxy`/`instrumentation`):
   регулярка `process\.env(?:\.NAME|\[['"]NAME['"]\])`, вывод «имя (сколько раз) файл:строка».
2. Точечные `search_files` по src для подтверждения «потребителя» у каждого имени.
3. Сверка со списками имён в `.env.example` (25 строк), `.env.docker.example` (13),
   `.env.production.example` (60) и `ENV_CONFIG` в `scripts/validate-env.ts:21-122`.
4. Compose/Dockerfile: `grep "\${NAME"` по `docker-compose*.yml` и `grep "ENV\|ARG"` по `Dockerfile*`.
5. Обратный поиск «описана, но не читается»: для каждого имени из шаблонов искал
   `process.env.<ИМЯ>` и `\${<ИМЯ>` по всему репо.
6. Проверка silent-поведения читалась глазами в точке вызова (default, fail-closed, fallback).

Ключевые команды:
```
grep -rn "process\.env\." src/ scripts/ | wc -l          # 266 совпадений
grep -rn "BACKUP_ENABLED\|BACKUP_DIR" --include=*.yml --include=*.example .
grep -rn "PIN_LOOKUP_SECRET\|SENTRY_ORG\|OTEL_" --include=*.ts src/ scripts/ next.config.ts
grep -n "\${" docker-compose.yml docker-compose.prod.yml docker-compose.monitoring-prod.yml
```

## Находки

Колонки: `# | severity | path:line | проблема | сценарий / почему важно | что делать`.
Определение «описана» = присутствует в `.env.example`, `.env.docker.example` или
`.env.production.example` (либо в `validate-env.ts`). Наличие в `docs/` и в
`.claude/skills/pilingtrack-config-and-flags/SKILL.md` отмечено отдельно.

### A. Читается, но нигде не описана

| # | severity | path:line | проблема | сценарий / почему важно | что делать |
|---|---|---|---|---|---|
| 1 | критично | `src/core/observability/health-tracker/checkers/backup.ts:16` | `BACKUP_ENABLED` — гейт `isBackupMonitoringEnabled()`; нет ни в одном `.env*.example`, нет в `validate-env.ts`, нет в `docker-compose*.yml` | Пусто = «выключено» → `checkBackupStatus()` (там же `:76`) возвращает `{status:'up', source:'disabled'}` без возраста и `s3Synced`, а `src/app/api/metrics/route.ts:111-112` печатает `0`/`0`. Мониторинг бэкапов неделю молчал — это и есть повод. Алерт `OffsiteBackupNotSynced` (условие `backup_age_hours > 0`) не может сработать при нуле | Добавить `BACKUP_ENABLED=true` в `.env.production.example` и в прод-`.env`; либо убрать гейт и строить метрику из Redis/ФС напрямую |
| 2 | важно | `src/core/observability/health-tracker/checkers/backup.ts:22` | `BACKUP_DIR`, default `DEFAULT_BACKUP_DIR='/backups/pilingtrack'` (`thresholds.ts:14`); не описана, в app-контейнер не пробрасывается | Файловый фолбэк (`backup.ts:25-73`) смотрит в `/backups/pilingtrack/daily`, где на бою дампов нет (`deploy/systemd/pilingtrack-backup.service` кладёт в `/var/backups/pilingtrack`) → всегда `source:'missing'` | Прописать `BACKUP_DIR=/var/backups/pilingtrack` в app-контейнер и шаблон, либо признать фолбэк нерабочим |
| 3 | критично | `src/lib/rate-limiter.ts:479` | `TRUST_PROXY` читается для `resolveClientIp()`; нет ни в одном `.env*.example`, нет в `validate-env.ts` | Без неё `x-forwarded-for`/`x-real-ip` игнорируются, ключ корзины = `host-<домен>` (`rate-limiter.ts:504`) → все пользователи делят один счётчик: 21-я попытка входа за 15 минут блокирует вход всем. Комментарий в `docker-compose.yml:120-124` фиксирует, что на бою было `true`, но в контейнер не попадало (аудит SEC-10) | Описать в `.env.production.example` с предупреждением «включать только когда порт 3000 закрыт снаружи» |
| 4 | критично | `src/core/notifications/telegram.ts:197,231,319` | `TELEGRAM_API_BASE`, default `https://api.telegram.org`; в шаблонах отсутствует | На VPS `api.telegram.org` заблокирован на уровне провайдера; прод ставит Cloudflare-прокси. Без переменной каждый `fetch` падает сетевой ошибкой (не ошибкой авторизации) → уведомления о сдаче наряда молча теряются | Добавить `TELEGRAM_API_BASE` в `.env.production.example` и в оба контейнера (`app`, `workers`) |
| 5 | критично | `src/core/security/identity-role.ts:35` | `DB_IDENTITY_ROLE` — роль для трёх запросов опознания (`withIdentityRole`, там же `:55`); не описана | Пустая = переключения нет; вход по email / по ПИН-коду и поиск ключа устройства идут под обычной ролью, которой RLS-политики писаны → запросы опознания отдают пусто. Комментарий `docker-compose.yml:102-107` прямо называет её обязательной в контейнере | Добавить в `.env.production.example` и в прод-`.env` (`DB_IDENTITY_ROLE=<имя роли>`) |
| 6 | важно | `src/app/api/metrics/route.ts:39` | `METRICS_SCRAPE_TOKEN`, fail-closed `:40`; нет в шаблонах | Без токена `/api/metrics` уходит на сессионную авторизацию; Prometheus (без cookie) получает 401 → метрики не собираются; на `/api/metrics` завязаны алерты `backup_*`, `http_*`, лаг воркеров | Описать в `.env.production.example` рядом с `ALERTMANAGER_WEBHOOK_TOKEN` |
| 7 | важно | `src/app/api/alerts/webhook/route.ts:75-76` | `ALERTMANAGER_WEBHOOK_TOKEN`, fail-closed (401 при пустом); нет в шаблонах | Пусто → все вебхуки Alertmanager получают 401, алерты не доходят до приложения. То же имя требует `docker-compose.monitoring-prod.yml:134` (`:?`) | Описать в `.env.production.example` |
| 8 | важно | `src/workers/embedded-workers.ts:44` | `EMBEDDED_WORKERS`, default `['outbox','projection']` (кроме `NODE_ENV=test`); не описана, в compose не задана нигде | В app-контейнере по умолчанию **запускаются** встроенные outbox+projection параллельно с контейнером `workers`. Защита — leader election по Redis; если он сломается, два процесса начнут дублировать работу. Способ выключить не задокументирован | Описать в `.env.docker.example`/`.env.production.example`; решить, нужен ли embedded outbox на бою |
| 9 | важно | `docker-compose.monitoring-prod.yml:60` | `GRAFANA_PASSWORD` требования `:?` (Compose падает без неё), но её нет ни в одном `.env*.example` | Мониторинговый стек не поднимется, а шаблон про него не знает; `.env.production.example` описывает только Redis/S3/Sentry | Добавить `GRAFANA_PASSWORD` (и `REDIS_PASSWORD` для exporter, `docker-compose.monitoring-prod.yml:161`) в `.env.production.example` |
| 10 | важно | `src/lib/db.ts:20` | Обратная нестыковка: `DATABASE_PROVIDER` в `validate-env.ts:23` — `required: true`, но в `.env.example` его нет (есть только в `.env.production.example:2`) | Разработчик, поднимающий окружение по `.env.example`, падает на `npm run dev` (`predev` → `validate-env.ts`) с «Missing required variable: DATABASE_PROVIDER» — приложение не стартует | Добавить `DATABASE_PROVIDER="postgres"` в `.env.example` |
| 11 | мелочь | `src/services/auth/session-service.ts:66`, `src/services/system/system-service.ts:22` | `AUTH_SECRET` читается как запасной к `SESSION_SECRET`; не описана нигде | Работает как недокументированный алиас; путаница при ротации секретов | Либо убрать алиас, либо описать |
| 12 | мелочь | `src/core/security/encryption.ts:66-79` | `ENCRYPTION_KEY_VERSION` и `ENCRYPTION_KEY_V1..Vn` читаются динамически (regex `^ENCRYPTION_KEY_V(\d+)$`); в шаблонах только `ENCRYPTION_KEY` | Механизм ротации ключа (`encryption.ts:12-23`) не описан в шаблонах — про него узнают только из кода/`docs/encryption-key-rotation.md` | Добавить закомментированные имена в `.env.production.example` |
| 13 | мелочь | `src/workers/unified-worker/config.ts:4-10` | `WORKER_HEALTH_PORT`(3002), `OUTBOX_INTERVAL_MS`(10000), `PROJECTION_INTERVAL_MS`(5000), `PDF_WORKER_CONCURRENCY`(2), `ENABLED_WORKERS`(outbox,projection,pdf) | Значения видны только в `docker-compose.yml:168-172`; в шаблонах нет | Описать строкой-комментарием в `.env.docker.example` |
| 14 | мелочь | `src/workers/unified-worker/pm-scheduler.ts:13-14`, `projection-rebuild-scheduler.ts:20-24`, `readiness-scheduler.ts:18-19` | `PM_SCHEDULER_*`, `PROJECTION_REBUILD_*`, `READINESS_SCHEDULER_*` (интервалы и задержки) | Не описаны; периоды фоновых задач настраиваются только из кода | Описать в `docs/` (R59) или в шаблоне |
| 15 | мелочь | `src/lib/db.ts:94-95` | `PRISMA_POOL_TIMEOUT`(10 с), `PRISMA_CONNECTION_LIMIT`(20) | При PgBouncer `DEFAULT_POOL_SIZE=40` на 3 сервиса × 20 = 60 потенциальных клиентов; настройка недокументирована | Описать рядом с `DATABASE_URL` в шаблоне |
| 16 | мелочь | `src/lib/redis-cache.ts:48` | `CACHE_DEFAULT_TTL`(300 с) | TTL кэша ответов настраивается только кодом | Описать |
| 17 | мелочь | `src/core/media/media-service.ts:507-508` | `CDN_BASE_URL` (без default), `MEDIA_MAX_FILE_SIZE`(10485760 = 10 МБ), `S3_BUCKET` default `pilingtrack-media` | Дефолт бакета здесь `pilingtrack-media`, в `s3-service.ts:45` — `pilingtrack-reports`, в API-роутах — `pilingtrack`. Три разных дефолта одного имени — расхождение | Свести дефолты к одному; описать `CDN_BASE_URL`/`MEDIA_MAX_FILE_SIZE` |
| 18 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:50-59` | `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS`(1), `MQTT_TOPIC_PREFIX`(`pilingtrack/telemetry`) | Телеметрия (дормантна по железу), но при подключении оборудования настраивать нечем по документации | Описать блоком «Телеметрия (dormant)» в `.env.production.example` |
| 19 | мелочь | `src/services/weather/weather-client.ts:82` | `WEATHER_API_BASE`, default `https://api.open-meteo.com`; в `validate-env.ts:112` она **есть** как optional, но в `.env*.example` — нет | Прокси для погоды на случай блокировки существует, но шаблон о нём не говорит | Добавить в `.env.production.example` |
| 20 | мелочь | `src/app/sitemap.ts:10`, `src/app/orion/page.tsx:12` | `NEXT_PUBLIC_SITE_URL`, default `https://orionpiling.ru` | Публичный URL сайта; не описан (ORION — замороженная зона, здесь только фиксация) | Не трогать зону; упомянуть в шаблоне |
| 21 | мелочь | `src/proxy.ts:21,26,31,102` | `ALLOWED_DEV_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `TENANT_DOMAIN` | CORS/мультитенантный домен настраиваются только из кода; `TENANT_DOMAIN` влияет на выделение тенанта из поддомена | Описать вместе с `MULTI_TENANT_MODE` |
| 22 | мелочь | `src/components/piling/to/to-module.tsx:125` | `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` (включена, пока не `'false'`) | Флаг оболочки готовности к производству; не описан | Описать рядом с другими `NEXT_PUBLIC_*` |
| 23 | мелочь | `next.config.ts:165`, `src/app/api/metrics/route.ts:94`, `src/core/observability/health-checks.ts:182` | `APP_VERSION`, default `npm_package_version` → `'unknown'` | Версия в `/api/health` и `/api/metrics` без переменной (и без Dockerfile-ARG) деградирует до `unknown`/`1.0.0` | Уже прокидывается в `Dockerfile:33-34`; описать в deploy-доке |
| 24 | мелочь | `src/lib/rate-limiter.ts:178-179` | `RATE_LIMIT_BYPASS` (обход лимитов) — не описана; защита `NODE_ENV !== 'production'` | В проде обойти нельзя (guard на месте), но имя недокументировано → легко забыть, что оно вообще существует | Оставить как есть; упомянуть в комментарии CI |
| 25 | мелочь | `src/lib/pdf-generator/fonts.ts:10` | `WINDIR` (Windows) | Системная переменная, не проектная | — |

Дополнительно (только имена, читаются в коде, в шаблонах отсутствуют — логи/отладка и e2e):
`LOG_LEVEL` (`src/lib/logger.ts:40`), `LOG_CACHE_STATS` (`response-cache.ts:361`),
`LOG_WORKER_STATS` (`embedded-workers.ts:190`), `LOG_REDIS_LIFECYCLE` (`redis-cache.ts:86`),
`LOG_UNHANDLED_EVENTS` (`instrumentation.ts:24`), `LOG_PROJECTION_SKIPS`
(`projection-worker.ts:109`), `LOG_WORKER_LIFECYCLE` (`projection-worker.ts:23`),
`LOG_LEADER_ELECTION` (`leader-election.ts:12`), `LOG_HANDLER_REGISTRATION`
(`domain-events.ts:18`), `LOG_SCHEMA_REGISTRATION` (`schema-registry/registry.ts:6`),
`HOSTNAME` (`leader-election.ts:22`), `CI` (`next.config.ts:128`),
`ADMIN_PASSWORD`/`DISPATCH_PASSWORD`/`OPERATOR_PASSWORD`/`ASSISTANT_PASSWORD`/`BASE_URL`
(`e2e/fixtures/auth.fixture.ts:11,16,21,26`, `e2e/global-setup.ts:12,48`),
`CAPTURE_USERS_UI`/`CAPTURE_DICTIONARIES_UI` (`e2e/admin-*.spec.ts`),
`SEED_TENANT_ID` (`scripts/seed-checklist-blocks.ts:941`), `SMOKE_TENANT_ID`
(`scripts/app-role-smoke.ts:27`), `DATABASE_URL` (`src/lib/db.ts:84`),
`S3_FORCE_PATH_STYLE`, `ASYNC_OUTBOX`, `DATABASE_URL_PGBOUNCER` (см. раздел B).

### B. Описана, но не читается (мёртвые имена)

| # | severity | path:line (где описана) | проблема | сценарий / почему важно | что делать |
|---|---|---|---|---|---|
| 26 | важно | `.env.production.example:13`, `Dockerfile:26`, `docs/deployment.md:48`, `README.md:165` | `PIN_LOOKUP_SECRET` — ни одной строки `process.env.PIN_LOOKUP_SECRET` в `src/`, `scripts/`, нет её и в `docker-compose*.yml` (только build-стаб в `Dockerfile:26`) | Деплой-док: «все обязательны, иначе compose упадёт». Compose про неё не знает и без неё не падает; код её не читает → секрет генерируют и хранят ради ничего, а `.claude/skills/pilingtrack-config-and-flags:90` вдобавок уверяет, что `validate-env.ts` её проверяет (проверки там нет). ПИН-хеширование в коде идёт без неё (`auth-service.ts` использует `bcrypt` без секрета) | Либо удалить имя из всех шаблонов и доков, либо доказать, где ПИН-лукап хешируется, и вернуть чтение. Это кандидат на отдельное решение владельца |
| 27 | важно | `.env.production.example:58-60`, `setup.sh:80` | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_ENABLED` — ни одного `OTEL_` в `src/`; пакеты `@opentelemetry/*` стоят в `package.json`, но SDK не инициализируется | Шаблон прода обещает трейсинг, которого нет. Отключение/замена endpoint ни на что не влияет | Либо доинициализировать SDK, либо пометить имена как «не активно» в примере (пакеты не удалять) |
| 28 | важно | `.env.example:15`, `.env.production.example:17`, `validate-env.ts:90` | `SENTRY_DSN` описан как «без DSN SDK — no-op», но DSN **зашит в код**: `sentry.server.config.ts:8`, `instrumentation-client.ts:8`; `SENTRY_ORG`/`SENTRY_PROJECT` тоже зашиты (`next.config.ts:122-123`) | `SENTRY_DSN` читается только для косметического флага в `system-service.ts:63`; `SENTRY_ORG` не читается вообще (только описание в `validate-env.ts:90`). Ошибки уходят в Sentry независимо от переменных, а комментарий в примере заставляет думать, что их можно выключить пустым DSN | Исправить комментарий в `.env.production.example`; решить, оставлять ли зашитый DSN (клиентский DSN не секрет, но `SENTRY_ORG`/project — конфиг сборки) |
| 29 | мелочь | `.claude/skills/pilingtrack-config-and-flags/SKILL.md:115-117` | `WS_URL`, `WS_PORT`, `NEXT_PUBLIC_WS_URL`, `PROMETHEUS_ENDPOINT`, `ASYNC_OUTBOX`, `S3_FORCE_PATH_STYLE`, `DATABASE_URL_PGBOUNCER` | Каталог скилла (и локальные `.env`, `scripts/generate-env-docker.ps1:81,89,158`) описывают WS-переменные, которых нет: `src/core/realtime` отсутствует, `WS_URL`/`WS_PORT` в `src/` не встречаются. `docs/deployment.md:52` подтверждает: «WebSocket-сервер удалён 26.09.2026». `ASYNC_OUTBOX`/`S3_FORCE_PATH_STYLE`/`DATABASE_URL_PGBOUNCER` тоже без потребителя | Скилл устарел — обновить (в рамках отдельной задачи, не удалять сами имена без полного поиска) |
| 30 | мелочь | `docs/deployment.md:64`, `docker-compose.prod.yml:144` | `SKIP_SEED` — управляет seed в `migrate`-сервисе Compose; приложением не читается | Не ошибка (его читает Compose), но в `.env*.example` его нет, хотя `docs/deployment.md:38-65` считает `.env.production` полным | Добавить `SKIP_SEED=1` в `.env.production.example` |
| 31 | мелочь | `docker-compose.monitoring-prod.yml:105`, `docker-compose.observability.yml:125` | `POSTGRES_USER`/`POSTGRES_DB` для exporter переиспользуются через интерполяцию; `REDIS_PASSWORD` (`:161`) | Читаются Compose, не код — в шаблонах частично описаны (`.env.production.example:4-6,30`). Ок, фиксируется для полноты | — |

### C. Без неё функция молча выключена (сводка по механизму)

| # | severity | path:line | что тихо перестаёт работать | механизм | что делать |
|---|---|---|---|---|---|
| C1 | критично | `checkers/backup.ts:16,76` + `metrics/route.ts:111-112` | Метрики бэкапа и алерт `OffsiteBackupNotSynced` | Пустая переменная = `source:'disabled'`, метрика печатает `0` | см. находку 1 |
| C2 | критично | `telegram.ts:197` | Уведомления о нарядах/отчётах | `fetch` на заблокированный `api.telegram.org`, ошибка глотается | см. находку 4 |
| C3 | критично | `rate-limiter.ts:479,504` | Персональные лимиты входа (превращаются в общий на домен) | IP не выводится, ключ = `host-<домен>` | см. находку 3 |
| C4 | важно | `metrics/route.ts:39-40` | Сбор Prometheus-метрик | Fail-closed: без токена 401 для скрейпера | см. находку 6 |
| C5 | важно | `alerts/webhook/route.ts:75-76` | Доставка алертов Alertmanager | Fail-closed: без токена 401 | см. находку 7 |
| C6 | важно | `telegram.ts:43`, `dead-letter-queue.ts:95`, `seed/equipment.seed.ts:61` | Telegram-уведомления и тенант фоновых путей | `DEFAULT_TENANT_ID` пуст → конфиг бота не найден (инцидент `c3a1774`) | Значение в `.env.production.example` — `default`, а прод = `orion`; сверить с боевым `.env` |
| C7 | важно | `identity-role.ts:34-35,59` | Вход по email/ПИН и телеметрия под RLS | Пустая роль = `run(db)` без переключения | см. находку 5 |
| C8 | важно | `lib/redis-cache.ts:45-47`, `lib/rate-limiter.ts:119` | Распределённый rate-limit и кэш/очереди | Без `REDIS_URL` — in-memory (не distribution-safe); `validate-env.ts:167` даёт warning, но не ошибку | Warning есть, но не фатален — оставить, задокументировать |
| C9 | важно | `core/security/encryption.ts:93-105` | Расшифровка секретов в БД | В проде — `throw` (громко), в dev — случайный ключ; «данные не переживут рестарт» пишется только в `logger.warn` | Проверить, что `ENCRYPTION_KEY` есть в обоих контейнерах (`docker-compose.yml:185`) |
| C10 | важно | `services/telemetry/device-key-service.ts:16-31` | Аутентификация устройств телеметрии | Без секрета — HMAC на dev-строке `dev-only-device-key-fallback` в dev/test; вне dev — `throw` | Оставить fail-closed; описать в шаблоне |
| C11 | мелочь | `embedded-workers.ts:47`, `unified-worker.ts:117,123,130` | Состав фоновых задач | `EMBEDDED_WORKERS` unset → outbox+projection в app-процессе; `PM_SCHEDULER_ENABLED`/`PROJECTION_REBUILD_ENABLED`/`READINESS_SCHEDULER_ENABLED` включены, пока не `'false'` | см. находку 8 и 14 |
| C12 | мелочь | `instrumentation.ts:20-26` | Диагностические логи | `LOG_*` пусто = тишина; значения логируются один раз на старте (`logEffectiveRuntimeFlags`) | Описать набор `LOG_*` в шаблоне |
| C13 | мелочь | `to-module.tsx:125` | Оболочка готовности к производству | Включена, пока переменная не `'false'` | Описать |

## Не проверено

- **Реальное содержимое боевого `.env` / `.env.production`** (`/opt/pilingtrack/.env` на VPS) —
  доступа нет (AGENTS.md §1). Все выводы про прод-значения (`TRUST_PROXY=true`, `orion`,
  задан ли `BACKUP_ENABLED`) опираются на комментарии в `docker-compose.yml` и на повод задачи,
  а не на прочитанный файл. Поэтому «на бою метрика всегда 0» — вывод из кода, не измерение.
- **Проверено ли `PIN_LOOKUP_SECRET` в старых версиях `validate-env.ts`** — история файла не
  смотрелась; каталог скилла (`:90`) утверждает, что проверка есть, текущий файл её не содержит.
  Расхождение зафиксировано, но причина (удалена/никогда не было) не установлена.
- **`.env.docker` (gitignored)** и `scripts/generate-env-docker.ps1` читались только на предмет
  списка имён (`grep`), без разбора значений.
- **Скрипты `deploy/**`, `observability/**`** — переменные там читаются shell-ом
  (`grep "\${NAME}"`), не через `process.env`; это вне заявленного охвата задачи и не
  проверялось построчно.
- Файлы `src/services/auth/**`, `src/core/security/**` открывались только на чтение (правило
  AGENTS.md §1); ничего в них не менялось.
- «Описана, но не читается» для инфраструктурных имён (`POSTGRES_*`, `REDIS_PASSWORD`,
  `MINIO_*`, `PGADMIN_*`, `GRAFANA_PASSWORD`, `STAGING_TAG`, `DISK_GUARD_*`, `ADMIN_USERS`)
  проверено по Compose-интерполяции; полное поведение мониторингового стека на бою не проверено.
