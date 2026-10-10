# AU184-S4 — Пул подключений к базе: размеры, таймауты, поведение при исчерпании

Версия кода (git rev-parse HEAD): `33ff8084a21f20892e1fcd619927ed96d70cd099`
Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`). Режим: только чтение, код не менялся.
Скрипты/БД не запускались, к живой базе не подключался — все числа ниже взяты из исходников
и compose-файлов в этом чекауте.

## Итог

Резюме для владельца (5 строк):
1. Потолок одновременных соединений приложения к базе задаётся не Postgres (200), а пулом PgBouncer = 40,
   и ровно эти же 40 может занять пара «app (20) + workers (20)» — запаса нет ни одного соединения.
2. Из-за транзакционного пулинга каждая одиночная операция Prisma занимает серверное соединение
   вчетверо дольше нужного (BEGIN + set_config + запрос + COMMIT), то есть пул «съедается» быстрее, чем кажется по коду.
3. Наблюдаемости пула нет: алерты смотрят на соединения Postgres (порог 160/190 из 200), которые пул физически
   не может превысить — тревога никогда не сработает, а очередь клиентов внутри PgBouncer не измеряется вообще.
4. При исчерпании пула пользователь получит 500 через 10 с без понятного текста; проверка здоровья самой базы
   таймаута не имеет и может висеть до ~120 с.
5. Смягчений (лимит времени запроса, лимит ожидания, метрики пула) в коде нет — всё держится на арифметике «40 = 20 + 20».

**Найдено: 15 → критично 0, важно 6, мелочь 9.**

Топ-5:
1. `docker-compose.yml:260` `DEFAULT_POOL_SIZE=40` = `src/lib/db.ts:95` (20) × 2 процесса (`app` + `workers`) — ноль запаса (см. №1).
2. `observability/prometheus/alerts.yml:73` — порог «критично» >190 соединений недостижим при пуле 40; метрик PgBouncer нет (№2).
3. `src/lib/db.ts:98-107` — не заданы `statement_timeout` / `idle_in_transaction_session_timeout`, хотя драйвер их поддерживает (№3).
4. `src/core/observability/health-checks.ts:42` — проверка базы без таймаута, в отличие от проверки Redis (№5).
5. `src/core/security/tenant-rls.ts:104-107` — каждая одиночная операция = транзакция из 4 операторов (№9).

## Методика

Что и как искалось (воспроизводимо):
1. `rg -n -i "connection_limit|pool_timeout|pgbouncer|connectionLimit|poolTimeout|max_connections|idle_in_transaction" --glob '!node_modules' --glob '!.next' .`
2. Чтение целиком: `src/lib/db.ts` (220 строк), `docker-compose.yml` (456 строк, блоки `migrate` 23-57, `app` 60-153,
   `workers` 155-233, `pgbouncer` 237-271, `postgres` 344-380), `docker-compose.prod.yml` (60-140), `docker-compose.staging.yml` (30-90).
3. `prisma.config.ts`, `src/workers/embedded-workers.ts`, `src/core/observability/health-checks.ts`,
   `src/core/security/tenant-rls.ts`, `src/modules/readiness/infrastructure/tenant-transaction.ts`,
   `src/modules/reports/application/commands/report-command.service.ts` (фрагменты транзакций).
4. Алерты и экспортёры: `observability/prometheus/alerts.yml`, `observability/prometheus/prometheus.yml`,
   `docker-compose.observability.yml:118-132`, `docker-compose.monitoring-prod.yml:99-112`.
5. Поведение драйвера по исходникам зависимостей (не по памяти): `node_modules/pg-pool/index.js`,
   `node_modules/pg/lib/connection-parameters.js`, `node_modules/pg-connection-string/index.js`,
   `node_modules/@prisma/adapter-pg/dist/index.js`.
6. `rg` по `\bDATABASE_URL_POSTGRES\b`, `\bpg_dump\b`, `EMBEDDED_WORKERS`, `leader-election`, `advisory`.
7. Существующие отчёты в `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy/**`, `reports/**` исключены из поиска
   (`--glob '!…'`) и не использовались как источник.

Файлы-источники правды по соединениям: **единственный** драйвер рантайма — `src/lib/db.ts`
(`new PrismaPg` там ровно один раз, `src/lib/db.ts:98`); других `new Pool` / клиентов `pg` в `src/` нет
(поиск `PrismaPg|new Pool|from 'pg'`).

## Таблица параметров

Параметр | Значение | Файл:строка | Риск при пике
---|---|---|---
Пул клиента Prisma/приложения (`max`) | 20 (`PRISMA_CONNECTION_LIMIT` по умолчанию) | `src/lib/db.ts:95`, применяется `src/lib/db.ts:101` | При всплеске >20 параллельных запросов лишние ждут в очереди pg-pool и падают через 10 с
Таймаут получения соединения из пула | 10 с (`PRISMA_POOL_TIMEOUT`) | `src/lib/db.ts:94`, `src/lib/db.ts:100` | Это же значение уходит драйверу как `connect_timeout` (секунды) — см. `node_modules/pg/lib/connection-parameters.js:126-130`
Idle-таймаут соединения | 0 = соединения не закрываются никогда | `src/lib/db.ts:105` | Тёплый app держит до 20 соединений в PgBouncer постоянно; расходится с `server_idle_timeout` PgBouncer (по умолчанию 600 с) — см. №6
keepAlive | true | `src/lib/db.ts:106` | Плюс: обрыв по тишине; минус: мёртвое соединение узнаётся позже
Таймаут интерактивной транзакции | 10 000 мс | `src/lib/db.ts:55` | Долгая транзакция принудительно откатывается — соединение возвращается, это защита
Ожидание соединения для транзакции (`maxWait`) | 5 000 мс | `src/lib/db.ts:56` | Не совпадает с 10 с из строки 100 — две разные шкалы ожидания (№8)
PgBouncer `POOL_MODE` | transaction | `docker-compose.yml:255` | Правильно для RLS через `set_config(..., true)`, но каждое соединение возвращается в пул после каждой транзакции
PgBouncer `MAX_CLIENT_CONN` | 1000 | `docker-compose.yml:256` | Очередь в 960 клиентов при серверном пуле 40 — сигнала нет
PgBouncer `DEFAULT_POOL_SIZE` (серверных соединений к Postgres) | 40 | `docker-compose.yml:260` | **Реальный потолок** всей системы; равен сумме клиентских пулов app+workers
PgBouncer `RESERVE_POOL_SIZE` | 10 | `docker-compose.yml:261` | Резерв поднимает потолок до ~50 при загруженности пула
PgBouncer `RESERVE_POOL_TIMEOUT` | 3 с | `docker-compose.yml:262` | Через 3 с простоя свободных серверных соединений берётся резерв
PgBouncer `AUTH_TYPE` | scram-sha-256 | `docker-compose.yml:266` | При каждом новом соединении — лишние round-trips авторизации
PgBouncer `query_wait_timeout` / `server_idle_timeout` | не заданы | `docker-compose.yml:243-266` | ГИПОТЕЗА: действуют дефолты образа (120 с ожидания в очереди), своего значения в репозитории нет (№14)
Postgres `max_connections` | 200 | `docker-compose.yml:365`, `docker-compose.prod.yml:93` | Не является узким местом: пул даёт максимум ~50 серверных соединений
Рантайм-URL приложения | `…@pgbouncer:5432/…?pgbouncer=true` | `docker-compose.yml:78` (app), `docker-compose.yml:168` (workers) | Весь рантайм идёт через пул (в `src/lib/db.ts:84` приоритет у `DATABASE_URL`)
Миграции | прямой `postgres:5432` ролью-владельцем | `docker-compose.yml:46-47` | Мимо пула; при `migrate deploy` во время работы app лимит не задан (№11)
Healthcheck app / workers | 10 с, 3 попытки, каждые 30 с | `docker-compose.yml:140-142`, `docker-compose.yml:217` | Проверка бьёт в базу; при заторе пула контейнер становится unhealthy
Фоновые проверки здоровья | каждые 15 с | `src/core/observability/health-tracker/thresholds.ts:11`, `src/core/observability/health-tracker/tracker.ts:97` | Постоянный фоновый трафик в ту же базу

## Находки

# | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление
---|---|---|---|---|---
1 | важно | `docker-compose.yml:260` + `src/lib/db.ts:95` | Серверный пул PgBouncer = 40, а суммарный клиентский пул приложения и воркеров = 20 + 20 = 40; запаса нет. Комментарий `docker-compose.yml:257-259` считает «3 services × Prisma max=20 = 60» — арифметика неверна: сервисов, идущих в пул, два (`migrate` ходит напрямую, `docker-compose.yml:46`), а 60 клиентов в пул 40 не помещаются | Одновременный пик в API и в фоновых заданиях (outbox 10 с, projection 5 с — `src/workers/unified-worker/config.ts:7-8`) + перекрытие при деплое: лишние транзакции встают в очередь PgBouncer, приложение при этом уверено, что соединения есть | Либо поднять `DEFAULT_POOL_SIZE` до ≥ 2× числа клиентских пулов (≥80), либо опустить `PRISMA_CONNECTION_LIMIT` до 12-14 на процесс; зафиксировать формулу в комментарии
2 | важно | `observability/prometheus/alerts.yml:62` и `:73` | Алерты PostgresHighConnectionCount (>160) и PostgresConnectionPoolExhausted (>190) считают `pg_stat_activity_count` от `postgres-exporter` (`observability/prometheus/prometheus.yml:42`, `docker-compose.observability.yml:125`). Через пул проходит максимум ~50 серверных соединений, без пула — единицы (migrate, exporter, бэкап). Порог недостижим | Боевой инцидент «пул занят» (клиенты висят в очереди PgBouncer) не поднимет ни warning, ни critical: на панели будет 50-60 соединений при лимите 200 — «всё спокойно», пока 100+ пользователей получают 500 | Добавить экспортёр PgBouncer (`cl_waiting`, `sv_active`, `sv_idle`) или отдавать `SHOW POOLS` из PgBouncer admin-консоли в `/api/metrics`; сделать алерт по ожидающим клиентам, а не по соединениям Postgres
3 | важно | `src/lib/db.ts:98-107` | Соединению не заданы `statement_timeout` и `idle_in_transaction_session_timeout`, хотя драйвер их поддерживает (`node_modules/pg/lib/connection-parameters.js:121-123`). В проекте они выставляются только точечно (`scripts/cleanup-report-analytics-orphans.cjs:95`, `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts:31`) | Залипший запрос или незакрытая транзакция держит и клиентское, и серверное соединение пула неограниченно долго. В транзакционном пулинге это выключает из работы часть пула 40 — при 20 «залипаниях» приложение полностью теряет базу. Защита «10 с на транзакцию» (`src/lib/db.ts:55`) действует только на `$transaction`, одиночные запросы не покрыты | Добавить в объект `PrismaPg` те же ключи, что понимает драйвер: `statement_timeout: 15000`, `idle_in_transaction_session_timeout: 30000`, `query_timeout`
4 | важно | `docker-compose.yml:71-127` (app), `docker-compose.yml:164-206` (workers) | `PRISMA_POOL_TIMEOUT` и `PRISMA_CONNECTION_LIMIT` читаются кодом (`src/lib/db.ts:94-95`), но ни в один сервис не проброшены; `env_file` у сервисов не объявлен, значит значения из `.env` до контейнера не доезжают | Оба пула всегда равны дефолтам 10 с / 20 — согласовать их с `DEFAULT_POOL_SIZE` или с нагрузкой можно только правкой compose и пересборкой образа. Плюс сам факт исчерпания: очередь pg-pool ничем не ограничена (`node_modules/pg-pool/index.js` не содержит `maxWaitingClients`), каждый ждущий падает по 10-секундному таймауту сообщением `timeout exceeded when trying to connect` (`node_modules/pg-pool/index.js:224`) | Пробросить обе переменные в `app` и `workers`; задокументировать их рядом с `DATABASE_URL`
5 | важно | `src/core/observability/health-checks.ts:42` | Проверка базы `await db.$queryRaw\`SELECT 1\`` не имеет собственного таймаута, хотя соседняя проверка Redis обёрнута в `Promise.race` с 1500 мс (`src/core/observability/health-checks.ts:148-150`) | Если запрос встанет в очередь PgBouncer, `/api/health` повиснет (по дефолту очереди — до 120 с, ГИПОТЕЗА), docker healthcheck отвалится по своим 10 с (`docker-compose.yml:140-142`) и контейнер станет unhealthy; ошибки в теле не будет, только пустота/таймаут | Обернуть запрос в такой же `Promise.race` с явным таймаутом (например 2-3 с) и вернуть `fail`
6 | мелочь | `src/lib/db.ts:105` | `idleTimeoutMillis: 0` — приложение не закрывает простаивающие соединения к PgBouncer. У PgBouncer `server_idle_timeout` в compose не задан (`docker-compose.yml:243-266`) | Клиент держит соединение, серверное при этом может быть закрыто после дефолтных 600 с (ГИПОТЕЗА) — обрыв обнаруживается только в момент запроса; восстановление есть (драйвер снимает битый клиент по событию `error`: `node_modules/@prisma/adapter-pg/dist/index.js:813-817`), но каждый случай стоит лишнего коннекта и auth (scram) | Либо задать `server_idle_timeout`/`server_lifetime` явно и согласовать с клиентом, либо вернуть разумный `idleTimeoutMillis`
7 | мелочь | `src/lib/db.ts:94-95` | `parseInt(process.env.X || '…', 10)` без проверки: `PRISMA_POOL_TIMEOUT=abc` даёт `NaN`, `=20x` — молча 20 | Опечатка в переменной не диагностируется: пул получает `max: NaN`, поведение такого пула я не проверял (см. «Что не проверено»). В проекте уже есть строгий разбор — `positiveIntEnv` (`src/workers/unified-worker/env-int.ts:19`) | Использовать общий `positiveIntEnv`/`env-int` и там же
8 | мелочь | `src/lib/db.ts:56` и `src/lib/db.ts:100` | Два разных лимита ожидания соединения: `maxWait` 5 с (транзакции Prisma) и `connectionTimeoutMillis` 10 с (пул драйвера) | Диагностика путается: пользователь получает разные сообщения в зависимости от того, ждал он на уровне Prisma или pg-pool; при 5 с ожидания из 10 с общего бюджета транзакции остаётся 5 с на работу | Согласовать числа и оставить комментарий, какой из двух таймаутов где действует
9 | важно | `src/core/security/tenant-rls.ts:104-107` (обоснование — комментарий `:16-21`) | Каждая одиночная операция над моделью выполняется как транзакция из четырёх операторов: `BEGIN`, `set_config`, сам запрос, `COMMIT`. Стоимость замерена автором кода: 200 чтений — 405 мс против 139 мс | При транзакционном пулинге серверное соединение занято на всё это время, то есть пул 40 пропускает в ~3 раза меньше операций, чем мог бы. Именно это приближает исчерпание пула под нагрузкой 100+ пользователей | Не менять сейчас (файл из зоны безопасности), но учесть при выборе размера пула: расчёт «пул = число клиентов» должен быть с запасом ×3 по времени удержания
10 | мелочь | `docker-compose.yml:78` + `node_modules/@prisma/adapter-pg/dist/index.js:801-812` | Параметры `?pgbouncer=true&schema=public` из URL передаются в node-postgres как обычные ключи конфига (`node_modules/pg-connection-string/index.js:40-41`); среди распознаваемых драйвером ключей их нет (`node_modules/pg/lib/connection-parameters.js:83-124`) — на поведение они не влияют | Защита от prepared statements в транзакционном пулинге обеспечивается не флагом, а тем, что node-postgres не кэширует именованные prepared statements (ГИПОТЕЗА). Ожидание «флаг включён — значит безопасно» ошибочно: если драйвер когда-нибудь начнёт кэшировать statements, флаг этого не предотвратит | Проверить фактическое поведение на живом PgBouncer (`SHOW POOLS`/логи) и заменить флаг на явное утверждение в коде/тесте
11 | мелочь | `docker-compose.yml:46-47`, `prisma.config.ts:6` | `migrate` и все скрипты ходят напрямую в `postgres:5432` без ограничения размера пула (Prisma CLI берёт свой дефолт) | Мимо пула, во время деплоя при работающем приложении — единственный неконтролируемый потребитель соединений. При 200 лимитах риска почти нет, но при переходе на managed-Postgres с меньшим лимитом это первое, что упрётся | Явно ограничить параллелизм миграций/скриптов (`connection_limit` в `DATABASE_URL_POSTGRES`) или задокументировать, что это редкий путь
12 | мелочь | `docker-compose.yml:79` (app), `docker-compose.yml:169` (workers) | `DATABASE_URL_POSTGRES` остался в окружении рантайм-контейнеров, хотя рантайм его не читает: `src/lib/db.ts:84` предпочитает `DATABASE_URL`, читатели `DATABASE_URL_POSTGRES` — только скрипты (`scripts/apply-postgres-hardening.ts:32`, `scripts/reset-passwords.ts:8` и др.) | В контейнере приложения лежит вторая, не проходящая через пул дорога к базе под той же ролью. Сейчас безвредна, но любой запущенный внутри контейнера скрипт обойдёт пул незаметно | Убрать переменную из app/workers либо оставить с комментарием «только для скриптов обслуживания»
13 | мелочь | `src/workers/embedded-workers.ts:27`, `:44-52` | В процессе app по умолчанию поднимаются embedded-воркеры (outbox, projection) и делят пул 20 с обработкой HTTP-запросов | Фоновая работа конкурирует с пользователями за те же 20 соединений в одном процессе; лидерство через Redis (`src/core/infrastructure/leader-election.ts:7-8`) исключает дублирование работы, но не уменьшает конкуренцию за соединения | Учитывать это в расчёте пула (фон + API в одном процессе) либо выключить embedded-воркеры в проде, где есть отдельный контейнер workers
14 | мелочь | `docker-compose.yml:238`, `:243-266` | Образ `edoburu/pgbouncer:latest` (изменяемый тег) и не заданы `query_wait_timeout` / `server_idle_timeout` / `max_prepared_statements` | Дефолты пула задаёт образ: при обновлении тега поведение очереди может измениться без изменений в репозитории (ГИПОТЕЗА: сейчас действуют дефолты PgBouncer, обычно ожидание в очереди 120 с) | Пиновать версию образа и задать таймауты явно; тогда «поведение при исчерпании» станет предсказуемым
15 | мелочь | `docker-compose.observability.yml:121-125`, `docker-compose.monitoring-prod.yml:101-105` | `postgres-exporter` подключается к Postgres напрямую под суперпользователем — ещё один потребитель соединений вне пула | Влияние мало (1-2 соединения), но именно из-за его метрики строится вывод «соединений мало» (см. №2) | Перевести экспортёр на отдельную роль с минимальными правами и учесть его соединения в бюджете

## Не проверено

1. **Живое поведение PgBouncer не проверялось.** Ни одного запуска `docker compose`/`psql`: в этом окружении нельзя поднимать сервисы и подключаться к базе. Поэтому не проверены: фактическое значение `query_wait_timeout`, `server_idle_timeout`, `max_prepared_statements` (задаёт образ `edoburu/pgbouncer:latest`, `docker-compose.yml:238`), реальный размер очереди и текст ошибки, который увидит пользователь.
2. **Фактические значения пулов из `.env`/`.env.docker` не проверялись** — читать `.env*` запрещено правилами задания. Если в них заданы `PRISMA_CONNECTION_LIMIT`/`PRISMA_POOL_TIMEOUT`, до контейнеров они всё равно не доезжают: `env_file` не объявлен, а списки `environment` (`docker-compose.yml:71-127`, `:164-206`) их не содержат.
3. **Не проверено, что `?pgbouncer=true` действительно нерабочий флаг в проде** — вывод сделан по исходникам драйвера (`node_modules/pg-connection-string/index.js:40-41`, `node_modules/pg/lib/connection-parameters.js:83-124`), но не подтверждён наблюдением соединений на живом стенде (ГИПОТЕЗА, №10).
4. **Не измерялась реальная утилизация пула** (сколько из 40 серверных соединений занято в проде, сколько раз в сутки воркеры и API конкурировали). Без метрик пула (№2) это можно получить только с боевого сервера, куда доступа нет.
5. **Не проверено поведение pg-pool при `max: NaN`** (№7) — гипотеза о том, что пул молча берёт дефолт, не подтверждена экспериментом.
6. **Длинные транзакции фоновых обработчиков** (outbox/projection/PDF) детально не разбирались: их код лежит вне `src/workers/unified-worker/*` (файлы по 15-140 строк, делегируют в сервисы), и я не проследил, удерживают ли они соединение на время внешних вызовов (Telegram, рендер PDF). Это потенциально сильнее влияет на пул, чем всё, что найдено выше, — отдельная задача.
7. **`PRISMA_CONNECTION_LIMIT`/`PRISMA_POOL_TIMEOUT` в проде**: проверено только по коду и compose этого чекаута (ветка `hermes/q4-0926`, HEAD `33ff8084`); реально задеплоенный коммит может отличаться.
