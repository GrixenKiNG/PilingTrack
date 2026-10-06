# R72 — Журнал аудита и техготовность: команда → след

Read-only разбор дефекта QA **D-20260930-002** («действия техготовности не пишутся в журнал
аудита»). Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`. Ни один существующий файл
не изменён; создан только этот отчёт. База не читалась и не писалась. Замороженные зоны
(варианты экрана оператора, ORION, `src/modules/operator-mobile/**`) читались только
справочно и в таблицу не входят.

В продукте **два независимых журнала**, и они пишутся разными подсистемами без пересечения:

| журнал | таблица | писатель | читатель |
|---|---|---|---|
| цепочка аудита (с хешами) | `AuditLog` + `TenantAuditChain` | `recordChainedReadinessAudit` → `appendAuditEvent` + `PrismaAuditRepository` (`src/modules/readiness/infrastructure/audit/`) | только `GET /api/readiness/audit` → экран «Техготовность → Настройки → Аудит» (`src/components/piling/to/readiness/settings/audit-section.tsx:30`) |
| лента событий | `FeedbackEvent` | `recordAuditEvent` (`src/services/audit/audit-service.ts:888`) и `recordFeedbackEvent` (`src/services/feedback/feedback-event-service.ts:112`) | лента `/admin` — колокольчик `FeedbackCenter` в шапке (`src/components/piling/feedback-center.tsx:67`, данные `GET /api/feedback/events`) и панели истории сущностей (`GET /api/audit` → `getEntityHistory`, `src/services/audit/audit-history-service.ts:90`) |

Третий, вспомогательный канал — транзакционный outbox (`OutboxEvent`). Он **не журнал**:
`ReadinessSnapshotRequested` заказывает пересчёт снимка готовности. Единственный outbox-тип,
который доходит до ленты, — `ReportSubmitted` (обработчик `src/services/reports/event-handlers.ts:426`).

## Итог

Найдено **19 находок: критично — 6, важно — 10, мелочь — 3**. Разобраны все команды контура
техготовности (`shifts`, `permits`, `defects`, `readiness-rules`, `access-matrix`, `scheduler`,
`bootstrap`) и все команды ТО и осмотров (`src/modules/equipment/**`,
`src/modules/inspections/**`), плюс маршруты к ним.

Главное: **журналы не пересекаются ни в одну сторону**. Контур готовности пишет только в
цепочку `AuditLog` и не пишет в ленту ни одного события; весь ТО, осмотры, техника и допуски
пишут только в ленту `FeedbackEvent` (и то не всё) и не оставляют ни одного звена в цепочке.
Именно поэтому «действия техготовности не пишутся в журнал аудита» верно ровно наполовину:
в *цепочке* они есть, а в *ленте*, которую владелец видит в `/admin`, их нет вообще.

Топ-5:

1. **критично** — завершение осмотра (`completeInspection`,
   `src/modules/inspections/application/commands/inspection-commands.ts:308`) не пишет
   **ни в один** из двух журналов, хотя это самый «допусковый» акт в системе: считается балл
   состояния, закрывается наряд ТО, пишутся моточасы и заводятся дефекты.
2. **критично** — контур готовности (смены, передачи, наряды-допуски, дефекты, правила,
   матрица доступов, автозакрытие) не пишет в ленту `FeedbackEvent` ни одного события → в
   ленте `/admin` заявки на допуск, отказы, блокировки пуска и дефекты не видны (`src/modules/readiness/infrastructure/audit/record-audit.ts:20`).
3. **критично** — удаление наряда ТО `DELETE /api/equipment/[id]/maintenance/[recordId]:115`
   не оставляет следа нигде, а `deleteMaintenance` (`src/modules/equipment/application/commands/equipment-maintenance.ts:327`)
   снимает открытый наряд с расчёта готовности — то есть меняет допуск техники.
4. **критично** — запись показания моточасов (`addMeterReading`,
   `src/modules/equipment/application/commands/meter-reading.ts:241`) не оставляет следа нигде,
   при том что удаление того же показания в ленту пишется (`meter.reading.deleted`).
5. **критично** — планировщик ТО (`runPmScheduler`,
   `src/modules/equipment/application/commands/pm-scheduler.ts:44`) заводит наряды ТО без
   единой записи; ручной запуск `POST /api/maintenance-plans/run:13` — тоже.

Замыслу это **соответствует только частично**. По замыслу (`docs/adr/0043-audit-hash-chain.md:13`,
принят 29.07.2026) цепочка `AuditLog` — единственный источник для аудит-API, а `FeedbackEvent` —
операционная лента уведомлений. Значит, писать в цепочку должна не «только техготовность»,
а всё, что читает аудит-API. Сегодняшнее положение дел (цепочка = контур готовности, лента =
всё остальное) — историческая случайность, а не решение: комментарий `record-audit.ts:7-18`
прямо говорит, что нецепочечный `recordAuditLog` «остался в core», а ADR-0043 п.1 при этом
не выполнен: `GET /api/audit` до сих пор читает `FeedbackEvent`
(`src/services/audit/audit-history-service.ts:101`), а не `AuditLog`.

## Методика

Что открывал и как повторить (path:line — по факту открытия, файлы читались целиком, если не
указано иное):

Писатели журналов:
- `src/services/audit/audit-service.ts` (920, целиком) — `recordAuditEvent` + словарь `AUDIT_DESCRIPTIONS` (там же:373-839 — полный список действий, которые лента умеет показывать по-человечески);
- `src/services/audit/audit-history-service.ts` (159, целиком) — читатель `/api/audit`;
- `src/services/feedback/feedback-event-service.ts` (281, целиком) — хранилище ленты;
- `src/services/reports/audit-service.ts` (131, целиком) — `ReportAudit` + мост в ленту;
- `src/services/reports/outbox-publisher.ts` (324, целиком) — два независимых потребителя outbox;
- `src/modules/readiness/infrastructure/audit/{record-audit.ts,append-audit.ts,audit-repository.ts}` (целиком) — цепочечный писатель и единственный читатель `AuditLog`;
- `src/services/reports/event-handlers.ts:405-445` — единственный outbox-обработчик, доходящий до ленты.

Команды техготовности (целиком): `src/modules/readiness/application/shifts/commands.ts` (433),
`defects/commands.ts` (232), `permits/commands.ts` (289), `readiness-rules-service.ts` (275),
`access-matrix-service.ts` (248), `scheduler.ts` (280), `bootstrap-query.ts` (283).

Команды ТО, техники и осмотров (целиком или указанным диапазоном):
`src/modules/equipment/application/commands/{equipment-maintenance.ts,equipment-command.service.ts,equipment-metadata.ts,equipment-document.ts,maintenance-plan.ts,maintenance-regulation.ts,meter-reading.ts,fuel-log.ts,pm-scheduler.ts}`,
`src/modules/safety/application/equipment-permits.ts` (183),
`src/modules/inspections/application/commands/inspection-commands.ts` (491).

Как считается «изменяет допуск»: критерии и блокеры расчёта читаются в
`src/modules/readiness/domain/readiness-rules.ts:26-32` (`BLOCKER_CONDITIONS`), `:46-65`
(`BLOCKER_LABELS`), `:67-72` (`BLOCKER_ACTION_LABELS`), `:146-202` (`DEFAULT_READINESS_RULES`:
веса `INSPECTION 40 / ENGINE_HOURS 20 / PERMIT 0 / MAINTENANCE 27 / ACCEPTANCE 13` — `:165-171`), а факты —
в `src/modules/readiness/application/readiness-facts.ts:36-83` (`inspectionCompleted`,
`healthScore`, `engineHoursTotal`, `permitValid/Expired`, `maintenanceOverdue*`,
`maintenanceConfigured`, `accepted`, `criticalDefect`).

Маршруты (мутации) открывал и просматривал на предмет вызовов аудита:
`src/app/api/readiness/**` (все `route.ts`, поиск `recordChainedReadinessAudit|recordAuditEvent` — совпадения только в `export/route.ts:140`),
`src/app/api/equipment/**` (`route.ts:84`; `[id]/route.ts:115,156`; `[id]/maintenance/route.ts:80`;
`[id]/maintenance/[recordId]/route.ts:82` и DELETE `:115-133`; `[id]/meter-readings/route.ts`;
`[id]/meter-readings/[readingId]/route.ts:46`; `[id]/fuel/route.ts`; `[id]/fuel/[entryId]/route.ts:50`;
`[id]/documents/route.ts`; `[id]/documents/[docId]/route.ts:96`),
`src/app/api/maintenance/{[id]/accept/route.ts:35,route.ts}`,
`src/app/api/maintenance-plans/{route.ts,[id]/route.ts:96,run/route.ts}`,
`src/app/api/inspections/**`, `src/app/api/safety/equipment-permits/{route.ts:90,[id]/route.ts:29}`,
`src/app/api/audit/route.ts`, `src/app/api/readiness/audit/route.ts`, `src/app/api/feedback/events/route.ts`.

Схема (только чтение): `prisma/schema.prisma` — `FeedbackEvent:2520-2546`, `AuditLog:2569-2614`
(в т.ч. nullable-поля цепочки `sequence/occurredAt/hash/prevHash:2587-2598`), `TenantAuditChain:2616-2622`,
`MaintenanceRecord:580-612` (`completedAt`, `acceptedById`, `closedById`), `Inspection:1554-1584`
(`signedAt`, `healthScore`), `WorkPermit:1442`, `UserEquipmentPermit:398`. `@@map` в схеме нет —
имена таблиц совпадают с именами моделей.

Документы-замысел: `docs/adr/0043-audit-hash-chain.md` (целиком),
`docs/design/tech-readiness-production-frontend-design.md:70` («audit/report читается из journal,
а не из hash-chained `AuditLog`» — зафиксированный разрыв, ещё до этой задачи),
`docs/audits/hermes-night/34-audit-trail.md` (предыдущий срез по журналу; его находки №3-5 —
`readiness-rules-service`/`access-matrix-service`/`bootstrap-query` без хеша — **на сегодня уже
исправлены**, см. `access-matrix-service.ts:129-135`, `readiness-rules-service.ts:126-140`,
`bootstrap-query.ts:107-114`).

Доказательства «следа нет» (текстовые поиски, воспроизводимы):
`search_files pattern='audit' path=src/modules/inspections` → **0 совпадений**;
`search_files pattern='audit|recordFeedback|outbox' path=src/modules/equipment` → совпадения только
на `outboxEvent` (доменные события) и на комментарии, ни одного вызова аудита;
`grep -rn "auditLog.create" src` → единственный писатель таблицы
`src/modules/readiness/infrastructure/audit/audit-repository.ts:45`;
`grep -rn "recordChainedReadinessAudit" src` → 7 не-тестовых точек (все — контур готовности);
`grep -rn "recordAuditEvent(" src` → 20 не-тестовых файлов, ни одного в `modules/readiness/**`.

Проверки §6 AGENTS.md (`tsc`, `lint`, `npm run test:unit`, `playwright --list`, `build`)
**не запускал**: задача read-only, файлов кода нет.

## Находки

### A. Таблица «команда → след» (техготовность и ТО)

Обозначения: **цепочка** — `AuditLog` с хешом (виден только на экране «Аудит» техготовности);
**лента** — `FeedbackEvent` (видна в колокольчике `/admin` и в панелях истории сущностей);
**«Аудит»** — экран «Техготовность → Настройки → Аудит» (`GET /api/readiness/audit`, право
`readiness.audit.read`); **`/admin`** — лента `FeedbackCenter` (`GET /api/feedback/events`).

| команда | файл:строка | цепочка `AuditLog` (через какой сервис) | лента событий (`FeedbackEvent`) | в «Аудите» техготовности | в ленте `/admin` |
|---|---|---|---|---|---|
| Создать смену | `src/modules/readiness/application/shifts/commands.ts:98` | да, `recordChainedReadinessAudit` (`:71`) | нет | да (`shift.created`) | нет |
| Изменить смену | `shifts/commands.ts:126` | да | нет | да (`shift.updated`) | нет |
| Запустить смену (и `start-blocked`) | `shifts/commands.ts:151` | да (`:183`, `:195`, `:202`) | нет | да (`shift.started`, `shift.start-blocked`) | нет |
| Запросить приёмку | `shifts/commands.ts:209` | да | нет | да (`shift.acceptance-requested`) | нет |
| Выдать разрешение на пуск (waiver) | `shifts/commands.ts:238` | да | нет | да (`shift.start-waived`) | нет |
| Отказать в допуске | `shifts/commands.ts:281` | да | нет | да (`shift.acceptance-declined`) | нет |
| Отменить смену | `shifts/commands.ts:303` | да | нет | да (`shift.cancelled`) | нет |
| Сдать передачу смены | `shifts/commands.ts:318` | да | нет | да (`handover.submitted/resubmitted`) | нет |
| Принять / вернуть передачу | `shifts/commands.ts:430`, `:432` | да | нет | да (`handover.accepted`, `handover.rework-requested`) | нет |
| Зафиксировать дефект (вручную) | `src/modules/readiness/application/defects/commands.ts:116` | да (`:71`) | нет | да (`defect.reported`) | нет |
| Разобрать дефект | `defects/commands.ts:176` | да | нет | да (`defect.triage`) | нет |
| Закрыть дефект | `defects/commands.ts:198` | да | нет | да (`defect.resolve`) | нет |
| Отклонить дефект | `defects/commands.ts:216` | да | нет | да (`defect.reject`) | нет |
| Создать наряд-допуск | `src/modules/readiness/application/permits/commands.ts:112` | да (`:74`) | нет | да (`work-permit.created`) | нет |
| Изменить наряд-допуск | `permits/commands.ts:151` | да | нет | да (`work-permit.updated`) | нет |
| Подать / согласовать / отозвать наряд | `permits/commands.ts:284`, `:286`, `:288` | да | нет | да (`work-permit.submit`, `approved-<роль>`, `revoke`) | нет |
| Сохранить черновик правил готовности | `src/modules/readiness/application/readiness-rules-service.ts:93` | да (`recordChainedReadinessAudit` `:132`) | нет | да (`draft_saved`) | нет |
| Опубликовать правила готовности | `readiness-rules-service.ts:213` (+ `:145` baseline) | да (`:259`, `:162`) | нет | да (`published`) | нет |
| Сохранить черновик матрицы доступов | `src/modules/readiness/application/access-matrix-service.ts:156` | да (`writeAudit` → `recordChainedReadinessAudit` `:135`) | нет | да (`draft_saved`) | нет |
| Опубликовать матрицу доступов | `access-matrix-service.ts:194` | да | нет | да (`published`) | нет |
| Включить режим замещения роли | `src/modules/readiness/application/bootstrap-query.ts:68` (запись `:114`) | да | нет | да (`acting_as_mechanic`) | нет |
| Планировщик: истечение наряда-допуска | `src/modules/readiness/application/scheduler.ts:113` (запись `:140`) | да, актор «Планировщик техготовности» (`:39`) | нет | да (`work-permit.expired`) | нет |
| Планировщик: автозакрытие смены | `scheduler.ts:113` (запись `:178`) | да | нет | да (`shift.auto-closed`) | нет |
| Планировщик: автосдача чернового отчёта | `scheduler.ts:220` (outbox `ReportSubmitted`) | нет | **да** — через `outbox → event-handlers.ts:426` | нет | **да** (`ReportSubmitted`) |
| Выгрузка данных готовности (CSV) | `src/app/api/readiness/export/route.ts:140` | да (`readiness.exported`) | нет | да | нет |
| Шаблон места работ: создать/удалить | `src/app/api/readiness/place-presets/route.ts:32`, `:91` | нет | нет | нет | нет |
| Осмотр: заведение с нарядом ТО (`startToInspection`) | `src/modules/inspections/application/commands/inspection-commands.ts:58` | **нет** | **нет** | нет | нет |
| Осмотр: заведение по шаблону (`startInspection`) | `inspection-commands.ts:176` | **нет** | **нет** | нет | нет |
| Осмотр: сохранить ответы (`saveAnswers`) | `inspection-commands.ts:251` | **нет** | **нет** | нет | нет |
| Осмотр: завершить (`completeInspection`) | `inspection-commands.ts:308` | **нет** | **нет** | нет | нет |
| ТО: создать наряд | `src/modules/equipment/application/commands/equipment-maintenance.ts:58` | нет | да — `src/app/api/equipment/[id]/maintenance/route.ts:80` (`maintenance.created`) | нет | да |
| ТО: изменить наряд | `equipment-maintenance.ts:191` | нет | да — `[id]/maintenance/[recordId]/route.ts:82` (`maintenance.updated`) | нет | да |
| ТО: принять наряд | `equipment-maintenance.ts:280` | нет | да — `src/app/api/maintenance/[id]/accept/route.ts:35` (`maintenance.accepted`) | нет | да |
| ТО: удалить наряд | `equipment-maintenance.ts:327` | **нет** | **нет** (DELETE-ветка `[id]/maintenance/[recordId]/route.ts:115-133`) | нет | нет |
| ТО: регламент — создать | `.../commands/maintenance-plan.ts:40` | нет | нет (`src/app/api/maintenance-plans/route.ts:51` — без аудита) | нет | нет |
| ТО: регламент — изменить | `maintenance-plan.ts:73` | нет | нет (`maintenance-plans/[id]/route.ts:29`) | нет | нет |
| ТО: регламент — удалить | `maintenance-plan.ts:106` | нет | да (`maintenance-plans/[id]/route.ts:96`, `maintenance.plan.deleted`) | нет | да |
| ТО: сдвиг регламента после закрытия наряда | `.../commands/maintenance-regulation.ts:76` | нет | нет (меняет `Equipment.nextMaintenance*`) | нет | нет |
| Моточасы: записать показание | `.../commands/meter-reading.ts:178`, `:241` | **нет** | **нет** (`src/app/api/equipment/[id]/meter-readings/route.ts:63` — без аудита) | нет | нет |
| Моточасы: удалить показание | `meter-reading.ts:260` | нет | да (`[readingId]/route.ts:46`, `meter.reading.deleted`) | нет | да |
| Топливо: добавить запись | `.../commands/fuel-log.ts:90` | нет | нет (`[id]/fuel/route.ts:79`) | нет | нет |
| Топливо: удалить запись | `fuel-log.ts:134` | нет | да (`[id]/fuel/[entryId]/route.ts:50`, `equipment.fuel.deleted`) | нет | да |
| Документ техники: добавить | `.../commands/equipment-document.ts:30` | нет | нет (`[id]/documents/route.ts:27`) | нет | нет |
| Документ техники: изменить | `equipment-document.ts:55` | нет | нет (`[id]/documents/[docId]/route.ts:31`) | нет | нет |
| Документ техники: удалить | `equipment-document.ts:80` | нет | да (`[docId]/route.ts:96`, `equipment.document.deleted`) | нет | да |
| Планировщик ТО (создание нарядов) | `.../commands/pm-scheduler.ts:44` (создание `:119`) | **нет** | **нет** (`src/app/api/maintenance-plans/run/route.ts:13` — без аудита) | нет | нет |
| Техника: создать / изменить / вывести / удалить | `.../commands/equipment-command.service.ts:10`, `:19`, `:27`, `:35` | нет | да (`api/equipment/route.ts:84`, `[id]/route.ts:115`, `:156`) | нет | да |
| Допуск работника к технике: выдать/изменить | `src/modules/safety/application/equipment-permits.ts:105` | нет | да (`src/app/api/safety/equipment-permits/route.ts:90`, `user.equipment_permit.saved`) | нет | да |
| Допуск работника к технике: удалить | `equipment-permits.ts:167` | нет | да (`equipment-permits/[id]/route.ts:29`) | нет | да |

### B. Команды, меняющие допуск техники, следа нет нигде (ни цепочки, ни ленты)

Перечислены по критериям и блокерам расчёта (`readiness-rules.ts:26-32`, `:146-202`;
`readiness-facts.ts:36-83`):

| команда | файл:строка | какой факт допуска меняет | след |
|---|---|---|---|
| `completeInspection` | `src/modules/inspections/application/commands/inspection-commands.ts:308` | критерий `INSPECTION` (40 баллов), `healthScore`; закрывает наряд ТО (`:404`); пишет моточасы (`:417`); заводит дефекты (`:443`) → блокер `CRITICAL_DEFECT`; итог — `inspectionCompleted` в фактах | **нет нигде** |
| `startToInspection` | `inspection-commands.ts:58` | открывает наряд ТО (`:146`) → критерий `MAINTENANCE` и признак незакрытой работы | **нет нигде** |
| `startInspection` | `inspection-commands.ts:176` | то же (осмотр без наряда) | **нет нигде** |
| `saveAnswers` | `inspection-commands.ts:251` | содержимое осмотра, из которого потом считается `healthScore` | **нет нигде** |
| `recordMeterReadingInTx` / `addMeterReading` | `src/modules/equipment/application/commands/meter-reading.ts:178`, `:241` | критерий `ENGINE_HOURS` (20 баллов) + `Equipment.engineHoursTotal` (`:223`) → вход в расчёт блокера `MAINTENANCE_OVERDUE_50H` | **нет нигде** |
| `deleteMaintenance` | `src/modules/equipment/application/commands/equipment-maintenance.ts:327` | снимает открытый наряд с расчёта (`:345-358`) → `MAINTENANCE` и `criticalDefect` (открытый `REPAIR`/`FAULT`, `readiness-facts.ts:78-79`) | **нет нигде** |
| `runPmScheduler` (+ `POST /api/maintenance-plans/run`) | `src/modules/equipment/application/commands/pm-scheduler.ts:44`, `src/app/api/maintenance-plans/run/route.ts:13` | создаёт наряд ТО `PLANNED` (`:119`) → тот же `MAINTENANCE` и незакрытая работа | **нет нигде** |
| `advanceMaintenanceRegulation` | `src/modules/equipment/application/commands/maintenance-regulation.ts:76` | `Equipment.nextMaintenanceAtHours/Date` (`:117`) → `maintenanceConfigured` и `maintenanceOverdue*` | собственного следа нет; в ленту попадает только как `maintenance.updated`/`accepted` от вызывающего маршрута, в цепочку — никогда |
| `createMaintenancePlan` / `updateMaintenancePlan` | `maintenance-plan.ts:40`, `:73` | интервалы регламента → те же `nextMaintenance*` | **нет нигде** |
| `deleteEquipmentPermit` (допуск работника) | `src/modules/safety/application/equipment-permits.ts:167` | матрица «работник × техника» (влияние на допуск — по замыслу отложено, см. `equipment-permits.ts:10-14`) | пишет только в ленту, и то без цели |
| `updateEquipmentMetadata` через `PUT /api/equipment/[id]` | `src/app/api/equipment/[id]/route.ts:99` | `nextMaintenanceAtHours/Date`, `engineHoursTotal` | пишет `equipment.updated` в ленту, но подписанных полей срока ТО в словаре нет |

### C. Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/infrastructure/audit/record-audit.ts:20`; `src/modules/readiness/application/shifts/commands.ts:71`; `defects/commands.ts:71`; `permits/commands.ts:74`; `scheduler.ts:140,178`; `access-matrix-service.ts:135`; `readiness-rules-service.ts:132,162,259`; `bootstrap-query.ts:114` | Ни одна команда контура готовности не пишет в ленту `FeedbackEvent`: `recordChainedReadinessAudit` кладёт только `AuditLog` + `outboxEvent`, а `recordAuditEvent` в `src/modules/readiness/**` не вызывается ни разу | Диспетчер открывает колокольчик `/admin`: заявок на допуск машины, отказов (`shift.acceptance-declined`), блокировок пуска (`shift.start-blocked`), новых критических дефектов и решений по нарядам там нет. Это ровно то, что QA назвал «действия техготовности не пишутся в журнал аудита». Обратно тоже верно: экран «Аудит» техготовности не показывает ни одного действия остальных модулей | Писать событие и в ленту: либо `recordAuditEvent` рядом с `recordChainedReadinessAudit` (после коммита, с `scope` контура), либо завести в `audit-repository` проекцию цепочки в `FeedbackEvent`; тексты для `AUDIT_DESCRIPTIONS` — по образцу `shift.*` |
| 2 | критично | `src/modules/inspections/application/commands/inspection-commands.ts:308-490` (закрытие наряда `:404`, моточасы `:417`, дефекты `:443`) | `completeInspection` не пишет ни в цепочку, ни в ленту: в `src/modules/inspections/**` слово `audit` не встречается ни разу | Осмотр — четверть балла готовности и условие запуска смены. Механик закрыл осмотр, система ушла в блокер, а в журналах нет ни строки: ни кто осмотрел, ни какой `healthScore` получился, ни какие дефекты родились. Разбор «почему машину не выпустили» невозможен | Писать `recordChainedReadinessAudit` в той же транзакции (контурные сущности — `Inspection`, `MaintenanceRecord`, `EquipmentDefect`) + событие в ленту; добавить `inspection.completed` в `AUDIT_DESCRIPTIONS` |
| 3 | критично | `src/modules/inspections/application/commands/inspection-commands.ts:58`, `:176` | Заведение осмотра и наряда ТО (`startToInspection`, `startInspection`) не оставляет следа | Наряд ТО, открытый осмотром, сразу влияет на критерий «Обслуживание» и на признак незакрытой работы. Открытый и закрытый в тот же час осмотр снаружи неотличимы от «наряда не было» | Аудит на создание: `inspection.started` + `maintenance.created` (в той же транзакции, `:145`) |
| 4 | критично | `src/modules/equipment/application/commands/meter-reading.ts:178-239`; `src/app/api/equipment/[id]/meter-readings/route.ts:63` | Запись показания моточасов не оставляет следа нигде (при этом удаление показания пишется в ленту — `[readingId]/route.ts:46`) | Показание двигает `engineHoursTotal`, а от него считаются моточасы (20 баллов) и просрочка ТО (блокер `MAINTENANCE_OVERDUE_50H`). Кто и когда выставил цифру, введшую технеку в блокировку, из журналов не видно; удаление этой же цифры, наоборот, видно — пара «добавил/стёр» читается перевёрнуто | Аудит `meter.reading.created` с `recordedById` (роут актора знает) или перевести добавление на тот же путь, что удаление |
| 5 | критично | `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts:115-133`; `src/modules/equipment/application/commands/equipment-maintenance.ts:327-359` | Удаление наряда ТО не оставляет следа ни в цепочке, ни в ленте, хотя создание/правка/приёмка того же наряда в ленту пишутся | `deleteMaintenance` удаляет и **открытый** наряд (`:345-358`), а открытый наряд `REPAIR`/`FAULT` держит блокер `criticalDefect` (`readiness-facts.ts:78-79`). Механик, стирая ошибочный наряд, снимает запрет на работу — и в журналах об этом нет ничего. Комментарий в коде (`:339-341`) прямо говорит, что удаление принятого наряда закрыли ради отсутствия следа, — но для непринятого оставили | Аудит `maintenance.deleted` с before-снимком (status/type/title/completedAt) до `delete`, и в ленту, и в цепочку |
| 6 | критично | `src/modules/equipment/application/commands/pm-scheduler.ts:44` (создание `:119`); `src/app/api/maintenance-plans/run/route.ts:13` | Планировщик ТО заводит наряды без следа; ручной запуск планировщика тоже не оставляет записи | Утром у машины появляется `PLANNED`-наряд от системы — и в журнале ни строки: ни по какому регламенту, ни от какого порога. Отличить «планировщик отработал» от «воркер молчит» по журналам нельзя, а ручной прогон админом неотличим от автоматического | Аудит `maintenance.auto-created` с актором-системой (как `SCHEDULER_ACTOR` в `scheduler.ts:39`) и `planId/trigger`; отдельное событие о самом запуске |
| 7 | важно | `src/services/audit/audit-history-service.ts:101`; `src/app/api/audit/route.ts:30`; `docs/adr/0043-audit-hash-chain.md:13` | `GET /api/audit` читает `FeedbackEvent`, тогда как принятый ADR-0043 п.1 объявляет единственным источником аудит-API таблицу `AuditLog`; цепочку читает один `readiness/audit` | Один и тот же вопрос «что было с объектом» отвечают две разные подсистемы с разным составом полей: у `FeedbackEvent` нет ни `tenantId`, ни `before/after` по контракту, у `AuditLog` нет действий остальных модулей. Владелец видит два несовпадающих журнала | Либо довести ADR до кода (читать `AuditLog`), либо понизить ADR п.1 и зафиксировать разделение явно в `docs/` |
| 8 | важно | `src/app/api/equipment/[id]/maintenance/route.ts:79-91`; `[id]/maintenance/[recordId]/route.ts:81-105`; `src/app/api/maintenance/[id]/accept/route.ts:34-45` | ТО-наряды (создание, правка, приёмка) пишут только в ленту, вне транзакции изменения, в `try/catch` с проглатыванием ошибки, и не оставляют ни одного звена в цепочке | Правка стоимости, трудозатрат и моточасов после закрытия видна только в ленте; сбой `FeedbackEvent` (или ретеншен ленты) стирает путь изменения вовсе. В «Доказательном журнале» техготовности наряд ТО не появляется никогда | Писать след в транзакции команды и в цепочку (`entityType: 'MaintenanceRecord'`), как это сделано у смен и нарядов-допусков |
| 9 | важно | `src/modules/equipment/application/commands/maintenance-regulation.ts:76-118` | Сдвиг регламента ТО (отметка выполнения и пересчёт `Equipment.nextMaintenanceAtHours/Date`) не оставляет собственного следа | Порог просрочки ТО двигается автоматически при закрытии и приёмке наряда. По журналу нельзя понять, почему у машины вдруг изменился срок: в ленте есть «наряд изменён», но само изменение порога — нет | Отдельное событие `maintenance.regulation.advanced` с before/after порогов |
| 10 | важно | `src/app/api/maintenance-plans/route.ts:51`; `src/app/api/maintenance-plans/[id]/route.ts:29` | Регламент ТО: создание и правка интервалов — без следа (удаление пишется — `[id]/route.ts:96`) | Интервал регламента прямо задаёт, когда машина уйдёт в блокер просрочки. Правку интервала с «каждые 250 м/ч» на «каждые 500» в журнале не увидеть; удаление того же регламента, наоборот, видно | Аудит `maintenance.plan.created/updated` с before/after (intervalHours/intervalDays/triggerType) |
| 11 | важно | `src/app/api/equipment/[id]/documents/route.ts:27`; `src/app/api/equipment/[id]/documents/[docId]/route.ts:31` | Документ техники: создание и правка (в т.ч. `expiresAt`) — без следа; удаление пишется (`:96`) | Срок действия документа техники — то, из-за чего машину снимают с работы; продление срока снаружи неотличимо от «никогда не было» | Аудит `equipment.document.created/updated` с before/after срока |
| 12 | важно | `src/app/api/equipment/[id]/fuel/route.ts:79` | Запись топлива: добавление — без следа (удаление пишется — `[entryId]/route.ts:50`) | Расход топлива считается по этим строкам; добавление задним числом меняет отчётность без следа | Аудит `equipment.fuel.created` |
| 13 | важно | `src/app/api/safety/equipment-permits/route.ts:90-97`; `equipment-permits/[id]/route.ts:29-35` | Допуск работника к технике: и выдача, и удаление пишутся только в ленту, без `before`; строка матрицы перезаписывается целиком (`upsertEquipmentPermit`, `equipment-permits.ts:137-157`) | Смена `ALLOWED → DENIED` в ленте выглядит как «Допуск работника к технике: Сваебойная установка, не допущен» — чем он был раньше, не узнать. Удаление пишет `targetId = permitId`, а не работника: чей допуск сняли, из записи не следует | Читать прежнюю строку до upsert и класть `before`; при удалении — снимок строки (`userId`, `equipmentKind`, `scope`, `status`) |
| 14 | важно | `src/app/api/feedback/events/route.ts:24-35`, `:147-159` | Любой аутентифицированный пользователь может создать событие в той же таблице, что читает лента и панели истории сущностей, со свободными `scope`, `action`, `targetId` (жёстко ограничен только `audience` для непривилегированных — `:154`) | Оператор из поля может вписать `scope='users'`, `action='user.equipment_permit.saved'`, `targetId=<чужой id>` — строка появится в карточке истории этого работника (`getEntityHistory` фильтрует именно по `scope`+`targetId`, `audit-history-service.ts:102`) и в ленте `/admin` у админа (уровень `error` даст «Внимание»). Журнал, в который пишет любой, контролем не является | Запретить создание событий из API (оставить только `operation: read/acknowledge`) либо ограничить `scope`/`action` белым списком клиентских значений |
| 15 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:429-470` | Дефекты, заведённые автоматически по ответам осмотра, не оставляют следа, тогда как тот же дефект, заведённый вручную, пишет `defect.reported` в цепочку (`defects/commands.ts:138`) | Два внешне одинаковых замечания в журнале читаются по-разному: ручное есть, автоматическое — нет. Именно автоматические (трещина в мачте по ответу чек-листа) чаще всего и блокируют допуск | Писать событие на каждый созданный дефект (тот же `recordChainedReadinessAudit` в транзакции осмотра, `entityId` = id дефекта) |
| 16 | важно | `src/app/api/equipment/[id]/route.ts:99`, `:115-126`; `src/services/audit/audit-service.ts:184-190` | `PUT /api/equipment/[id]` пишет `equipment.updated`, но `EQUIPMENT_FIELD_LABELS` включает только `name/model/description/qty/isActive`; поля срока ТО (`nextMaintenanceAtHours/nextMaintenanceDate/engineHoursTotal`), которые правит `updateEquipmentMetadata`, в текст и в `before/after` не попадают | Админ двигает порог просрочки ТО в карточке — в ленте «Установка «X»: изменения сохранены.» без единого поля. Это и есть самый частый способ погасить блокер `MAINTENANCE_OVERDUE_50H` вручную | Добавить поля срока ТО в `EQUIPMENT_FIELD_LABELS` и в `changedEquipmentFields` |
| 17 | мелочь | `src/app/api/readiness/place-presets/route.ts:32`, `:91` | Шаблоны места работ: создание и удаление не оставляют следа (и DELETE идёт через `withMutation`, а не через `withReadinessCommand`) | Шаблон места попадает в наряд-допуск; удаление чужого шаблона снаружи неотличимо от «его не было» | Аудит `place-preset.created/deleted` в цепочку либо явно зафиксировать как несущественное |
| 18 | мелочь | `src/modules/equipment/application/commands/meter-reading.ts:260-289`; `src/app/api/equipment/[id]/meter-readings/[readingId]/route.ts:46` | Удаление показания пишет `meter.reading.deleted` только в ленту, не в цепочку, тогда как исходный факт (`Equipment.engineHoursTotal`) меняется в базе | Класс «техника/ТО» в цепочке отсутствует целиком: на экране «Аудит» техготовности ни одно действие ТО не появится никогда, включая удаления, которые лента помнит | Определиться с целевым журналом для контура ТО (см. #7) и довести до конца |
| 19 | мелочь | `src/modules/equipment/application/commands/equipment-maintenance.ts:280-325`; `src/app/api/maintenance/[id]/accept/route.ts:41` | Приёмка наряда пишет только `{name: record.title}`: ни `closedById`, ни `acceptedById`, ни стоимости | «Кто выполнил работу» и «кто принял» в ленте не видно, хотя обе колонки в строке есть (`MaintenanceRecord.closedById/acceptedById`, `prisma/schema.prisma:601-603`) | Класть в metadata `closedById/acceptedById/cost/laborHours` |

### D. Готовый SELECT для проверки на базе (29–30.09.2026)

Все запросы read-only, только по двум журналам и трём связанным таблицам. Границы периода —
производственные сутки 29 и 30.09.2026 в поясе организации (+03:00), то есть
`2026-09-28 21:00:00+00 … 2026-09-30 21:00:00+00` по UTC. Тенант — `orion`
(`prisma/seed.ts:101`). Имена таблиц совпадают с именами моделей (`@@map` в схеме нет).

```sql
-- ─────────────────────────────────────────────────────────────────────
-- 1. ЖУРНАЛ 1: цепочка AuditLog — что техготовность записала за 29–30.09.
--    Ожидание по коду: смены, передачи, наряды-допуски, дефекты (ручные),
--    правила, матрица доступов, режим замещения, автозакрытие, истечение наряда.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  to_char(al."occurredAt" AT TIME ZONE 'Europe/Moscow', 'DD.MM HH24:MI:SS') AS "когда",
  al."sequence"                        AS "№",
  al.action,
  al."entityType",
  al."entityId",
  al."actorId",
  al."userName",
  al."userRole",
  al."actingAs",
  al."before",
  al."after",
  left(encode(al.hash, 'hex'), 12)     AS "hash"
FROM "AuditLog" al
WHERE al."tenantId" = 'orion'
  AND al.hash IS NOT NULL                                  -- только звенья цепочки (так читает экран)
  AND al."occurredAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND al."occurredAt" <  timestamptz '2026-09-30 21:00:00+00'
ORDER BY al."sequence";

-- 1б. То же в разрезе «что за действия»: сколько звеньев по каждому действию.
SELECT al.action, count(*) AS "звеньев"
FROM "AuditLog" al
WHERE al."tenantId" = 'orion' AND al.hash IS NOT NULL
  AND al."occurredAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND al."occurredAt" <  timestamptz '2026-09-30 21:00:00+00'
GROUP BY 1 ORDER BY 2 DESC, 1;

-- 1в. Строки AuditLog ВНЕ цепочки (hash IS NULL) за тот же период — «след, которого
--     не видит экран». Ожидание: 0 (после фиксов F-R34-3 прямых записей нет).
SELECT al.action, al."entityType", count(*) AS "строк без хеша"
FROM "AuditLog" al
WHERE al."tenantId" = 'orion' AND al.hash IS NULL
  AND al."timestamp" >= timestamptz '2026-09-28 21:00:00+00'
  AND al."timestamp" <  timestamptz '2026-09-30 21:00:00+00'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 2. ЖУРНАЛ 2: лента FeedbackEvent — что попало в колокольчик /admin.
--    Ключевая проверка дефекта: есть ли здесь ХОТЬ ОДНО событие контура
--    готовности (scope того контура / действия shift.*, handover.*,
--    work-permit.*, defect.*). По коду ожидание — 0.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  to_char(fe."createdAt" AT TIME ZONE 'Europe/Moscow', 'DD.MM HH24:MI:SS') AS "когда",
  fe.level, fe.priority, fe.scope, fe.action, fe.title, fe.message,
  fe."actorId", fe."actorName", fe."actorRole", fe."targetId"
FROM "FeedbackEvent" fe
WHERE fe."createdAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND fe."createdAt" <  timestamptz '2026-09-30 21:00:00+00'
ORDER BY fe."createdAt";

-- 2б. Прямой ответ на D-20260930-002: события техготовности в ленте.
SELECT fe.action, count(*) AS "событий"
FROM "FeedbackEvent" fe
WHERE fe."createdAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND fe."createdAt" <  timestamptz '2026-09-30 21:00:00+00'
  AND (fe.action LIKE 'shift.%'
    OR fe.action LIKE 'handover.%'
    OR fe.action LIKE 'work-permit.%'
    OR fe.action LIKE 'defect.%'
    OR fe.scope IN ('readiness', 'readiness-audit'))
GROUP BY 1 ORDER BY 2 DESC;      -- ожидание: 0 строк

-- 2в. Что вообще было в ленте по контурам ТО/техники/осмотров:
SELECT fe.scope, fe.action, count(*) AS "событий"
FROM "FeedbackEvent" fe
WHERE fe."createdAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND fe."createdAt" <  timestamptz '2026-09-30 21:00:00+00'
  AND fe.scope IN ('equipment', 'users', 'reports')
GROUP BY 1, 2 ORDER BY 3 DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Разрыв «факт в базе vs след в журналах» за 29–30.09.
--    Каждое число в паре должно быть объяснимо одной строкой в журнале.
--    Ожидание по коду: слева десятки событий, справа нули.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM "Inspection" i
     WHERE i."tenantId" = 'orion' AND i.status = 'COMPLETED'
       AND i."signedAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND i."signedAt" <  timestamptz '2026-09-30 21:00:00+00')          AS "завершено осмотров",
  (SELECT count(*) FROM "MaintenanceRecord" mr
     WHERE mr."tenantId" = 'orion'
       AND mr."completedAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND mr."completedAt" <  timestamptz '2026-09-30 21:00:00+00')      AS "закрыто нарядов ТО",
  (SELECT count(*) FROM "MaintenanceRecord" mr
     WHERE mr."tenantId" = 'orion' AND mr."createdAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND mr."createdAt" <  timestamptz '2026-09-30 21:00:00+00')        AS "заведено нарядов ТО",
  (SELECT count(*) FROM "EquipmentDefect" d
     WHERE d."tenantId" = 'orion' AND d."reportedAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND d."reportedAt" <  timestamptz '2026-09-30 21:00:00+00')        AS "зафиксировано дефектов",
  (SELECT count(*) FROM "AuditLog" al
     WHERE al."tenantId" = 'orion' AND al.hash IS NOT NULL
       AND al."occurredAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND al."occurredAt" <  timestamptz '2026-09-30 21:00:00+00')       AS "звеньев цепочки",
  (SELECT count(*) FROM "AuditLog" al
     WHERE al."tenantId" = 'orion' AND al.hash IS NOT NULL
       AND al."entityType" IN ('Inspection', 'MaintenanceRecord', 'EquipmentDefect')
       AND al."occurredAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND al."occurredAt" <  timestamptz '2026-09-30 21:00:00+00')       AS "из них по ТО/осмотрам/дефектам",
  (SELECT count(*) FROM "FeedbackEvent" fe
     WHERE fe.action LIKE 'maintenance.%'
       AND fe."createdAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND fe."createdAt" <  timestamptz '2026-09-30 21:00:00+00')        AS "событий ТО в ленте";

-- ─────────────────────────────────────────────────────────────────────
-- 4. Показания моточасов (критерий ENGINE_HOURS): сколько добавлено и удалено
--    против числа событий в журналах. Ожидание: добавления — 0 событий нигде,
--    удаления — только в ленте (meter.reading.deleted).
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM "MeterReading" mr
     WHERE mr."tenantId" = 'orion'
       AND mr."recordedAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND mr."recordedAt" <  timestamptz '2026-09-30 21:00:00+00')       AS "показаний внесено (осталось в базе)",
  (SELECT count(*) FROM "FeedbackEvent" fe
     WHERE fe.action IN ('meter.reading.created', 'meter.reading.deleted')
       AND fe."createdAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND fe."createdAt" <  timestamptz '2026-09-30 21:00:00+00')        AS "событий по моточасам в ленте",
  (SELECT count(*) FROM "AuditLog" al
     WHERE al."tenantId" = 'orion' AND al.hash IS NOT NULL
       AND al."entityType" = 'MeterReading'
       AND al."occurredAt" >= timestamptz '2026-09-28 21:00:00+00'
       AND al."occurredAt" <  timestamptz '2026-09-30 21:00:00+00')       AS "звеньев по моточасам в цепочке";

-- ─────────────────────────────────────────────────────────────────────
-- 5. Сводка по обоим журналам одним взглядом (для протокола QA).
-- ─────────────────────────────────────────────────────────────────────
SELECT 'AuditLog (цепочка)' AS "журнал",
       count(*)                          AS "записей",
       count(*) FILTER (WHERE hash IS NOT NULL) AS "в цепочке",
       count(*) FILTER (WHERE hash IS NULL)     AS "вне цепочки"
FROM "AuditLog"
WHERE "tenantId" = 'orion'
  AND "occurredAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND "occurredAt" <  timestamptz '2026-09-30 21:00:00+00'
UNION ALL
SELECT 'FeedbackEvent (лента)', count(*), count(*), 0
FROM "FeedbackEvent"
WHERE "createdAt" >= timestamptz '2026-09-28 21:00:00+00'
  AND "createdAt" <  timestamptz '2026-09-30 21:00:00+00';
```

Как читать результат:

- **Запрос 2б пуст** — дефект D-20260930-002 подтверждён в самой сильной форме: в ленте
  `/admin` нет ни одного действия контура готовности.
- **Запрос 1б без `shift.*`/`handover.*`/`work-permit.*`/`defect.*`** — действия техготовности
  вообще не доходят до цепочки (тогда причина глубже: транзакция откатывалась, либо вызов шёл
  мимо `withReadiness*Transaction`).
- **Запрос 3**: колонка «из них по ТО/осмотрам/дефектам» = 0 при ненулевых первых трёх —
  ровно находки #2, #3, #5, #6, #15: работа в базе есть, следа нет.
- **Запрос 1в**: ненулевое значение — это прямые записи в `AuditLog` без хеша; такие строки
  не видны ни на экране «Аудит», ни в проверке цепочки (фильтр `hash: {not: null}`,
  `src/modules/readiness/infrastructure/audit/audit-repository.ts:88`).

## Не проверено

- **Фактическое содержимое базы** — к базе не подключался ни локально, ни тем более к прод-базе.
  Все выводы получены чтением кода и схемы; SELECT'ы выше — это *намерение* проверки, числа в
  них не выполнялись. Есть ли в реальных данных строки `AuditLog` без `hash` и сколько их —
  не проверено.
- **Что именно QA называет «журналом аудита»** в D-20260930-002: сам дефект в репозитории
  отсутствует (искал `D-20260930` по всему репозиторию — найдено только упоминание
  D-20260930-001 в `docs/audits/hermes-night/R71-v2-handover-stuck.md:3`). Расхождение между
  лентой `/admin` и экраном «Аудит» техготовности описано в отчёте, но какая из двух
  поверхностей имелась в виду — из текста задачи не следует.
- **Воркеры и доставка событий**: прочитана только регистрация outbox-обработчика
  (`event-handlers.ts:405-445`). Включён ли outbox-воркер в конкретной среде и в каком порядке
  реплик он читает (`outbox-publisher.ts:262-302`), эмпирически не проверял — то есть
  «`ReportSubmitted` попал в ленту» следует из кода, но не подтверждено на живых данных.
- **`src/modules/operator-mobile/**`** — замороженная зона (AGENTS.md). Не разбирал; известно из
  отчёта 34, что там аудита нет вовсе, но справочно: `finishWork` тоже двигает состояние смены
  (см. R71), то есть контур «допил» со стороны мобильного экрана в эту таблицу не попал.
- **`src/services/auth/**`, `src/core/security/**`, `src/lib/rate-limiter.ts`** — не открывал
  (security-critical по AGENTS.md). Поэтому не проверено, какими правами наделены
  `system.read` (чтение `/api/audit`) и `readiness.audit.read` (чтение цепочки) и пересекаются
  ли они у диспетчера.
- **Экраны** — разметку экрана «Аудит» техготовности и ленты `/admin` читал частично
  (`audit-section.tsx:1-60`, `audit-labels.ts:1-60`, `feedback-center.tsx:1-80`). Не проверено,
  как именно лента рисует строку «Инициатор» и что показывает при `actorName = null`
  (в `recordAuditEvent` имя актора резолвится — `audit-service.ts:870-886`; у всех ТО/техника
  путей актор передаётся, у событий из outbox-обработчика — может быть `null`).
- **Полнота словаря `AUDIT_DESCRIPTIONS`** для новых действий, которые появятся после фиксов
  (#1-#6): контракт «новое действие → строка в словаре» держится тестом
  (`src/services/audit/__tests__/audit-service.test.ts`), но события, записанные напрямую через
  `recordFeedbackEvent`, его минуют — проверял только факт наличия теста, не его полноту.
- **Проверки §6 AGENTS.md** (`rm -rf .next/dev/types`, `npx tsc --noEmit`, `npm run lint`,
  `npm run test:unit`, `npx playwright test --list`, `npm run build`) не запускал: задача
  read-only, ни одного файла кода не изменено.
