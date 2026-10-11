# AU219-S4-PRISMA-QUERY-TIMEOUTS — Таймауты запросов к базе

Версия аудита: `git rev-parse HEAD` = **a53b6149bf51c485f99444374e6bff232fe7c386** (ветка `hermes/q4-0926`).
Только чтение: код приложения не менялся. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не использовались как источник.

## Итог

- **Всего находок: 15.** По важности: **критично — 0, важно — 8, мелочь — 7.** Статусы: ПРОЙДЕНО — 9, ГИПОТЕЗА — 3, НЕ ПРОВЕРЕНО — 3 (число статусов пересекается с числом находок, у части находок статус смешанный — см. колонку).
- Таймаут транзакции и запроса задаётся в одном месте — `src/lib/db.ts:54-58` (`DEFAULT_TX_OPTIONS`: `timeout: 10000`, `maxWait: 5000`). Но применяется он лишь в **7** вызовах из **45** (без тестов) — остальные идут с дефолтами движка Prisma (`maxWait 2000`, `timeout 5000`).
- Таймаута на отдельный (нетранзакционный) SQL-запрос **нет нигде**: ни на пуле `pg` (`src/lib/db.ts:98-107`), ни в Postgres/compose, ни в pgbouncer. Запрос может висеть неограниченно.
- **Самый важный вывод:** зависший запрос в outbox-воркере не обрывается ни по какому таймауту и навсегда закрывает публикацию событий: защита от повторного входа (`running`) снимается только в `finally`, процесс не падает, а heartbeat продолжает рапортовать «running» — health зелёный, а отчёты в Telegram не уходят. Молчаливый отказ (находка №1).
- Повторы на сериализации есть только в одном месте — readiness (`src/modules/readiness/infrastructure/tenant-transaction.ts:80-118`), без задержки/джиттера, и не ловят таймаут пула/транзакции (`P2024`/`P2028`).
- Ошибки таймаута (`P2024`/`P2028`) не смапплены — `src/core/api-wrapper.ts:26-29` знает только `P2025`/`P2002`, поэтому таймаут отдаёт пользователю 500 «Внутренняя ошибка сервера» + событие в Sentry без `Retry-After`.

## Методика

Поиск по коду и конфигу (только разрешённые области; без `docs/audits/`, `CODEX-REPORT*`, `docs/strategy`):

```bash
git rev-parse HEAD
grep -rn '\$transaction(' src --include='*.ts' | grep -v '__tests__'          # все транзакции
grep -rn 'DEFAULT_TX_OPTIONS' src --include='*.ts' | grep -v '__tests__'      # где применены дефолты
grep -rn '{ *timeout: *[0-9_]* *}' src --include='*.ts'                       # таймауты-константы
grep -rn 'statement_timeout|lock_timeout|idle_in_transaction_session_timeout|pgbouncer' .
grep -rn 'P2024|P2028|P2034|40001|serializ' src
```

Читались (полностью или диапазоном): `src/lib/db.ts`, `src/core/security/tenant-rls.ts`, `src/core/security/identity-role.ts`, `src/core/security/tenant-enforcement.ts`, `src/modules/readiness/infrastructure/tenant-transaction.ts`, `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts`, `src/core/outbox/dead-letter-queue.ts`, `src/services/telemetry/telemetry-buffer.ts`, `src/services/reports/outbox-publisher.ts`, `src/modules/reports/application/projections/rebuild.ts`, `src/core/api-wrapper.ts`, `docker-compose.yml`, `docker-compose.prod.yml`, `src/generated/postgres-client/runtime/client.d.ts` (тип и дефолты), `node_modules/@prisma/adapter-pg/dist/index.d.ts`, `node_modules/pg/lib/{client,connection-parameters,defaults}.js`, `node_modules/pg-pool/index.js`.
Версии: `@prisma/client` 7.10.0, `prisma` 7.10.0, `@prisma/adapter-pg` ^7.8.0, `pg` (в составе адаптера), Next 16.3.6.

## Находки

Легенда важности: **важно** / **мелочь**. Столбец «статус»: ПРОЙДЕНО — проверено по коду/типам; ГИПОТЕЗА — вывод из кода без запуска; НЕ ПРОВЕРЕНО — указано, чего не хватило.

| # | важн. | место | файл:строка | таймаут | риск / сценарий | предлагаемое | статус |
|---|---|---|---|---|---|---|---|
| 1 | важно | Outbox-воркер, обход таблицы событий | `src/services/reports/outbox-publisher.ts:94` (запрос) и `:276-293` (guard `running`) | нет | `findMany`/обработчик события без таймаута. Если запрос виснет (блокировка строки, залипший сервер пула), `running=true` снимается только в `finally`, а `finally` не наступает. Публикация outbox останавливается навсегда до рестарта процесса; `recordWorkerHeartbeat` продолжает рапортовать «outbox running» → тихий отказ (события копятся, уведомления не уходят). Единственный «таймаут» рядом — транзакция доставки в Telegram (60 с, `src/services/reports/event-handlers.ts:670`), но она не покрывает сам `findMany`. | Watchdog/`AbortSignal.timeout` на проход и на `findMany`; отдельный heartbeat «последний успешный проход» | ПРОЙДЕНО |
| 2 | важно | Где заданы дефолты транзакции | `src/lib/db.ts:54-58` vs `src/generated/postgres-client/runtime/client.d.ts:2040-2045` | `DEFAULT_TX_OPTIONS`: timeout 10 с, maxWait 5 с; дефолт движка Prisma: timeout **5 с**, maxWait **2 с** | `DEFAULT_TX_OPTIONS` применяется только в **7** вызовах (`grep 'DEFAULT_TX_OPTIONS)'`): `db.ts:219`, `app/api/reports/delete/route.ts:139`, `crews/infrastructure/crew.repository.ts:69`, `reports/infrastructure/report.repository.ts:270`, `reports/application/commands/report-command.service.ts:329`, `readiness/infrastructure/tenant-transaction.ts:35,98`. Все остальные `$transaction` идут с дефолтами 5 с/2 с. Заявленные «10 с» де-факто отсутствуют на большинстве путей: длинная отчётная транзакция молча обрывается на 5 с → `P2028` → 500. | Задать дефолты один раз на клиенте (см. №3) или прокидывать `DEFAULT_TX_OPTIONS` везде | ПРОЙДЕНО |
| 3 | важно | Конструктор PrismaClient | `src/lib/db.ts:109-113` (нет `transactionOptions`), поддержка — `client.d.ts:2045` | дефолт клиента не задан | Prisma 7 умеет хранить дефолты транзакции на уровне клиента (`transactionOptions?`), но здесь переданы только `log`, `errorFormat`, `adapter`. Любой новый `db.$transaction(...)` автоматически получает 5 с/2 с. | Добавить `transactionOptions: { maxWait, timeout }` в конструктор, чтобы дефолт был единым и явным | ПРОЙДЕНО |
| 4 | важно | Согласование maxWait и таймаута пула | `src/lib/db.ts:94,100` (пул: 10 с) и `src/lib/db.ts:56` (maxWait 5 с), дефолт движка 2 с | пул 10 с, транзакция 2-5 с | Комментарий `db.ts:56` «5s max wait for connection from pool» неверен: клиент `pg` ждёт соединение из пула `connectionTimeoutMillis` = `PRISMA_POOL_TIMEOUT*1000` = **10 с** (`node_modules/pg-pool/index.js:250-262`). Интерактивная транзакция со своим maxWait (2-5 с) падает `P2024` раньше, чем сработает собственный таймаут пула. Два разных «нет соединения» с разным поведением. | Согласовать: maxWait ≥ connectionTimeoutMillis, либо явно объяснить разницу | ПРОЙДЕНО (числа из кода; поведение P2024 при исчерпании пула — ГИПОТЕЗА, не воспроизводилось) |
| 5 | важно | Таймаут отдельного SQL-запроса | `src/lib/db.ts:98-107` (конфиг пула) | нет (statement/query timeout не заданы) | В конфиг пула переданы только `connectionTimeoutMillis`, `max`, `idleTimeoutMillis`, `keepAlive`. `pg` поддерживает `statement_timeout` и `query_timeout` (`node_modules/pg/lib/connection-parameters.js:121,124`), но их дефолт — `false` = выключено (`node_modules/pg/lib/defaults.js:65,76`). У нетранзакционного запроса верхней границы нет вообще: `SELECT ... FOR UPDATE`/advisory-lock в ожидании держит соединение сколько угодно. | Задать `statement_timeout`/`query_timeout` в пуле (и `idle_in_transaction_session_timeout`) | ПРОЙДЕНО |
| 6 | важно | Postgres и pgbouncer в compose | `docker-compose.yml:363-371`, `docker-compose.prod.yml:91-103`, pgbouncer `docker-compose.yml:237-266` | statement/lock/idle_in_transaction не заданы | Ни у `postgres` (dev и prod), ни у `pgbouncer` не выставлены `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `query_wait_timeout`, `server_reset_query_always`. Серверный предохранитель против зависшего запроса отсутствует; в режиме транзакционного пулинга залипшая транзакция занимает серверный слот пула. | Явно задать серверные таймауты (Postgres `-c statement_timeout`, pgbouncer `query_wait_timeout`) | ПРОЙДЕНО (отсутствие параметров); значение дефолта pgbouncer `query_wait_timeout` ~120 с — ГИПОТЕЗА, рабочую конфигурацию контейнера не читал |
| 7 | важно | Логин/опознание | `src/core/security/identity-role.ts:61` | нет options → дефолт 5 с/2 с | Транзакция переключения роли на входе (`SET LOCAL ROLE` + поиск по email/ПИН/ключу) идёт с дефолтом 5 с. При всплеске входа и загруженном пуле `maxWait` 2 с даёт `P2024` → 500 на входе вместо понятной ошибки. Критичный путь. | `DEFAULT_TX_OPTIONS` (или клиентские дефолты из №3) на транзакции идентификации | ПРОЙДЕНО |
| 8 | важно | Маппинг ошибок таймаута в HTTP | `src/core/api-wrapper.ts:26-29` и `:119-133` | — | `PRISMA_STATUS` знает только `P2025`/`P2002`. `P2024` (таймаут получения соединения из пула) и `P2028` (транзакция истекла/закрыта) уходят в ветку `else` → 500 «Внутренняя ошибка сервера» + Sentry, без `Retry-After`, хотя это временные состояния. | Добавить `P2024`/`P2028` → 503/429 с `Retry-After`, отдельный русский текст | ПРОЙДЕНО (список кодов); точный текст ошибки движка для P2024/P2028 на этом рантайме — НЕ ПРОВЕРЕНО (запросов к БД не выполнялось) |
| 9 | мелочь | Повтор на сериализации | `src/modules/readiness/infrastructure/tenant-transaction.ts:48-51,74-118` | 3 попытки, задержки нет | Повторы только для readiness. Распознаются `40001`/`40P01` (в т.ч. через `meta.driverAdapterError.cause.originalCode`) и `P2034` — это корректно. Но: (а) повтор мгновенный, без backoff/джиттера, — при конкуренции три попытки бьют подряд; (б) не ловятся `P2028`/`P2024`, поэтому таймаут под нагрузкой отдаёт 500, а не 409 «Одновременное изменение». | Добавить небольшую задержку/джиттер; решать, считать ли таймаут конфликтом | ПРОЙДЕНО (код); эффект без БД — ГИПОТЕЗА |
| 10 | мелочь | Блокировки как «таймаут» | `src/modules/settings/application/settings-service.ts:99`, `src/services/users/user-service.ts:272` | только timeout транзакции (дефолт 5 с) | Advisory-локи берутся в транзакции без явного `lock_timeout`; единственная граница ожидания лока — таймаут всей транзакции. Единственное место с явным `lock_timeout` — `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts:31` (`SET LOCAL lock_timeout = '1000ms'`). | Там, где лок берётся ради сериализации доступа, задавать `lock_timeout`, а не полагаться на общий таймаут | ПРОЙДЕНО |
| 11 | мелочь | Пакетная вставка телеметрии | `src/services/telemetry/telemetry-buffer.ts:145` | нет options → дефолт | Массив `$transaction([...create])` без опций; при таймауте весь батч откатится, записи восстановлены для повтора (`:154-159`). Обработка отказа есть, но зависит от дефолта движка. | Применять общие дефолты клиента | ПРОЙДЕНО |
| 12 | мелочь | Пересборка проекций | `src/modules/reports/application/projections/rebuild.ts:80,164` | нет options → дефолт 5 с | `deleteMany` + `createMany` в одной транзакции; у крупной организации набор строк может не уложиться в 5 с → `P2028`, пересборка падает (откат сохраняет целостность, но проекция не обновляется). Admin-путь `/api/admin/projections/rebuild`. | Явный увеличенный `timeout` для пересборки | ПРОЙДЕНО |
| 13 | мелочь | Пул: суммарный размер против pgbouncer | `src/lib/db.ts:95` (max 20) vs `docker-compose.yml:256-260` (`DEFAULT_POOL_SIZE=40`) | — | `PRISMA_CONNECTION_LIMIT`/`PRISMA_POOL_TIMEOUT` не проброшены в сервисы — берутся дефолты 20 и 10 с. Суммарно up to 3×20=60 клиентов против серверного пула 40: очередь и `P2024` при пике. Это тюнинг пула, а не таймаут, но именно он превращает таймауты в реальность. | Пробросить лимиты и согласовать с `DEFAULT_POOL_SIZE` | ПРОЙДЕНО |
| 14 | мелочь | Разбор env без проверки | `src/lib/db.ts:94-95` | — | `parseInt(process.env.X || '10'/'20', 10)`: значение `=abc` даёт `NaN` в `max`/`connectionTimeoutMillis`. Диагностики опечатки нет. | Использовать строгий разбор (`positiveIntEnv`/`env-int`) | ПРОЙДЕНО |
| 15 | мелочь | Поведение пула при `$transaction([...])` | `src/core/security/tenant-rls.ts:104,207` (пакет `[set_config, query]`) | нет options | Каждая операция над моделью/сырой запрос через прокси GUC оборачивается в пакетную транзакцию `$transaction([...])` без опций. Тип принимает `maxWait`/`timeout` (`client.d.ts:638-642`), но применяет ли движок эти таймауты к массивной форме — не проверено. Если да, одиночное чтение получает скрытый потолок 5 с. | Уточнить поведение пакетной формы; при необходимости задать опции | НЕ ПРОВЕРЕНО |

## Что не проверено

1. **Живая БД не поднималась и запросы к ней не выполнялись.** Все выводы о кодах ошибок (`P2024`, `P2028`, `P2034`, `40001`) — по коду и типам, не по воспроизведению.
2. **Применяются ли `timeout`/`maxWait` к массивной форме `$transaction([...])`.** Тип их допускает (`src/generated/postgres-client/runtime/client.d.ts:638-642`), но подтверждения поведения движка нет (находка №15).
3. **Дефолты pgbouncer** (`query_wait_timeout`, `server_reset_query_always`, `server_idle_timeout`): в compose не заданы (`docker-compose.yml:237-266`), а фактические значения из образа `edoburu/pgbouncer:latest` не читались — число «~120 с» взято из документации и помечено ГИПОТЕЗОЙ (находка №6).
4. **Файлы `.env*` не читались** (правило AGENTS.md). Реально задеплоенные значения `PRISMA_CONNECTION_LIMIT`/`PRISMA_POOL_TIMEOUT`/`DATABASE_URL` могут отличаться; по коду и compose они в контейнер не пробрасываются.
5. **Реально задеплоенный коммит** может отличаться от `a53b6149` этого чекаута.
6. **Postgres-сервер вне docker-compose** (managed/RDS) не проверялся — там свои `statement_timeout` по умолчанию.
7. **Поведение при зависании на уровне ОС/сети** (обрыв TCP, залипший сокет) не моделировалось.
8. Версии `pg`/`pg-pool` определены по составу адаптера, точные версии из дерева не снимались.

## Приложение: прочие места, задающие/не задающие таймаут (`path:line`)

Комментарий-упоминание транзакции (не вызов): `src/services/reports/outbox-publisher.ts:45`.
Вызовы `$transaction` без опций (дефолт Prisma 5 с/2 с), полный список:
`src/modules/sites/infrastructure/site.repository.ts:20`,
`src/services/users/user-service.ts:303`,
`src/modules/equipment/infrastructure/equipment.repository.ts:23`,
`src/core/security/tenant-enforcement.ts:42`,
`src/core/security/identity-role.ts:61`,
`src/modules/sites/application/commands/site-admin-command.service.ts:93,177,446,463,476`,
`src/core/outbox/dead-letter-queue.ts:115`,
`src/modules/settings/application/settings-service.ts:98`,
`src/modules/inspections/application/commands/template-commands.ts:72`,
`src/modules/inspections/application/commands/inspection-commands.ts:147,285,380`,
`src/modules/equipment/application/commands/equipment-maintenance.ts:73,246,299,345`,
`src/modules/equipment/application/commands/equipment-command.service.ts:23,60`,
`src/modules/equipment/application/commands/pm-scheduler.ts:106`,
`src/modules/equipment/application/commands/meter-reading.ts:262,279`,
`src/modules/reports/application/projections/rebuild.ts:80,164`,
`src/modules/readiness/application/readiness-rules-service.ts:100,219`,
`src/modules/readiness/application/access-matrix-service.ts:163,200`,
`src/services/telemetry/telemetry-buffer.ts:145` (пакетная форма).
Счёт из команд: 45 вызовов `$transaction(` в нетest-коде вне модуля `tenant-rls`; с опциями — 9 (7 × `DEFAULT_TX_OPTIONS` + 2 × `{timeout: 60_000}`); без опций — 36 (из них один — комментарий).
