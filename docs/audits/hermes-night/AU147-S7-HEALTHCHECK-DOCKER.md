# AU147-S7-HEALTHCHECK-DOCKER — healthcheck-и контейнеров против реальной готовности

Версия: `git rev-parse HEAD` → `9acc1b605a7dfd13bc441229fbce4ec4ed8e59c8` (ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`).

Область: только чтение. Проверялись `docker-compose*.yml`, `Dockerfile*` и код, который эти healthcheck дёргают (`/api/health`, `/api/health/deep`, worker `/health`). Код приложения не менялся.

## Итог

- Всего находок: **15**. По severity: критично — **0**, важно — **3**, мелочь — **12**.
- Healthcheck есть у 6 сервисов из базового `docker-compose.yml` (app, workers, redis, redis-cache, postgres, minio); у `migrate`, `pgbouncer`, `pgadmin` — нет; у стека observability/monitoring healthcheck нет ни у одного сервиса.
- Главное (важно): healthcheck redis/redis-cache **всегда зелёный даже при неверном пароле** — пароль передаётся как литерал `$REDIS_PASSWORD` (exec-форма `CMD` не раскрывает переменные), а `redis-cli` возвращает код 0 при `AUTH failed`/`NOAUTH`. Проверено запуском контейнера.
- Важно: app-healthcheck бьёт в `/api/health`, который отдаёт **HTTP 200 для статуса `degraded`** — значит сбой Redis, диск ≥85 %, heap >80 %, отсутствие env-переменных контейнер не помечают. Проверено: `wget --spider` даёт 0 на 200 и 1 на 503.
- Важно: у `pgbouncer` нет healthcheck и `app`/`workers` его в `depends_on` не ждут — все запросы в БД идут через пул, но готовность пула не проверяется и не гейтит старт.
- Хорошее (для контекста): `migrate` гейтит `app`/`workers` через `service_completed_successfully`; признак «БД недоступна» ловится (через pgbouncer → `/api/health` 503). Метрика `health_status` (Prometheus) даёт алерт `HealthDegraded` через 5 мин — часть пробелов healthcheck закрыта мониторингом.

## Методика

Что искал и как (команды воспроизводимы):

1. Инвентаризация файлов: `ls docker-compose* Dockerfile*`; список сервисов и healthcheck — `grep -n "healthcheck\|start_period\|^  [a-z-]*:" docker-compose*.yml`.
2. Реквизиты команд: чтение `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`, `docker-compose.observability.yml`, `docker-compose.monitoring-prod.yml`, `docker-compose.monitoring-standalone.yml`, `Dockerfile`, `Dockerfile.workers`, `Dockerfile.quick`.
3. Что именно проверяет цель healthcheck: `src/app/api/health/route.ts`, `src/app/api/health/deep/route.ts`, `src/core/observability/health-checks.ts`, `src/core/observability/health-tracker/aggregate.ts`, `src/workers/unified-worker/health-server.ts`, `src/workers/unified-worker.ts`, `src/workers/unified-worker/state.ts`, `outbox.ts`.
4. Секрет-литерал `***` в `DATA_SOURCE_NAME` проверен `od -c` — это маскировка вывода инструмента, в файле реальный `${POSTGRES_PASSWORD}` (не дефект).
5. Эксперименты (Docker 29.8.2, локальные образы `redis:7-alpine`, `postgres:18-alpine`), в скретч-каталоге, вне репозитория:
   - копия healthcheck redis: `test: ["CMD","redis-cli","-a","$$REDIS_PASSWORD","--no-auth-warning","ping"]`;
   - недоступный redis: тот же CMD, но порт 6399 → `docker inspect` `.State.Health`.
   - `pg_isready` с несуществующими user/db внутри живого postgres.
   - `wget --spider` (busybox 1.37, как в образе приложения) против ответов 200 и 503.
6. Использованные факты проверены командами; всё, что не удалось проверить, вынесено в «Что не проверено».

### Матрица: сервис | команда healthcheck | что проверяет | что НЕ проверяет | start_period | риск ложного healthy

| Сервис (файл:строка) | Команда healthcheck | Что проверяет | Что НЕ проверяет | start_period | Риск ложного healthy |
|---|---|---|---|---|---|
| `app` — docker-compose.yml:139-144 | `wget --no-verbose --tries=1 --spider http://localhost:3000/api/health` | HTTP 2xx от `/api/health`: `SELECT 1` через pgbouncer, heap, диск, env, ping Redis — но «fail» только БД | Redis/диск/heap/env только `warn` → 200; S3, планировщики воркеров, готовность pgbouncer, применённые миграции, права/RLS роли | 40s | **Высокий**: `degraded` = 200, контейнер «healthy» при сбое Redis / диске ≥85 % / отсутствии env (проверено: `wget --spider` 200→0, 503→1) |
| `workers` — docker-compose.yml:216-221 | `curl -f http://localhost:3002/health` | только in-process `workerStates` (`health-server.ts:14`): 200 если есть `running` и нет `error` | БД, Redis, S3, pgbouncer, реальная обработка событий (петля может быть «running» с мёртвой БД) | 40s | Средний: цикл помечен `running`, но зависимости недоступны → 200 |
| `pgbouncer` — docker-compose.yml:237-271 | **нет healthcheck** | — | всё | нет | **Высокий**: не гейтит старт `app`/`workers` (нет в `depends_on`), готовность пула нигде не проверяется |
| `redis` — docker-compose.yml:300-304 | `redis-cli -a $$REDIS_PASSWORD --no-auth-warning ping` | доступность сокета/порта (connection refused → exit 1) | аутентификацию: пароль не раскрывается (`$REDIS_PASSWORD` литерал), `redis-cli` даёт exit 0 при `AUTH failed`/`NOAUTH` | нет | Средний: неверный пароль → «healthy» (проверено в контейнере) |
| `redis-cache` — docker-compose.yml:331-335 | та же, что `redis` | то же | то же + policy/eviction/память | нет | Средний (то же) |
| `postgres` — docker-compose.yml:372-376 | `pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-pilingtrack_test}` | «accepting connections» | аутентификацию, существование БД/роли, применение миграций, репликацию (проверено: exit 0 с несуществующими user/db) | нет | Низкий: негодный `POSTGRES_DB` всё равно «healthy», но это ловит `migrate` |
| `minio` — docker-compose.yml:416-420 | `curl -f http://localhost:9000/minio/health/live` | живость процесса | готовность (`/minio/health/ready`): кластер, диск | нет | Низкий: однонодовый MinIO, live≈ready |
| `migrate` — docker-compose.yml:23-55 | нет (одноразовый) | — | — | нет | Нет (гейтит `app` через `service_completed_successfully`, L137-138) |
| `pgadmin` — docker-compose.yml:383-397 | нет | — | — | нет | dev-profile, вне боя |
| observability: prometheus, grafana, loki, tempo, alertmanager, postgres/redis-exporter, pushgateway — docker-compose.observability.yml | **нет ни у одного** | — | — | нет | Средний: сбой Prometheus/Alertmanager не виден docker-слою (частично ловится алертами `up{}`) |
| monitoring-prod: prometheus, grafana, node-exporter, postgres-exporter, alertmanager, redis-exporter — docker-compose.monitoring-prod.yml | **нет ни у одного** | — | — | нет | Тот же |
| `Dockerfile` runner (L110-111) | `wget --spider http://localhost:3000/api/health` | дубль healthcheck compose | — | 40s | Дрейф: два разных определения healthcheck (образ + compose) |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `docker-compose.yml:301`, `docker-compose.yml:332` | Пароль в healthcheck redis/redis-cache передан как литерал: exec-форма `CMD` не раскрывает переменные, а `redis-cli` возвращает 0 даже при `AUTH failed` | Пароль Redis в `.env` сменили/рассинхронизировали — контейнер redis «healthy», app получает `warn`→`degraded`→200; docker-слой молчит. Проверено: контейнер с этим healthcheck — `healthy`, лог: `AUTH failed: WRONGPASS … NOAUTH Authentication required` (exit 0). При недоступном порте — exit 1 → `unhealthy` | Использовать `CMD-SHELL` c `sh -c 'redis-cli -a "$$REDIS_PASSWORD" --no-auth-warning ping \| grep -q PONG'`, либо `REDISCLI_AUTH=$$REDIS_PASSWORD redis-cli ping`; проверять именно `PONG`, а не код возврата |
| 2 | важно | `docker-compose.yml:139-144`, `src/app/api/health/route.ts:25-29`, `src/core/observability/health-checks.ts:176` | Healthcheck бьёт в `/api/health`, где `degraded` = 200 (`statusMap`), а `degraded` ставят warn-проверки Redis (L136-162), диска ≥85 % (L95-106), heap >80 % (L58-82), env (L121-130) | Диск заполнен на 85 %+ (историческая причина падения — 30-ГБ VPS), или Redis недоступен, или пропала env — `docker ps` показывает `healthy`, деплой-гейт и Caddy ничего не замечают. Проверено: `wget --spider` возвращает 0 на 200 и 1 на 503 | Для docker-гейта использовать `/api/health/deep` (503 при `unhealthy`: `aggregate.ts:22-31` — redis/storage/workers/backup `down` → 503); либо явно решить, что критично, и поднять эти проверки до `fail` |
| 3 | важно | `docker-compose.yml:237-271`, `docker-compose.yml:130-138`, `docker-compose.yml:207-215` | У `pgbouncer` нет healthcheck и он не в `depends_on` у app/workers, хотя ВСЯ работа с БД идёт через пул (`DATABASE_URL=…@pgbouncer:5432`) | Пул не поднялся/упал (плохой `AUTH_TYPE`, лимит коннектов) — app/workers стартуют, БД-проверка падает, контейнер `unhealthy`, но compose не перезапускает unhealthy и не ждёт пул | Добавить `pgbouncer` healthcheck (например `pg_isready -h localhost -p 6432`) и `depends_on: pgbouncer: condition: service_healthy` у app/workers |
| 4 | мелочь | `docker-compose.yml:372-376` | `pg_isready` проверяет только «accepting connections», а не аутентификацию и существование БД/роли | `POSTGRES_DB`/роль заданы неверно — postgres «healthy», ошибка всплывёт только в `migrate`. Проверено внутри контейнера: `pg_isready -U nosuchuser -d nosuchdb` → exit 0 | Оставить как liveness, но не полагаться на него как на «БД готова»; при желании — `pg_isready` + `psql -c 'select 1'` с реальными кредами |
| 5 | мелочь | `docker-compose.yml:416-420` | MinIO healthcheck по `/minio/health/live` (живость), не `/minio/health/ready` | Для однонодовой установки почти эквивалентно; при будущем кластере live останется зелёным при неготовности диска | Использовать `/minio/health/ready` (или оба) |
| 6 | мелочь | `docker-compose.yml:300-304`, `docker-compose.yml:331-335`, `docker-compose.yml:372-376`, `docker-compose.yml:416-420` | У redis/redis-cache/postgres/minio нет `start_period` (interval 10s, retries 3) | На медленном старте hostа healthcheck успевает «мигнуть», а `depends_on: service_healthy` у `migrate`/`app` ждёт его зря | Добавить `start_period: 20s`-`30s` для redis/postgres |
| 7 | мелочь | `src/workers/unified-worker/health-server.ts:14` | `/health` воркеров оценивает только `workerStates`, не зависимости (БД, Redis, S3) | Воркер с мёртвой БД, но живым циклом (`status='running'`) отдаёт 200 → контейнер «healthy». Пульс-прикрытие есть только со стороны health-tracker (планировщики) | Добавить хотя бы `SELECT 1`/Redis-ping в worker `/health`, либо завести алерт на `worker_status` (есть `WorkerNotRunning`, alerts.yml:285) |
| 8 | мелочь | `src/workers/unified-worker.ts:149`, `src/workers/unified-worker/state.ts:15-43`, `src/workers/unified-worker/outbox.ts:72` | Health-сервер поднимается ДО планировщиков; пока все статусы `starting` → `/health` отдаёт 503 | Если выборы лидера/инициализация задержатся дольше 40 с, контейнер помечается `unhealthy` (ложно). Проверено только по коду, не под нагрузкой | Убедиться, что `start_period: 40s` перекрывает худший старт; при обнаружении — увеличить |
| 9 | мелочь | `src/core/observability/health-checks.ts:122` | Env-проверка требует только `DATABASE_URL_POSTGRES` и `SESSION_SECRET`; отсутствие `DATABASE_URL` (pgbouncer) и прочих — не проверяется, и это только `warn` → 200 | Контейнер может быть «healthy» при неполной конфигурации | Расширить список обязательных env или задействовать `/api/health/deep` для гейта |
| 10 | мелочь | `src/core/observability/health-checks.ts:39-56` | `checkDatabase` делает `SELECT 1`; не проверяет права/RLS-роль | Неверная роль приложения (без нужных грантов) → «healthy», ошибка видна только на реальных запросах | При желании — проверять `current_user` и базовый доступ к таблице |
| 11 | мелочь | `docker-compose.observability.yml:22-160`, `docker-compose.monitoring-prod.yml:14-172` | В обоих стеках observability/monitoring НЕТ ни одного healthcheck (проверено grep: 0 совпадений) | Crash-loop Prometheus/Alertmanager/Grafana не виден docker-слою; частично компенсируется алертами `up{}`/`AlertmanagerDown` (alerts.yml:320-330) | Добавить healthcheck ключевым сервисам (prometheus, alertmanager, exporters) |
| 12 | мелочь | `Dockerfile:106-111` vs `docker-compose.yml:139-144` | Два независимых определения healthcheck (образ и compose); compose перекрывает образ | При запуске образа без compose (Swarm/K8s/ручной `docker run`) действует Dockerfile-версия, и правки в одном файле не доезжают до другого | Держать одно определение или синхронизировать с комментарием-ссылкой |
| 13 | мелочь | `Dockerfile.quick` (весь файл, 33 строки) | Нет healthcheck, нет `wget`/`curl`, нет `HOSTNAME=0.0.0.0`; `CMD node server.js` с фолбэком | Образ не используется compose-файлами (grep по репозиторию не нашёл ссылок вне `docs/` и `.gitnexus`), но если его поднять — healthcheck отсутствует и сервер не слушает внешний интерфейс | Удалить или пометить как неиспользуемый (решение владельца) |
| 14 | мелочь | `docker-compose.yml:139-144` vs `src/app/api/health/deep/route.ts:44-57` | Docker не дёргает `/api/health/deep`, хотя там есть `schedulers`/`staleSchedulers` — единственный признак «тихой» потери суточной рутины | Остановившиеся планировщики воркеров docker-слою не видны (ловит только `/api/health/deep`/метрики) | Если нужен гейт — добавить `/api/health/deep` во внешний сторож; для docker оставить осознанно |
| 15 | мелочь | `docker-compose.yml:55`, `docker-compose.yml:137-138`, `docker-compose.yml:214-215` | `migrate`: `restart: "no"` и гейт `service_completed_successfully` — при падении миграций app/workers не стартуют (это корректно) | Не дефект: положительная находка, что неудачный деплой не поднимает «полурабочий» бой | — (оставить) |

### Доказательства экспериментов (в скретч-каталоге вне репозитория)

- Копия healthcheck redis → `docker inspect .State.Health.Status` = `"healthy"`, `.State.Health.Log` = `0 :: AUTH failed: WRONGPASS … NOAUTH Authentication required` (повторялось). Команда в контейнере: `["CMD","redis-cli","-a","$REDIS_PASSWORD","--no-auth-warning","ping"]` — `$REDIS_PASSWORD` НЕ раскрыт.
- Тот же CMD, но порт 6399 (ничего не слушает) → `"unhealthy"`, `1 :: Could not connect to Redis at 127.0.0.1:6399: Connection refused`.
- `pg_isready -U nosuchuser -d nosuchdb` внутри `postgres:18-alpine` → `/var/run/postgresql:5432 - accepting connections`, `EXIT_BOGUS=0`.
- busybox `wget --no-verbose --tries=1 --spider` (v1.37, как в образе приложения): HTTP 200 → `rc=0`; HTTP 503 → `rc=1`.

## Что не проверено

- **Не проверял** поведение healthcheck `curl -f` воркеров против HTTP 503 (в локальных образах не нашлось `curl`) — опираюсь на документированную семантику `-f`; вживую не воспроизводил. ГИПОТЕЗА.
- **Не поднимал** полный стек `docker compose -p pilingtrack … up` (нет `.env` c боевыми секретами, правило «не читать `.env`»), поэтому реальные статусы контейнеров redis/postgres/app в боевой конфигурации не наблюдал — выводы по ним из кода и из изолированных экспериментов.
- **Не проверял** поведение `pg_isready` во время recovery/архивного восстановления (нужен специально подготовленный кластер).
- **Не проверял** фактический `start_period`-флаг воркеров под нагрузкой (п.8) — вывод по коду, временное окно до выборов лидера измерений не делал.
- **Не проверял** наличие иных healthcheck вне перечисленных файлов (проверял только `docker-compose*.yml` и `Dockerfile*` корня).
- **Не проверял**, используется ли `Dockerfile.quick` какими-либо внешними (не в репозитории) скриптами развёртывания — grep по репозиторию ссылок не нашёл.
- Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` в соответствии с заданием НЕ читались.
