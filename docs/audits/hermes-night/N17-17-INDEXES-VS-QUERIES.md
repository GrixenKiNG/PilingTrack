# N17-17 — Индексы против запросов: 9 таблиц (WorkPermit, BriefingRecord, FeedbackEventRead, ReportDowntime, PileWork, Inspection, MaintenanceRecord, OutboxEvent, DeadLetterQueue)

- Дата: 2026-10-17
- Тип: read-only аудит (код и схема; база не запускалась, запросы не выполнялись)
- HEAD на момент аудита: `38032a92a2f278eed58ae9d233c4cadee59b4afc`, ветка `hermes/code-1011`
- Единственный изменённый файл: этот отчёт

## Итог

- Найдено 16 замечаний: **критично — 0, важно — 10, мелочь — 6**. Причина отсутствия «критично»: расхождения индексов здесь — производительность и рост, а не корректность или утечка данных между тенантами. Ни один из путей чтения не теряет `tenantId`, RLS включён и форсирован на всех 9 таблицах, кроме `OutboxEvent` (ему RLS и не нужен — см. ниже).
- Топ-5 важного: (1) `MaintenanceRecord` — нет ни одного составного индекса и нет `(tenantId, createdAt)`, а строки копятся по одной на каждый ЕО/ТО установки в смену; (2) `WorkPermit` — нет `(tenantId, updatedAt)`, дефолтный список без фильтров сортирует все наряды тенанта; (3) `PileWork` — журнал сортируется `occurredAt DESC NULLS LAST`, что не ложится на существующий `ASC NULLS LAST` индекс; (4) `Inspection` — нет `(tenantId, inspectionDate)`, список осмотров сортирует всю таблицу; (5) `OutboxEvent.publishedAt` не индексирован, а таблица outbox никогда не чистится, при этом её `count()` дёргается каждым health-запросом.
- Ничего редундантного, что ломало бы работу, не найдено. 7 одноколоночных индексов `[tenantId]` дублируются tenant-first композитами (замечание №15) — это лишние записи при вставке/удалении, но не ошибка.
- Расхождения имён индексов «схема ↔ миграции» — **не** расхождение: имена согласованы переименованиями (`20260913130100_align_constraint_names`, `20260924120200_rename_user_equipment_permit_unique`, `20260710190000_module_layout_template`). Проверено списком.
- Ни один вывод ниже не требует изменения кода в замороженных зонах. Наоборот: часть запросов, создающих нагрузку, живёт в `src/modules/operator-mobile/**` — правится индексом, а не этим модулем.

## Методика

1. `prisma/schema.prisma` — выписаны все `@@index`/`@@unique` для 9 целевых моделей (строки: MaintenanceRecord 580–617, BriefingRecord 293–355, WorkPermit 1448–1527, Inspection 1566–1597, PileWork 2184–2225, ReportDowntime 2404–2445, FeedbackEventRead 2564–2579, OutboxEvent 2070–2100, DeadLetterQueue 2835–2858, плюс Report 1939–1999 и Site 1785–1788 для сверки префиксов).
2. `prisma/migrations/**/migration.sql` — выписаны все индексы, заведённые SQL-ом (частичные, `CREATE INDEX CONCURRENTLY`), плюс RLS (`ENABLE`/`FORCE`/`DISABLE`). Проверены 8 частичных индексов и 2 `CREATE INDEX CONCURRENTLY`.
3. По коду найдены фактические запросы к каждой таблице: `where`, `orderBy`, `take`, включая `$queryRaw`-агрегаты и `groupBy`. Для каждой находки указан реально открытый файл и строка.
4. Ключевое ограничение: **запросы не выполнялись и `EXPLAIN` не снимался** — база не запускалась. Поэтому всё, что зависит от выбора плана планировщиком, помечено `ГИПОТЕЗА`, а не подано как факт.

Статусы в таблице находок:
- `ПРОЙДЕНО` — проверено, проблемы нет (оставлено как зафиксированный результат).
- `ГИПОТЕЗА` — вывод из структуры индекса и запроса; для подтверждения нужен `EXPLAIN (ANALYZE)` на реальных данных.
- `НЕ ПРОВЕРЕНО` — не смог оценить без доступа к базе.

## Находки

| # | severity | статус | path:line | проблема | сценарий | исправление |
|---|----------|--------|-----------|----------|----------|-------------|
| 1 | важно | ПРОЙДЕНО | `src/modules/equipment/application/queries/equipment-query.service.ts:336` | `getFleetKpiData`: `where { tenantId, createdAt: { gte, lte } }` — ни одного индекса с `createdAt`. У `MaintenanceRecord` все индексы одноколоночные (`schema.prisma:611–616`): `[tenantId]`, `[equipmentId]`, `[status]`, `[scheduledAt]`, `[assigneeId]`, `[priority]` | KPI парка за период: читает все наряды тенанта за окно; при росте строк — скан по `[tenantId]` с фильтром | Добавить `@@index([tenantId, createdAt])` |
| 2 | важно | ПРОЙДЕНО | `src/modules/equipment/application/queries/equipment-query.service.ts:462` | `listAllMaintenance`: `where { tenantId, status?, priority?, assigneeId?, type? }`, `orderBy [{priority desc},{scheduledAt asc},{createdAt desc}]`, `take` 500 (`:13`, `:492–493`) — составного индекса нет | Экран «Список нарядов ТО» (кросс-парковый): сортировка до 500 строк по всей выборке тенанта | `@@index([tenantId, priority, scheduledAt, createdAt])` либо курсорная пагинация |
| 3 | важно | ПРОЙДЕНО | `src/modules/equipment/application/queries/equipment-query.service.ts:226` | `listMaintenance`: `where { equipmentId, tenantId }`, `orderBy [{status asc},{scheduledAt desc},{createdAt desc}]` — покрывающего индекса нет | Журнал ТО одной установки: сортировка независимо от `[equipmentId]` | `@@index([tenantId, equipmentId, status, scheduledAt])` |
| 4 | важно | ПРОЙДЕНО | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:159` | `list`: `orderBy [{updatedAt desc},{id desc}]`; при пустых фильтрах `where = { tenantId }`. Индексы `WorkPermit` (`schema.prisma:1521–1526`): `[tenantId,equipmentId,state,validTo]`, `[tenantId,state,updatedAt]`, `[tenantId,risk,updatedAt]`, `[tenantId,shiftId]`, `[tenantId,workTypeId]` — `[tenantId,updatedAt]` нет; индекс со `state` не применим без равенства по `state` | GET `/api/readiness/work-permits` без фильтров (`src/app/api/readiness/work-permits/route.ts:53`) — сортировка всех нарядов тенанта + `count` (`:161`) | Добавить `@@index([tenantId, updatedAt])` |
| 5 | важно | ГИПОТЕЗА | `src/modules/reports/application/queries/pile-journal-list.ts:71` | `orderBy [{ occurredAt: {sort:'desc', nulls:'last'} }, { receivedAt: 'desc' }]`. Существующий `PileWork_tenantId_occurredAt_idx` построен по умолчанию как `ASC NULLS LAST`; обратный проход даёт `DESC NULLS FIRST`, а не `DESC NULLS LAST` → индекс для сортировки не подходит | Первая страница журнала забивки (самое тяжёлое чтение): явная сортировка выборки тенанта | Либо индекс `(tenantId, occurredAt DESC NULLS LAST)`, либо переписать сортировку под существующий индекс; подтвердить `EXPLAIN ANALYZE` |
| 6 | важно | ГИПОТЕЗА | `src/modules/reports/application/queries/pile-journal-totals.ts:77` | Сырой агрегат: `p."pileNumber" ILIKE ${pileLike} ESCAPE '\'` (шаблон с ведущим `%`) + OR-ветка по `occurredAt`/`receivedAt` (`:78–85`). B-tree индекс по `pileNumber` при ведущем `%` не работает | Итоги и титул XLSX журнала при заданном номере сваи: скан `PileWork`⋈`PilePassport` | Принять как ожидаемое; при необходимости — trigram (`pg_trgm`) или фильтр по диапазону без ведущего `%` |
| 7 | важно | ПРОЙДЕНО | `src/modules/inspections/application/queries/inspection-query.service.ts:20` | `listInspections`: `orderBy { inspectionDate: 'desc' }, take 200`, `where { tenantId, … }`. Индексы `Inspection` (`schema.prisma:1593–1596`): `[tenantId]`, `[tenantId,equipmentId]`, `[tenantId,status]`, unique `[tenantId,shiftId,phase]` — `(tenantId, inspectionDate)` нет | Экран осмотров: сортировка до 200 строк по всей таблице тенанта | `@@index([tenantId, inspectionDate])` |
| 8 | важно | ПРОЙДЕНО | `src/core/observability/lag-monitor.ts:212` | `getPublishRate`: `where { published: true, publishedAt: { gte } }`. Индексы `OutboxEvent` (`schema.prisma:2094–2099`) не содержат `publishedAt`; подойдёт только `[published, createdAt]` с фильтром `publishedAt` после | Rate публикации пересчитывается периодически (воркеры — раз в 60 с). `published = true` накапливается неограниченно | `@@index([published, publishedAt])` или перейти на `[published, createdAt]`, если `createdAt ≈ publishedAt` приемлемо |
| 9 | важно | ПРОЙДЕНО | `src/services/reports/outbox-publisher.ts:325` | `getOutboxStats`: `db.outboxEvent.count()` без условия. Outbox не чистится нигде (поиск по репозиторию: prune-скрипта нет), таблица растёт вечно | Агрегатный health-запрос дёргает полный `count()` по растущей таблице | Ввести политику очистки (например, `published AND projected AND createdAt < now()-N`) или оценивать счётчик по метрике, а не `count()` |
| 10 | важно | ПРОЙДЕНО | `src/modules/analytics/application/queries/site-analytics-service.ts:122` | Подзапрос по `PileWork`: `JOIN Report r ON pw.reportId = r.id ... WHERE r.status = SUBMITTED` без фильтра по периоду (даты только в `FILTER` на `:125–126`, «all»-столбцы `:127–128` — по всей истории) | Дашборд аналитики объектов: агрегирует всю историю выработки тенанта при каждой загрузке | Добавить `r.date BETWEEN …` в `WHERE` подзапроса (если «всего» должно быть за всё время — вынести отдельно/кэшировать) |
| 11 | мелочь | ПРОЙДЕНО | `src/modules/operator-mobile/application/briefing-journal-query.ts:106` | Фильтры журнала инструктажей по `kind` и `instructorId` (`:106`, `:108`). Индексы `BriefingRecord` (`schema.prisma:350–354`): `[tenantId,recordedAt]`, `[tenantId,userId,recordedAt]`, `[tenantId,type,recordedAt]` — по `kind`/`instructorId` нет | Журнал инструктажей с фильтром по виду/инструктору: `[tenantId,recordedAt]` + фильтр после | Не критично; при необходимости `@@index([tenantId, kind, recordedAt])`. Модуль заморожен — только индекс |
| 12 | мелочь | ПРОЙДЕНО | `src/modules/safety/application/clearance-overview-query.ts:205` | `where { tenantId, kind:'INSTRUCTION', userId: { in: userIds } }, orderBy recordedAt desc`. `[tenantId,userId,recordedAt]` помогает при равенстве `userId`, но не при `IN ({in})` большого списка | Сводка допусков: чтение истории ознакомлений по списку людей | Оставить; оценить `EXPLAIN` на реальном размере `userIds` |
| 13 | мелочь | ПРОЙДЕНО | `src/services/feedback/feedback-event-service.ts:220` | `FeedbackEventRead` пишется только `upsert` по unique `[eventId,userId]` (и `:261`). Индексы `[userId,readAt]`, `[userId,acknowledgedAt]` (`schema.prisma:2577–2578`) запросами приложения не используются | Чтение/подтверждение события: идёт по unique | **Не удалять:** префикс `userId` используется политикой RLS (`prisma/migrations/20261014090000_feedback_event_read_rls/migration.sql:7–12`) |
| 14 | мелочь | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:553` | `count` фильтрует `aggregateId` + `type` (`:555–556`). Индекс — `[aggregateId, aggregateType]`; второй столбец `aggregateType`, а не `type` | Дедупликация `ReportSubmitted` в батче outbox: по индексу идёт только `aggregateId`, `type`/`published` — после | `@@index([aggregateId, type])` при необходимости |
| 15 | мелочь | ПРОЙДЕНО | `prisma/schema.prisma:1593` (и см. список) | 7 одноколоночных `[tenantId]` дублируются tenant-first композитами: `User:145` (`[tenantId,role,isActive]`), `ChecklistTemplate:869` (`[tenantId,level]`), `ReadinessRuleSet:945` (`[tenantId,status]`), `ReadinessAccessMatrix:966` (`[tenantId,status]`), `Inspection:1593` (`[tenantId,equipmentId]`), `Site:1786` (`[tenantId,isActive]`), `Report:1984` (`[tenantId,updatedAt]`) | Лишняя запись индекса на каждой вставке/удалении | Удалить дубли (отдельным изменением схемы; здесь не трогаю) |
| 16 | мелочь | ПРОЙДЕНО | `src/app/api/admin/dlq/route.ts:73` | `status === 'all'` → `where = {}` + `orderBy createdAt desc`. Индекс `[status,createdAt]` (`schema.prisma:2855`) работает при конкретном `status`, но не при пустом `where` | Админ-DLQ «все записи»: сортировка всей таблицы | Не критично при малом DLQ; `@@index([createdAt])` при росте |

Замечаний больше 30 не набралось; приложение path:line не требуется.

## Таблица: запрос ↔ подходящий индекс

| Таблица | Запрос (файл:строка) | Подходящий индекс | Вывод |
|---------|----------------------|-------------------|-------|
| MaintenanceRecord | `equipment-query.service.ts:337` | нет `(tenantId, createdAt)` | ❌ не покрыт |
| MaintenanceRecord | `equipment-query.service.ts:462–494` | нет составного под `orderBy` | ❌ не покрыт (находка 2) |
| MaintenanceRecord | `equipment-query.service.ts:226–229` | нет покрывающего | ❌ (находка 3) |
| BriefingRecord | `briefing-journal-query.ts:126` | `[tenantId, recordedAt]` | ✔ покрыт по `orderBy`; `kind`/`instructorId` — фильтр после (находка 11) |
| FeedbackEventRead | `feedback-event-service.ts:220,261` | unique `[eventId,userId]` | ✔ покрыт |
| ReportDowntime | `operator-mobile/.../production.ts:233` | `[reportId]` | ✔ покрыт (модуль заморожен — только чтение) |
| PileWork | `pile-journal-list.ts:71` | `[tenantId, occurredAt]` | ⚠ `ASC NULLS LAST` vs `DESC NULLS LAST` — гипотеза (находка 5) |
| PileWork | `pile-journal-totals.ts:62–86` | — | ⚠ `ILIKE '%…%'` — гипотеза (находка 6) |
| Inspection | `inspection-query.service.ts:20` | нет `(tenantId, inspectionDate)` | ❌ не покрыт (находка 7) |
| WorkPermit | `work-permit-repository.ts:159` | нет `(tenantId, updatedAt)` | ❌ не покрыт (находка 4) |
| OutboxEvent | `lag-monitor.ts:212` | нет на `publishedAt` | ❌ частично (находка 8) |
| OutboxEvent | `outbox-publisher.ts:325` | — | ❌ `count()` без условия на растущей таблице (находка 9) |
| DeadLetterQueue | `admin/dlq/route.ts:74` | `[status, createdAt]` | ✔ при конкретном `status`; ❌ при `all` (находка 16) |

## Топ-10 вероятных медленных запросов при росте данных ×10

Порядок — по вероятности деградации. Ни один не измерен (база не запускалась); это оценка по структуре индексов и объёму роста.

1. `getFleetKpiData` — MaintenanceRecord, `where tenantId + createdAt` диапазон, без индекса (`equipment-query.service.ts:337`).
2. `listAllMaintenance` — MaintenanceRecord, `orderBy priority/scheduledAt/createdAt`, `take 500`, без составного индекса (`equipment-query.service.ts:462`).
3. Журнал ТО установки — MaintenanceRecord, `orderBy status/scheduledAt/createdAt` (`equipment-query.service.ts:226`).
4. Дефолтный список нарядов-допусков — WorkPermit, `orderBy updatedAt desc` + `count`, нет `(tenantId, updatedAt)` (`work-permit-repository.ts:159,161`).
5. Первая страница журнала забивки — PileWork, `orderBy occurredAt DESC NULLS LAST` (`pile-journal-list.ts:71`).
6. Итоги журнала забивки — PileWork⋈PilePassport, `ILIKE '%…%'` (`pile-journal-totals.ts:77`).
7. Список осмотров — Inspection, `orderBy inspectionDate desc`, `take 200` (`inspection-query.service.ts:20`).
8. Аналитика объектов — PileWork за всю историю без периода (`site-analytics-service.ts:122–128`).
9. Rate публикации outbox — `published=true` + `publishedAt` (`lag-monitor.ts:212`); накопительная таблица.
10. `getOutboxStats` `count()` без условия на неубираемой таблице (`outbox-publisher.ts:325`).

## Не проверено

- `EXPLAIN (ANALYZE, BUFFERS)` не снимался ни для одного запроса: база не запускалась (read-only аудит кода). Все пункты со статусом `ГИПОТЕЗА` (находки 5, 6) требуют подтверждения на реальных данных — особенно поведение `ORDER BY occurredAt DESC NULLS LAST` относительно `ASC NULLS LAST`-индекса (зависит от версии и плана).
- Фактические объёмы таблиц (сколько строк сегодня в MaintenanceRecord, PileWork, OutboxEvent) не измерялись — приоритеты «важно/мелочь» даны по характеру роста, а не по числу строк.
- Частичные индексы, заведённые SQL-ом (8 шт.: telematics IMEI, `ReadinessRuleSet` active, `Shift`/`ShiftHandover` live, `ReportDowntime` one_open_interval, `Report` without_shift, `PileWork` receivedAt-fallback), сверены по тексту миграций, но их реальное использование планировщиком не проверено.
- `CREATE INDEX CONCURRENTLY` (2 шт., оба PileWork) — приняты как факт из миграций; состояние индексов (`valid`/`invalid`) в базе не проверялось.
- Замороженные зоны (варианты экранов оператора, ORION, `src/modules/operator-mobile/**`) читались только на предмет запросов; изменения кода там не предлагаются.
- Наличие/отсутствие `pg_trgm` и других расширений в целевой БД не проверялось (важно для находки 6).

## Приложение: RLS целевых таблиц (проверено)

- `FORCE ROW LEVEL SECURITY` включён на `MaintenanceRecord`, `WorkPermit`, `PileWork`, `ReportDowntime`, `BriefingRecord`, `FeedbackEventRead`, `Inspection`, `Site`, `Report`, `User`, `LeaderDrilling` (миграции `20260701020000_force_row_level_security`, `20260808140000_readiness_tenant_isolation`, `20260819120000_rls_fail_closed_all`, `20260903000000_rls_remaining_tables`, `20261013120000_briefing_record_rls`, `20261014090000_feedback_event_read_rls`).
- `OutboxEvent` — RLS намеренно **выключен** (`prisma/migrations/20260702000000_drop_stray_rls_tenant_outbox/migration.sql:11`): обрабатывается системными воркерами и не является tenant-scoped. Это не находка.
