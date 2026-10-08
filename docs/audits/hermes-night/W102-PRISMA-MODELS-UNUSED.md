# W102 — модели Prisma, которые код не использует

Дата: 2026-10-08. Ветка: `hermes/q4-0926`. Только чтение: изменялся лишь этот файл.

## Итог

Всего в `prisma/schema.prisma` объявлено **83 модели**. Из них **8 не имеют ни одного обращения** в `src/`, `scripts/`, `e2e/` ни напрямую, ни через связи. Ещё **4 модели** не имеют прямого доступа (`prisma.<имя>`), но используются через связи Prisma (`include` / вложенный `create`). Ещё **1 модель** (`DeviceSyncState`) в коде приложения не упоминается вовсе и встречается только в скрипте `scripts/apply-full-ddl.sql`.

Кандидаты на разбор (без обращений): `TenantInvoice`, `RepairVerification`, `TelematicsDeviceAssignment`, `TrustedOperatorDeviceRecord`, `ServerOfflineAuthorizationKey`, `OfflineWorkAuthorizationRecord`, `ConflictAudit`, `ReportPhoto`.

Top-5 по значимости:
1. `RepairVerification` (schema L1341) — таблица создана свежей миграцией operator v3 (2026-08-26), но кода, который её читает или пишет, нет — недостроенный контур «ремонт → проверка».
2. `TrustedOperatorDeviceRecord` + `ServerOfflineAuthorizationKey` + `OfflineWorkAuthorizationRecord` (L2677/L2690/L2699) — полный набор таблиц под оффлайн-подпись/авторизацию (миграция 2026-08-26), ни строки кода; механизм безопасности без реализации — «проверить вручную».
3. `DeviceSyncState` (L2658) — приложение в неё не пишет; единственный потребитель — запрос мониторинга `scripts/apply-full-ddl.sql:383`, который поэтому всегда вернёт 0.
4. `TelematicsDeviceAssignment` (L1725) — история привязок телематики, ни одного обращения; «проверить вручную» вместе с дремлющей телеметрией.
5. `TenantInvoice` (L65) — биллинг в коде отсутствует (только схема и архивные документы); таблица и её связи не используются.

## Методика

Охват: `src/`, `scripts/`, `e2e/` (как в задании). Исключены автоматически: `node_modules`, `.next`, `src/generated` (сгенерированный Prisma-клиент содержит имена всех моделей и дал бы ложные срабатывания), `coverage`, `test-results`, `playwright-report`. Просканировано 1468 текстовых файлов (`.ts/.tsx/.js/.jsx/.mjs/.cjs/.sql/.prisma/.json`).

Для каждой модели из `prisma/schema.prisma` искались:
- **прямой доступ** — свойство Prisma-клиента `.имяСоСтрочной` (регэксп `\.имя\b` ловит и `prisma.X`, и `tx.X`, и `(tx as PrismaClient).X`, и `db.X`);
- **SQL** — имя таблицы в кавычках `"Имя"` (сырой SQL: `FROM "Имя"`, `INSERT INTO "Имя"`, RLS-политики, сиды e2e);
- **тип** — `Prisma.<Имя>...`.

Шаги:
1. Список моделей и строк — регэксп `^model\s+(\w+)` по `prisma/schema.prisma`.
2. Подсчёт обращений (скрипт на node, рекурсивный обход указанных каталогов).
3. Модели с нулём прямых обращений доразбирались вручную: искал доступ через связи (`include`/вложенный `create`) по именам полей-связей (`sets`, `sections`, `items`, `telematicsDevices`, `assignments`, `invoices`).
4. Контроль «на весь репозиторий»: `search_files` по `\b(Имя|имя)\b` без ограничения каталогов — подтверждено, что PascalCase-имена 8 «без обращений» моделей встречаются только в `prisma/schema.prisma`, `prisma/migrations/**`, `.prisma/**`, `docs/**`, `CHANGELOG.md` (то есть в БД-слое и документации, но не в прикладном коде), а `имяСоСтрочной` (обращение клиента) не встречается в репозитории вовсе.

Ограничения метода: см. раздел «Не проверено».

## Находки

| # | severity | path:line | проблема | сценарий / чем мешает | предлагаемое действие |
|---|---|---|---|---|---|
| 1 | важно | `prisma/schema.prisma:1341` (`RepairVerification`) | Модель не читается и не пишется кодом нигде: 0 обращений в `src/`, `scripts/`, `e2e/`. Создана миграцией `20260826130000_operator_v3_repair_verification`. Поля описывают контур «ремонт инцидента → проверка мастером». | Либо фича operator v3 не доделана, либо таблица осталась пустой после переноса. Пустая таблица без владельца: занимает место, требует RLS, при следующей правке схемы про неё забывают. | Проверить вручную, нужен ли ещё контур ремонта: если нет — кандидат на удаление; если да — запланировать реализацию. |
| 2 | важно | `prisma/schema.prisma:2677` (`TrustedOperatorDeviceRecord`) | Нет обращений в коде. Миграция `20260826150000_operator_v3_offline_authority`. | Механизм доверенных устройств оператора не реализован; security-таблица «на будущее». | Проверить вручную (механизм оффлайн-подписи). Не удалять без решения владельца. |
| 3 | важно | `prisma/schema.prisma:2690` (`ServerOfflineAuthorizationKey`) | Нет обращений в коде (тот же пакет offline authority). | Ключи серверной авторизации без кода — заготовка. | Проверить вручную, как #2. |
| 4 | важно | `prisma/schema.prisma:2699` (`OfflineWorkAuthorizationRecord`) | Нет обращений в коде (тот же пакет offline authority). | Записи оффлайн-авторизации работ не создаются/не читаются. | Проверить вручную, как #2. |
| 5 | важно | `prisma/schema.prisma:2658` (`DeviceSyncState`) | Прямых обращений нет; единственные упоминания — `scripts/apply-full-ddl.sql:120`, `:121` (индексы) и `:383` (метрика мониторинга `COUNT(DISTINCT "deviceId") ... "lastSyncAt" > NOW()-1h`). Приложение в таблицу не пишет. | Метрика здоровья «сколько устройств синхронизировалось за час» всегда вернёт 0 — тихо вводящая в заблуждение цифра (наследие offline-sync). | Определить, живо ли это; иначе убрать устройство-метрику и таблицу. |
| 6 | мелочь | `prisma/schema.prisma:1725` (`TelematicsDeviceAssignment`) | Нет ни прямых обращений, ни использования через связи (поле-связь `assignments` в коде не читается). Миграции `20260517120000`, `20260526202204`. | История привязок боксов телематики не ведётся. Родственная `TelematicsDevice` при этом используется (см. отдельный раздел). | Проверить вручную вместе с дремлющей телеметрией; не удалять поспешно. |
| 7 | мелочь | `prisma/schema.prisma:65` (`TenantInvoice`) | Нет обращений в коде; единственное упоминание связи — `Tenant.invoices` (schema L43), которое тоже не читается. Биллинг-сервис в `src/` отсутствует. | Таблица биллинга без кода: место в БД + RLS-политика (`20260516100000_extend_rls_tenant_scoped`) без потребителя. | Кандидат на удаление (биллинг не подключён), но подтвердить у владельца. |
| 8 | мелочь | `prisma/schema.prisma:2749` (`ConflictAudit`) | Нет обращений в коде. Таблица эпохи offline-sync/vector clock (миграция `20260419190903_init`, содержит `clientVectorClock`/`serverVectorClock`). | Журнал конфликтов синхронизации никто не пишет. | Кандидат на удаление вместе с устаревшим offline-sync. |
| 9 | мелочь | `prisma/schema.prisma:2777` (`ReportPhoto`) | Нет обращений в коде. Дублирует назначение `Media` (schema L2716), которая используется (28 обращений). | Дублирующая таблица медиа-вложений без кода. | Кандидат на удаление; `Media` покрывает потребность. |

## Модели без прямого доступа, но используемые через связи

Это НЕ находки: строки читаются/пишутся через вложенные операции Prisma, поэтому имя модели в коде не встречается. Но если такую модель искать наивно (`prisma.<имя>`) — она ложно выглядит мёртвой.

| модель | строка | как используется | доказательство |
|---|---|---|---|
| `ChecklistSection` | `prisma/schema.prisma:874` | вложенный `create` внутри `ChecklistTemplate`; сырой SQL в сиде e2e | `src/modules/inspections/application/commands/template-commands.ts:36`; `e2e/fixtures/disposable-to-seed.mjs:3` |
| `ChecklistItem` | `prisma/schema.prisma:887` | вложенный `create` внутри `ChecklistSection`; сырой SQL в сиде e2e | `src/modules/inspections/application/commands/template-commands.ts:41`; `e2e/fixtures/disposable-to-seed.mjs:3` |
| `PileDrivingSet` | `prisma/schema.prisma:2319` | вложенный `create` под `PilePassport`; чтение через `include: { sets: ... }` | `src/modules/operator-mobile/application/commands/production.ts:367`; `src/modules/reports/application/queries/pile-journal-list.ts:87` |
| `TelematicsDevice` | `prisma/schema.prisma:1648` | чтение через `include`/связь из установки | `src/modules/equipment/application/queries/equipment-query.service.ts:80`,`:203`; `src/components/piling/admin-equipment/detail/equipment-detail.tsx:274` |

Примечание: `OrionLead` (`prisma/schema.prisma:2856`) обращается как `(tx as PrismaClient).orionLead` в `src/app/api/orion/lead/route.ts:93`,`:141` — это зона ORION (заморожена), поэтому в находки не выносится; модель используется.

## Полная опись (все 83 модели)

`prop` — обращения через свойство клиента (`.имя`), `sql` — имя таблицы в кавычках в сыром SQL, `type` — `Prisma.<Имя>` (всегда 0 в охвате). Данные — из скрипта обхода `src/`, `scripts/`, `e2e/`.

| строка | модель | prop | sql | статус |
|---|---|---|---|---|
| 14 | Tenant | 46 | 1 | используется |
| 65 | TenantInvoice | 0 | 0 | без обращений |
| 93 | User | 164 | 17 | используется |
| 162 | UserDocumentType | 24 | 0 | используется |
| 192 | UserDocument | 18 | 0 | используется |
| 228 | PpeCheck | 4 | 0 | используется |
| 293 | BriefingRecord | 17 | 2 | используется |
| 398 | UserEquipmentPermit | 3 | 0 | используется |
| 440 | Equipment | 308 | 19 | используется |
| 543 | EquipmentDocument | 6 | 0 | используется |
| 580 | MaintenanceRecord | 24 | 4 | используется |
| 658 | EquipmentDefect | 18 | 0 | используется |
| 731 | MeterReading | 15 | 2 | используется |
| 762 | FuelLog | 7 | 0 | используется |
| 789 | MaintenancePlan | 15 | 0 | используется |
| 854 | ChecklistTemplate | 11 | 1 | используется |
| 874 | ChecklistSection | 0 | 1 | через связи/e2e |
| 887 | ChecklistItem | 0 | 1 | через связи/e2e |
| 914 | TenantSettings | 17 | 0 | используется |
| 933 | ReadinessRuleSet | 17 | 0 | используется |
| 953 | ReadinessAccessMatrix | 13 | 0 | используется |
| 973 | ReadinessScoreSnapshot | 8 | 1 | используется |
| 1008 | CurrentReadiness | 16 | 4 | используется |
| 1027 | ReadinessBackfillProgress | 5 | 0 | используется |
| 1081 | Shift | 173 | 11 | используется |
| 1144 | ShiftStartWaiver | 3 | 0 | используется |
| 1160 | ShiftHandover | 8 | 0 | используется |
| 1199 | OperatorChecklistTemplate | 4 | 0 | используется |
| 1221 | OperatorChecklistExecution | 15 | 0 | используется |
| 1248 | OperatorChecklistAnswerRecord | 2 | 0 | используется |
| 1273 | OperatorShiftEvidence | 8 | 0 | используется |
| 1298 | SafetyIncident | 9 | 0 | используется |
| 1341 | RepairVerification | 0 | 0 | без обращений |
| 1379 | UserPlacePreset | 3 | 0 | используется |
| 1404 | PermitWorkType | 2 | 0 | используется |
| 1442 | WorkPermit | 12 | 1 | используется |
| 1517 | WorkPermitApproval | 2 | 0 | используется |
| 1537 | ModuleLayoutTemplate | 5 | 0 | используется |
| 1554 | Inspection | 59 | 3 | используется |
| 1587 | InspectionAnswer | 2 | 0 | используется |
| 1608 | DeviceKey | 6 | 2 | используется |
| 1648 | TelematicsDevice | 0 | 0 | через связи |
| 1725 | TelematicsDeviceAssignment | 0 | 0 | без обращений |
| 1746 | Site | 159 | 13 | используется |
| 1780 | SitePilePlan | 23 | 3 | используется |
| 1797 | SiteDrillingPlan | 8 | 1 | используется |
| 1811 | PileField | 11 | 6 | используется |
| 1825 | Cluster | 14 | 12 | используется |
| 1839 | Picket | 17 | 8 | используется |
| 1858 | Crew | 118 | 5 | используется |
| 1886 | CrewAssistant | 10 | 0 | используется |
| 1908 | UserSiteAssignment | 6 | 1 | используется |
| 1927 | Report | 204 | 48 | используется |
| 1993 | ReportVersion | 8 | 0 | используется |
| 2010 | ReportAudit | 15 | 0 | используется |
| 2034 | TelemetryRecord | 8 | 11 | используется |
| 2058 | OutboxEvent | 61 | 8 | используется |
| 2094 | ReportAnalytics | 5 | 10 | используется |
| 2113 | SiteDailySummary | 7 | 3 | используется |
| 2140 | SiteWeeklyTrend | 4 | 0 | используется |
| 2172 | PileWork | 44 | 40 | используется |
| 2232 | PilePassport | 3 | 7 | используется |
| 2319 | PileDrivingSet | 0 | 0 | через связи |
| 2351 | LeaderDrilling | 20 | 11 | используется |
| 2388 | ReportDowntime | 18 | 17 | используется |
| 2435 | PileGrade | 104 | 8 | используется |
| 2464 | DrillingType | 29 | 4 | используется |
| 2481 | DowntimeReason | 31 | 5 | используется |
| 2502 | TelegramConfig | 14 | 0 | используется |
| 2520 | FeedbackEvent | 14 | 1 | используется |
| 2548 | FeedbackEventRead | 2 | 0 | используется |
| 2569 | AuditLog | 11 | 1 | используется |
| 2616 | TenantAuditChain | 2 | 2 | используется (сырой SQL) |
| 2628 | IdempotencyKey | 5 | 4 | используется |
| 2658 | DeviceSyncState | 0 | 3 | только скрипт |
| 2677 | TrustedOperatorDeviceRecord | 0 | 0 | без обращений |
| 2690 | ServerOfflineAuthorizationKey | 0 | 0 | без обращений |
| 2699 | OfflineWorkAuthorizationRecord | 0 | 0 | без обращений |
| 2749 | ConflictAudit | 0 | 0 | без обращений |
| 2777 | ReportPhoto | 0 | 0 | без обращений |
| 2819 | DeadLetterQueue | 9 | 1 | используется |
| 2856 | OrionLead | 2 | 0 | используется (ORION) |

## Не проверено

1. **`prisma/seed.ts`, `prisma/seed-test-data.ts`, каталог `tests/`** — не входили в заданный охват (`src/`, `scripts/`, `e2e/`). Их я просмотрел точечно поиском по 8 «мёртвым» моделям: вхождения есть только в `prisma/migrations/**` и документации, в `seed*.ts` и `tests/` обращений не найдено. Полный построчный разбор по этим каталогам не делал.
2. **Динамический доступ** — обращения вида `db[имя]`, Prisma Client extensions (`$extends`), generic-хелперы, где имя модели задаётся строкой/переменной, методом не покрываются. Косвенно проверено: строка `имяСоСтрочной` для 8 моделей не встречается в репозитории вообще, что делает такой доступ маловероятным, но не исключает его.
3. **Сырой SQL без кавычек** — искал только `"Имя"`. Выражения вида `FROM RepairVerification` (без кавычек) не искал; по стилю проекта (`raw-queries.ts`, репозитории) таблицы всегда в кавычках.
4. **Фактическое содержимое таблиц в БД** — не смотрел (правило «без продакшена»; локальную БД не поднимал). Пустоту/заполненность `TenantInvoice`, `RepairVerification` и др. не проверял: вывод «код не обращается» верен независимо от данных.
5. **RLS-статус каждой таблицы** — проверял частично. Для `RepairVerification`, `OfflineWorkAuthorizationRecord`, `ServerOfflineAuthorizationKey`, `TrustedOperatorDeviceRecord` RLS есть (`prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:68,78,84,90`); для `ConflictAudit`, `DeviceSyncState`, `ReportPhoto`, `TenantInvoice` — в `prisma/migrations/20260516100000_extend_rls_tenant_scoped/migration.sql`. Полную сверку «RLS есть у всех 83» не делал.
6. **Прикладной смысл «дремлющих» моделей** (`TelematicsDeviceAssignment`, offline-authority-набор, `RepairVerification`) — относится ли к запланированным, но не подключённым функциям, из кода однозначно не выводится; поэтому помечены «проверить вручную», а не «удалить».
