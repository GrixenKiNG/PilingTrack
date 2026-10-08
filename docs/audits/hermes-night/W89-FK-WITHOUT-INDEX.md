# W89 — внешние ключи в `prisma/schema.prisma` без индекса

Аудит на чтение. Код, схема и миграции не менялись; создан только этот отчёт.
Проверялся ровно один файл — `prisma/schema.prisma` (2879 строк).

## Итог

- Моделей в схеме: **83**. Полей с `@relation(... fields: [...])` (далее — FK-поля): **99**.
- FK-полей, у которых **нет** индекса, начинающегося с колонок этого FK: **20** (≈20%).
- FK-полей, у которых такой индекс есть: **79**.
- Затронуто моделей: **9**. Критичных находок нет (это латентная деградация, не утечка и не потеря данных): **важно — 16, мелочь — 4**.
- Схема **не** отклоняется от правила ADR-0042 («новые FK — составные ссылки `(tenantId, id)`»): все 20 «дыр» — это либо «кто/когда создал-правил» ссылки на `User`, которые просто забыли проиндексировать, либо старые одиночные FK (`Inspection`, `UserDocument`), где есть только индекс с ведущим `tenantId`.
- Топ-5:
  1. **Shift** — 5 FK без индекса: `createdById`, `lastEditedById`, `startedById`, `closedById`, `cancelledById` (`prisma/schema.prisma:1121–1125`).
  2. **WorkPermit** — 3 FK: `authorId`, `lastEditedById`, `revokedById` (`:1504–1506`).
  3. **ShiftHandover** — 3 FK: `submittedById`, `acceptedById`, `reworkedById` (`:1179–1181`).
  4. **OperatorChecklistExecution** — 2 FK: `templateId`, `startedById` (`:1238–1239`).
  5. **UserDocument** — 2 FK: `userId`, `typeId` (`:208–209`) — есть только `@@index([tenantId, userId])` / `[tenantId, typeId]`, а FK ссылается на `[id]` по одной колонке, поэтому ведущая колонка индекса не та.

## Методика

Автоматический разбор схемы (node, scratch-скрипт вне репозитория; regex по строкам, без Prisma-парсера):

1. Разбиение `prisma/schema.prisma` на блоки `model <Name> { … }` (83 блока).
2. Внутри блока — все строки вида `^<field> <Type> @relation(<args>)`; из `args` извлекается `fields: [...]` (список колонок FK). Найдено 99; сверено с `grep`: строк с `@relation(` — 119, из них с `fields:` — 99 (остальные 20 — обратные связи без колонок), те же 99.
3. Внутри блока — все индексы: `@@index([...])`, `@@unique([...])`, `@@id([...])`, а также `@unique` / `@id` на одиночном поле. Всего таких строк в схеме — 278.
4. FK считается покрытым, если есть индекс, у которого список колонок начинается с колонок FK (совпадение по префиксу), либо (для одно-колоночного FK) на самом поле стоит `@unique`/`@id`.
5. Ручная проверка выборочно по дампу: `Shift` (только `@@index` 1129–1132, ни один не ведёт с `createdById`), `WorkPermit` (1499–1514), `ShiftHandover` (1183–1185), `Inspection` (1581–1584), `UserDocument` (211–213) — совпало с разбором.
6. Дополнительно проверено, что «дыры» не закрыты вручную вне схемы: `grep -rnE "createdById|…|revokedById" prisma/migrations/` (108 миграций, 320 `CREATE INDEX`) и `scripts/` — **ни одного** `CREATE INDEX` по этим колонкам не найдено. То есть индекс отсутствует и в базе.

## Находки

`есть индекс` = да, если найдётся индекс/уникальность с ведущей колонкой FK (полный список «да» — в приложении).
Порядок: модели с большим числом FK без индекса — сверху.

| # | severity | модель | поле (FK-колонка, relation) | есть индекс | файл:строка | проблема / почему важно / что делать |
|---|----------|--------|------------------------------|-------------|-------------|--------------------------------------|
| 1 | важно | Shift | `createdById` (creator) | нет | prisma/schema.prisma:1121 | В `Shift` нет ни одного индекса, ведущего с `createdById`. Индексы 1129–1132 ведут с `tenantId`, `@@unique([tenantId, id])` — только `tenantId+id`. При удалении/обновлении родителя (`User`) Postgres сканирует всю `Shift`. Смена — самая крупная журнальная таблица, поэтому это первый кандидат. Добавить `@@index([tenantId, createdById])`. |
| 2 | важно | Shift | `lastEditedById` (editor) | нет | prisma/schema.prisma:1122 | То же. Добавить `@@index([tenantId, lastEditedById])`. |
| 3 | важно | Shift | `startedById` (starter) | нет | prisma/schema.prisma:1123 | То же (поле nullable). `@@index([tenantId, startedById])`. |
| 4 | важно | Shift | `closedById` (closer) | нет | prisma/schema.prisma:1124 | То же (nullable). `@@index([tenantId, closedById])`. |
| 5 | важно | Shift | `cancelledById` (canceller) | нет | prisma/schema.prisma:1125 | То же (nullable). `@@index([tenantId, cancelledById])`. |
| 6 | важно | WorkPermit | `authorId` (author) | нет | prisma/schema.prisma:1504 | Индексы 1509–1514 покрывают `equipmentId`, `shiftId`, `workTypeId`, но не `authorId`. Проверка/удаление `User` — seq scan по нарядам. `@@index([tenantId, authorId])`. |
| 7 | важно | WorkPermit | `lastEditedById` (editor) | нет | prisma/schema.prisma:1505 | То же. `@@index([tenantId, lastEditedById])`. |
| 8 | важно | WorkPermit | `revokedById` (revoker) | нет | prisma/schema.prisma:1506 | То же (nullable). `@@index([tenantId, revokedById])`. |
| 9 | важно | ShiftHandover | `submittedById` (submitter) | нет | prisma/schema.prisma:1179 | Индексы 1184–1185 ведут с `shiftId`/`state`, не с `submittedById`. `@@index([tenantId, submittedById])`. |
| 10 | важно | ShiftHandover | `acceptedById` (acceptor) | нет | prisma/schema.prisma:1180 | То же (nullable). `@@index([tenantId, acceptedById])`. |
| 11 | важно | ShiftHandover | `reworkedById` (reworker) | нет | prisma/schema.prisma:1181 | То же (nullable). `@@index([tenantId, reworkedById])`. |
| 12 | важно | OperatorChecklistExecution | `templateId` (template) | нет | prisma/schema.prisma:1238 | Индексы покрывают `shiftId` (1244) и `equipmentId` (1245), но не `templateId`. Удаление/правка шаблона чек-листа сканирует все выполнения. `@@index([tenantId, templateId])`. |
| 13 | важно | OperatorChecklistExecution | `startedById` (startedBy) | нет | prisma/schema.prisma:1239 | `@@unique([tenantId, id])` и др. не ведут с `startedById`. `@@index([tenantId, startedById])`. |
| 14 | важно | OperatorChecklistAnswerRecord | `answeredById` (answeredBy) | нет | prisma/schema.prisma:1265 | Уникальности 1267–1269 ведут с `executionId`/`clientCommandId`, не с `answeredById`. На крупной таблице ответов — seq scan при проверке FK. `@@index([tenantId, answeredById])`. |
| 15 | важно | OperatorChecklistTemplate | `createdById` (createdBy) | нет | prisma/schema.prisma:1213 | `@@unique([tenantId, templateKey, version])` (1217) не ведёт с `createdById`. `@@index([tenantId, createdById])`. |
| 16 | важно | OperatorShiftEvidence | `recordedById` (recordedBy) | нет | prisma/schema.prisma:1288 | Индексы 1292–1293 ведут с `shiftId`/`equipmentId`. `@@index([tenantId, recordedById])`. |
| 17 | мелочь | Inspection | `equipmentId` (equipment) | нет | prisma/schema.prisma:1577 | FK одно-колоночный (`references: [id]`). Рядом есть `@@index([tenantId, equipmentId])` (:1582), но он не помогает FK, т.к. ведёт с `tenantId`. Если проверки читают по технике — индекс `[tenantId, equipmentId]` уже есть; для FK-проверки нужен `[equipmentId]` (или сменить FK на ссылку `(tenantId, id)`). |
| 18 | мелочь | Inspection | `templateId` (template) | нет | prisma/schema.prisma:1578 | Нет индекса вообще по `templateId`. Удаление шаблона `ChecklistTemplate` сканирует `Inspection`. Добавить `@@index([templateId])`. |
| 19 | мелочь | UserDocument | `userId` (user) | нет | prisma/schema.prisma:208 | FK одно-колоночный. Есть `@@index([tenantId, userId])` (:211) — для запросов годится, для FK нет (ведущая колонка `tenantId`). `@@index([userId])` либо смена FK на `(tenantId, id)` по ADR-0042. |
| 20 | мелочь | UserDocument | `typeId` (type) | нет | prisma/schema.prisma:209 | Аналогично: `@@index([tenantId, typeId])` (:213) не ведёт с `typeId`. `@@index([typeId])` либо составной FK. |

Примечание: «мелочь» у `Inspection`/`UserDocument` — потому что нужный для чтения индекс всё же есть (с ведущим `tenantId`), и страдает только проверка FK при удалении редко удаляемых родителей; «важно» у строк 1–16 — потому что там нет ни одного индекса, затрагивающего эти колонки, а `Shift`/`Report`-подобные таблицы растут быстро.

## Приложение

### A. FK без индекса (20, полный список)

```
Shift                        createdById     prisma/schema.prisma:1121
Shift                        lastEditedById  prisma/schema.prisma:1122
Shift                        startedById     prisma/schema.prisma:1123
Shift                        closedById      prisma/schema.prisma:1124
Shift                        cancelledById   prisma/schema.prisma:1125
ShiftHandover                submittedById   prisma/schema.prisma:1179
ShiftHandover                acceptedById    prisma/schema.prisma:1180
ShiftHandover                reworkedById    prisma/schema.prisma:1181
OperatorChecklistTemplate    createdById     prisma/schema.prisma:1213
OperatorChecklistExecution   templateId      prisma/schema.prisma:1238
OperatorChecklistExecution   startedById     prisma/schema.prisma:1239
OperatorChecklistAnswerRec.  answeredById    prisma/schema.prisma:1265
OperatorShiftEvidence        recordedById    prisma/schema.prisma:1288
WorkPermit                   authorId        prisma/schema.prisma:1504
WorkPermit                   lastEditedById  prisma/schema.prisma:1505
WorkPermit                   revokedById     prisma/schema.prisma:1506
Inspection                   equipmentId     prisma/schema.prisma:1577
Inspection                   templateId      prisma/schema.prisma:1578
UserDocument                 userId          prisma/schema.prisma:208
UserDocument                 typeId          prisma/schema.prisma:209
```

### B. FK с индексом (79) — как покрыты

```
TenantInvoice.tenant          -> [tenantId]                              :68    @@index:82
User.tenant                   -> [tenantId]                              :114   @@unique:143 [tenantId, id]
UserDocumentType.tenant       -> [tenantId]                              :165   @@unique:188 [tenantId, normalizedName]
PpeCheck.user                 -> [tenantId, userId]                      :250   @@unique:252
BriefingRecord.user           -> [tenantId, userId]                      :347   @@index:351
UserEquipmentPermit.user      -> [tenantId, userId]                      :426   @@unique:431
EquipmentDocument.equipment   -> [equipmentId]                           :556   @@index:559
MaintenanceRecord.equipment   -> [equipmentId]                           :608   @@index:612
EquipmentDefect.equipment     -> [equipmentId]                           :699   @@index:706
MeterReading.equipment        -> [equipmentId]                           :742   @@index:745
FuelLog.equipment             -> [equipmentId]                           :774   @@index:777
MaintenancePlan.equipment     -> [equipmentId]                           :805   @@index:808
ChecklistSection.template     -> [templateId]                            :881   @@index:884
ChecklistItem.section         -> [sectionId]                             :908   @@index:911
TenantSettings.tenant         -> [tenantId]                              :928   @@index:930
CurrentReadiness.snapshot     -> [tenantId, snapshotId]                  :1019  @@index:1023
Shift.tenant                  -> [tenantId]                              :1119  @@unique:1128
Shift.equipment               -> [tenantId, equipmentId]                 :1120  @@index:1129
Shift.startSnapshot           -> [tenantId, startSnapshotId]             :1126  @@index:1132
ShiftHandover.shift           -> [tenantId, shiftId]                     :1177  @@index:1184
OperatorChecklistTemplate.tenant -> [tenantId]                           :1212  @@unique:1216
OperatorChecklistExecution.tenant -> [tenantId]                          :1235  @@unique:1242
OperatorChecklistExecution.shift  -> [tenantId, shiftId]                 :1236  @@index:1244
OperatorChecklistExecution.equipment -> [tenantId, equipmentId]          :1237  @@index:1245
OperatorChecklistAnswerRecord.tenant -> [tenantId]                       :1263  @@unique:1267
OperatorChecklistAnswerRecord.execution -> [tenantId, executionId]       :1264  @@unique:1269
OperatorShiftEvidence.tenant  -> [tenantId]                              :1285  @@unique:1290
OperatorShiftEvidence.shift   -> [tenantId, shiftId]                     :1286  @@index:1292
OperatorShiftEvidence.equipment -> [tenantId, equipmentId]               :1287  @@index:1293
UserPlacePreset.user          -> [tenantId, userId]                      :1383  @@unique:1395
PermitWorkType.tenant         -> [tenantId]                              :1407  @@unique:1437
WorkPermit.workType           -> [tenantId, workTypeId]                  :1453  @@index:1514
WorkPermit.shift              -> [tenantId, shiftId]                     :1500  @@index:1512
WorkPermit.tenant             -> [tenantId]                              :1502  @@unique:1508
WorkPermit.equipment          -> [tenantId, equipmentId]                 :1503  @@index:1509
WorkPermitApproval.permit     -> [tenantId, permitId]                    :1528  @@unique:1532
WorkPermitApproval.approver   -> [tenantId, approvedById]                :1530  @@index:1534
Inspection.maintenanceRecord  -> [maintenanceRecordId]                   :1579  @unique:1559
InspectionAnswer.inspection   -> [inspectionId]                          :1596  @@index:1599
DeviceKey.equipment           -> [equipmentId]                           :1625  @@index:1628
DeviceKey.telematicsDevice    -> [telematicsDeviceId]                    :1626  @@index:1631
TelematicsDevice.equipment    -> [equipmentId]                           :1680  @@index:1687
TelematicsDevice.tenant       -> [tenantId]                              :1681  @@index:1686
TelematicsDeviceAssign.device -> [deviceId]                              :1734  @@index:1737
TelematicsDeviceAssign.equipment -> [equipmentId]                        :1735  @@index:1738
Site.tenant                   -> [tenantId]                              :1765  @@unique:1773
SitePilePlan.site             -> [siteId]                                :1783  @@index:1792
SitePilePlan.pileGrade        -> [pileGradeId]                           :1785  @@index:1793
SiteDrillingPlan.site         -> [siteId]                                :1800  @@index:1808
PileField.site                -> [siteId]                                :1815  @@index:1822
Cluster.field                 -> [fieldId]                               :1829  @@index:1836
Picket.cluster                -> [clusterId]                             :1843  @@index:1851
Crew.operator                 -> [operatorId]                            :1873  @@index:1879
Crew.equipment                -> [equipmentId]                           :1874  @@index:1880
Crew.site                     -> [siteId]                                :1881
CrewAssistant.crew            -> [crewId]                                :1889  @@index:1900
CrewAssistant.user            -> [userId]                                :1894  @@index:1901
UserSiteAssignment.user       -> [userId]                                :1912  @@unique:1918
UserSiteAssignment.site       -> [siteId]                                :1913  @@index:1920
Report.user                   -> [userId]                                :1963  @@index:1975
Report.site                   -> [siteId]                                :1964  @@index:1976
Report.crew                   -> [crewId]                                :1965  @@index:1978
Report.equipment              -> [equipmentId]                           :1966  @@index:1979
PileWork.report               -> [reportId]                              :2198  @@index:2203
PileWork.picket               -> [picketId]                              :2199  @@index:2204
PileWork.pileGrade            -> [pileGradeId]                           :2200  @@index:2205
PilePassport.pileWork         -> [pileWorkId]                            :2299  @unique:2236
PileDrivingSet.passport       -> [passportId]                            :2335  @@unique:2337
LeaderDrilling.report         -> [reportId]                              :2372  @@index:2376
LeaderDrilling.picket         -> [picketId]                              :2373  @@index:2377
LeaderDrilling.type           -> [typeId]                                :2374  @@index:2378
ReportDowntime.report         -> [reportId]                              :2418  @@index:2421
ReportDowntime.reason         -> [reasonId]                              :2419  @@index:2422
PileGrade.tenant              -> [tenantId]                              :2438  @@unique:2460
DrillingType.tenant           -> [tenantId]                              :2467  @@unique:2477
DowntimeReason.tenant         -> [tenantId]                              :2484  @@unique:2494
FeedbackEventRead.event       -> [eventId]                               :2557  @@unique:2560
FeedbackEventRead.user        -> [userId]                                :2558  @@index:2561
TenantAuditChain.tenant       -> [tenantId]                              :2621  @id:2617
```

## Не проверено

- **Не проверено в живой базе.** Доступа к Postgres не было; вывод «индекса нет» сделан по `prisma/schema.prisma` + `grep` по `prisma/migrations/**` и `scripts/**` (ручных `CREATE INDEX` по этим колонкам не найдено). Если индекс создавали вручную вне репозитория — отчёт этого не увидит.
- **Не проверено: реальная производительность.** Оценки «важно/мелочь» — по размеру и «температуре» таблиц, без EXPLAIN и без данных о планах запросов.
- **Не проверено: фактические фильтры приложения.** Как часто запросы реально фильтруют по этим FK (напр. «смены, созданные мной») я не считал — это влияет на приоритеты внутри списка.
- **Не проверено: составные FK, где годится любой порядок колонок.** Разбор засчитывает только индекс, ведущий ровно с колонок FK. Индекс с теми же колонками в ином порядке для равенства по обеим колонкам тоже сработал бы; таких случаев в схеме не нашлось, но метод формально их не покрывает.
- **Не проверено: производительность `@unique`/`@id`-покрытия** (строки со `@unique`/`@id` в приложении Б) — это лишь признак «индекс ведёт с нужной колонки», а не доказательство оптимальности.
- Отчёт составлен автоматическим разбором (см. «Методика»); выборочная ручная сверка — по моделям из топа, полный перечень 79 «да» глазами не перечитывался построчно.
