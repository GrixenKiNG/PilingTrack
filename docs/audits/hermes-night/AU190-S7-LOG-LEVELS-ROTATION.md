# AU190-S7-LOG-LEVELS-ROTATION: Логи: уровни и объём

Версия (HEAD): `ba1e5fd20a280ab14576d56ec692cab6dce45d1e`
Ветка: `hermes/q4-0926`. Тип: read-only аудит (код приложения не менялся).

## Итог

Независимый аудит уровней логирования, содержимого логов при ошибке и ротации логов Docker (риск диска). Просмотрены `src/lib/logger.ts`, все `docker-compose*.yml`, `Dockerfile*`, `scripts/docker-daemon.json`, `scripts/disk-guard.sh`, `scripts/app-guard.sh`, systemd-units, `deploy/Caddyfile.prod`, `sentry.*.config.ts`, `src/core/api-wrapper.ts`, `src/instrumentation.ts`.

Резюме для владельца (5 строк):
1. Приложение пишет логи только структурным JSON в stdout (контейнерный json-file); централизованного хранилища логов на проде НЕТ (Loki в проде не поднят, Sentry Logs выключен) — при удалении/пересборке контейнера логи безвозвратно пропадают.
2. Уровни: `debug|info|warn|error`; на проде по умолчанию `info`. Ни `LOG_LEVEL`, ни флаги `LOG_*` НЕ проброшены ни в один контейнер — включить диагностику можно только пересборкой образа.
3. Ротация Docker задана в `docker-compose.prod.yml` для 7 сервисов (app/workers/postgres/redis/pgbouncer/minio = 20m×5, migrate = 5m×2), но `redis-cache` и `minio-init` пропущены; базовый `docker-compose.yml` не задаёт ротацию вообще.
4. Хост-дефолт `scripts/docker-daemon.json` (10m×5) способен закрыть пробелы, но доказать, что он применён на сервере, из репозитория нельзя — статус НЕ ПРОВЕРЕНО.
5. При каждой ошибке логгер добавляет `error.message` И полный `error.stack` (`src/lib/logger.ts:97-99`), а `withApi` пишет так на каждый необработанный 500 (`src/core/api-wrapper.ts:128`) — это главный источник объёма и утечки внутренностей.

Счёт по важности: критично — 0; важно — 5; мелочь — 11; итого 16 находок.

Топ-5:
1. Нет централизованного хранения логов + ложный комментарий про Loki (`sentry.server.config.ts:19`).
2. `LOG_LEVEL`/`LOG_*` не проброшены в compose (`src/lib/logger.ts:40`, `src/instrumentation.ts:20-25`).
3. `redis-cache` (реально работает на проде) без ротации в prod-overlay (`docker-compose.prod.yml`, отсутствует; сервис — `docker-compose.yml:316`).
4. Caddy access-log в journald без явной ротации (`deploy/Caddyfile.prod:69-72`).
5. Полный stack trace в каждом логе ошибки (`src/lib/logger.ts:97-99` + `src/core/api-wrapper.ts:128`).

## Методика

Пути в отчёте — от корня репозитория (`D:\PillingR\wt-night`). Все числа получены командами, приведёнными ниже; существующие отчёты в `docs/audits/` не читались (по условию).

Что искалось:
- `grep -n "logging|max-size|max-file|driver:|json-file|LOG_LEVEL" *.yml` — ротация в compose.
- `grep -n "logging|max-size|max-file|LOG_LEVEL|NODE_ENV" Dockerfile*` — ротация/уровни в образах.
- `grep -rn "daemon.json|log-opts|log-driver|SystemMaxUse|journald|logrotate"` — хостовые ограничения логов.
- `grep -rn "logger\.error\(" src` (111 совпадений), `logger\.info\(` (105), `logger\.warn\(` (73), `logger\.debug\(` (12) — уровни и содержимое.
- `grep -rn "console\." src` без тестов — 10 совпадений (остались в `logger.ts` + seed + error-boundary).
- Прочитаны: `src/lib/logger.ts`, `src/core/api-wrapper.ts`, `src/instrumentation.ts`, `src/lib/db.ts`, `sentry.server.config.ts`.
- Compose: `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.monitoring-prod.yml`, `docker-compose.observability.yml`, `docker-compose.monitoring-standalone.yml`, `docker-compose.staging.yml`.
- Прод-путь подтверждён `docs/deployment.md:72-74` (`-f docker-compose.yml -f docker-compose.prod.yml`).

Ограничения доступа: SSH/прод-сервер недоступен (по правилам проекта), фактическое содержимое `.env` на хосте неизвестно, `docker info` не запускался.

## Источники логов, уровни, риск диска

| Источник | Файл:строка | Уровень (по коду) | Риск диска |
|---|---|---|---|
| Логгер приложения (единственный путь) | `src/lib/logger.ts:39-43,64-80` | prod=`info`, иначе `debug`; `LOG_LEVEL` переопределяет | зависит от ротации контейнера |
| Next.js app контейнер | `docker-compose.prod.yml:36-40` | info (default) | ограничен: 20m × 5 = ~100 MB (ПРОЙДЕНО) |
| workers контейнер | `docker-compose.prod.yml:52-56` | info (default) | ограничен: 20m × 5 = ~100 MB (ПРОЙДЕНО) |
| postgres | `docker-compose.prod.yml:109-111` | серверные логи PG | ограничен: 20m × 5 (ПРОЙДЕНО) |
| redis | `docker-compose.prod.yml:120-122` | stdout redis | ограничен: 10m × 3 (ПРОЙДЕНО) |
| pgbouncer | `docker-compose.prod.yml:126-128` | stdout | ограничен: 10m × 3 (ПРОЙДЕНО) |
| minio | `docker-compose.prod.yml:138-140` | stdout | ограничен: 10m × 3 (ПРОЙДЕНО) |
| migrate (one-shot) | `docker-compose.prod.yml:145-147` | prisma | ограничен: 5m × 2 (ПРОЙДЕНО) |
| redis-cache | `docker-compose.yml:316-342`; в prod-overlay НЕ переопределён | stdout redis | НЕ ограничен overlay'ем — см. находку #3 |
| minio-init (one-shot) | `docker-compose.yml:425-441`; в prod-overlay НЕ переопределён | mc | НЕ ограничен overlay'ем; объём мал (мелочь) |
| Caddy (reverse-proxy, вне Docker) | `deploy/Caddyfile.prod:69-72` | access log → journald | ограничен только дефолтом journald — см. находку #4 |
| host-дефолт для всех контейнеров | `scripts/docker-daemon.json:3-7` | — | 10m × 5 = ~50 MB на контейнер, ЕСЛИ применён (НЕ ПРОВЕРЕНО) |
| Loki (только dev/standalone стек) | `docker-compose.observability.yml:70-81`, `observability/loki/loki-config.yml` | сбор логов | retention не задан → неограниченно, ЕСЛИ поднят (ГИПОТЕЗА) |
| app-guard / disk-guard (systemd) | `scripts/app-guard.sh`, `scripts/disk-guard.sh:34-35,65` | stdout/stderr → journald | низкий: пишут только при смене состояния (ПРОЙДЕНО) |

## Находки

| # | Severity | Path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `sentry.server.config.ts:19-20` | Комментарий «We already ship application logs to Loki — don't double-pay Sentry» ложен: прод-стек мониторинга явно БЕЗ Loki (`docker-compose.monitoring-prod.yml:4`). `enableLogs:false` оправдан отсутствующей системой. | Централизованного хранения логов нет. Логи живут только в json-file контейнера и стираются при пересборке/пересоздании (`docker compose up -d --force-recreate`). При разборе инцидента задним числом логов может не быть. | Либо поднять реальный сбор логов (Loki + promtail) и включить ротацию/retention, либо исправить комментарий и зафиксировать как осознанное решение (логи — локальные, окно = размер json-file). |
| 2 | важно | `src/lib/logger.ts:40`; `src/instrumentation.ts:20-25` | `LOG_LEVEL` и весь набор `LOG_*` не проброшены ни в `app`, ни в `workers`, ни в один контейнер (в compose их нет — ПРОЙДЕНО). | Уровень на проде жёстко `info`; включить `debug`/диагностику (`LOG_CACHE_STATS` и т.п.) без пересборки образа нельзя. При инциденте теряется время. | Пробросить `LOG_LEVEL` и флаги `LOG_*` в `app`/`workers` (по умолчанию пусто), как это уже сделано для части env. |
| 3 | важно | `docker-compose.prod.yml:113-122` (нет блока для `redis-cache`); сервис — `docker-compose.yml:316-342`; потребитель — `docker-compose.yml` env `REDIS_URL_CACHE=...@redis-cache:6379` | `redis-cache` реально работает на проде (нет `profiles`-гейта), но prod-overlay НЕ задаёт ему `logging`. Ротация падает на хост-дефолт. | Второй Redis (кеш) может писать в json-file без лимита, если `scripts/docker-daemon.json` на сервере не применён. Объём у redis небольшой, но при инциденте с реконнектами/шумом лог растёт неограниченно. | Добавить в prod-overlay блок `logging` для `redis-cache` (и, при желании, `minio-init`), как для `redis`. |
| 4 | важно | `deploy/Caddyfile.prod:69-72` | Caddy пишет access-лog в journald через stdout; в самом файле признано, что файловая ротация «requires LogsDirectory= ... TODO». Ограничение — только системный дефолт journald. | Access-лог растёт с каждым HTTP-запросом к сайту. Дефолт journald (обычно ~10% ФС, на 30 GB ≈ 3 GB) — потолок, который владелец не контролирует из репозитория; при его достижении journald сам вытесняет записи, включая логи backup/guards. | Задать лимиты journald (`SystemMaxUse`, `SystemMaxFileSize` в `/etc/systemd/journald.conf.d`), либо перевести Caddy access-log в файл через `LogsDirectory=`. |
| 5 | важно | `src/lib/logger.ts:97-99` + `src/core/api-wrapper.ts:128` | `logger.error` ВСЕГДА добавляет `error.message` и `error.stack`, если передан `Error`. `withApi` так логирует каждый необработанный throw (500). | Объём: полный stack на каждую 500-ю, включая шумные пути (PDF, Telegram, проекции). Утечка: stack раскрывает пути ФС, структуру кода и (для Prisma-ошибок) детали запросов — в контейнерном логе, доступном любому с доступом к `docker logs`. | Оставить stack, но решить объём/доступность: не логировать полный стек на ожидаемых ошибках, ограничить доступ к `docker logs`, либо ввести уровневое редактирование (stack только при `LOG_LEVEL=debug`). |
| 6 | мелочь | `docker-compose.yml` (весь файл; блоков `logging` нет — ПРОЙДЕНО grep) | Базовая compose-конфигурация не задаёт ротацию вообще. | Любой запуск без prod-overlay (dev/staging) и любой новый сервис, забытый в overlay, пишет без лимита. На проде спасает только prod-overlay + возможный daemon.json. | Задать `logging` (дефолт json-file 10m×5) в базовом `docker-compose.yml` через YAML-anchor `x-logging`, переиспользуемый сервисами. |
| 7 | мелочь | `docker-compose.staging.yml`, `docker-compose.monitoring-standalone.yml`, `docker-compose.observability.yml` (блоков `logging` нет — ПРОЙДЕНО grep) | Ни staging, ни standalone-мониторинг не ограничивают логи. | Стенд/локальный стенд с мониторингом могут забить диск без уведомления; на проде эти файлы не используются, риск локальный. | Добавить те же `logging`-опции, что в `monitoring-prod`. |
| 8 | мелочь | `observability/loki/loki-config.yml:1-26` | Конфиг Loki не задаёт `retention_period`/compactor — логи хранятся бесконечно. | Если стек `docker-compose.observability.yml` поднят, том `loki-data` растёт без предела. В проде Loki нет (`monitoring-prod.yml:4`) — риск потенциальный. | Задать `limits_config.retention_period` + `compactor.retention_enabled: true`. |
| 9 | мелочь | `docker-compose.observability.yml:70-81` | Loki поднят, но ни один сервис не пишет в него (нет `driver: loki`, нет promtail). | Loki пуст, а Grafana-датасорс на него ссылается — ложное ощущение «логи собираются». | Удалить Loki/дать promtail, либо настроить docker log driver `loki`. |
| 10 | мелочь | `src/core/api-wrapper.ts:122` | На Prisma-конфликт пишется `message: error.message` на уровне warn (комментарий сам признаёт, что текст называет таблицы/поля схемы). | В лог уходит имя таблицы/поля БД и значения уникального ключа — раскрытие схемы в логах (в ответ клиенту правильно не отдаётся). | Логировать только `code` и `domain`, без `error.message`. |
| 11 | мелочь | `src/app/api/orion/lead/route.ts:83,100` (frozen-область ORION) | На уровне error логируются `{ name, contact, message }` — персональные данные (имя, контакт). | PII лида в логах противоречит заявленному «152-ФЗ scope» (ср. `sentry.server.config.ts:16-17`). Область заморожена — правка за владельцем. | Не логировать `name/contact/message`; логировать `leadId`/`deliveryError`. |
| 12 | мелочь | `src/workers/pdf-worker.ts:54,73` | На уровне info пишутся `userId` и абсолютный `filePath` сгенерированного PDF. | Пути ФС и идентификатор пользователя в логах; накопление при массовой генерации. | Логировать `jobId`/`type`, без абсол. пути (или только basename). |
| 13 | мелочь | `src/lib/logger.ts:41` | `if (env && env in MIN_LEVEL)` регистрозависимо: `LOG_LEVEL=INFO` молча игнорируется, откат на дефолт по `NODE_ENV`. | На проде значение из env может не примениться незаметно (если его когда-нибудь пробросят). | Нормализовать: `env?.toLowerCase()`. |
| 14 | мелочь | `src/lib/logger.ts:42` | Вне `production` дефолтный уровень — `debug` (пишется всё). | На staging/standalone-стенде объём логов существенно выше, растёт быстрее при те же лимитах ротации. | Задать `info` по умолчанию, `debug` — только по явному `LOG_LEVEL`. |
| 15 | мелочь | `src/lib/db.ts:44-49` | `DATABASE_LOG_QUERIES=true` включает Prisma `['query','warn','error']` — логирование КАЖДОГО SQL-запроса. В compose переменная не задана (выключено, ПРОЙДЕНО). | При включении для отладки объём логов вырастет на порядки; забытый флаг = забивание диска. | Документировать риск и/или ограничить флаг не-production сборкой. |
| 16 | мелочь | `src/lib/logger.ts:126-146` | `withRequestLogging` — экспортируется, но нигде не используется (grep по `src/e2e/tests` — 0 вызовов). | Мёртвый код, который при подключении начал бы писать info-строку на КАЖДЫЙ запрос (объём). Не удаляю (правило «докажи прежде чем удалять»); отмечаю как риск, если кто-то «включит». | Решить судьбу: удалить или явно задокументировать как неиспользуемое. |

## Что не проверено

- Применён ли `scripts/docker-daemon.json` на прод-сервере (нет SSH/доступа — по правилам проекта). Если НЕ применён — пробелы ротации из находок #3, #6 реальны; если применён — они закрыты хост-дефолтом 10m×5. Статус: НЕ ПРОВЕРЕНО.
- Фактическое значение `LOG_LEVEL`/`LOG_*` в `.env` на сервере и в `docker inspect` работающих контейнеров — читать `.env` запрещено правилами, сервер недоступен.
- Реальные размеры `*.log` json-file на диске сейчас (`docker inspect --format '{{.LogPath}}'` + `du`) — сервер недоступен, локальный Docker не поднимался.
- Настроены ли хостовые лимиты journald (`journald.conf`/drop-in) — файла в репозитории нет (grep по `SystemMaxUse`/`journalctl` — 0 в конфигах), что именно на сервере — НЕ ПРОВЕРЕНО.
- Поднят ли на проде стек `docker-compose.observability.yml` (с Loki) или только `monitoring-prod.yml` — по репозиторию есть расхождение (`docs/deployment.md:162-170` отправляет ставить observability, `docker-compose.monitoring-prod.yml:4` заявляет «без Loki»). Статус: ГИПОТЕЗА.
- В NODE_ENV=production на проде работает только контейнер; верно ли, что `BUILD`/`migrate`-процессы не пишут debug-шум — не проверено за отсутствием прогона.
- Раздел про ротацию логов на уровне Docker daemon (`.LogPath`, эффективные `LogConfig`) требует доступа к серверу — не проверено.
