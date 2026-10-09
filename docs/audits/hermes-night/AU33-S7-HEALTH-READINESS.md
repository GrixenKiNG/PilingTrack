# AU33-S7-HEALTH-READINESS: проверки здоровья — что реально проверяют health, ready, liveness

Версия кода: `git rev-parse HEAD` → `7a3b63bffe07f53ea80ff9c36621bd8f6b86ddee`
(ветка `hermes/q4-0926`). Рабочее дерево на момент аудита: `M AGENTS.md` (правкой не
трогал).

## Итог

Всего 18 находок: критично — 0, важно — 8, мелочь — 10.

Пять точек здоровья (`/api/health`, `/api/health/deep`, `/api/ready`,
`/api/readiness`, `/api/liveness`) устроены по-разному и отвечают на разные
вопросы; единого «здоровья» нет. Топ-5:

1. `/api/health/deep` считает общий статус по семи компонентам (база, оба Redis,
   outbox, воркеры, планировщики, хранилище, бэкап), но в теле отдаёт только
   четыре. При 503 из-за воркеров/outbox/бэкапа публичный ответ показывает все
   четыре компонента «ok» — смоук выкладки `prod-smoke.mjs` по нему и судит.
2. Оба health-эндпоинта пингуют только КЭШ-инстанс Redis. Инстанс СОСТОЯНИЯ
   (`REDIS_URL`, noeviction) напрямую не проверяется: его поле в ответе —
   `redis: ok`, хотя весь прод-пульс живёт именно там.
3. Один и тот же кэш-Redis даёт противоположный вердикт: `/api/health` → 200
   (degraded), `/api/health/deep` → 503 (unhealthy).
4. Хранилище: при провайдере `local` health безусловно рапортует `ok` (ничего не
   проверяет), а при `s3` без ключей доступа — навсегда `down`/503 из-за
   непустого значения `S3_BUCKET` по умолчанию.
5. Docker-healthcheck и хост-сторож `app-guard` судят только по HTTP-коду
   `/api/health`, где `degraded` = 200. Диск, память, Redis, отсутствие
   `SESSION_SECRET` — всё это 200 и ни одного действия.

Статусы по разделам код-разбора: **ПРОЙДЕНО** — чтение и сверка строк кода
(все `path:line` открыты); **НЕ ПРОВЕРЕНО** — поведение под реальным отказом
БД/Redis/S3, работа мониторинга (прод не запускался, Docker/БД недоступны);
**ГИПОТЕЗА** — в выводах помечено отдельно (в частности по миграциям и
внешнему UptimeRobot).

## Методика

Read-only: файлы только читал, изменён один — этот отчёт. Существующие отчёты в
`docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` не открывал.

Команды и поиски (числа только отсюда):

- `git rev-parse HEAD` → `7a3b63bffe07f53ea80ff9c36621bd8f6b86ddee`.
- `ls src/app/api/{health/route.ts,health/deep/route.ts,liveness/route.ts,ready/route.ts,readiness/route.ts} | wc -l` → 5 публичных проб.
- `grep -c 'healthcheck:' docker-compose.yml` → 6 сервисов с healthcheck.
- `grep -c '      - alert:' observability/prometheus/alerts.yml` → 31 правило;
  из них `grep -nE 'HealthSnapshotStale|HealthDegraded|WorkersDown|WorkerNotRunning|Backup(Missing|Stale|Critical)|OffsiteBackup'` → 8 правил про здоровье.
- Поиск по содержимому `search_files` по шаблонам: `healthcheck|HEALTHCHECK|/api/health`,
  `liveness|readiness|/healthcheck`, `_prisma_migrations|migrate deploy`,
  `websocket`, `Dockerfile.prod|uptimerobot`.

Прочитаны целиком (все `path:line` ниже проверены по этим файлам):

- маршруты: `src/app/api/health/route.ts`, `src/app/api/health/deep/route.ts` (+ его
  тест `__tests__/route.test.ts`), `src/app/api/liveness/route.ts`,
  `src/app/api/ready/route.ts` (+`__tests__/route.test.ts`),
  `src/app/api/readiness/route.ts`, `src/app/api/system/status/route.ts`,
  `src/app/api/system/route.ts`, `src/app/api/metrics/route.ts`;
- ядро: `src/core/observability/health-checks.ts`, весь
  `src/core/observability/health-tracker/**` (tracker, aggregate, thresholds,
  types, helpers, scheduler-registry, checkers/{database,redis,storage,workers,
  schedulers,outbox,backup}), `s3-health-check.ts`, `src/instrumentation.ts`,
  `src/lib/redis-cache.ts`;
- воркеры: `src/workers/unified-worker.ts`, `unified-worker/{health-server,
  state,config,outbox,pdf,readiness-scheduler,pm-scheduler,
  projection-rebuild-scheduler,scheduler-heartbeat}.ts`,
  `src/workers/embedded-workers.ts`;
- инфраструктура: `docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.monitoring-prod.yml`, `Dockerfile`, `Dockerfile.workers`,
  `deploy/Dockerfile.prod`, `Caddyfile`, `deploy/Caddyfile.prod`,
  `observability/prometheus/{prometheus-prod.yml,alerts.yml}`,
  `src/proxy.ts`, `deploy/systemd/pilingtrack-app-guard.{service,timer}`,
  `scripts/app-guard.sh`, `scripts/prod-smoke.mjs`, `scripts/smoke-workers-image.sh`,
  `e2e/smoke-e2e.spec.ts`, `deploy-2026-05-17.md`.

Не запускалось (нет Docker/БД/env на этой машине): сами health-эндпоинты,
`npm run build`, тесты. Поэтому «что вернёт при частичном отказе» ниже —
из кода, не из прогонов.

### Кто и как опрашивает (карта)

| Опрашивающий | Цель | Как | Период | Реакция |
| --- | --- | --- | --- | --- |
| Docker (Dockerfile HEALTHCHECK) | app `/api/health` | `wget --spider`/`curl -f` | 30 с | только флаг `Health.Status`, рестарта при `unhealthy` нет (`restart: unless-stopped`) |
| Docker (Dockerfile.workers) | workers `:3002/health` | `curl -f` | 30 с | то же |
| `scripts/deploy-prod.sh` | `docker inspect .State.Health.Status`, `/api/health`, код `/api/health/deep`, `_prisma_migrations` | чтение | раз на выкладку | печатает, не гейтит по deep |
| Сторож `app-guard` (systemd timer) | `http://127.0.0.1:3000/api/health` | `curl -fsS` | 2 мин, порог 3 подряд | Telegram напрямую, рестарта нет |
| Prometheus (`prometheus-prod.yml`) | app `/api/metrics`, workers `:3002/metrics` | Bearer-токен / без авторизации | 15 с | 31 правило Alertmanager (8 про здоровье) |
| Alertmanager → `/api/alerts/webhook` | — | webhook | по триггеру | Telegram |
| Внешний UptimeRobot (по комментариям `health/deep/route.ts:4`, тесту `route.test.ts:4`) | `/api/health/deep` | GET | ? | в репозитории конфига нет — НЕ ПРОВЕРЕНО |
| Caddy (`deploy/Caddyfile.prod`) | — | `reverse_proxy 127.0.0.1:3000` | постоянно | активного health-check у Caddy нет |

## Находки

| # | важноcть | path:line | проблема | сценарий / почему важно | что делать |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/app/api/health/deep/route.ts:40-57`; `src/core/observability/health-tracker/aggregate.ts:98-111`; `aggregate.ts:19-48` | Тело `/api/health/deep` отдаёт только `database`,`redis`,`schedulers`,`storage`, а общий статус и HTTP-код считаются ещё по `outbox`,`workers`,`backup` (`computeOverallStatus`). Тест `src/app/api/health/deep/__tests__/route.test.ts:73-78` это намеренно фиксирует. | Падает контейнер `workers` или бэкап старше 48 ч → общий `unhealthy` → HTTP 503, но в теле все четыре перечисленных компонента «ok». `scripts/prod-smoke.mjs:88-97` судит ровно по `components` и печатает «всё ок» при мёртвых воркерах. Внешний монитор получает 503, не зная причины. | Либо отдавать все семь компонентов, либо добавить в тело `workers`/`outbox`/`backup`. |
| 2 | важно | `src/core/observability/health-tracker/checkers/redis.ts:1,9`; `src/lib/redis-cache.ts:118-139`; `src/core/observability/health-checks.ts:136-162` | Оба health-эндпоинта пингуют только КЭШ-инстанс (`getRedisClient`). Инстанс СОСТОЯНИЯ (`REDIS_URL`, `getStateRedisClient`) напрямую не проверяется. | State-Redis держит пульс воркеров, планировщиков и ключи бэкапа — это единственная точка, чья смерть тихо останавливает суточную рутину. При его отказе глубокий ответ покажет `redis: ok` (503 придёт из `workers`/`schedulers`), а `/api/health` вообще промолчит. | Пинговать оба инстанса отдельными полями. |
| 3 | важно | `health-checks.ts:136-162` (redis → `warn`); `health-tracker/checkers/redis.ts:21-26` (redis → `down`) | Одна и та же зависимость (кэш-Redis) даёт противоположный вердикт: `/api/health` → `degraded`/200, `/api/health/deep` → `unhealthy`/503. Политики «Redis не критичен» и «Redis критичен» живут в двух файлах. | Владелец видит: одна проба зелёная, другая 503. Мониторинг получает ложный critical при живом приложении (кэш опционален). | Свести политику: кэш не должен переводить `deep` в `unhealthy`. |
| 4 | важно | `src/core/observability/health-tracker/checkers/storage.ts:4-9`; `src/core/observability/s3-health-check.ts:13-16`; `docker-compose.yml:88-90` | `getStorageProvider` выбирает `'s3'`, если задан `S3_BUCKET` ИЛИ `S3_ACCESS_KEY_ID`. В прод-компоузе `S3_BUCKET` по умолчанию непустой (`pilingtrack-reports`), а `S3_ACCESS_KEY_ID/SECRET_ACCESS_KEY` по умолчанию пустые. `getS3ClientForHealth` требует ВСЕ три и иначе возвращает `null` → `ok=false`. | На выкладке без S3-ключей (приложение молча пишет PDF/фото локально) `storage` навсегда `down` → `/api/health/deep` = 503 perpetuum. Ложная тревога, глушащая настоящие. | Согласовать условия провайдера и клиента; при отсутствии полной S3-конфигурации считать провайдера `local`. |
| 5 | важно | `src/core/observability/health-tracker/checkers/storage.ts:14-16` | При `provider === 'local'` возвращается безусловное `{ status: 'up' }` — ни `statfs`, ни пробной записи. | Если S3 не настроен, файлы идут на локальный том; его переполнение/отвал никак не отражается — `storage: ok`. Ровно тот «ложно-зелёный», которого проверка должна избегать. | Проверять доступность каталога (запись/`statfs`) или честно писать `unknown`. |
| 6 | важно | `src/core/observability/health-checks.ts:121-130`; `health-checks.ts:192-205` | `checkEnv` возвращает только `pass`/`warn` (никогда `fail`), а `buildReadiness` проверяет `envCheck.status !== 'fail'` (`:196`) — условие всегда истинно. Список `required` ограничен `DATABASE_URL_POSTGRES` и `SESSION_SECRET` (`:122`); `ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`, `REDIS_URL` не проверяются. | `/api/ready` фактически гейтится единственной проверкой — БД. Пропавший `ENCRYPTION_KEY` (Telegram-конфиг не расшифруется) readiness не завалит. Мёртвая ветка вводит в заблуждение при чтении. | Либо сделать env реально блокирующим, либо убрать недостижимое условие и расширить список. |
| 7 | важно | `docker-compose.yml:139-144`; `src/app/api/health/route.ts:24-37`; `deploy/systemd/pilingtrack-app-guard.timer:5-6`; `scripts/app-guard.sh:237-250` | И Docker-healthcheck, и независимый хост-сторож судят только по HTTP-коду `/api/health`, а `degraded` там отдаётся кодом 200 (`route.ts:25-29`). 503 возможен лишь при `database.status='fail'` или исключении в самом обработчике (`health-checks.ts:173-176`). | Полный диск, деградация памяти, отказ обоих Redis, отсутствие `SESSION_SECRET` → 200; ни рестарта, ни Telegram-тревоги от сторожа. Оба «предохранителя» слепы к целому классу деградаций. | Осознанно принять или перевести сторожа/healthcheck на `/api/health/deep`. |
| 8 | важно | `src/core/observability/health-tracker/checkers/workers.ts:6-46`; `src/workers/embedded-workers.ts:26,165-171`; `src/workers/unified-worker/state.ts:49-52` | Компонент `workers` берёт САМЫЙ свежий пульс среди имён из `system:workers`. Пульс `outbox`/`projection` пишут и встроенные воркеры app, и контейнер `workers` (только лидер). Планировщики и PDF пульса воркера не пишут. | Смерть PDF-воркера и/или всего контейнера `workers` (когда он standby по outbox) маскируется свежим пульсом app: `workers` остаётся `running`, `deep` — зелёным. Единственный сигнал — метрика `worker_status` и правило `WorkerNotRunning` (`alerts.yml:285-295`). | Требовать пульс по каждому воркеру отдельно или ввести отдельные поля для app/workers. |
| 9 | мелочь | `src/workers/unified-worker/health-server.ts:10-14`; `src/workers/unified-worker/config.ts:12`; `src/workers/unified-worker.ts:153-169` | `:3002/health` отдаёт 200, если жив ХОТЯ БЫ один worker (`runningWorkers.length > 0`) и нет ни одного в статусе `error`; включённый, но `stopped`/«застрявший» воркер провал не создаёт. | Один живой outbox + остановленный pdf → healthcheck контейнера зелёный. Правило Prometheus (`WorkerNotRunning`) сравнивает с `ENABLED_WORKERS`, healthcheck — нет: две разные правды. | Сравнивать с `ENABLED_WORKERS`, как в правиле алерта. |
| 10 | мелочь | `src/core/observability/health-tracker/tracker.ts:127-131`; `src/core/observability/health-checks.ts:207-234` | `getFreshStatus` не дедуплицирует запросы «в полёте» (в отличие от `getReadiness` с `readinessInFlight`). | Публичный `/api/health/deep` при протухшем кэше (`route.ts:32`) на всплеск анонимных запросов выполнит N полных проверок (8 обращений: БД, оба Redis, S3…). | Добавить in-flight dedup, как в readiness. |
| 11 | мелочь | `src/app/api/liveness/route.ts:14`; `src/core/observability/health-checks.ts:240-252` | `/api/liveness` публично отдаёт `pid`, `nodeVersion`, `platform`, `heapUsedMB`, `rssMB` — тогда как `/api/health` специально сужен от `fingerprinting` (`route.ts:4-10`). | Информационное раскрытие среды выполнения и несогласованность политики двух проб. | Сузить liveness до `{ status, uptime }`. |
| 12 | мелочь | `src/app/api/readiness/route.ts:35`; `e2e/smoke-e2e.spec.ts:28` | Устаревший alias `/api/readiness` объявляет `Sunset: Wed, 30 Sep 2026 21:00:00 GMT` — дата уже прошла (отчёт 09.10.2026), маршрут жив; e2e и часть нагрузочных скриптов (`load-tests/slo-monitor.ts`, `performance/k6/soak.test.js`) бьют именно в него. | Мёртвая договорённость о судьбе маршрута: убирать его «по плану» нельзя, не переведя зависимости. | Перевести зависимости на `/api/ready`, затем удалить alias и заголовки. |
| 13 | мелочь | `scripts/prod-smoke.mjs:92` | Смоук пропускает компонент `websocket`, которого в ответе `/api/health/deep` нет (`deep/route.ts:40-57`); комментарий про «503 из-за websocket» устарел. | Ветка никогда не срабатывает; ложное ощущение, что причина 503 разобрана. | Убрать ветку и комментарий. |
| 14 | мелочь | `src/core/observability/health-checks.ts:164-186`; `src/app/api/health/route.ts:24` | `getHealth()` не кэшируется: каждый GET `/api/health` выполняет `SELECT 1`, PING Redis и `statfs`. Docker опрашивает каждые 30 с (`docker-compose.yml:141`), но маршрут публичен. | Любой анонимный поток даёт нагрузку на БД/Redis через публичный путь. | Короткий кэш, как у `/api/health/deep`. |
| 15 | мелочь | `checkers/workers.ts:13-29`; `checkers/schedulers.ts:32-37`; `checkers/backup.ts:83-99` | Эти проверки не обёрнуты `withTimeout`, в отличие от `checkers/database.ts:9`, `checkers/redis.ts:14`, `checkers/outbox.ts:13`. | «Зависшая» команда к state-Redis затянет `checkSystemStatus` (`aggregate.ts:86-96`, `Promise.allSettled`); снапшот трекера не обновится → сработает `HealthSnapshotStale` (`alerts.yml:297-307`) вместо точной причины. | Обернуть таймаутами, как у остальных проверок. |
| 16 | мелочь | `checkers/backup.ts:78-80`; `docker-compose.yml:124-129`; `observability/prometheus/alerts.yml:374-416` | Если `BACKUP_ENABLED` не задан (в компоузе дефолт пустой), проверка возвращает `{ status: 'up', source: 'disabled' }`. Все алерты по бэкапу требуют `backup_monitoring_enabled == 1` (`:375,386,397,409`). | Контроль бэкапов молча выключен: `/api/health/deep` зелёный, метрика `backup_monitoring_enabled=0`, тревоги никогда не сработают. Бэкапы могут встать незамеченными. | Явно сигнализировать «контроль выключен» владельцу; включать `BACKUP_ENABLED` в бою. |
| 17 | мелочь | `docker-compose.yml:23-55,137-138`; `scripts/deploy-prod.sh:135-138` | Нет ни одного health/readiness-маршрута, читающего `_prisma_migrations` или сверяющего схему. Сервис `migrate` только гейтит старт (`app` зависит от `service_completed_successfully`); версии миграций печатает лишь `deploy-prod.sh` и только если `migrate` был в списке. | Если рантайм стартует со схемой, разошедшейся с билдом (откат образа, ручной запуск), health об этом не скажет. ГИПОТЕЗА по практической достижимости на проде. | Добавить в readiness сверку версии миграций. |
| 18 | мелочь | `src/app/api/health/deep/__tests__/route.test.ts:103-105`; `deep/route.ts:44` | «Медленная» БД (`status:'slow'`) в публичном теле отображается как `down`, при этом HTTP 200 (общий статус `degraded`). | Потребитель читает `database: down` рядом с кодом 200 — противоречивая картина без пояснения. | Отдавать отдельное `slow`/`degraded` для «медленно, но живо». |

## Не проверено

- **Фактическое поведение под отказом.** Ни один health/ready-эндпоинт не
  запускался: нет Docker, БД и env на этой машине. Все сценарии «что вернёт при
  частичном отказе» выведены из кода, а не воспроизведены.
- **`npm run build`, `tsc`, тесты** не выполнялись (read-only аудит). Достоверность
  номеров строк проверена только чтением файлов.
- **Работа мониторинга в бою.** Настроен ли внешний UptimeRobot на
  `/api/health/deep` (о нём говорят комментарии `deep/route.ts:4` и
  `__tests__/route.test.ts:4`), какие значения `BACKUP_ENABLED`,
  `S3_ACCESS_KEY_ID`, `REDIS_URL_CACHE` реально стоят в проде — из репозитория
  не видно (`.env` не читал по правилам AGENTS.md §1).
- **Гипотезы, требующие прогона:** №17 (расхождение схемы), влияние отсутствия
  таймаутов в №15, реальная частота внешних опросов, поведение `wget --spider`
  (HEAD) против Next-роутов с одним `GET` — по коду неоднозначно, не проверено.
- **Не проверялось по условию задачи:** файлы `docs/audits/**`, `CODEX-REPORT*`,
  `docs/strategy` не открывались; замороженные зоны (варианты экрана оператора,
  сайт ORION) не рассматривались.
- **Caddy** активную проверку здоровья не выполняет (только `reverse_proxy`,
  `deploy/Caddyfile.prod:52-54`) — это прочитано, но как ведёт себя прод-Caddy
  при недоступном upstream, не проверялось.
