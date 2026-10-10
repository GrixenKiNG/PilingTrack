# AU118-S6 — Поля времени в схеме Prisma: createdAt/updatedAt/архивация, тип и часовой пояс

Версия (git rev-parse HEAD): `dee7ced9db19d5c6648ec0166f66b717c31fc456`
Файл схемы: `prisma/schema.prisma` (2883 строки). Только чтение: код приложения и схема не менялись.

## Итог

Резюме для владельца (5 строк):
1. Все поля времени в базе — с часовым поясом: 231 поле `@db.Timestamptz(3)` и 2 поля `@db.Date`; полей без зоны — ноль. Хранить «время без пояса» схема не позволяет.
2. Три модели вообще не хранят время создания: `ChecklistSection`, `ChecklistItem`, `InspectionAnswer` — по строкам-потомкам нельзя узнать, когда они созданы.
3. Бизнес-дата («сутки», «неделя», «дата ТО») записана тремя разными способами: строкой `YYYY-MM-DD`, типом `date` и полным `timestamptz` — считать «за сутки» приходится тремя способами.
4. Архивация времени почти не хранит: время архива/удаления есть только у `PileGrade.archivedAt` и `Media.deletedAt`; у остальных справочников — только флаг `isActive` без даты.
5. У 4 моделей `updatedAt` записан как `@default(now()) @updatedAt` — избыточно, но не вредно.

Количество находок по важности: критично — 0, важно — 2, мелочь — 4. Плюс 2 положительных вывода (ПРОЙДЕНО).
Топ-5: (1) 3 модели без времени создания; (2) три представления бизнес-даты; (3) 10 моделей без `createdAt`; (4) `updatedAt` с лишним `@default(now())`; (5) несогласованная архивация.

Числа (командами):
- моделей: `grep -c '^model '` → **83**; перечислений: `grep -c '^enum '` → **30**.
- строк со словом `DateTime`: **233**; из них `@db.Timestamptz(3)` → **231**, `@db.Date` → **2**; без аннотации `@db.*` → **0** (`grep -nE 'DateTime' | grep -v '@db.Timestamptz' | grep -v '@db.Date'` — пусто, exit 1).
- `@default(now())` всего: **94**; `@updatedAt` всего: **50**.
- моделей без `createdAt`: **10**; без `updatedAt`: **33**; без единого поля времени: **3**.

## Методика

Работа только чтением схемы; скрипты писались в каталог-скретч вне репозитория, чтобы не создавать файлов в проекте.

1. `git rev-parse HEAD` — зафиксирована версия.
2. `grep -c '^model '` / `grep -c '^enum '` — число моделей и перечислений.
3. `grep -c 'DateTime'`, `grep -c '@db.Timestamptz(3)'`, `grep -n '@db.Date'` и
   `grep -nE 'DateTime' prisma/schema.prisma | grep -v '@db.Timestamptz' | grep -v '@db.Date'` —
   тип и наличие пояса у каждого поля времени. Пустой последний результат (exit 1) = полей без зоны нет.
4. Разбор схемы скриптом на `node` (`schema_parse.cjs`, в скретче): по каждой модели собраны
   поля `createdAt`/`updatedAt`/`archivedAt`/`deletedAt`, их тип (`Timestamptz`/`Date`/без аннотации),
   `@default(now())`, `@updatedAt`. Отдельными проходами выведены: модели без `createdAt`, без `updatedAt`,
   `updatedAt` с `@default(now())`, поля `archivedAt`/`deletedAt`, поля `@db.Date`, `createdAt` без `@default(now())`.
5. Отдельный прогон искал модели без единого поля `DateTime`; `grep` — поля «бизнес-даты» и поля `timezone`.
6. Строки в таблице и находках сверены с содержимым `prisma/schema.prisma` (прочитан целиком).

Команды воспроизводимы из корня репозитория на текущей версии.

## Таблица моделей (83)

Обозначения: `TZ` — `@db.Timestamptz(3)`; `Date` — `@db.Date`. В колонке `createdAt`/`updatedAt`
список в скобках означает поле-замену у моделей без одноимённого поля. `—` — поля нет.

| # | Модель | schema.prisma | createdAt | updatedAt | архив/удаление | теперь |
|---|---|---|---|---|---|---|
| 1 | Tenant | 14 | TZ | TZ | — | +now |
| 2 | TenantInvoice | 65 | TZ | — | — | +now |
| 3 | User | 93 | TZ | TZ | — | +now |
| 4 | UserDocumentType | 162 | TZ | TZ | — | +now |
| 5 | UserDocument | 192 | TZ | TZ | — | +now |
| 6 | PpeCheck | 228 | TZ | — | — | +now |
| 7 | BriefingRecord | 293 | TZ | — | — | +now |
| 8 | UserEquipmentPermit | 398 | TZ | TZ | — | +now |
| 9 | Equipment | 440 | TZ | TZ | — | +now |
| 10 | EquipmentDocument | 543 | TZ | TZ | — | +now |
| 11 | MaintenanceRecord | 580 | TZ | TZ | — | +now |
| 12 | EquipmentDefect | 658 | TZ | TZ | — | +now |
| 13 | MeterReading | 731 | TZ | — | — | +now |
| 14 | FuelLog | 762 | TZ | — | — | +now |
| 15 | MaintenancePlan | 789 | TZ | TZ | — | +now |
| 16 | ChecklistTemplate | 854 | TZ | TZ | — | +now |
| 17 | ChecklistSection | 874 | — | — | — | нет |
| 18 | ChecklistItem | 887 | — | — | — | нет |
| 19 | TenantSettings | 914 | TZ | TZ | — | +now |
| 20 | ReadinessRuleSet | 933 | TZ | TZ | — | +now |
| 21 | ReadinessAccessMatrix | 953 | TZ | TZ | — | +now |
| 22 | ReadinessScoreSnapshot | 973 | — (calculatedAt 993) | — | — | +now |
| 23 | CurrentReadiness | 1008 | TZ | TZ | — | +now |
| 24 | ReadinessBackfillProgress | 1027 | TZ | TZ | — | +now |
| 25 | Shift | 1081 | TZ | TZ | — | +now |
| 26 | ShiftStartWaiver | 1144 | — (issuedAt 1154) | — | — | +now |
| 27 | ShiftHandover | 1160 | TZ | TZ | — | +now |
| 28 | OperatorChecklistTemplate | 1199 | TZ | TZ | — | +now |
| 29 | OperatorChecklistExecution | 1221 | TZ | — | — | +now |
| 30 | OperatorChecklistAnswerRecord | 1248 | TZ | — | — | +now |
| 31 | OperatorShiftEvidence | 1273 | TZ | — | — | +now |
| 32 | SafetyIncident | 1298 | TZ | TZ | — | +now |
| 33 | RepairVerification | 1341 | TZ | TZ | — | +now |
| 34 | UserPlacePreset | 1379 | TZ | TZ | — | +now |
| 35 | PermitWorkType | 1404 | TZ | TZ | — | +now |
| 36 | WorkPermit | 1442 | TZ | TZ | — | +now |
| 37 | WorkPermitApproval | 1517 | — (approvedAt 1524) | — | — | +now |
| 38 | ModuleLayoutTemplate | 1537 | TZ | TZ | — | +now |
| 39 | Inspection | 1554 | TZ | TZ | — | +now |
| 40 | InspectionAnswer | 1587 | — | — | — | нет |
| 41 | DeviceKey | 1608 | TZ | — | — | +now |
| 42 | TelematicsDevice | 1648 | TZ | TZ | — | +now |
| 43 | TelematicsDeviceAssignment | 1725 | — (startedAt 1730) | — | — | +now |
| 44 | Site | 1746 | TZ | TZ | — | +now |
| 45 | SitePilePlan | 1780 | TZ | TZ | — | +now |
| 46 | SiteDrillingPlan | 1797 | TZ | TZ | — | +now |
| 47 | PileField | 1811 | TZ | TZ | — | +now |
| 48 | Cluster | 1825 | TZ | TZ | — | +now |
| 49 | Picket | 1839 | TZ | TZ | — | +now |
| 50 | Crew | 1858 | TZ | TZ | — | +now |
| 51 | CrewAssistant | 1886 | TZ | TZ | — | +now |
| 52 | UserSiteAssignment | 1908 | TZ | TZ | — | +now |
| 53 | Report | 1927 | TZ | TZ | — | +now |
| 54 | ReportVersion | 1993 | TZ | — | — | +now |
| 55 | ReportAudit | 2010 | TZ | — | — | +now |
| 56 | TelemetryRecord | 2034 | TZ | — | — | +now |
| 57 | OutboxEvent | 2058 | TZ | — | — | +now |
| 58 | ReportAnalytics | 2094 | TZ | — | — | +now |
| 59 | SiteDailySummary | 2113 | TZ | TZ | — | +now |
| 60 | SiteWeeklyTrend | 2140 | TZ | TZ | — | +now |
| 61 | PileWork | 2172 | TZ | — | — | +now |
| 62 | PilePassport | 2236 | TZ | TZ | — | +now |
| 63 | PileDrivingSet | 2323 | TZ | — | — | +now |
| 64 | LeaderDrilling | 2355 | TZ | — | — | +now |
| 65 | ReportDowntime | 2392 | TZ | — | — | +now |
| 66 | PileGrade | 2439 | TZ | TZ | archivedAt 2456 | +now |
| 67 | DrillingType | 2468 | TZ | TZ | — | +now |
| 68 | DowntimeReason | 2485 | TZ | TZ | — | +now |
| 69 | TelegramConfig | 2506 | TZ | TZ | — | +now |
| 70 | FeedbackEvent | 2524 | TZ | — | — | +now |
| 71 | FeedbackEventRead | 2552 | TZ | TZ | — | +now |
| 72 | AuditLog | 2573 | — (timestamp 2587) | — | — | +now |
| 73 | TenantAuditChain | 2620 | — | TZ | — | +now |
| 74 | IdempotencyKey | 2632 | TZ | — | — | +now |
| 75 | DeviceSyncState | 2662 | TZ | TZ | — | +now |
| 76 | TrustedOperatorDeviceRecord | 2681 | — (registeredAt 2688) | — | — | +now |
| 77 | ServerOfflineAuthorizationKey | 2694 | TZ | — | — | +now |
| 78 | OfflineWorkAuthorizationRecord | 2703 | TZ | — | — | +now |
| 79 | Media | 2720 | TZ | TZ | deletedAt 2736 | +now |
| 80 | ConflictAudit | 2753 | TZ | — | — | +now |
| 81 | ReportPhoto | 2781 | TZ | — | — | +now |
| 82 | DeadLetterQueue | 2823 | TZ | TZ | — | +now |
| 83 | OrionLead | 2860 | TZ | TZ | — | +now |

Поля типа `@db.Date` (не timestamptz, только дата — намеренно): `PpeCheck.productionDate` (schema.prisma:234), `Shift.productionDate` (schema.prisma:1087).

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| F1 | важно | `prisma/schema.prisma:874,887,1587` | Три модели без единого поля времени: `ChecklistSection` (874), `ChecklistItem` (887), `InspectionAnswer` (1587) — нет ни `createdAt`, ни `updatedAt`, ни заменяющего `@default(now())`. | По этим строкам нельзя понять, когда они созданы и менялись: при разборе «кто исправил пункт чек-листа» и при сверке ответов осмотра опоры нет. У остальных 80 моделей время есть — здесь единственные три исключения. | Добавить `createdAt DateTime @default(now()) @db.Timestamptz(3)` (миграция — отдельной задачей, схему правит владелец/БД-контур). |
| F2 | важно | `prisma/schema.prisma:1935,2116,2144,2145` vs `234,1087` vs `1567` | Бизнес-дата хранится тремя разными способами: строкой `YYYY-MM-DD` (`Report.date` 1935, `SiteDailySummary.date` 2116, `SiteWeeklyTrend.weekStart` 2144 / `weekEnd` 2145), типом `date` (`PpeCheck.productionDate` 234, `Shift.productionDate` 1087) и полным `timestamptz` (`Inspection.inspectionDate` 1567). | Выборка «за производственные сутки» пишется по-разному для отчёта, сводки, смены и осмотра; строку `date` БД не проверяет на формат (мусор «2026-13-99» пройдёт), а `timestamptz` подтягивает пояс, которого у чистых суток нет. Сравнение и группировка по дате между этими моделями хрупки. | Свести бизнес-дату к одному типу (`@db.Date`, пояс — отдельным полем `timezone`, которое уже есть у `Shift`/`WorkPermit`). |
| F3 | мелочь | см. список ниже | 10 моделей без `createdAt`. У 6 из них поле осознанно заменено своим временем сущности с `@default(now())`: `ReadinessScoreSnapshot.calculatedAt` (993), `ShiftStartWaiver.issuedAt` (1154), `WorkPermitApproval.approvedAt` (1524), `TelematicsDeviceAssignment.startedAt` (1730), `AuditLog.timestamp` (2587), `TrustedOperatorDeviceRecord.registeredAt` (2688). Остальные: `ChecklistSection` (874), `ChecklistItem` (887), `InspectionAnswer` (1587) — уже в F1, и `TenantAuditChain` (2620, только `updatedAt`). | Для immutable/append-only моделей своё поле времени вместо `createdAt` — нормально. Но при переносе запроса «когда заведено» между моделями имя каждый раз разное, легко забыть про модель без времени. `TenantAuditChain` вообще не имеет момента создания цепочки. | Оставить как есть для 6 замен (задокументировано); F1 закрыть `createdAt`; для `TenantAuditChain` при необходимости добавить время создания. |
| F4 | мелочь | `prisma/schema.prisma:1017,1036,1210,2624` | `updatedAt` записан как `@default(now()) @updatedAt` в 4 моделях: `CurrentReadiness` (1017), `ReadinessBackfillProgress` (1036), `OperatorChecklistTemplate` (1210), `TenantAuditChain` (2624). | `@updatedAt` сам проставляет время и при создании, и при обновлении; `@default(now())` рядом избыточен. Не ошибка, но отличает эти 4 модели от остальных 46 и намекает на скрытый смысл (сброс времени при upsert), которого в схеме нет. | Убрать лишний `@default(now())` либо оставить осознанно с комментарием. |
| F5 | мелочь | `prisma/schema.prisma:2456,2736` vs `180,2474,2491` | Время архивации/удаления есть только у `PileGrade.archivedAt` (2456) и `Media.deletedAt` (2736). Остальные справочники выключаются флагом без даты: `UserDocumentType.isActive` (180), `DrillingType.isActive` (2474), `DowntimeReason.isActive` (2491) и т.п. | «Запись выключена» видно, «когда выключена» — нет: при разборе «почему марка пропала из выбора в тот день» ответ есть только у свай. Единой конвенции архивации в схеме нет. | Ввести общий `archivedAt DateTime? @db.Timestamptz(3)` (или правило «`isActive` + дата»), применяя по мере надобности. |
| F6 | мелочь (ГИПОТЕЗА) | `prisma/schema.prisma:1562,1566` | У `Inspection` рядом лежат `shiftId String?` (1562, ссылка) и `shift String?` (1566, снимок-строка). Возможно, `shift` — устаревшее поле прошлой итерации. | Два поля об одной смене: читающий код может взять не то, что нужно. Не проверено, используется ли `shift` в коде (см. «Что не проверено»). | Если `shift` не читается — удалять только после доказательства нулевых ссылок (AGENTS.md §4). |

Положительные выводы (ПРОЙДЕНО):
- P1: Полей времени без часового пояса — **нет**. Все 233 `DateTime`-поля аннотированы: 231 `@db.Timestamptz(3)` + 2 `@db.Date`. Команда `grep -nE 'DateTime' prisma/schema.prisma | grep -v '@db.Timestamptz' | grep -v '@db.Date'` дала пустой результат (exit 1). Сравнение `schema.prisma:1-2883`.
- P2: Часовой пояс хранится отдельным строковым полем, а не примесью в отметке времени: `User.timezone` (109), `TenantSettings.timezone` (919), `Shift.timezone` (1088), `WorkPermit.timezone` (1487). Отметки — абсолютные (`timestamptz`), пояс — свойство отображения. Дизайн согласован.

Список моделей без `createdAt` (для F3): `ChecklistSection` (874), `ChecklistItem` (887), `ReadinessScoreSnapshot` (973), `ShiftStartWaiver` (1144), `WorkPermitApproval` (1517), `InspectionAnswer` (1587), `TelematicsDeviceAssignment` (1725), `AuditLog` (2573), `TenantAuditChain` (2620), `TrustedOperatorDeviceRecord` (2681).

Список моделей без `updatedAt` (33; для полноты — в основном append-only): `TenantInvoice` 65, `PpeCheck` 228, `BriefingRecord` 293, `MeterReading` 731, `FuelLog` 762, `ChecklistSection` 874, `ChecklistItem` 887, `ReadinessScoreSnapshot` 973, `ShiftStartWaiver` 1144, `OperatorChecklistExecution` 1221, `OperatorChecklistAnswerRecord` 1248, `OperatorShiftEvidence` 1273, `WorkPermitApproval` 1517, `InspectionAnswer` 1587, `DeviceKey` 1608, `TelematicsDeviceAssignment` 1725, `ReportVersion` 1993, `ReportAudit` 2010, `TelemetryRecord` 2034, `OutboxEvent` 2058, `ReportAnalytics` 2094, `PileWork` 2172, `PileDrivingSet` 2323, `LeaderDrilling` 2355, `ReportDowntime` 2392, `FeedbackEvent` 2524, `AuditLog` 2573, `IdempotencyKey` 2632, `TrustedOperatorDeviceRecord` 2681, `ServerOfflineAuthorizationKey` 2694, `OfflineWorkAuthorizationRecord` 2703, `ConflictAudit` 2753, `ReportPhoto` 2781.

## Что не проверено

- Используется ли поле `Inspection.shift` (schema.prisma:1566) в коде приложения — НЕ ПРОВЕРЕНО (в этой задаче читалась только схема; вывод F6 помечен ГИПОТЕЗА).
- Что в реальной БД все колонки действительно созданы как `timestamptz(3)`/`date` — НЕ ПРОВЕРЕНО: подключение к базе запрещено (AGENTS.md §1, «No production»). Судил только по аннотациям `@db.*` в `prisma/schema.prisma`.
- Совпадает ли число моделей/полей схемы с миграциями `prisma/migrations/**` — НЕ ПРОВЕРЕНО (каталог миграций не читался; сверка схемы и применённой БД вне рамок этой задачи).
- Влияют ли три представления бизнес-даты (F2) на конкретные запросы «за сутки» в коде — НЕ ПРОВЕРЕНО (код не читался, задача ограничена схемой).
- Существует ли осознанная причина у `@default(now()) @updatedAt` (F4), кроме копипасты — НЕ ПРОВЕРЕНО (в схеме нет комментария, объясняющего это).
