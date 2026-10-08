# W119-ENUM-DRIFT: расхождение значений enum между кодом и схемой Prisma

## Итог

- В `prisma/schema.prisma` ровно 30 `enum`. Для каждого найден код-аналог (тип/`as const`/`z.enum`/словарь подписей) и сверены наборы значений.
- Критичных расхождений нет. Расхождений — 2 (`важно`) и 2 (`мелочь`).
- `важно`: состояние передачи смены в клиентском контракте называется `REWORK_REQUESTED`, а в Prisma-enum `ShiftHandoverState` — `REWORK_REQUIRED` (value есть только в коде, обратного `REWORK_REQUIRED` в контракте нет).
- `важно`: словарь подписей статуса устройства телематики использует `ONLINE` и `INACTIVE`, которых нет в enum `TelematicsStatus`, и не знает `PROVISIONED`/`DEGRADED`/`ARCHIVED`.
- `мелочь`: `SiteStatus`/`Site.status` (`ACTIVE|INACTIVE|COMPLETED`) против `'paused'|'PAUSED'` в двух неиспользуемых zod-схемах сайта.
- `мелочь`: `dictionaryManageSchema` требует `'PileGrade'`, а рабочий маршрут — `'pileGrade'` (схема маршрутом не используется).
- 26 из 30 enum совпадают с кодом полностью; `TelematicsProvider` и `TelematicsAuthType` вообще не имеют кода-аналога (дремлющая телеметрия — это не расхождение, а «только в Prisma»).
- Значения DB-типов (миграции), схемы и сгенерированного клиента совпадают между собой — устаревшего клиента нет.

## Методика

Полный список `enum` из `prisma/schema.prisma` получен скриптом (node), разобран по значениям; отдельно выгружены значения тех же enum из сгенерированного клиента `src/generated/postgres-client/index.d.ts` и из `CREATE TYPE ... AS ENUM` / `ALTER TYPE ... ADD VALUE` в `prisma/migrations/**`. Сравнение наборов (не порядка) — расхождений между schema / server-DB-типами / generated нет (3 «DIFF» оказались только разным порядком и учтены как равные по составу).

Код-аналоги искал так:
- `export enum` в `src/` — ни одного (0 совпадений); enum'ы в коде заданы `as const`-массами, `type`-union'ами, `z.enum([...])` и словарями подписей.
- `search_files` по `src/` для: `z.enum(`, `= [...] as const`, `..._LABEL(S)`, `..._ORDER`, `..._OPTIONS`, а также по каждому значению неоднозначных enum (`REWORK_`, `TELTONIKA`, `PUSH_TOKEN`, `ONLINE`, `PAUSED` и т.п.).
- Для каждого enum Prisma вручную открыты файл(ы)-аналог(и) и маршруты, которые пишут в колонку.
- Проверены все `z.enum([...])` в `src/app/api/**` для колонок-enum: `maintenance-plans`, `checklist-templates`, `briefings`, `inspections`, `equipment/[id]/{maintenance,documents,fuel,meter-readings}`, `safety/equipment-permits`, `pile-passports/[id]/decide`, `readiness/*` — все значения входят в соответствующий Prisma-enum.

Команды для повторного прогона (читают только; скрипты в scratch, в репозитории не остаются):
`node <scratch>/enumcmp.js` (schema vs generated), `node <scratch>/dbenum.js` (schema vs migrations).

Рамки: `src/` (код), `prisma/schema.prisma`, `prisma/migrations/**`. Замороженные зоны (operator variants, ORION) не разбирались глубже, чем требует сверка enum; на них ссылок по существу не нашлось.

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | как чинить |
|---|----------|-----------|----------|----------------------|------------|
| 1 | важно | `src/components/piling/to/readiness/api/contracts.ts:102`, `src/components/piling/to/readiness/readiness-labels.ts:36` (enum: `prisma/schema.prisma:1074`; домен: `src/modules/readiness/domain/shifts/types.ts:17`) | Клиентский тип `ReadinessHandoverDto.state` объявляет `REWORK_REQUESTED`, которого нет в Prisma-enum `ShiftHandoverState` (там `REWORK_REQUIRED`). «Только в коде»: `REWORK_REQUESTED`. «Только в Prisma»: `REWORK_REQUIRED`. | Сериализатор отдаёт состояние строкой прямо из БД (`src/modules/readiness/application/shifts/commands.ts:34` — `{...row}`), то есть реально придёт `REWORK_REQUIRED`. Словарь `HANDOVER_STATE_LABEL` заведён (и экспортируется) под `REWORK_REQUESTED`, поэтому по ключу `REWORK_REQUIRED` подпись не найдётся. Сейчас симптома нет — `HANDOVER_STATE_LABEL` нигде не вызывается (`search_files`: только определение), а экран журнала строит события по меткам времени (`handover-journal.ts:85-88`). Проявится, как только к карте подключат рендер: состояние «возвращено на доработку» покажется пропуском/сырым кодом. | Привести тип DTO и ключ словаря к значению схемы: `REWORK_REQUIRED` (`readiness-labels.ts:36`, `contracts.ts:102`) либо явно замапить оба. |
| 2 | важно | `src/components/piling/to/readiness/settings/integrations-section.tsx:27` (карта), `:52` (фильтр «онлайн»), `:139` (рендер) (enum: `prisma/schema.prisma:1709`; миграция: `prisma/migrations/20260517120000_telematics_device_foundation/migration.sql:32`) | Словарь `DEVICE_STATUS_LABEL` содержит `ONLINE` и `INACTIVE` — таких значений в `TelematicsStatus` нет; при этом `PROVISIONED`, `DEGRADED`, `ARCHIVED` в словаре отсутствуют. «Только в коде»: `ONLINE`, `INACTIVE`. «Только в Prisma»: `PROVISIONED`, `DEGRADED`, `ARCHIVED`. | `TelematicsDevice.status` — это Prisma-enum (`equipment-query.service.ts:81` фильтрует `not: 'ARCHIVED'`, `schema.prisma:1652`). На экране Интеграций подпись берётся `DEVICE_STATUS_LABEL[device.status] ?? device.status` (`:139`) — для `PROVISIONED`/`DEGRADED`/`ARCHIVED` подписи нет, и владельцу покажется английский код прямо в интерфейсе. Фильтр «на связи» (`:52`) считает онлайн только `ONLINE`/`ACTIVE`, то есть `DEGRADED` (деградация) не попадёт ни в «на связи», ни в понятную подпись. Сейчас не проявляется — таблица `TelematicsDevice` пуста (телеметрия дремлет), но экран достижим и оживёт при подключении бокса. | Привести ключи словаря к значениям enum (`PROVISIONED/DEGRADED/ARCHIVED/OFFLINE/ACTIVE`), убрать `ONLINE`/`INACTIVE`; фильтр «онлайн» сверить с жизненным циклом статуса. |
| 3 | мелочь | `src/lib/validation-schemas.ts:79` и `:396` против `src/modules/sites/domain/site.aggregate.ts:10` и `prisma/schema.prisma:1759` | Значения статуса объекта разошлись: домен/SQL — `ACTIVE|INACTIVE|COMPLETED`, `createSiteSchema.status` — `active|paused|completed` (строчные, с несуществующим `paused`), `siteManageSchema.status` — `ACTIVE|PAUSED|COMPLETED` (с несуществующим `PAUSED`). | Живого риска нет: `sites/create/route.ts:33-38` не передаёт `status` из схемы (пишутся только имя/планы), дефолт колонки — `"ACTIVE"`. `siteManageSchema` не используется ни одним маршрутом (`search_files`: только определение, стр. 390). Ловушка на будущее: если эти поля начнут писать, в колонку уйдёт значение вне доменного набора. | Убрать `status` из `createSiteSchema`/`siteManageSchema` либо привести к `ACTIVE|INACTIVE|COMPLETED`. |
| 4 | мелочь | `src/lib/validation-schemas.ts:376` против `src/app/api/dictionary/manage/route.ts:17` | Тип справочника: схема `dictionaryManageSchema` требует `'PileGrade'|'DrillingType'|'DowntimeReason'` (с большой буквы), рабочий маршрут — `'pileGrade'|'drillingType'|'downtimeReason'` (строчные); сервис/БД ждут строчные. | `dictionaryManageSchema` не используется маршрутами (только экспорт и тип `DictionaryManageInput`, `search_files`: определение + тип). Два владельца одного набора значений с разным регистром — тот же класс, что уже ловили на роли (механика/мастер). | Удалить неиспользуемую `dictionaryManageSchema` либо согласовать регистр с маршрутом. |

Примечание к известному прошлому риску (не текущее расхождение): `User.role` — колонка `String`, список значений держит CHECK `chk_user_role_valid`. Код-тип `UserRole` (`src/lib/types.ts:5`) содержит 7 ролей и совпадает с актуальной проверкой (`prisma/migrations/20260906090000_user_role_check_all_roles/migration.sql:23`). Ранее было два владельца списка (`User_role_readiness_check` на 5 и `chk_user_role_valid` на 4) — оба сняты той же миграцией; сейчас один. Дрейфа нет.

### Полное совпадение (26 из 30)

| Prisma-enum | значения | код-аналог |
|---|---|---|
| BriefingRecordKind | INSTRUCTION, KNOWLEDGE | `src/modules/operator-mobile/domain/briefing-journal-view.ts:12` (`BriefingKind`); серверный тип из generated — `application/briefing-journal-query.ts:3` |
| BriefingType | INDUCTION, PRIMARY, REPEAT, UNSCHEDULED, TARGETED | `briefing-journal-view.ts:21`; маршрут `src/app/api/briefings/route.ts:14` |
| EquipmentWorkScope | OPERATION, ASSEMBLY, MAINTENANCE, RIGGING, SUPPORT | `screens/equipment-permit-labels.ts:22`; маршрут `safety/equipment-permits/route.ts:17` |
| EquipmentPermitStatus | ALLOWED, LIMITED, DENIED | `equipment-permit-labels.ts:34`; маршрут `safety/equipment-permits/route.ts:18` |
| EquipmentKind | PILE_DRIVER, DRILLING_RIG, VIBRO_HAMMER, HYBRID, OTHER | `admin-equipment/equipment-status.ts:76`; `validation-schemas.ts:155`; маршрут `safety/equipment-permits/route.ts:15` |
| HammerKind | HYDRAULIC, DIESEL, NONE | `admin-equipment/equipment-form.tsx:93`; `inspections/template-editor-parts.tsx:22`; `validation-schemas.ts:174` |
| EquipmentDocumentType | PASSPORT, OTS, INSURANCE, INSPECTION, CERTIFICATE, MAINTENANCE_LOG, OTHER | `modules/equipment/application/commands/equipment-document.ts:11`; маршруты `equipment/[id]/documents/route.ts:11` и `.../[docId]/route.ts:15`; `admin-equipment/detail/equipment-documents.tsx:31` |
| MaintenanceType | EO, TO1, TO2, TO3, SEASONAL, REPAIR, FAULT, SCHEDULED, INSPECTION | `piling/maintenance/maintenance-labels.ts:5`; маршрут `equipment/[id]/maintenance/route.ts:14` |
| MaintenanceStatus | PLANNED, ASSIGNED, IN_PROGRESS, ON_HOLD, DONE, CANCELLED | `maintenance-labels.ts:18`; маршрут `equipment/[id]/maintenance/route.ts:15` |
| MaintenancePriority | LOW, NORMAL, HIGH, CRITICAL | `maintenance-labels.ts:30`; маршрут `equipment/[id]/maintenance/route.ts:16` |
| DefectSeverity | LOW, NORMAL, HIGH, CRITICAL | `modules/readiness/domain/defects/types.ts:1`; маршрут `checklist-templates/route.ts:26` |
| DefectStatus | OPEN, IN_WORK, CLOSED, REJECTED | `modules/readiness/domain/defects/types.ts:4` |
| MeterSource | MANUAL, TELEMETRY | `modules/equipment/application/commands/meter-reading.ts:23`; маршруты `equipment/[id]/meter-readings/route.ts:38`, `.../fuel/route.ts:36` |
| PmTriggerType | HOURS, CALENDAR | `src/lib/pm-due.ts:10`; маршрут `maintenance-plans/route.ts:19` |
| InspectionPhase | PRE_SHIFT, POST_SHIFT | `src/app/api/inspections/route.ts:30` |
| ChecklistLevel | EO, TO1, TO2, TO3, SEASONAL | маршрут `checklist-templates/route.ts:12`; `inspections/inspection-labels.ts:1` (`InspectionLevel`) |
| AnswerType | YES_NO, STATUS4, DONE, MEASURE | `inspections/template-editor-parts.tsx:20`; маршрут `checklist-templates/route.ts:15` |
| InspectionStatus | DRAFT, COMPLETED | `inspections/inspection-labels.ts:2` |
| BlockType | BASE, HAMMER, ROTARY | `template-editor-parts.tsx:21`; маршрут `checklist-templates/route.ts:13` |
| WorkPermitRisk | NORMAL, ELEVATED | `modules/readiness/application/permits/schemas.ts:22` |
| WorkPermitState | DRAFT, PENDING_APPROVAL, APPROVED, EXPIRED, REVOKED | `modules/readiness/domain/permits/types.ts:2`; `to/readiness/api/contracts.ts:139` |
| WorkPermitApprovalRole | DISPATCHER, ADMIN | `modules/readiness/domain/permits/types.ts:3`; `contracts.ts:179` |
| ShiftType | DAY, NIGHT | `modules/reports/domain/shift-types.ts:14`; `modules/readiness/application/shifts/schemas.ts:9` |
| ShiftState | PLANNED, PENDING_ACCEPTANCE, STARTED, HANDOVER_PENDING, CLOSED, CANCELLED | `modules/readiness/domain/shifts/types.ts:8`; `contracts.ts:120` |
| OperatorEvidenceKind | KNOWLEDGE_TEST, WEATHER_SNAPSHOT, SITE_CHECK, STARTUP_READING, MAINTENANCE_ACTION, FLUID_READING, PILE_DRIVING, LEADER_DRILLING | `modules/operator-mobile/application/commands/shared.ts:299` (`EvidenceKind`) |
| PileAcceptance | PENDING, ACCEPTED, NEEDS_REDRIVE | `modules/operator-mobile/domain/pile-passport.ts:60`; маршруты `pile-passports/route.ts:15`, `.../[id]/decide/route.ts:14` |

### Только в Prisma (кода-аналога нет)

| Prisma-enum | значения | примечание |
|---|---|---|
| TelematicsProvider | TELTONIKA_FMC640, TELTONIKA_FMB640, GALILEOSKY_7X, WIALON_GENERIC, OTHER | `prisma/schema.prisma:1693`. В `src/` нет ни одного значения этих enum (поиск по `TELTONIKA/GALILEOSKY/WIALON` — только schema+миграция). |
| TelematicsAuthType | PUSH_TOKEN, API_KEY, OAUTH2, IP_ALLOWLIST, NONE | `prisma/schema.prisma:1701`. Аналогично — значений в `src/` нет. |

Это дремлющая телеметрия (не мёртвый код) — отсутствие кода-аналога дрейфом не является, но и «сверить» его не с чем.

### Проверка zod-схем маршрутов (шаг 4 задания)

Все `z.enum([...])`, пишущие в колонки-enum, содержат значение, входящее в соответствующий Prisma-enum (перечислены в «Методика»); случая «разрешено схемой, но нет в enum» не найдено. Отдельно стоит только п.1 (не `z.enum`, а type-union контракта).

## Не проверено

- Реальные значения enum в живой БД (`pg_type`/`pg_enum`) SQL-запросом не читались: сервер/прод недоступны (read-only, без доступа к БД). Вывод о совпадении DB-типов сделан по тексту миграций (`CREATE TYPE`/`ALTER TYPE`), а не по `psql`.
- Полнота охвата кода: искал `export enum`, `... as const`, `z.enum`, `..._LABEL(S)/ORDER/OPTIONS`. Наборы значений, заданные иначе (например инлайн-строкой без словаря, вычислением, значением в `switch`), могли не попасть в выборку.
- Строковые колонки с enum-подобными значениями (без Prisma-enum: `Site.status`, `FeedbackEvent.level/priority/audience`, `Report.status`, `OperatorChecklistTemplate.stage`, `WorkPermit?`) сверялись выборочно; `OperatorChecklistTemplate.stage` (String, значения `PRESHIFT_INSPECTION/SITE_READY/EO_BEFORE/TB_PILING/TB_DRILLING/EO_AFTER`) построчно по всем местам не сверял — это вне рамок «Prisma-enum vs код».
- `scripts/`, `e2e/`, `prisma/seed*`, фикстуры на значения вне enum не проверялись (задание ограничено кодом `src/` и схемой).
- `tsc`/`npm run build` не запускал: задача — опись, правок нет.
