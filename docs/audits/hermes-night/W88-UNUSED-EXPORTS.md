# W88 — неиспользуемые экспорты модулей `src/modules/`

Аудит на чтение. Ничего в коде не менялось; создан только этот отчёт.

## Итог

- Просканировано экспортируемых функций/классов/констант в `src/modules/**` (без `*.test.ts` и `__tests__`): **531**.
- Экспортов, которые **не импортирует никто** в `src/`, `e2e/`, `tests/`, `scripts/`: **53**.
  - из них вне замороженных зон, пригодны для разбора: **27** (важно — 13, мелочь — 14);
  - внутри замороженного модуля `src/modules/operator-mobile/**`: **26** (не оценивались как удаляемые — зона владельца).
- Экспортов, импортируемых **только тестами** (в прод не подключены): **33** — категория «мёртвое в проде, живое только в спеке».
- Критичных находок нет: неиспользуемый экспорт — это риск путаницы и лишнего веса бандла, а не утечка данных.
- Топ-5 (важно, ноль импортов, экспорт висит на публичном барреле модуля):
  1. `getDashboardStats` — `src/modules/reports/application/queries/report-query.service.ts:332` (в `reports/index.ts`).
  2. `reportDetailInclude` — `report-query.service.ts:18` (в `reports/index.ts`).
  3. `retireEquipment` — `src/modules/equipment/application/commands/equipment-command.service.ts:51` (в `equipment/index.ts`) — списание оборудования, вероятно «выключено из UI», но API осталось.
  4. `createSite` — `src/modules/sites/application/commands/site-command.service.ts:13` (в `sites/index.ts`); рядом живёт `createSiteWithPlans`, которым и пользуются.
  5. `isSystemSafetyBlocker`, `READINESS_CRITERION_KEYS`, `BLOCKER_CONDITIONS` — `src/modules/readiness/domain/readiness-rules.ts` — попадают в клиентский баррель `@/modules/readiness` через `export *`, хотя не нужны ни одному потребителю.

## Методика

Автоматический разбор (node-скрипт, scratch, вне репозитория):

1. Обход `src/`, `e2e/`, `tests/`, `scripts/` (`.ts/.tsx/.js/...`), парсинг `export function|const|let|var|class|enum`, `export {…} from`, `export * from`, `export {…}`, `import {…} from`, `import * as`, `import(…)` (динамический).
2. Разрешение спецификаторов `@/…` → `src/…`, относительных — по каталогу файла (файл, `+ext`, `/index+ext`).
3. Транзитивное разрешение имени через баррели: `export { X } from`, `export * from` (origin-файл определяется рекурсивно).
4. Для динамических импортов (`import('@/modules/x')` + `const { fn } = await helper()`) имя извлекается из деструктуризации/обращений `mod.fn`.
5. Экспорт считается неиспользуемым, если ни один `import` в `src/`, `e2e/`, `tests/`, `scripts/` не разрешается в его origin-файл. Дополнительно считались текстовые вхождения имени вне файла-определения и вхождения внутри файла (чтобы отличить «совсем мёртвый» от «экспорт не нужен, но используется локально»).

Ручные проверки выборочно: `computeFuelConsumption`, `getCrewById`, `INCIDENT_CATEGORIES`, `READINESS_READY_THRESHOLD`, `clonePageLayoutTemplate`, `retireEquipment`, `getDashboardStats`, `createSite`, `toDay`, `VERDICT_LABELS`, `csvRows`, `AUDIT_DIGEST_DOMAIN`, `verifyTenantAuditChain`, `acceptHandoverSchema` — совпали с разбором. Найдено и исправлено в скрипте до подсчёта: экспорт через `export *` (иначе все имена барреля давали ложный «ноль»), многострочные и «склеенные через `;`» импорты, `import` внутри комментария (см. `fuel-log.test.ts`).

Важно: строка `export { X } from './...'` в барреле импортом не считается. Поэтому «импортов 0» для имени, которое реэкспортируется через `index.ts`, означает ровно «на публичной поверхности есть, потребителей нет».

## Находки

### A. Ноль импортов, вне замороженных зон (27)

| # | severity | модуль | экспорт | file:line | импортов | комментарий |
|---|----------|--------|---------|-----------|----------|-------------|
| 1 | важно | reports | `getDashboardStats` | src/modules/reports/application/queries/report-query.service.ts:332 | 0 | Экспортируется через `reports/index.ts` и `queries/index.ts`, потребителей нет; в файле тоже не вызывается. Кандидат: удалить из баррелей/из кода либо подключить (проверить, не остался ли от снятой страницы дашборда). |
| 2 | важно | reports | `reportDetailInclude` | src/modules/reports/application/queries/report-query.service.ts:18 | 0 | Prisma-`include` вынесен в публичный экспорт, используется только внутри файла. Убрать `export`. |
| 3 | важно | equipment | `retireEquipment` | src/modules/equipment/application/commands/equipment-command.service.ts:51 | 0 | Есть в `equipment/index.ts`, никто не зовёт (даже внутри файла). Списание техники недоступно ни из UI, ни из API. Проверить вручную: задумано ли как «выключенная» функция. |
| 4 | важно | equipment | `METER_JUMP_WARN_HOURS` | src/modules/equipment/application/commands/meter-reading.ts:30 | 0 | Константа в `equipment/index.ts`; потребителей нет (внутри файла используется 3 раза). Оставить константу, снять с барреля. |
| 5 | важно | sites | `createSite` | src/modules/sites/application/commands/site-command.service.ts:13 | 0 | В `sites/index.ts`; не вызывается. Рядом `createSiteWithPlans` (живой) — вероятно, `createSite` вытеснен. Проверить вручную. |
| 6 | важно | reports | `toPrismaCreateData` | src/modules/reports/infrastructure/report.prisma.mapper.ts:13 | 0 | Реэкспорт в `reports/infrastructure/index.ts`; потребителей нет. Мапперы отчёта подключены иначе. |
| 7 | важно | reports | `toOutboxData` | src/modules/reports/infrastructure/report.prisma.mapper.ts:94 | 0 | Аналогично: в барреле infrastructure, потребителей нет (одноимённые функции в crews/equipment — другие). |
| 8 | важно | reports | `isReportDomainEventType` | src/modules/reports/domain/report-event-types.ts:50 | 0 | Реэкспортируется цепочкой `report.events.ts` → `reports/domain/index.ts`; потребителя нет ни у одного звена. Снять с баррелей или удалить, если не нужен как guard. |
| 9 | важно | readiness | `READINESS_CRITERION_KEYS` | src/modules/readiness/domain/readiness-rules.ts:1 | 0 | Попадает в клиентский баррель `@/modules/readiness` через `export *`. Используется только внутри файла. Убрать `export` — меньше веса в клиентском бандле. |
| 10 | важно | readiness | `BLOCKER_CONDITIONS` | src/modules/readiness/domain/readiness-rules.ts:26 | 0 | То же (внутри файла — 2 ссылки). |
| 11 | важно | readiness | `isSystemSafetyBlocker` | src/modules/readiness/domain/readiness-rules.ts:106 | 0 | То же, 0 ссылок вообще. |
| 12 | важно | readiness | `VERDICT_LABELS` | src/modules/readiness/domain/readiness-score.ts:66 | 0 | В клиентском барреле. В `assistant-app.tsx` есть СВОЯ локальная `VERDICT_LABELS` — дубль, потребителя у модульной нет. Проверить вручную: не должна ли UI брать метки отсюда. |
| 13 | важно | readiness | `readinessTone` | src/modules/readiness/domain/readiness-score.ts:235 | 0 | В клиентском барреле, 0 ссылок. Проверить вручную: задумано под UI-тон. |
| 14 | мелочь | readiness | `READINESS_BACKFILL_BATCH_SIZE` | src/modules/readiness/application/backfill/backfill-service.ts:8 | 0 | Экспорт-константа, используется внутри файла; глубокая ветка `application/backfill`, на баррель не выведена. |
| 15 | мелочь | readiness | `parseStrongEtag` | src/modules/readiness/application/command-pipeline/etag.ts:12 | 0 | Вызывается только внутри `resolveExpectedVersion` того же файла. Убрать `export`. |
| 16 | мелочь | readiness | `assertCurrentVersion` | src/modules/readiness/application/command-pipeline/etag.ts:60 | 0 | Не вызывается нигде, даже внутри файла. Кандидат на удаление (проверить, не заготовка под будущие команды). |
| 17 | мелочь | readiness | `replayableHeaders` | src/modules/readiness/application/command-pipeline/execute-command.ts:41 | 0 | Внутри файла — 1 ссылка, наружу не выведена. |
| 18 | мелочь | readiness | `csvRows` | src/modules/readiness/application/csv-export.ts:50 | 0 | Зовётся внутри `buildReadinessCsv`; отдельный экспорт не нужен. |
| 19 | мелочь | readiness | `csvSha256` | src/modules/readiness/application/csv-export.ts:54 | 0 | Зовётся внутри `buildReadinessCsv`; экспорт лишний. |
| 20 | мелочь | readiness | `isReadinessProjectionEvent` | src/modules/readiness/application/projection/consumer.ts:3 | 0 | Проверка-гард, вызывается только из `consumeReadinessProjectionEvent` того же файла. Убрать `export`. |
| 21 | мелочь | readiness | `AUDIT_DIGEST_DOMAIN` | src/modules/readiness/domain/audit/digest.ts:3 | 0 | Доменный домен-префикс хеша; используется внутри `digestAuditEvent`. Проверить вручную (аудит-цепочка — потенциально чувствительная зона). |
| 22 | мелочь | readiness | `sha256Hex` | src/modules/readiness/domain/audit/digest.ts:5 | 0 | Внутренний хелпер аудит-дайджеста, наружу не выведен. Проверить вручную. |
| 23 | мелочь | readiness | `AUDIT_REDACTION` | src/modules/readiness/domain/audit/mask.ts:4 | 0 | Константа `'[REDACTED]'`; используется внутри файла. Проверить вручную. |
| 24 | мелочь | readiness | `isOpenDefect` | src/modules/readiness/domain/defects/defect.ts:31 | 0 | Предикат, внутри файла 1 ссылка; наружу не позван. |
| 25 | мелочь | readiness | `buildEvidenceReferences` | src/modules/readiness/domain/evaluation/evidence.ts:78 | 0 | Внутри файла 1 ссылка; наружу не позван. |
| 26 | мелочь | readiness | `requiredApprovalRoles` | src/modules/readiness/domain/permits/approval-policy.ts:48 | 0 | Не вызывается нигде, даже внутри файла. Проверить вручную: политика согласования нарядов (0 ссылок — риск, что логика не подключена, а не «мёртвая»). |
| 27 | мелочь | readiness | `verifyTenantAuditChain` | src/modules/readiness/infrastructure/audit/verify-chain.ts:81 | 0 | Верификация аудит-цепочки не вызывается нигде. Проверить вручную: не запланирована ли как админ-проверка (ср. R72 «readiness audit trail»). |

### B. Ноль импортов — замороженный модуль `src/modules/operator-mobile/**` (26), не трогать

Правило AGENTS.md: `src/modules/operator-mobile/**` — замороженная зона (варианты операторского экрана, решает владелец). Ниже — только список (path:line), без оценки «удалить».

```
src/modules/operator-mobile/application/commands/shift-close.ts:117  submitShiftReport
src/modules/operator-mobile/domain/briefing-journal-view.ts:38       BRIEFING_STATUS_LABELS
src/modules/operator-mobile/domain/briefing-journal-view.ts:98       toDayValue
src/modules/operator-mobile/domain/checklist-types.ts:118            checklistItems
src/modules/operator-mobile/domain/hazard-classification.ts:44       SAFETY_CLASSIFICATION_RULE
src/modules/operator-mobile/domain/hazard-classification.ts:49       isObservedHazardSign
src/modules/operator-mobile/domain/hazard-classification.ts:52       isSafetyIncidentState
src/modules/operator-mobile/domain/hazard-classification.ts:55       isHazardSeverity
src/modules/operator-mobile/domain/incidents.ts:61                   isIncidentCategory
src/modules/operator-mobile/domain/incidents.ts:96                   INCIDENT_DESCRIPTION_MAX
src/modules/operator-mobile/domain/knowledge-bank.ts:400             findQuestion
src/modules/operator-mobile/domain/pile-passport.ts:194              SOIL_REST_DAYS
src/modules/operator-mobile/domain/ppe.ts:35                         PPE_LABELS
src/modules/operator-mobile/domain/ppe.ts:45                         ppeConfirmedFor
src/modules/operator-mobile/domain/ppe.ts:53                         toDay
src/modules/operator-mobile/domain/safety-briefing.ts:82             briefingRules
src/modules/operator-mobile/domain/safety-checklist-period.ts:26     TB_INSTRUCTION_CODE
src/modules/operator-mobile/domain/safety-checklist-period.ts:37     TB_WARN_DAYS
src/modules/operator-mobile/domain/safety-checklist-period.ts:48     repeatMonthsFor
src/modules/operator-mobile/domain/shift-conditions.ts:15            CONDITION_THRESHOLDS
src/modules/operator-mobile/domain/shift-phases.ts:74                STAGE_PREREQUISITES
src/modules/operator-mobile/domain/shift-window.ts:17                SHIFT_WINDOW
src/modules/operator-mobile/domain/shift-window.ts:52                localHourInstant
src/modules/operator-mobile/domain/slinger-briefing.ts:98            slingerBriefingRules
src/modules/operator-mobile/domain/work-warnings.ts:63               COLD_STOP_C
src/modules/operator-mobile/domain/work-warnings.ts:272              hasAlerts
```

Замечание: часть из них реэкспортируется клиентским входом `src/modules/operator-mobile/contracts.ts` (например, `checklistItems`, `findQuestion`, `briefingRules`, `CONDITION_THRESHOLDS`, `PPE_LABELS`, `toDayValue`, `BRIEFING_STATUS_LABELS`, `COLD_STOP_C`, `slingerBriefingRules`) — «на поверхности есть, потребителя нет». Но зона заморожена, решение за владельцем.

### C. Импортируются только тестами (33) — мертвы в проде

Значит, в приложении эти экспорты не вызываются: единственные импортёры — `*.test.ts(x)` или `tests/`. Это либо «экспорт оставлен ради теста» (убрать с публичной поверхности), либо признак, что фича не подключена.

```
src/modules/crews/infrastructure/crew.repository.ts:24                          PrismaCrewRepository
src/modules/equipment/application/commands/fuel-log.ts:72                       computeFuelConsumption
src/modules/equipment/application/commands/meter-reading.ts:146                 checkMeterReading
src/modules/equipment/application/queries/equipment-query.service.ts:13         getAccessibleEquipment
src/modules/equipment/application/queries/equipment-query.service.ts:18         getEquipmentById
src/modules/equipment/application/queries/equipment-query.service.ts:44         listEquipmentWithCrewCounts
src/modules/equipment/application/queries/equipment-query.service.ts:211        listEquipmentCatalog
src/modules/equipment/infrastructure/equipment.repository.ts:10                 PrismaEquipmentRepository
src/modules/inspections/domain/state-diff.ts:75                                 describeStateChanges
src/modules/layout/domain/surfaces.ts:38                                        EQUIPMENT_CARD_SURFACE_ID
src/modules/operator-mobile/domain/operator-admission.ts:118                     isIdentityValid (заморожено)
src/modules/operator-mobile/domain/work-warnings.ts:99                           weatherStop (заморожено)
src/modules/readiness/application/bootstrap-query.ts:31                         readReadinessFeatureFlags
src/modules/readiness/application/csv-export.ts:44                              safeCsvCell
src/modules/readiness/domain/audit/mask.ts:5                                    MAX_MASKED_AUDIT_BYTES
src/modules/readiness/domain/audit/mask.ts:24                                   maskAuditPayload
src/modules/readiness/domain/defects/defect.ts:27                               blocksOperation
src/modules/readiness/domain/permits/transitions.ts:38                          transitionPermit
src/modules/readiness/domain/shifts/transitions.ts:66                           transitionShift
src/modules/readiness/domain/shifts/transitions.ts:83                           transitionHandover
src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts:15  tenantStorageScope
src/modules/readiness/infrastructure/readiness-worker-entry.ts:21               executeReadinessWorkerJob
src/modules/readiness/infrastructure/tenant-transaction.ts:19                   runReadinessTenantTransaction
src/modules/readiness/infrastructure/tenant-transaction.ts:80                   runReadinessSerializableTransaction (и tests/integration/*)
src/modules/reports/application/commands/report-validation.service.ts:11        validateDowntimeWithinShift
src/modules/reports/application/commands/report-validation.service.ts:35        validateReportDateNotInFuture
src/modules/reports/application/commands/report-validation.service.ts:44        validateReportRequiredFields
src/modules/reports/application/commands/report-validation.service.ts:55        validatePileEntries
src/modules/reports/application/commands/report-validation.service.ts:70        validateDrillingEntries
src/modules/reports/application/commands/report-validation.service.ts:88        validateDowntimeEntries
src/modules/reports/infrastructure/report.repository.ts:85                      PrismaReportRepository
src/modules/sites/application/commands/site-admin-command.service.ts:47         normalizeSitePlans
src/modules/sites/infrastructure/site.repository.ts:14                          PrismaSiteRepository
```

## Не проверено

- Не проверено удаление/правку не предлагаю намеренно: по AGENTS.md любое удаление требует доказательства нулевых ссылок по всему репозиторию, включая строковые пути маршрутов и CSS. Здесь доказано только отсутствие импортов в `src/`, `e2e/`, `tests/`, `scripts/`.
- Не проверено (вне разбора): экспорты, отданные как `export default` без имени, и локальные объявления, вынесенные наружу строкой `export { x }` без inline-`export` — их разбор не покрывает; такие случаи в `src/modules` могли не попасть в список 531.
- Не проверено: сборка/бандл-эффект (попадает ли конкретный экспорт в клиентский чанк) — оценка «вес бандла» сделана по признаку «в клиентском барреле», без `npm run build` и анализа чанков.
- Не проверено: остаются ли «мёртвыми» экспорты, которые импортирует файл, сам являющийся мёртвым (цепочку мёртвых модулей я не разворачивал).
- Не проверено намеренно (по правилам): `src/modules/telemetry/**` (спящий по решению), роли «Мастер»/«Инженер ОТ», мультитенантность — в замороженные/сохранённые не заглядывал глубже, чем требовал список.
- Не проверено: файлы `src/generated/**` и `src/generated/postgres-client/**` — совпадения имён там (напр. `checklistItems`) к модулям не относятся.
