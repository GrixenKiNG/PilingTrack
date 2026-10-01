# R87 — Журнал `AuditLog` «остановился» 28.09: расследование D-20260930-002

Только чтение. Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`. Ни один существующий файл
не изменён; создан только этот отчёт. Код приложения и воркеры не запускались. Боевой сервер и
боевая база не трогались. База локальная (`pilingtrack-postgres`, БД `pilingtrack_test`) — **только SELECT**.

## Итог

**Причина подтверждена и она НЕ в RLS и НЕ в «сломанной цепочке».** `AuditLog` — это таблица
**одного** потребителя: цепочки аудита контура техготовности. В неё не писал (и по коду не может
писать) ни один путь входов, сдачи отчётов и экранов оператора — они идут во **вторую, независимую
таблицу** `FeedbackEvent` (та же мысль, что в R72, и она подтверждается данными). Поэтому «журнал
неизменяемого аудита не пополняется, хотя были входы и сданные отчёты» — это не поломка записи, а
разрыв замысла: ADR-0043 п.1 объявляет `AuditLog` единственным источником аудит-API, а фактически
в `AuditLog` пишет только техготовность.

Отдельно найдена **вторая, новая причина**, объясняющая, почему цепочка молчала именно 29–30.09:
единственный автоматический писатель цепочки (планировщик техготовности) живёт в **отдельном
процессе `unified-worker`** (`npm run worker:all`), которого на стенде не было. Локальная БД это
показывает прямо: смена `3190cede…`, заведённая 28.09 20:09 UTC, была автозакрыта только
01.10 06:24 UTC — то есть планировщик не работал ~2,5 суток.

Итог по severity: **критично — 0, важно — 5, мелочь — 5** (всего 10).

Топ-5:

1. **важно** — `AuditLog` пишет **только** цепочка техготовности (`recordChainedReadinessAudit`),
   входы/отчёты/экран оператора идут в `FeedbackEvent`; ADR-0043 п.1 не выполнен, `/api/audit`
   читает ленту, а не журнал (`src/services/audit/audit-history-service.ts:101`). Это и есть ответ на
   D-20260930-002: дефект-детектор QA измеряет не тот журнал.
2. **важно** — три пути записи в цепочку передают событие **без `requestId`/`correlationId`**
   (`readiness-rules-service.ts:132,162,259`; `access-matrix-service.ts:135`; `bootstrap-query.ts:114` —
   есть `requestId`, нет `correlationId`), а БД-ограничение `AuditLog_native_chain_complete` требует
   их непустыми у любого звена с хэшем → `INSERT` отбивается, и **вся команда падает**. В БД нет ни
   одного звена с этими действиями (`draft_saved`/`published`/`acting_as_mechanic` — 0 с хэшем), а
   последние их строки датированы до перевода этих путей на цепочечный писатель (26.09). Юнит-тест
   это не ловит: Prisma замокана и ограничений БД не знает.
3. **важно** — единственный автоматический писатель цепочки — планировщик в `unified-worker`
   (`readiness-scheduler.ts`), а в процессе Next.js встроены только `outbox`/`projection`
   (`embedded-workers.ts:26`). Там, где запускают `npm run dev` без `npm run worker:all`, `AuditLog`
   не пополняется вообще ничем.
4. **важно** — автозакрытие берёт только `STARTED` (`scheduler.ts:64`); `HANDOVER_PENDING` намеренно
   не закрывается → в цепочку не попадает. На стенде 3 смены висят в `HANDOVER_PENDING` с 27.09.
5. **важно** — цепочка может «встать навсегда» при рассинхроне головы: если `TenantAuditChain.lastSequence`
   окажется ниже максимума `AuditLog.sequence`, каждая новая запись будет биться в `@@unique([tenantId, sequence])`
   (`P2002`) и команда будет падать при каждом повторе без самоизлечения. **Сейчас этого нет**: голова
   315 = максимум 315, разрывов в нумерации нет (проверено SELECT'ом).

## Методика

Всё на чтение; ни один файл кода не менялся. Что и как (воспроизводимо):

1. **Писатели `AuditLog`.** `search_files pattern='auditLog|AuditLog' path=src` → 13 файлов;
   `grep 'auditLog' src` → единственный нецепочечный `create` — `modules/readiness/infrastructure/audit/audit-repository.ts:45`;
   `grep 'recordChainedReadinessAudit' src` → 7 не-тестовых точек (все — контур готовности).
   Прочитаны целиком: `append-audit.ts`, `audit-repository.ts`, `record-audit.ts`, `tenant-transaction.ts`,
   `scheduler.ts`, `readiness-scheduler.ts`, `services/audit/audit-service.ts` (985 строк),
   `services/reports/audit-service.ts`, `services/feedback/feedback-event-service.ts`.
2. **Проверка «а писал ли кто-то ещё».** `grep 'recordAuditLog'` по всей истории: функция жила в
   `src/core/infrastructure/audit-log-service.ts` и была удалена коммитом `be261f79` (18.08.2026) —
   `git grep 'recordAuditLog' be261f79^ -- src` показал **ноль вызовов** уже до удаления. Значит,
   входы и отчёты в `AuditLog` не писали никогда.
3. **Ловушка R85 (глобальный `db` внутри `$transaction`).** Проверено, что все вызовы
   `recordChainedReadinessAudit` получают `tx` из `withReadinessTenantTransaction`/`withReadinessSerializableTransaction`
   (`tenant-transaction.ts:26-35,89-98` — до GUC `set_config('app.current_tenant', …, true)`), а
   `withReadinessCommand` транзакции не открывает (`_shared/route-adapter.ts:17-29`) — то есть
   `db.$transaction` внутри `saveReadinessDraft`/`saveAccessMatrixDraft` является внешней транзакцией
   и GUC в ней выставляется. RLS эту запись не ломает.
4. **RLS (только чтение миграций + каталога БД).** `20260819120000_rls_fail_closed_all/migration.sql:50-61,82`
   (AuditLog в списке 37 таблиц, политика `USING ("tenantId" = current_setting('app.current_tenant', true))`,
   ENABLE+FORCE); на живой локальной БД `pg_policies`/`pg_class` подтверждают `FORCE RLS` и `tenant_isolation_auditlog`.
5. **Ограничения таблицы.** `prisma/migrations/20260802110000_readiness_native_row_invariants/migration.sql:5-19`
   (`AuditLog_native_chain_complete`); на живой БД `pg_constraint` подтверждает текст и флаг `NOT VALID`.
6. **Git по файлам аудита с 24.09 по 29.09.** `git log --date=iso --since=2026-09-24 --until=2026-09-30`;
   `git log -- src/modules/readiness/infrastructure/audit/ tenant-transaction.ts` — инфраструктура
   цепочки не менялась с 18.08; `git log -S 'auditLog.create' --all` — единственная правка-переключатель
   `2af0de08` (26.09 22:08, перевод правил/матрицы на цепочечный писатель).
7. **Локальная БД (только SELECT).** Рабочая команда — `docker exec pilingtrack-postgres psql -U postgres -d pilingtrack_test -c "SELECT …"`
   (в задаче указано `-U piling`, но такой роли в контейнере нет: `\du` → `pilingtrack_app`, `pilingtrack_identity`, `postgres`).
   Запросы: максимум/минимум `sequence`, разрывы через `generate_series`/`lead()`, голова `TenantAuditChain`,
   последние строки по действиям, счётчики `FeedbackEvent` по дням, состояния `Shift`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/services/audit/audit-service.ts:953-984`; `src/services/reports/audit-service.ts:38-52,81-96`; `src/modules/readiness/infrastructure/audit/record-audit.ts:20-25`; `src/services/audit/audit-history-service.ts:101`; `docs/adr/0043-audit-hash-chain.md:13` | В `AuditLog` пишет **только** цепочка техготовности. `recordAuditEvent` (входы, отчёты, справочники, техника, ТО) пишет в `FeedbackEvent`; сдача отчёта кладёт ещё и `ReportAudit`. Ни ADR-0043 п.1 («`AuditLog` — единственный источник аудит-API»), ни экран «Аудит» техготовности событий входов/отчётов не получают | Ровно дефект D-20260930-002: за 29.09–01.10 в `FeedbackEvent` 68+59 входов и 9+8 сданных отчётов в сутки (SELECT), а в цепочке 0 звеньев по этим действиям — так и должно быть. QA будет «находить» этот дефект каждый день, пока детектор мерит `AuditLog`, а код пишет в ленту. И наоборот: экран «Аудит» техготовности не покажет ни одного действия остальных модулей | Решить архитектурно (владельцу): либо довести ADR п.1 до кода — писать цепочку на всех изменяющих путях (как это уже сделано для правил/матрицы), либо понизить ADR п.1 и зафиксировать в `docs/`, что аудит-API = `FeedbackEvent`. Детектор QA поправить под принятое решение |
| 2 | важно | `src/modules/readiness/application/readiness-rules-service.ts:132-140`, `:162-169`, `:259-271`; `src/modules/readiness/application/access-matrix-service.ts:135-153`; `src/modules/readiness/application/bootstrap-query.ts:114-130`; `prisma/migrations/20260802110000_readiness_native_row_invariants/migration.sql:5-19`; `prisma/schema.prisma:2587-2598` | Событие идёт в цепочечный писатель без `requestId` (правила, матрица) и без `correlationId` (все три пути), а CHECK `AuditLog_native_chain_complete` требует у звена с хэшем `requestId IS NOT NULL AND correlationId IS NOT NULL AND metadata IS NOT NULL`. `metadata` подставляется в `append-audit.ts:63`, два других — нет (`append-audit.ts:52-53` → `audit-repository.ts:63-64`). Итог: `INSERT` нарушает CHECK (23514), и **вся транзакция команды откатывается** | «Сохранить черновик правил», «опубликовать правила», «сохранить/опубликовать матрицу доступов» и включение замещения роли не просто не пишут след — они **не выполняются целиком** (внешне — 500/ошибка). В БД нет ни одного звена этих действий (`draft_saved` 30, `published` 8, `acting_as_mechanic` 506 строк — у всех `hash IS NULL`), последние датированы 07.09 и 20.09 — то есть до 26.09, когда пути перевели на цепочечный писатель. Юнит-тест молчит: `readiness-rules-service.test.ts:63-71` мокает `tx.auditLog.create` и ограничений Postgres не воспроизводит | Передавать в `recordChainedReadinessAudit` те же `requestId`/`correlationId`, что уже есть в контексте команды (`withReadinessCommand` их резолвит — `_shared/route-adapter.ts:17-27`); в `append-audit.ts` либо заполнять их фолбэком из `occurredAt`+тенанта, либо сделать `requestId`/`correlationId` обязательными в `AppendAuditInput` (`domain/audit/types.ts:21-22`), чтобы компилятор показал все забытые места. Обязательный тест, который бьётся о реальную БД (не мок) |
| 3 | важно | `src/workers/unified-worker/readiness-scheduler.ts:21-22,41-46`; `src/workers/unified-worker.ts:181`; `src/workers/embedded-workers.ts:26`; `package.json:52` | Единственный автоматический писатель цепочки — планировщик техготовности — запускается только процессом `npm run worker:all` (или systemd-юнитом воркера). В процессе Next.js встроены только `outbox` и `projection` (`DEFAULT_WORKERS`), планировщик readiness туда не входит | На стенде, где поднимают только `npm run dev`, `AuditLog` не пополняется **ничем автоматически**, а ручные команды готовности QA не вызывает. Данные это подтверждают: смена `3190cede…` заведена 28.09 20:09 UTC, автозакрыта 01.10 06:24 UTC (SELECT) — планировщик не работал 29 и 30.09. Это вторая половина причины «тишины» 29–30.09 | Ничего не ломать в коде: в QA-стенд добавить запуск воркера (или зафиксировать в инструкции, что `AuditLog` зависит от `worker:all`). Если цепочка должна пополняться и без воркера — это уже пункт 1 (писать её на прикладных путях) |
| 4 | важно | `src/modules/readiness/application/scheduler.ts:64` (`UNFINISHED_SHIFT_STATES = ['STARTED']`), пояснение `:54-62` | Автозакрытие намеренно не трогает `HANDOVER_PENDING` и `PLANNED` — это решение зафиксировано комментарием (иначе приёмка передачи становится невозможной навсегда). Следствие: сданные, но не принятые смены не дают звена в цепочке **никогда** | На локальной БД 3 смены висят в `HANDOVER_PENDING` с 27.09 и 1 в `PLANNED` с 30.08 (SELECT). Пока это не разобрано человеком, цепочка по этим сменам пуста; если разбор отложен на дни, `halt` цепочки выглядит как «аудит сломался» | Кода не менять (решение осознанное). Стоит добавить отдельное событие «смена ждёт приёмки N суток» (в ленту или цепочку) — чтобы «цепочка не растёт» имело читаемое объяснение на экране |
| 5 | важно | `src/modules/readiness/infrastructure/audit/append-audit.ts:29-31,72-73`; `src/modules/readiness/infrastructure/audit/audit-repository.ts:25-31,44-83`; `prisma/schema.prisma:2603,2616-2622` | Номер звена берётся из головы `TenantAuditChain` (`lastSequence + 1`) и вставляется под `@@unique([tenantId, sequence])`. Если голова окажется **ниже** фактического максимума `AuditLog.sequence` (ручное вмешательство, частичный откат, удалённая/пересозданная строка головы, импорт), каждая новая запись получит уже занятый номер → `P2002`, транзакция команды падает, голова не двигается → **повтор падает бесконечно**, самоизлечения нет | Инцидент класса «одна ошибка — и журнал встал навсегда, а вместе с ним перестают работать команды готовности». Сейчас не наблюдается: голова 315 = максимум 315, разрывов `sequence` нет (SELECT, `generate_series`) | При `P2002` по `[tenantId, sequence]` пересчитывать голову из `max(sequence)` той же транзакцией (`ensureChain` уже умеет upsert) либо отказаться от `sequence` из головы в пользу `max+1` под `FOR UPDATE`; добавить проверку «голова == максимум» в health/verify и алерт при расхождении |
| 6 | мелочь | `src/workers/unified-worker/readiness-scheduler.ts:41-46`, `:40` | Ошибка прохода планировщика ловится целиком: `logger.error` + Sentry, и на этом всё — повторов, DLQ и явного сигнала «цепочка не растёт» нет. Пульс (`recordSchedulerHeartbeat`) при падении не пишется вовсе | Отказ планировщика (RLS-ошибка, блокировка, недоступная БД) выглядит в данных ровно как «планировщика нет»: ни звеньев, ни пульса, ни алерта. Именно так 29–30.09 и прошло незамеченным | Считать «нет звеньев цепочки за N суток» отдельной проверкой (метрика/алерт), а не полагаться на глаз |
| 7 | мелочь | `src/services/audit/audit-service.ts:956-984` (`catch` на `:976-984`), `:944-950` (`resolveActor`) | Запись ленты `FeedbackEvent` и чтение имени актора глотают ошибку в `logger.warn` — намеренно (лента не должна ронять основное действие). При этом лента уже сейчас хранит на 546 строк меньше, чем могла бы: строки без хэша и старые записи не доходят до экрана «Аудит» (см. №8) | Если `FeedbackEvent` однажды начнёт падать (например, её тоже закроют RLS), потеря следа будет видна только в логах приложения, которых на стенде не читают | Оставить поведение, но добавить счётчик неудач записи ленты в метрики/`/api/health/deep` |
| 8 | мелочь | `src/modules/readiness/infrastructure/audit/audit-repository.ts:88` (`where: {tenantId, hash: {not: null}}`); `src/app/api/readiness/audit/route.ts:28-33` | Читатель цепочки отбирает только звенья с хэшем. «Старые» строки `AuditLog` без хэша (в локальной БД **546 из 872**) не видны ни на экране, ни в проверке цепочки — исторический аудит до ADR-0043 фактически недоступен через интерфейс | Вопрос «что было с этим объектом до августа» на экране не имеет ответа, хотя строки в базе есть | Либо бэкфилл/манифест легаси-строк (это и предполагает ADR-0043), либо явная вкладка/пометка «до ADR-0043, без хэша» — чтобы отсутствие не читалось как «ничего не было» |
| 9 | мелочь | `src/modules/readiness/infrastructure/audit/record-audit.ts:17-18` | Комментарий утверждает, что «общий `recordAuditLog` (нецепочечный, на голом `db.auditLog`) остался в core». Файла нет с 18.08.2026 (`be261f79`), вызовов не было и до удаления | Комментарий обещает существующий «общий» писатель аудита — читающий его сделает неверный вывод о том, куда пишутся события | Убрать/поправить абзац при следующей правке файла (сейчас — только зафиксировать в отчёте) |
| 10 | мелочь | `src/modules/readiness/infrastructure/audit/audit-repository.ts:44-45`; `src/core/security/tenant-rls.ts` (механика — R85); `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:82` | `AuditLog` под `FORCE ROW LEVEL SECURITY`; запись глобальным `db` внутри помеченной GUC-области ушла бы без `set_config` и упала бы «new row violates row-level security policy». Сегодня все вызовы цепочки передают `tx` (проверено по 7 точкам), то есть это мина, а не живой дефект | Любой новый вызов `recordChainedReadinessAudit(db, …)` или `db.auditLog.create` изнутри `$transaction` даст ровно эту ошибку — «одна правка останавливает всю команду готовности» | Типизировать параметр как `ReadinessTransaction` (уже так) и не добавлять публичных обёрток без `tx`; при появлении — запретить `db` на уровне типа |

### Что проверено и чисто (чтобы не возвращаться)

- **RLS не при чём**: политика `AuditLog` строгая (fail-closed, FORCE) — подтверждено миграцией и живым
  `pg_policies`; но все существующие писатели цепочки идут в тенантной транзакции с `set_config`, поэтому
  «INSERT без тенанта» в текущем коде не встречается. `FeedbackEvent`, наоборот, вне RLS (`relrowsecurity = f`),
  так что входы/отчёты пишутся без контекста и падать не могут.
- **Цепочка не сломана**: локальная БД — 315 звеньев, `sequence` 1…315 без разрывов и дублей, голова 315;
  хэш-цепочка валидна по нумерации.
- **Правок 25–28.09, «остановивших» запись, нет**: инфраструктура цепочки не менялась с 18.08;
  коммиты 25–28.09 (`F-R34-*`) меняли **ленту** (`services/audit/**`) и модули, но не писатель `AuditLog`.
- **Дефект QA «max sequence=314, timestamp 28.09 09:07»** — верен на момент проверки и не является
  свидетельством разрыва: следующее звено (315, `shift.auto-closed`) появилось только 01.10 06:24 UTC,
  уже после окончания прогона QA (03:42 UTC 01.10).
- Замороженные зоны (варианты экрана оператора, ORION) не разбирались; `src/modules/operator-mobile/**`
  прочитан только на предмет вызовов аудита — их там нет (подтверждает R72).

## Как проверить на бою (готовые SELECT, read-only)

Выполняет Claude на боевой базе. Ключевое: **не сравнивать «звенья цепочки» со «входами и отчётами»** —
это разные таблицы. Проверять надо (а) целостность цепочки и (б) то, что молчание цепочки объяснимо.

```sql
-- 1. Целостность цепочки и её крайние точки (ожидание: head == max_seq, gaps пусто).
SELECT
  (SELECT max(sequence) FROM "AuditLog" WHERE "tenantId"='orion' AND hash IS NOT NULL)      AS max_seq,
  (SELECT count(*)      FROM "AuditLog" WHERE "tenantId"='orion' AND hash IS NOT NULL)      AS chain_rows,
  (SELECT "lastSequence" FROM "TenantAuditChain" WHERE "tenantId"='orion')                  AS head_seq,
  (SELECT "updatedAt"    FROM "TenantAuditChain" WHERE "tenantId"='orion')                  AS head_updated;

-- 2. Есть ли разрывы нумерации (ожидание: 0 строк).
SELECT g AS missing_sequence
FROM generate_series(
  (SELECT min(sequence) FROM "AuditLog" WHERE "tenantId"='orion' AND hash IS NOT NULL),
  (SELECT max(sequence) FROM "AuditLog" WHERE "tenantId"='orion' AND hash IS NOT NULL)
) g
LEFT JOIN "AuditLog" a
  ON a.sequence = g AND a."tenantId"='orion' AND a.hash IS NOT NULL
WHERE a.id IS NULL;

-- 3. Хэш-цепочка: последние 5 звеньев (когда реально писал планировщик/готовность).
SELECT sequence, action, "entityType", "occurredAt", "recordedAt"
FROM "AuditLog" WHERE "tenantId"='orion' AND hash IS NOT NULL
ORDER BY sequence DESC LIMIT 5;

-- 4. Что писала ЛЕНТА за последние сутки (тот самый «входы и отчёты»).
SELECT action, count(*) FROM "FeedbackEvent"
WHERE "createdAt" >= now() - interval '1 day'
GROUP BY 1 ORDER BY 2 DESC;

-- 5. Проверка находки №2: есть ли ХОТЬ ОДНО звено с хэшем по этим действиям
--    (ожидание: 0 — значит «сохранить правила/матрицу/замещение» до БД не доходит).
SELECT action, count(*) FILTER (WHERE hash IS NOT NULL) AS with_hash, count(*) AS total
FROM "AuditLog" WHERE "tenantId"='orion'
  AND action IN ('draft_saved','published','acting_as_mechanic')
GROUP BY 1;

-- 6. Проверка «только техготовность»: состав действий цепочки за 30 дней.
SELECT action, count(*) FROM "AuditLog"
WHERE "tenantId"='orion' AND hash IS NOT NULL
  AND "occurredAt" >= now() - interval '30 days'
GROUP BY 1 ORDER BY 2 DESC;

-- 7. Запущен ли планировщик: heartbeat (инстанс состояния Redis, не кэш).
--    Проверять вне SQL: ключ пульса readiness-scheduler в getStateRedisClient().
```

Как читать: если в (1) `head == max_seq` и (2) пусто — цепочка цела, и «журнал не пополняется» означает
лишь отсутствие событий техготовности; тогда смотреть (6) и объяснять через (4). Если (5) непусто —
находка №2 на бою не подтверждается (значит, там пути прошли); если пусто при живом использовании экрана
правил/матрицы — подтверждается.

## Предлагаемое исправление (по шагам)

1. **Решить вопрос замысла (владелец + Claude).** Либо `AuditLog` становится общим аудитом (ADR-0043 п.1):
   тогда входы, вход-отказ, сдача/правка/удаление отчёта, действия оператора и экраны админа должны
   вызывать цепочечный писатель в своей транзакции. Либо ADR-0043 п.1 понижается, и `FeedbackEvent`
   официально признаётся аудит-лентой; тогда правится детектор QA, а не код.
2. **Починить три пути записи цепочки (находка №2) — это дефект независимо от решения (1):**
   передавать `requestId`/`correlationId` из контекста команды в `readiness-rules-service.ts:132,162,259`,
   `access-matrix-service.ts:135`, `bootstrap-query.ts:114`; сделать поля обязательными в `AppendAuditInput`
   (`domain/audit/types.ts:21-22`) либо подставлять фолбэк в `append-audit.ts`; покрыть интеграционным
   тестом против реальной БД (мок Prisma ограничение не воспроизводит).
3. **Защита цепочки от рассинхрона (находка №5):** при `P2002` по `[tenantId, sequence]` пересчитывать
   голову из `max(sequence)`; добавить в verify/health проверку «голова == максимум» и алерт.
4. **Наблюдаемость (находки №3, №6):** метрика/алерт «нет звеньев цепочки за N часов»; в инструкцию
   QA-стенда добавить запуск `npm run worker:all` (без него автозакрытие и цепочка мертвы) — либо
   принять это как штатное и не считать дефектом.
5. **Чистки (мелочи):** поправить устаревший комментарий `record-audit.ts:17-18`; для легаси-строк без
   хэша (546 в локальной БД) решить судьбу по ADR-0043 (бэкфилл/манифест) — иначе исторический аудит
   недоступен через интерфейс.

Порядок: (1) — решение, (2) — правка, (3)-(4) — защита и наблюдаемость, (5) — по остатку. Всё — отдельными
ветками `codex/*`, без правок в `main` и без касания схемы/миграций.

## Не проверено

1. **Боевая база и боевой сервер не проверялись** (запрет AGENTS.md). Все выводы о боевом состоянии —
   это перенос кода и локальных замеров; прогон SELECT'ов выше на бою за Claude.
2. **Находка №2 не воспроизведена в рантайме.** Утверждение «вставка отбивается CHECK-ограничением и
   команда падает» получено чтением кода + текста ограничения (`pg_constraint`) + отсутствием строк;
   я не запускал ни приложение, ни `saveReadinessDraft`, чтобы увидеть код ошибки 23514 живьём.
   Возможна альтернатива: этими экранами просто не пользовались после 26.09 — по данным различить нельзя.
3. **Приложение, воркеры, тесты, `tsc`, `lint`, `build` не запускались** — задача read-only.
   Счётчики пройденных/пропущенных тестов не собирались.
4. **`git merge-base` и содержимое `main` (коммит QA `53957b1f`) не сверялись** с этой веткой: QA-прогон
   шёл на другой сборке, поэтому «на бою» поведение может отличаться от разобранного здесь кода.
5. **Worker/планировщик 29–30.09**: не могу доказать, был ли `unified-worker` не запущен или падал —
   логи воркера недоступны (сервер не запускался). Данные (смена, просроченная к автозакрытию на 2,5 суток)
   говорят «не отработал», но «не запущен» vs «падал» — не различаю.
6. **`.env*` не читались** (запрет): неизвестно, какие переменные планировщика (`READINESS_SCHEDULER_*`),
   `DEFAULT_TENANT_ID` и воркера заданы на стенде и на бою.
7. **`docs/audits/hermes-night/R85-global-db-inside-tx.md` взят как описание механики GUC**; сама
   `src/core/security/**` (security-critical) мной не открывалась, поведение помеченной области взято
   из R85 и из чтения `tenant-transaction.ts`.
8. **Замороженные зоны** (`src/app/operator/**`, `src/app/(app)/operator/**`,
   `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) не разбирались;
   `operator-mobile` проверен только на вызовы аудита.
