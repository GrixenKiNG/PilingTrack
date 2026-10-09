# AU43-S5-RLS-POLICIES — Политики RLS и роли БД по миграциям

Аудит только для чтения. Версия: `git rev-parse HEAD` рабочей папки
`D:\PillingR\wt-night` = `46a5f5103a2e4a403975b57c30de111114f3e533` (ветка
`hermes/q4-0926`).

Источники: `prisma/migrations/**/migration.sql`, `scripts/app-role-grants.sql`,
`scripts/identity-role-grants.sql`, `scripts/rls-state.sql`, `scripts/app-role-verify.sql`,
`prisma/schema.prisma`. Существующие отчёты в `docs/audits/` не читались.

## Итог

- Проверено **83** модели Prisma; у **69** есть колонка `tenantId`.
- RLS включён и принуждён (ENABLE + FORCE) на **76** таблицах: **65** со строгой
  политикой `"tenantId" = current_setting('app.current_tenant', true)`, **11** — с
  политикой через `EXISTS` по родителю (своего `tenantId` нет). Таблиц с ENABLE без
  FORCE — **0**. Таблиц с RLS без единой политики — **0**.
- Таблиц с `tenantId`, но **без RLS вовсе** — **4**: `OutboxEvent`, `IdempotencyKey`
  (обе задокументированы), плюс **не задокументированы** `BriefingRecord` и
  `DeadLetterQueue`. Это главная находка: у `BriefingRecord` `tenantId NOT NULL`,
  таблица живая (журнал инструктажей), защита — только прикладной фильтр.
- Отдельно: `Tenant`, `FeedbackEvent`, `FeedbackEventRead` — ни `tenantId`, ни RLS
  (задокументировано). Роль приложения `pilingtrack_app` — `NOBYPASSRLS`; роль
  опознания `pilingtrack_identity` — `BYPASSRLS` и выдана приложению.
- Все найденные расхождения проверены по тексту миграций (команды ниже). На прод/БД
  не подключался: фактическое `relrowsecurity`/`relforcerowsecurity` в живой базе —
  **НЕ ПРОВЕРЕНО** (см. «Что не проверено»).

Топ-5 находок:

1. `BriefingRecord` — `tenantId NOT NULL`, RLS отсутствует (важно).
2. `DeadLetterQueue` — добавлен `tenantId`, RLS отсутствует (важно).
3. Guard в `20260819120000` проверяет остаток режима аудита только на момент наката —
   таблицы, заведённые позже, им не покрыты (важно, причина п.1–2).
4. `BYPASSRLS`-роль `pilingtrack_identity` выдана рабочей роли приложения — любой путь
   под приложением может обойти RLS (важно, риск при SQL-инъекции).
5. Строгая политика на таблицах с nullable `tenantId` — строка с `NULL` становится
   невидимой никому, включая владельца (важно для `AuditLog` и выработки).

## Методика

Все числа получены командами из корня `D:\PillingR\wt-night`, без подключения к БД.

1. Версия:
   `git rev-parse HEAD` → `46a5f5103a2e4a403975b57c30de111114f3e533`.
2. Статический разбор всех RLS-операторов по миграциям:
   `grep -rniE "enable row level security|force row level security|disable row level security|create policy|drop policy|alter policy" prisma/migrations scripts/app-role-grants.sql`
   → 228 совпадений; полный список `ENABLE`/`FORCE`/политик собран построчно.
3. Разбор циклов (`DO $$ ... FOREACH`) в миграциях `20260516100000`, `20260701020000`,
   `20260813030000`, `20260817230000`, `20260819120000`, `20260819140000` — списки
   таблиц внутри `ARRAY[...]` прочитаны и объединены со статическими операторами
   (`node -e`, скрипт в разделе «Команды»).
4. Разбор `prisma/schema.prisma` скриптом на `node` (модели и наличие скалярного поля
   `tenantId`) → 83 модели, 69 с `tenantId` (команда ниже).
5. Сопоставление множеств: (a) `tenantId` без RLS, (b) RLS без `tenantId`,
   (c) ни того, ни другого. Результат — разделы «Б» / «В» в таблице.
6. Перекрёстная проверка: `DROP TABLE` в миграциях (снятые проекции и `RefreshToken`),
   переименование `MonitoringTileTemplate` → `ModuleLayoutTemplate`
   (`20260710190000_module_layout_template/migration.sql:7`).

### Команды (ключевые, выборочно)

- `git rev-parse HEAD`
- `grep -c "^model " prisma/schema.prisma` → `83`
- Разбор схемы (83 модели, 69 с tenantId) и сопоставление с RLS-списками — `node -e`
  (результат: `[A] tenantId без RLS: BriefingRecord, DeadLetterQueue, IdempotencyKey,
  OutboxEvent`; `[B] RLS без tenantId: Cluster, Crew, CrewAssistant, Picket, PileField,
  ReportAudit, ReportVersion, SiteDailySummary, SiteDrillingPlan, SitePilePlan,
  UserSiteAssignment`; `[C] ни RLS, ни tenantId: FeedbackEvent, FeedbackEventRead,
  Tenant`).
- Сводка: RLS-таблиц 76 (65 строгих по колонке + 11 через EXISTS); ENABLE без FORCE — 0.

## Находки

### А. Сводная таблица: таблица БД → RLS и политика

Обозначения: **tenantId** — `String` (NOT NULL, если не указано `?`); **E/F** — ENABLE/FORCE
RLS; **Операции** — политика объявлена `FOR ALL`, то есть SELECT+INSERT+UPDATE+DELETE.
Условие `tenantId = GUC` читается как `"tenantId" = current_setting('app.current_tenant', true)`.
Имя политики — `tenant_isolation_<x>`; где `<x>` отличается от `lower(таблицы)`, оно
приведено явно.

| Таблица | tenantId | E/F | Политика (условие USING) | Операции | Исключение/источник |
|---|---|---|---|---|---|
| Report | `String?` | да/да | `tenantId = GUC` (строгая) | ALL | nullable; 20260819120000 |
| Site | `String?` | да/да | `tenantId = GUC` | ALL | nullable; 20260819120000 |
| User | `String` | да/да | `tenantId = GUC` | ALL | вход через identity-роль |
| Equipment | `String` | да/да | `tenantId = GUC` | ALL | 20260819120000 |
| EquipmentDocument | `String` | да/да | `tenantId = GUC` | ALL | 20260819120000 |
| MaintenanceRecord | `String` | да/да | `tenantId = GUC` | ALL | 20260819120000 |
| ChecklistTemplate | `String` | да/да | `tenant_isolation_checklist_template` | ALL | 20260819120000 |
| ChecklistSection | `String` | да/да | `_checklist_section` | ALL | 20260819120000 |
| ChecklistItem | `String` | да/да | `_checklist_item` | ALL | 20260819120000 |
| Inspection | `String` | да/да | `tenantId = GUC` | ALL | 20260819120000 |
| InspectionAnswer | `String` | да/да | `_inspection_answer` | ALL | 20260819120000 |
| AuditLog | `String?` | да/да | `tenant_isolation_auditlog` | ALL | nullable; 20260819120000 |
| ConflictAudit | `String?` | да/да | `tenant_isolation_conflictaudit` | ALL | nullable; 20260819120000 |
| Media | `String?` | да/да | `tenant_isolation_media` | ALL | nullable; 20260819120000 |
| ReportAnalytics | `String?` | да/да | `tenant_isolation_reportanalytics` | ALL | nullable; 20260819120000 |
| ReportPhoto | `String?` | да/да | `tenant_isolation_reportphoto` | ALL | nullable; 20260819120000 |
| SiteWeeklyTrend | `String` | да/да | `tenant_isolation_siteweeklytrend` | ALL | 20260819120000 |
| TenantInvoice | `String` | да/да | `tenant_isolation_tenantinvoice` | ALL | 20260819120000 |
| DeviceKey | `String?` | да/да | `tenant_isolation_devicekey` | ALL | nullable; вход через identity-роль |
| DeviceSyncState | `String?` | да/да | `tenant_isolation_devicesyncstate` | ALL | nullable; 20260819120000 |
| ServerOfflineAuthorizationKey | `String?` | да/да | `_server_offline_key` | ALL | nullable; 20260903000000 |
| TelegramConfig | `String` | да/да | `tenantId = GUC` | ALL | 20260819120000 |
| TelemetryRecord | `String` | да/да | `tenantId = GUC` | ALL | 20260819120000 |
| TenantSettings | `String` | да/да | `tenant_isolation_tenant_settings` | ALL | 20260819120000 |
| ReadinessRuleSet | `String` | да/да | `_readiness_rule_set` | ALL | 20260819120000 |
| EquipmentDefect | `String` | да/да | `_equipmentdefect` | ALL | 20260819120000 |
| MeterReading | `String` | да/да | `_meterreading` | ALL | 20260819120000 |
| MaintenancePlan | `String` | да/да | `_maintenanceplan` | ALL | 20260819120000 |
| PileGrade | `String` | да/да | `_pilegrade` | ALL | 20260819120000 |
| DrillingType | `String` | да/да | `_drillingtype` | ALL | 20260819120000 |
| DowntimeReason | `String` | да/да | `_downtimereason` | ALL | 20260819120000 |
| TelematicsDevice | `String` | да/да | `_telematicsdevice` | ALL | 20260819120000 |
| TelematicsDeviceAssignment | `String` | да/да | `_telematicsdeviceassignment` | ALL | 20260819120000 |
| Shift | `String` | да/да | `_shift` (строгая с 13.08) | ALL | 20260813030000 |
| ShiftHandover | `String` | да/да | `_shifthandover` | ALL | 20260813030000 |
| WorkPermit | `String` | да/да | `_workpermit` | ALL | 20260813030000 |
| WorkPermitApproval | `String` | да/да | `_workpermitapproval` | ALL | 20260813030000 |
| ReadinessScoreSnapshot | `String` | да/да | `_readinessscoresnapshot` | ALL | 20260813030000 |
| CurrentReadiness | `String` | да/да | `_currentreadiness` | ALL | 20260813030000 |
| UserDocumentType | `String` | да/да | `_userdocumenttype` | ALL | 20260819120000 |
| UserDocument | `String` | да/да | `_userdocument` | ALL | 20260819120000 |
| PermitWorkType | `String` | да/да | `_permitworktype` | ALL | 20260819120000 |
| UserPlacePreset | `String` | да/да | `_userplacepreset` | ALL | 20260819120000 |
| ModuleLayoutTemplate | `String` | да/да | `_module_layout_template` (переименована) | ALL | 20260709120000 / 20260710190000 |
| ShiftStartWaiver | `String` | да/да | `_shiftstartwaiver` | ALL | 20260820120000 |
| OrionLead | `String` | да/да | `_orionlead` | ALL | 20260823100000 |
| OperatorChecklistTemplate | `String` | да/да | `_operator_checklist_template` | ALL | 20260829170000 |
| OperatorChecklistExecution | `String` | да/да | `_operator_checklist_execution` | ALL | 20260829170000 |
| OperatorChecklistAnswerRecord | `String` | да/да | `_operator_checklist_answer` | ALL | 20260829170000 |
| OperatorShiftEvidence | `String` | да/да | `_operator_shift_evidence` | ALL | 20260829170000 |
| PileWork | `String?` | да/да | `_pile_work` | ALL | nullable; 20260903000000 |
| LeaderDrilling | `String?` | да/да | `_leader_drilling` | ALL | nullable; 20260903000000 |
| ReportDowntime | `String?` | да/да | `_report_downtime` | ALL | nullable; 20260903000000 |
| SafetyIncident | `String` | да/да | `_safety_incident` | ALL | 20260903000000 |
| RepairVerification | `String` | да/да | `_repair_verification` | ALL | 20260903000000 |
| OfflineWorkAuthorizationRecord | `String` | да/да | `_offline_work_authorization` | ALL | 20260903000000 |
| TrustedOperatorDeviceRecord | `String` | да/да | `_trusted_operator_device` | ALL | 20260903000000 |
| FuelLog | `String` | да/да | `_fuel_log` | ALL | 20260903120000 |
| PilePassport | `String` | да/да | `_pile_passport` | ALL | 20260905090000 |
| PileDrivingSet | `String` | да/да | `_pile_driving_set` | ALL | 20260914090000 |
| UserEquipmentPermit | `String` | да/да | `_user_equipment_permit` | ALL | 20260914100000 |
| PpeCheck | `String` | да/да | `_ppe_check` | ALL | 20260914110000 |
| ReadinessAccessMatrix | `String` | да/да | `_readinessaccessmatrix` | ALL | 20260819140000 |
| ReadinessBackfillProgress | `String` | да/да | `_readinessbackfillprogress` | ALL | 20260819140000 |
| TenantAuditChain | `String` | да/да | `_tenantauditchain` | ALL | 20260819140000 |

**Группа «наследование по родителю» — RLS есть, своего `tenantId` нет (11 таблиц).**
Политика — `EXISTS`-подзапрос по родителю; введена миграцией
`20260903000000_rls_remaining_tables/migration.sql` (условия: строки 110–194).

| Таблица | tenantId | E/F | Политика (условие) | Родитель |
|---|---|---|---|---|
| PileField | нет | да/да | EXISTS по `Site.id` | Site |
| Cluster | нет | да/да | EXISTS по `PileField`→`Site` | Site |
| Picket | нет | да/да | EXISTS по `Cluster`→`PileField`→`Site` | Site |
| SitePilePlan | нет | да/да | EXISTS по `Site.id` | Site |
| SiteDrillingPlan | нет | да/да | EXISTS по `Site.id` | Site |
| SiteDailySummary | нет | да/да | EXISTS по `Site.id` | Site |
| UserSiteAssignment | нет | да/да | EXISTS по `Site.id` | Site |
| Crew | нет | да/да | EXISTS по `Site.id` | Site |
| CrewAssistant | нет | да/да | EXISTS по `Crew`→`Site` | Site |
| ReportVersion | нет | да/да | EXISTS по `Report.reportId` | Report |
| ReportAudit | нет | да/да | EXISTS по `Report.reportId` | Report |

### Б. Таблицы с `tenantId`, но без RLS (4)

| # | severity | path:line | Проблема | Сценарий / почему это важно | Что сделать |
|---|---|---|---|---|---|
| 1 | важно | `prisma/schema.prisma:295` (модель `:293`), `prisma/migrations/20260913140100_briefing_record/migration.sql:5-7` | `BriefingRecord` заведена с `tenantId TEXT NOT NULL`, ни одной RLS-инструкции по ней в миграциях нет | Журнал инструктажей (чтение — `briefing-journal-query.ts:102`, `self-clearance-query.ts:69`) защищён только прикладным `where tenantId`. Любой сырой SQL/новый путь без фильтра вернёт строки всех организаций — ровно класс ошибки IDOR 31.05.2026, от которого остальные 76 таблиц закрыты Postgres | Добавить миграцию: ENABLE+FORCE+строгая политика `tenantId = current_setting('app.current_tenant', true)` |
| 2 | важно | `prisma/schema.prisma:2836`, `prisma/migrations/20260925180000_dlq_replay_identity/migration.sql:4` | `DeadLetterQueue.tenantId` добавлен 25.09.2026 (nullable), RLS не включался | Очередь DLQ разбирает инфраструктура; часть строк с `NULL` (старые). Ожидаемо, но нигде не задокументировано как исключение — в отличие от `OutboxEvent`/`IdempotencyKey` | Либо строгая политика, либо занести в `rls-state.sql` как осознанное исключение |
| 3 | мелочь | `prisma/schema.prisma:2645`, `prisma/migrations/20260924120000_drop_refresh_token/migration.sql` | `IdempotencyKey` — `tenantId String?`, RLS нет. Считается мёртвой, но таблица и модель живы | Если код вернётся без политики — таблица открыта. Претензия уровня «долг», а не «дыра» сегодня | При удалении кода удалить и таблицу; иначе — политику |
| 4 | мелочь | `prisma/schema.prisma:2079`, `prisma/migrations/20260702000000_drop_stray_rls_tenant_outbox/migration.sql:12` | `OutboxEvent` — `tenantId String?`, RLS выключен намеренно (воркер разбирает сквозь организации) | Задокументированное исключение (ADR-0046) | Оставить как есть; подтверждено |

### В. Таблицы с RLS без `tenantId`

11 таблиц (группа «наследование по родителю», таблица в разделе «А»). Это **не дефект**:
своего `tenantId` у них нет по решению миграции `20260903000000` (комментарий: строки
100–104), политика спрашивает родителя через `EXISTS`. Риск: политика дороже
равенства по колонке, но родитель ищется по первичному ключу — на объёмах продукта
измеримой разницы нет (утверждение миграции, не проверялось планами запросов).

Отдельно — таблицы **ни с `tenantId`, ни с RLS** (3): `Tenant` (`20260702000000:11`),
`FeedbackEvent`, `FeedbackEventRead` (`20260903000000:215-219`). Задокументированы как
осознанно оставленные.

### Г. Прочие находки по ролям и механике

| # | severity | path:line | Проблема | Сценарий / почему это важно | Что сделать |
|---|---|---|---|---|---|
| 5 | важно | `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:99-107` | Guard «остался ли хоть один режим аудита» (`qual LIKE '%IS NULL%'`) отрабатывает только в момент наката этой миграции | Любая таблица с `tenantId`, заведённая позже (`BriefingRecord`, `DeadLetterQueue`), не попадает ни в список миграции, ни в её проверку — политика у неё просто не появляется, и никто не падает. Это корневая причина находок №1–2 | Перенести проверку в `scripts/rls-state.sql` как обязательный CI-гейт (он уже умеет искать таблицы с `tenantId` без RLS, `scripts/rls-state.sql:48-60`) |
| 6 | важно | `scripts/identity-role-grants.sql:46,50` | Роль `pilingtrack_identity` объявлена `BYPASSRLS` и выдана рабочей роли приложения (`GRANT pilingtrack_identity TO pilingtrack_app`) | `SET ROLE` в роль, в которой ты состоишь, пароля не требует. Значит, любой код под `pilingtrack_app` (или SQL-инъекция) одной строкой `SET LOCAL ROLE pilingtrack_identity` обходит RLS всех таблиц — модель «Postgres держит границу» держится договорённостью в коде (`identity-role.ts`). Оправдано для входа; но границей, как заявлено в комментарии, это не является | Ограничить: не давать BYPASSRLS «вслепую» всей роли, либо признать в ADR, что RLS защищает только от забытого фильтра, а не от злоумышленника за приложением |
| 7 | важно | `prisma/schema.prisma:1748` (Site), `:1929` (Report), `:2583` (AuditLog), `:1612` (DeviceKey), `:2099` (ReportAnalytics), `:2175` (PileWork), `:2358` (LeaderDrilling), `:2395` (ReportDowntime), `:2665` (DeviceSyncState), `:2699` (ServerOfflineAuthorizationKey), `:2729` (Media), `:2762` (ConflictAudit), `:2785` (ReportPhoto) | У 13 таблиц `tenantId` допускает `NULL`, а политика строгая: `NULL = GUC` → `NULL` → строка не проходит. При FORCE на владельца строка невидима **всем**, включая psql владельца | Разовая уборка была (`20260903000000:30-35` бэкфилл выработки; `20260817230000:15` «0 из 0»), но новые вставки с `NULL` исчезнут бесшумно. Особенно `AuditLog`: системные записи без организации пропадут из аудита | Бэкфилл + `NOT NULL` там, где можно; для `AuditLog` — решить, чья строка без организации |
| 8 | мелочь | `scripts/app-role-grants.sql:98` | `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` — приложение получает `DELETE` и на журнальные таблицы (`AuditLog`, `ReportAudit`, `TenantAuditChain`) | Политика `FOR ALL` разделяет доступ на чтение/запись, но не запрещает `DELETE` отдельных журнальных строк | Если аудит неизменяем — выдать `DELETE`/`UPDATE` точечно, а журналы оставить только на INSERT |
| 9 | мелочь | `src/core/security/identity-role.ts:65` | Использован `$executeRawUnsafe` (`SET LOCAL ROLE`) — прямое нарушение правила AGENTS §3 «never `$queryRawUnsafe`» | Обосновано: имя роли нельзя параметризовать, а значение проходит regex-проверку (`identity-role.ts:32,37`). Но это единственное место, где правило нарушено осознанно, и оно должно быть явно разрешено в ADR | Оставить; зафиксировать исключение в документах, чтобы ревьюер не «чинил» вслепую |
| 10 | мелочь | `scripts/rls-state.sql:42-46` | Комментарий-ожидание «Ожидаются ровно две [таблицы с tenantId без RLS]» устарел: их четыре | Скрипт печатает список, а ожидание в комментарии сбивает с толку; расхождение с находкой №1 не ловится глазами | Обновить комментарий (или заменить на «Count = 4: OutboxEvent, IdempotencyKey, BriefingRecord, DeadLetterQueue») |
| 11 | мелочь | `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:23-28` | Переход в fail-closed требует `DB_IDENTITY_ROLE` в окружении прода; без неё вход по паролю/ПИН-коду и контроллер телеметрии сломаются | `User` и `DeviceKey` строгие; без переключения роли их строка не найдётся. Локально/CI суперпользователь, поэтому проблема скрыта | Держать `DB_IDENTITY_ROLE` в обязательных переменных прода и проверять на старте; порядок — ранбук 012 |

## Статусы по ключевым проверкам

| Проверка | Статус |
|---|---|
| Число моделей и число с `tenantId` (83 / 69) | ПРОЙДЕНО (команда) |
| RLS-таблиц 76, ENABLE без FORCE 0, RLS без политики 0 | ПРОЙДЕНО (разбор миграций) |
| Таблиц с `tenantId` без RLS = {OutboxEvent, IdempotencyKey, BriefingRecord, DeadLetterQueue} | ПРОЙДЕНО (команда) |
| Таблиц с RLS без `tenantId` = 11 (обоснованно EXISTS-родителем) | ПРОЙДЕНО |
| Все политики строгие (режима аудита `IS NULL` не осталось) | ПРОЙДЕНО по тексту миграций; в живой БД — НЕ ПРОВЕРЕНО |
| Реальное `relrowsecurity`/`relforcerowsecurity`/`pg_policies` в БД | НЕ ПРОВЕРЕНО (к БД не подключался) |
| Роль подключения приложения в проде = `pilingtrack_app` | ГИПОТЕЗА (по `scripts/app-role-grants.sql:11-13`; `.env` не читал) |

## Что не проверено

- **Живая база.** Не подключался ни к локальной, ни к прод-БД (`AGENTS.md` §1 запрещает
  прод; `.env*` не читал). Все выводы — из текста миграций и `schema.prisma`. Фактическое
  состояние `pg_class.relrowsecurity`, `pg_policies`, `pg_roles` могло разойтись с
  миграциями (дрейф уже случался — см. `20260702000000:1-9`). Запустить один раз:
  `docker exec -i <pg> psql -U <owner> -d <db> -f - < scripts/rls-state.sql`.
- **`DATABASE_URL`/`DB_IDENTITY_ROLE` в проде.** Файлы `.env*` не читал. Что прод реально
  ходит ролью `pilingtrack_app` и что `DB_IDENTITY_ROLE` выставлена — из кода и
  комментариев скриптов, не из окружения.
- **Дрейф схемы vs миграций.** Наличие RLS-таблиц сверял по `schema.prisma` и миграциям;
  ручные изменения в БД вне миграций (кроме задокументированного случая `Tenant`/
  `OutboxEvent`) невидимы.
- **Поведение под PgBouncer.** Утверждение о безопасности transaction-pooling при
  `set_config(..., true)` и `SET LOCAL ROLE` взято из комментариев
  (`identity-role.ts:22-24`, `db.ts:81-83`), не воспроизводил.
- **Стоимость `EXISTS`-политик** (11 таблиц) на планах запросов не измерял — оценка
  «неизмеримо на объёмах продукта» из комментария миграции.
- **`rls-state.sql`/`app-role-verify.sql` на живых данных** не выполнял.
