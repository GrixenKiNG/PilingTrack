# AU89-S6-DB-INDEX-COVERAGE — индексы БД под частые запросы и внешние ключи

**Версия:** `git rev-parse HEAD` = `699acf0da97dedd8c2c1e6baade03e74bb205592` (ветка `hermes/q4-0926`, рабочая папка D:\PillingR\wt-night).
**Тип задачи:** только чтение, код приложения не менялся.

## Резюме для владельца (5 строк)

1. Схема целая: 83 таблицы, 99 внешних ключей, 292 индекса. 4 из 133 колонок-ключей (UserDocument.userId, UserDocument.typeId, Inspection.equipmentId, Inspection.templateId) не имеют ни одного индекса, где эта колонка стоит первой — проверка целостности и удаление родителя по ним идут полным перебором таблицы.
2. Ещё 16 составных ключей вида «(tenantId, кто-то)» покрыты только индексом с первой колонкой `tenantId`; полного индекса на пару нет. Это мелочь, пока родителя не удаляют (FK стоят на Restrict).
3. Из 15 проверенных частых запросов «tenantId + дата» 11 опираются на готовый индекс. Два экранных списка — Shift по productionDate и WorkPermit по updatedAt — индексом не покрыты и сортируют выборку всей организации в памяти.
4. Разбор чисел — в разделе «Методика»; DB и EXPLAIN не запускались (локальной/боевой базы нет), поэтому это статический разбор схемы, а не замер планов.
5. Миграции не предлагаются: только список, как и просили.

## Методика

1. **Схема.** Прочитан `prisma/schema.prisma` (2883 строки) целиком; отдельно — блоки моделей UserDocument (192–214), Inspection (1554–1585), Shift (1081–1133), ShiftHandover (1160–1186), WorkPermit (1442–1515), TelemetryRecord (2034–2052), AuditLog (2573–2618).
2. **Разбор индексов и FK из схемы.** Скрипт `fk_cover.js` (node, только чтение файла) строит по каждому отношению `@relation(fields:[...])` список колонок FK и проверяет: (а) есть ли индекс/уникальный ключ/PK, где колонка FK стоит первой; (б) есть ли индекс, чей префикс совпадает со всем набором колонок FK. Команда:
   `node fk_cover.js prisma/schema.prisma` → `MODELS=83  RELATIONS_WITH_FK=99  FK_COLUMNS_TOTAL=133  FK_FIRSTCOL_UNCOVERED=4  FK_NO_EXACT_PREFIX=20`.
3. **Независимая сверка по DDL.** Сгенерирован SQL всей схемы без подключения к БД (read-only):
   `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (exit 0) → 2875 строк. По нему скрипт `ddl_cover.js` пересчитал то же самое из реального DDL: `CREATE TABLE` = 83, `FOREIGN KEY` = 99, `CREATE (UNIQUE) INDEX` = 292, FK без индекса с ведущей колонкой = 4 (пятый, TenantAuditChain.tenantId, покрыт PRIMARY KEY — см. schema.prisma:2621). Результаты схемы и DDL сошлись.
4. **Миграции.** По `prisma/migrations/**` посчитано: `CREATE INDEX` = 324, `DROP INDEX` = 6, частичных индексов = 1 (`Crew_equipmentId_active_unique`, 20260624000000_crew_equipment_active_unique/migration.sql:5). Отдельно проверено, что для UserDocument (20260815000000_user_documents/migration.sql:55–58) и Inspection (20260603120000_checklist_engine_slice1/migration.sql:108–114) индексов на «голую» колонку FK миграции не создавали.
5. **Запросы.** В `src/modules` и `src/services` найдены точки чтения с фильтром по `tenantId` и упорядочиванием/фильтром по дате: `grep -rn "orderBy" src/modules src/services` (92 совпадения по датам), затем прочитаны сами функции, чтобы взять настоящий `where`, а не название.

Проверки НЕ запускались: `tsc`, `lint`, тесты, `build`, `EXPLAIN ANALYZE` — это аудит чтения, код не менялся (пункт 6 AGENTS.md к таким изменениям не применяется).

## Находки

Премиса: Prisma/Postgres **не** создаёт индекс на колонки внешнего ключа автоматически — его надо объявлять (`@@index`). Ниже «индекс с колонкой первой» = есть индекс/уникальный ключ/PK, у которого проверяемая колонка — первая.

### Таблица A. Внешние ключи без индекса по колонке FK

| # | severity | path:line (объявление FK) | модель | колонка FK | составной индекс с этой колонкой первой | проблема / сценарий |
|---|---|---|---|---|---|---|
| A1 | важно | prisma/schema.prisma:208 | UserDocument | userId | **нет** (индексы :211 `[tenantId,userId]`, :213 `[tenantId,typeId]`) | FK `UserDocument.userId → User.id`; ни один индекс не начинается с `userId`. Удаление/переключение пользователя и RI-проверка FK сканируют всю таблицу документов. |
| A2 | важно | prisma/schema.prisma:209 | UserDocument | typeId | **нет** (только `[tenantId,typeId]` :213) | FK `UserDocument.typeId → UserDocumentType.id` с `onDelete: Restrict`: удаление вида документа упирается в полный перебор UserDocument. |
| A3 | важно | prisma/schema.prisma:1577 | Inspection | equipmentId | **нет** (есть `[tenantId,equipmentId]` :1582) | FK `Inspection.equipmentId → Equipment.id` с `onDelete: Cascade`: удаление установки вынуждено сканировать Inspection целиком (композит `[tenantId,equipmentId]` для проверки по одной колонке не годится). |
| A4 | важно | prisma/schema.prisma:1578 | Inspection | templateId | **нет** (есть `[tenantId]`, `[tenantId,equipmentId]`, `[tenantId,status]`) | FK `Inspection.templateId → ChecklistTemplate.id` с `onDelete: Restrict`: удаление шаблона чек-листа — полный перебор Inspection. |
| A5 | мелочь | prisma/schema.prisma:1121 | Shift | createdById | **нет** (ведущая колонка индексов — только `tenantId`) | Составной FK `(tenantId,createdById) → User(tenantId,id)`. Индекс `[tenantId,equipmentId,productionDate]` :1129 начинается с tenantId, но не с createdById — полного индекса на пару нет. |
| A6 | мелочь | prisma/schema.prisma:1122 | Shift | lastEditedById | **нет** | то же: FK `(tenantId,lastEditedById)` не покрыт ни одним индексом Shift (:1128–1132). |
| A7 | мелочь | prisma/schema.prisma:1123 | Shift | startedById | **нет** | FK `(tenantId,startedById)` без покрывающего индекса. |
| A8 | мелочь | prisma/schema.prisma:1124 | Shift | closedById | **нет** | FK `(tenantId,closedById)` без покрывающего индекса. |
| A9 | мелочь | prisma/schema.prisma:1125 | Shift | cancelledById | **нет** | FK `(tenantId,cancelledById)` без покрывающего индекса. |
| A10 | мелочь | prisma/schema.prisma:1179 | ShiftHandover | submittedById | **нет** (индексы :1184–1185) | FK `(tenantId,submittedById) → User(tenantId,id)` без полного индекса. |
| A11 | мелочь | prisma/schema.prisma:1180 | ShiftHandover | acceptedById | **нет** | FK `(tenantId,acceptedById)` без полного индекса. |
| A12 | мелочь | prisma/schema.prisma:1181 | ShiftHandover | reworkedById | **нет** | FK `(tenantId,reworkedById)` без полного индекса. |
| A13 | мелочь | prisma/schema.prisma:1213 | OperatorChecklistTemplate | createdById | **нет** (индексы :1216–1218) | FK `(tenantId,createdById)` без полного индекса. |
| A14 | мелочь | prisma/schema.prisma:1238 | OperatorChecklistExecution | templateId | **нет** (индексы :1244–1245) | FK `(tenantId,templateId)` без полного индекса. |
| A15 | мелочь | prisma/schema.prisma:1239 | OperatorChecklistExecution | startedById | **нет** | FK `(tenantId,startedById)` без полного индекса. |
| A16 | мелочь | prisma/schema.prisma:1265 | OperatorChecklistAnswerRecord | answeredById | **нет** (индексы :1267–1270) | FK `(tenantId,answeredById)` без полного индекса. |
| A17 | мелочь | prisma/schema.prisma:1288 | OperatorShiftEvidence | recordedById | **нет** (индексы :1290–1293) | FK `(tenantId,recordedById)` без полного индекса. |
| A18 | мелочь | prisma/schema.prisma:1504 | WorkPermit | authorId | **нет** (индексы :1508–1514) | FK `(tenantId,authorId)` без полного индекса. |
| A19 | мелочь | prisma/schema.prisma:1505 | WorkPermit | lastEditedById | **нет** | FK `(tenantId,lastEditedById)` без полного индекса. |
| A20 | мелочь | prisma/schema.prisma:1506 | WorkPermit | revokedById | **нет** | FK `(tenantId,revokedById)` без полного индекса. |

Пояснение к A5–A20: первая колонка этих FK (`tenantId`) проиндексирована (составные индексы с ведущим `tenantId`), поэтому обычно проблема не проявляется. Полного индекса на пару колонок нет; RI-проверка при удалении/изменении родителя его не получит. Риск низкий, потому что все эти FK — `onDelete: Restrict`, а пользователей/наряды/смены из системы не удаляют.

Остальные 79 внешних ключей имеют индекс, где колонка FK стоит первой (пример: `Report.siteId` → `Report_siteId_date_idx [siteId,date]`, schema.prisma:1976; `PileWork.reportId` → `[reportId]` :2203).

### Таблица B. 15 частых запросов «tenantId + дата»

| # | severity | path:line | запрос (модель и признак) | индекс под него | статус |
|---|---|---|---|---|---|
| B1 | мелочь | src/modules/reports/application/queries/report-query.service.ts:166 | `Report` where tenantId (:138), orderBy `[date desc, id desc]` (список отчётов на проверку) | `[tenantId,date]` schema.prisma:1974 | ПРОЙДЕНО (тай-брейкер `id` в индекс не входит, но диапазон даты покрыт) |
| B2 | мелочь | src/modules/reports/application/queries/report-query.service.ts:230 | `Report` where tenantId (:229), orderBy `updatedAt desc` (последние отчёты на дашборде) | `[tenantId,updatedAt]` schema.prisma:1973 | ПРОЙДЕНО |
| B3 | мелочь | src/modules/reports/application/queries/report-query.service.ts:300 | `Report` where `{userId[,tenantId]}` (:283), orderBy `date desc` (отчёты одного оператора) | `[userId,date]` schema.prisma:1975 | ПРОЙДЕНО |
| B4 | мелочь | src/modules/reports/application/queries/report-export.service.ts:146 | `Report` where tenantId + диапазон `date` (:125,:131), orderBy `date desc` (выгрузка) | `[tenantId,date]` schema.prisma:1974 | ПРОЙДЕНО |
| B5 | мелочь | src/modules/reports/application/queries/pile-journal-list.ts:71 | `PileWork` where tenantId + период по `occurredAt`/`receivedAt` (:51,:68), orderBy `occurredAt desc` | `[tenantId,occurredAt]` schema.prisma:2208 + частичный `(tenantId,receivedAt) WHERE occurredAt IS NULL` (:2210) | ПРОЙДЕНО |
| B6 | **важно** | src/modules/readiness/infrastructure/shifts/shift-repository.ts:81 | `Shift` where tenantId + диапазон `productionDate` (:74–79), orderBy `[productionDate desc, createdAt desc]` (список смен) | **нет** `[tenantId,productionDate]`; ближайший `[tenantId,equipmentId,productionDate]` schema.prisma:1129 | НЕ ПОКРЫТО — `productionDate` только третьей в индексе, без `equipmentId` индекс не работает: фильтр по дате + сортировка идут по всей выборке организации |
| B7 | мелочь | src/modules/readiness/infrastructure/defects/defect-repository.ts:97 | `EquipmentDefect` where tenantId (+equipmentId/status/severity) (:84–94), orderBy `[reportedAt desc, id desc]` | `[tenantId,reportedAt]` schema.prisma:704 | ПРОЙДЕНО |
| B8 | **важно** | src/modules/readiness/infrastructure/permits/work-permit-repository.ts:159 | `WorkPermit` where tenantId + диапазон `validFrom`/`validTo` (:143–151), orderBy `[updatedAt desc, id desc]` (реестр нарядов) | **нет** `[tenantId,updatedAt]`; есть `[tenantId,state,updatedAt]` schema.prisma:1510 | НЕ ПОКРЫТО — сортировка по `updatedAt` без фильтра по `state` индексом не поддержана |
| B9 | мелочь | src/services/users/user-documents.ts:94 | `UserDocument` where `{tenantId,userId}` (:92), orderBy `expiresAt asc` (документы работника) | `[tenantId,userId]` schema.prisma:211 + `[tenantId,expiresAt]` :212 | ПРОЙДЕНО |
| B10 | мелочь | src/services/users/user-documents.ts:139 | `UserDocument` where tenantId, `expiresAt ≤ now+окно` (:128–133), orderBy `expiresAt asc` (контроль сроков) | `[tenantId,expiresAt]` schema.prisma:212 | ПРОЙДЕНО (комментарий кода прямо ссылается на этот индекс, user-documents.ts:121) |
| B11 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:236 | `MeterReading` where `{equipmentId,tenantId}` (:235), orderBy `recordedAt desc` (журнал моточасов) | `[equipmentId,recordedAt]` schema.prisma:745 | ПРОЙДЕНО |
| B12 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:285 | `FuelLog` where equipmentId+tenantId+диапазон `recordedAt` (:284), orderBy `recordedAt asc` (сводка топлива) | `[equipmentId,recordedAt]` schema.prisma:777 | ПРОЙДЕНО |
| B13 | мелочь | src/services/telemetry/telemetry-ingestion-service.ts:317 | `TelemetryRecord` where tenantId + диапазон `timestamp` (:319,:327), orderBy `timestamp asc` | есть `[equipmentId,timestamp]`,`[siteId,timestamp]`,`[type,timestamp]` (:2048–2050), но **нет** `[tenantId,timestamp]` | ГИПОТЕЗА / частично — без `equipmentId`/`siteId`/`type` в фильтре ведущего `timestamp`-индекса нет; телеметрия спит (hardware не подключён), сценарий не живой |
| B14 | мелочь | src/services/telemetry/telemetry-ingestion-service.ts:290 | `TelemetryRecord` where `{equipmentId,tenantId}`, orderBy `timestamp desc` (последнее показание) | `[equipmentId,timestamp]` schema.prisma:2048 | ПРОЙДЕНО |
| B15 | мелочь | src/services/reports/outbox-publisher.ts:103 | `OutboxEvent` where `published=false` + бэкофф `nextRetryAt` (:95–100), orderBy `createdAt asc`, take BATCH | `[published,createdAt]` schema.prisma:2084 + `[published,nextRetryAt]` :2083 | ПРОЙДЕНО |

Дополнительно (вне «tenantId+дата», но рядом):

| # | severity | path:line | проблема | статус |
|---|---|---|---|---|
| C1 | мелочь | src/modules/readiness/application/bootstrap-query.ts:100 | `AuditLog` findFirst where `{tenantId,userId,action}`, orderBy `timestamp desc` — индекса `[tenantId,userId,timestamp]` нет; есть `[userId,timestamp]` (schema.prisma:2610) и `[tenantId,timestamp]` :2611 | ПРОЙДЕНО с оговоркой (по конкретному пользователю строк мало) |
| C2 | мелочь | src/services/feedback/feedback-event-service.ts:158 | `FeedbackEvent` where `action notIn` + `OR[actorId=user, audience='ALL']`, orderBy `createdAt desc` — фильтр без tenantId, форма OR плохо ложится на один индекс; есть `[actorId,createdAt]` :2546 и `[audience,createdAt]` :2547 | ПРОЙДЕНО с оговоркой |
| C3 | мелочь | src/services/audit/audit-history-service.ts:103 | `FeedbackEvent` where `{scope,targetId}`, orderBy `createdAt desc` | ПРОЙДЕНО — `[scope,targetId,createdAt]` schema.prisma:2545 |
| C4 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:228 | `MaintenanceRecord` where `{equipmentId,tenantId}`, orderBy `[status asc, scheduledAt desc, createdAt desc]` — составного индекса под этот порядок нет (есть одиночные :613–614) | ГИПОТЕЗА (выборка узкая по equipmentId, сортировка в памяти) |

Итог по severity (только проблемы, не «ПРОЙДЕНО»): **критично — 0; важно — 6** (A1–A4, B6, B8); **мелочь — 19** (A5–A20 = 16, B13, C1, C2, C4). Записей в таблицах выше: 20 (A) + 15 (B) + 4 (C) = 39.

## Что не проверено

- **Реальные планы запросов (EXPLAIN ANALYZE) не снимались.** Локальной и боевой БД нет, `.env` не читался (запрет AGENTS.md п.1). Все выводы — статический разбор схемы/DDL, а не измерение. `scripts/explain-analyze.ts` (см. skill pilingtrack-proof-and-analysis-toolkit, рецепт 5) не запускался.
- **Объёмы данных и фактическая критичность не измерены.** Нужны реальные счётчики строк по таблицам (UserDocument, Inspection, Shift, WorkPermit), чтобы отличить «полный перебор 100 строк» от «100 000». Не проверено.
- **Дрейф схемы и миграций не сверялся.** `prisma migrate diff --from-migrations ... --to-schema` требует shadow-базы; без неё нельзя доказать, что в базе набор индексов совпадает со схемой (в частности, что 324 исторических `CREATE INDEX` и 6 `DROP INDEX` дают ровно 292 актуальных). НЕ ПРОВЕРЕНО.
- **Покрытие всех 15 запросов не полно.** Выбраны представительные точки чтения из `src/modules`/`src/services`; route-handlers в `src/app/api/**` и сырой SQL (`src/core/infrastructure/raw-queries.ts`) в выборку не входили. Часть запросов, исполняемых дважды (count + findMany, как в shift-repository.ts:81–82), учтена по основному findMany.
- **Не проверялось, какие FK реально удаляются в проде.** Все найденные FK — `onDelete: Restrict`/`Cascade`; вывод «мелочь» для A5–A20 опирается на предположение «родителя не удаляют». Подтверждения из кода удаления нет.
- **Секция «Запросы» в схеме отсутствует** — я не утверждаю, что список из 15 покрывает все частые чтения; только те, что найдены по `tenantId`+дата.
