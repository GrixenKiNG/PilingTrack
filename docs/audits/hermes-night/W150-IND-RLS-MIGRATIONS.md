# W150-IND-RLS-MIGRATIONS — политики RLS и миграции (независимый аудит)

Аудируемый код: `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01a264ffae97e3eaa7fea7582d90bf657d`.
Метод: только чтение, без подключения к базе и без запуска миграций. Все выводы — из файлов
`prisma/migrations/**`, `prisma/schema.prisma`, `scripts/**` и `src/**`. Роль приложения
`pilingtrack_app` без `BYPASSRLS` принята как данность (проверить на живом Postgres нельзя).

## Итог

- Всего миграций: **109** (каталогов в `prisma/migrations/`, без `migration_lock.toml`).
- Миграции, которые создают/меняют RLS: **30** файлов; операторов `CREATE POLICY` — **71** (включая динамические в `DO`-блоках).
- Моделей с колонкой `tenantId` в `schema.prisma`: **69**. Из них с включённой RLS: **65**. Без RLS: **4** — `BriefingRecord` (непреднамеренно), `OutboxEvent` (осознанно, выключена), `IdempotencyKey` и `DeadLetterQueue` (осознанно, но обоснование устарело).
- Ещё **11** таблиц получают RLS без своей колонки `tenantId` (политика по родителю: `Site`/`Report`).
- Политики в финальном состоянии (после всех миграций) — **строгие**: единственное условие `"tenantId" = current_setting('app.current_tenant', true)`. Ветки «`GUC IS NULL` → показать всё» в `prisma/migrations/**` не осталось ни в одной миграции (проверено текстовым поиском).
- Найдено **15** находок: **критично — 2**, **важно — 6**, **мелочь — 7**.

Топ-5:

1. **критично** — `BriefingRecord`: таблица с `tenantId NOT NULL` и **без RLS вообще** (`schema.prisma:293`, `20260913140100_briefing_record/migration.sql:5`).
2. **критично** — `scripts/apply-full-ddl.sql:194-206`: параллельный путь DDL заводит **fail-open** политики на чужом GUC `app.tenant_id` и при запуске на существующей базе **заменит строгие политики слабыми**.
3. **важно** — у **13** таблиц `tenantId` допускает `NULL`, а политика строгая: строки с пустым тенантом не видит НИКТО, backfill сделан только для трёх (`Report`/`Site`/`Media`/`AuditLog` и др.).
4. **важно** — `20260526202204_equipment_maintenance` смешала несвязанный `DROP COLUMN "Report"."journalPhotoMediaId"` (`:32`) с созданием таблицы и правкой FK; колонка была потеряна в бою, восстановлена отдельной миграцией.
5. **важно** — `20260817230000_rls_drop_null_tenant_escape` в заголовке заявляет снятие «`tenantId IS NULL`», но пересоздаёт политики **всё ещё fail-open** по GUC (окно 17–19.08.2026; закрыто `20260819120000`).

## Методика

Всё воспроизводимо текстовыми командами (в каталоге `D:/PillingR/wt-audit-0f53`):

1. `ls prisma/migrations` — список миграций; `grep -rlE "CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|DROP POLICY" prisma/migrations --include=migration.sql` — миграции RLS.
2. `grep -rnE "CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|DROP POLICY" prisma/migrations` — построчный разбор.
3. Схема: разбор `prisma/schema.prisma` регуляркой `model … { … tenantId … }` + учёт `@@map`; сопоставление списка таблиц с таблицами, встречающимися в RLS-миграциях (и статическими, и в `ARRAY[...]` динамических `DO`-блоков).
4. Форма политики: наличие ветки `current_setting(...) IS NULL` / `= ''` в теле `CREATE POLICY` (fail-open) против одиночного `"tenantId" = current_setting(...)` (строгая).
5. Деструктив: `grep -rnE "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM" prisma/migrations`.
6. Одна логическая правка: сводка операторов по каждому файлу (`CREATE TABLE`/`ADD COLUMN`/`DROP COLUMN`/`DROP TABLE`/`CREATE INDEX`/`UPDATE`/`INSERT`/`DELETE`/`CREATE POLICY`).
7. Транзакции: `grep -rn "db\.\$transaction\|prisma\.\$transaction" src/` (без тестов), плюс чтение механизма подстановки тенанта `src/lib/db.ts` и `src/core/security/tenant-rls.ts`.

Порядок применения миграций учтён: финальная форма политики для таблицы = последний по времени `CREATE POLICY`/`ALTER POLICY`, её затронувший (для динамических блоков форма определяется по строке-формату внутри `DO $$`).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | что сделать |
|---|---|---|---|---|---|
| 1 | критично | `prisma/schema.prisma:293,295`; `prisma/migrations/20260913140100_briefing_record/migration.sql:5,7`; `20260913150000_briefing_type_instructor_signatures/migration.sql:12` | Таблица `BriefingRecord` (`tenantId TEXT NOT NULL`) создаётся и меняется без `ENABLE`/`FORCE ROW LEVEL SECURITY` и без политики. Ни одна из 109 миграций не включает на ней RLS (поиск `tenant_isolation_briefing` — пусто). | Для роли `pilingtrack_app` без `BYPASSRLS` отсутствие RLS = доступ ко **всем** строкам всех организаций. Запрос без прикладного фильтра `tenantId` (а именно на такой случай и держат RLS как defense-in-depth) вернёт журнал инструктажей чужих организаций: ФИО, роль, коды/версии инструкций, результат проверки знаний. Это единственная таблица «окна» с tenantId, оставшаяся открытой без письменного обоснования — соседи того же периода защищены (`20260914110000_ppe_check:35-38`, `20260914090000_pile_driving_set:38-41`). | Отдельной миграцией включить `ENABLE`+`FORCE` и строгую политику `tenant_isolation_*`; либо записать в файле, почему она не нужна. |
| 2 | критично | `scripts/apply-full-ddl.sql:194-206` (в частности `:204`), `package.json:65` (`db:apply-ddl`), `scripts/apply-full-ddl.ts:24` | Параллельный путь создания схемы (`npm run db:apply-ddl` → `scripts/apply-full-ddl.ts` → этот SQL) сам создаёт RLS-политики с **другим** GUC: `\"tenantId\" = current_setting('app.tenant_id', true)::uuid OR current_setting('app.tenant_id', true) IS NULL`, плюс `ENABLE ROW LEVEL SECURITY` на `Report`, `AuditLog`, `DeviceSyncState`, `SiteWeeklyTrend`, `ReportAnalytics`, `OutboxEvent` и др. | Приложение выставляет `app.current_tenant` (`src/core/security/tenant-rls.ts:105,141,160,208`), а `app.tenant_id` не выставляет нигде — значит в этих политиках ветка `OR … IS NULL` всегда истинна и политика **разрешает все строки** (fail-open). Если файл прогнать на уже мигрированной базе, `DROP POLICY IF EXISTS` + `CREATE POLICY` (`:194-206`) **заменят строгие политики этих таблиц слабыми** — то есть база будет выглядеть защищённой, но перестанет фильтровать по организации. Дополнительно: скрипт включает RLS на `OutboxEvent`, который миграция `20260702000000_drop_stray_rls_tenant_outbox:11-12` намеренно выключила. | Оставить один источник истины (миграции). Если файл нужен — переписать его RLS-раздел под `app.current_tenant` без ветки `IS NULL` или удалить раздел, чтобы не было двух источников правды. |
| 3 | важно | `prisma/schema.prisma:1929` (`Report.tenantId String?`), `:1748` (`Site`), `:2729` (`Media`), `:2583` (`AuditLog`), `:2762` (`ConflictAudit`), `:2785` (`ReportPhoto`), `:1612` (`DeviceKey`), `:2665` (`DeviceSyncState`), `:2699` (`ServerOfflineAuthorizationKey`), `:2099` (`ReportAnalytics`), `:2175` (`PileWork`), `:2358` (`LeaderDrilling`), `:2395` (`ReportDowntime`) | 13 этих таблиц имеют `tenantId`, допускающий `NULL` (всего в схеме таких 16, ещё 3 — `OutboxEvent`/`IdempotencyKey`/`DeadLetterQueue` без RLS), а их политика (после `20260819120000`/`20260813030000`/`20260903000000`) строгая: `"tenantId" = current_setting('app.current_tenant', true)`. Для строки с `tenantId IS NULL` сравнение даёт `NULL` → строка не видна **ни одному** тенанту. Backfill (заполнение из родителя) сделан только для трёх таблиц — `PileWork`/`LeaderDrilling`/`ReportDowntime` (`20260903000000_rls_remaining_tables/migration.sql:30-35`); для `Report`, `Site`, `Media`, `AuditLog`, `ConflictAudit`, `ReportPhoto`, `DeviceKey`, `DeviceSyncState`, `ServerOfflineAuthorizationKey`, `ReportAnalytics` backfill'а в миграциях нет. | Если на проде есть строки с пустым `tenantId` (например отчёт или объект, созданные до появления колонки), они **молча исчезнут** из выдачи вместо ошибки — тот самый симптом «пустой экран», о котором предупреждает ранбук 012. Обратная сторона: `INSERT`/`UPDATE` новой строки без выставленного GUC теперь отклоняется `WITH CHECK`. Существование таких строк не проверено (см. «Не проверено»). | Перед выпуском прогнать на копии `SELECT count(*) FROM "<t>" WHERE "tenantId" IS NULL` по списку; где >0 — добавить backfill и/или `SET NOT NULL`, либо сохранить ветку совместимости осознанно. |
| 4 | важно | `prisma/migrations/20260526202204_equipment_maintenance/migration.sql:32` (в связке с `:7-11,35-86`) | В одной миграции: `DROP COLUMN "Report"."journalPhotoMediaId"` (без защиты данных, без предпроверки), создание таблицы `MaintenanceRecord`, создание/удаление FK и индексов. Колонка была нужна схеме — её снос сломал чтение/запись `Report` в бою. | Деструктивная правка без предпроверки проехала «прицепом» к несвязанной задаче техобслуживания. Восстановлена отдельной миграцией `20260529000000_restore_report_journal_photo/migration.sql:10`, где прямо сказано: «unrelated DROP COLUMN … every Report read/write fails». | Правило «одна миграция — одно логическое изменение»; для любого `DROP COLUMN`/`DROP TABLE` — предпроверка (`DO $$ … RAISE`), дамп и осознанное решение. Уже случившийся инцидент; держать как урок. |
| 5 | важно | `prisma/migrations/20260817230000_rls_drop_null_tenant_escape/migration.sql:49-52` | Миграция в заголовке заявляет снятие оговорки `tenantId IS NULL` («Убрана оговорка…»), но в теле пересоздаёт политики **той же fail-open формы** по GUC: `… IS NULL OR … = '' OR "tenantId" = …`. То есть у 17 таблиц (`:33-39`) сохранена ветка «GUC не выставлен → показать всё». | В окне 17.08–19.08.2026 эти 17 таблиц оставались fail-open: соединение без `app.current_tenant` видело строки всех организаций. Только `20260819120000_rls_fail_closed_all` перевело их в строгий режим. На момент аудита (HEAD) форма уже строгая, но чтение одной этой миграции вводит в заблуждение при разборе инцидентов/релизных заметок. | Явно назвать в комментарии, что GUC-ветка остаётся (это и есть fail-open), и не считать миграцию снятием fail-open. Смысловая правка без изменения SQL. |
| 6 | важно | `src/services/telemetry/telemetry-buffer.ts:145`; `src/services/reports/event-handlers.ts:658`; `src/core/outbox/dead-letter-queue.ts:115`; `src/services/notifications/durable-alert-delivery.ts:43`; `src/modules/reports/application/projections/rebuild.ts:80,164`; `src/modules/equipment/application/commands/pm-scheduler.ts:104`; `src/modules/reports/infrastructure/report.repository.ts:270`; `src/services/users/user-service.ts:298` | Вызовы `db.$transaction(...)` на глобальном клиенте. Механизм в `src/lib/db.ts:172-177` → `src/core/security/tenant-rls.ts:125-166` подставляет тенанта первой строкой транзакции **только если** `resolveGucTenantId()` вернул непустое значение, а он берёт его из контекста запроса (`getRequestTenantId`, `src/core/security/tenant-context.ts:95`). | У путей, где контекста запроса нет (воркеры, планировщик, фоновые проекции, буфер телеметрии, outbox/DLQ), подстановки не произойдёт: под строгим RLS такие запросы к защищённым таблицам вернут **ноль строк** или упрутся в `WITH CHECK` на записи. Проверено только наличие вызова (как требует задание), поведение в рантайме не проверялось. | Для фоновых путей — явная точка входа с тенантом (`withReadinessTenantTransaction`/`set_config` первой строкой) либо `runOutsideGucScope` там, где намеренно нужен обход; список из грепа свести к инвентарю и пометить каждый вызов. |
| 7 | важно | `prisma/migrations/20260427200931_iron_rules_money_timestamptz_index/migration.sql` (весь файл, `:9-185`) | Одна миграция объединяет три несвязанные группы: перевод `DateTime`→`TIMESTAMPTZ(3)` ~по 45 таблицам (`:9-182`), перевод денег `DoublePrecision`→`DECIMAL` на `Tenant`/`TenantInvoice` (`:165,172`) и создание индекса `User_tenantId_idx` (`:184-185`). Имя файла само перечисляет три темы. | Три несвязанных риска в одном накате: смена типа денежной колонки (`ALTER COLUMN … SET DATA TYPE` с потерей при неверном приведении — предупреждение в шапке `:4-5`), массовая смена типа времени и индекс. При падении одного шага откат затрагивает все три, а атрибуцию инцидента усложняет. | Разнести на отдельные миграции (деньги / timestamptz / индекс). |
| 8 | важно | `prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:46-47,52-53,58-59,110-111,116-117,124-125,134-135,141-142,148-149,155-156` | Для 19 таблиц используется угаданное имя политики: `DROP POLICY IF EXISTS "<tenant_isolation_x>"` + `CREATE POLICY "<то же имя>"`. Если фактическое имя когда-нибудь разойдётся, `DROP` тихо не найдёт цель, а строгая политика ляжет **рядом** с прежней permissive — и RLS останется fail-open при успешной миграции. | Соседняя миграция `20260819120000:71-78` сделала это правильно: берёт имя из `pg_policies` и падает (`RAISE`), если политики нет. Здесь приём не перенят, поэтому ошибка имени не проявится ничем, кроме тихой дыры. | Перенять приём `20260819120000`: выбирать имя из `pg_policies` с `RAISE`, если не найдено. |
| 9 | мелочь | `prisma/migrations/20260710190000_module_layout_template/migration.sql:17-18` | `ALTER POLICY tenant_isolation_monitoring_tile_template … RENAME TO …` без предпроверки существования политики/таблицы; сам файл смешивает `RENAME TO` + добавление колонки + политику. | На чистой базе порядок «`20260709120000` создаёт политику → `20260710190000` переименовывает» выполняется, но неявно; при ручном вмешательстве `ALTER POLICY` упадёт. Риск низкий. | Добавить `DROP POLICY IF EXISTS`/проверку существования либо обоснование в комментарии (частично уже есть `:4-5`). |
| 10 | мелочь | `prisma/migrations/20260425000000_enable_rls_foundation/migration.sql:27,50,70`; `20260819120000_rls_fail_closed_all/migration.sql:80` | Неидемпотентный DDL: `CREATE POLICY` без `IF NOT EXISTS` (в `20260425000000`) и `DROP POLICY %I` без `IF EXISTS` (в `20260819120000`). | Prisma накатывает каждую миграцию один раз, поэтому штатно проблемы нет. Но повторный ручной прогон или накат на частично подготовленную базу упадёт. Для `20260819120000` это отчасти намеренно (fail-loud). | Оставить как есть либо придать идемпотентность там, где это не мешает «падать громко». |
| 11 | мелочь | `prisma/migrations/20260820150000_crew_operator_many_rigs/` и `prisma/migrations/20260820150000_document_required_for_operator/` | Две разные миграции с одинаковой меткой времени `20260820150000`. | Prisma упорядочивает по полному имени каталога, поэтому порядок между ними сейчас недетерминированно-алфавитный и случайно безопасен (разные таблицы). Совпадение метки — будущая ловушка при попытке упорядочить по таймстампу. | Разнести метки времени при следующей возможности. |
| 12 | мелочь | `prisma/migrations/20260813030000_readiness_rls_fail_closed/migration.sql:43` | `DROP POLICY IF EXISTS %I ON %I` без схемы `public.`, тогда как в `20260819120000:80`/`20260903000000:46` используется `ON public.%I` (или без схемы) непоследовательно. | При `search_path`, не равном `public`, адресация политики без схемы может не найти цель. На проде `search_path` по умолчанию, риск латентный. | Привести адресацию объектов к единому виду (`public."T"`). |
| 13 | мелочь | `scripts/apply-postgres-hardening.ts:90,159,199,227` | Скрипт применяет `$executeRawUnsafe`/`$queryRawUnsafe` (в т.ч. `VACUUM ANALYZE`). Сейчас шаг RLS переведён в режим «только проверка» (не мутирует) — это хорошо; но сырой unsafe-SQL остаётся. | AGENTS.md §3 требует `$queryRaw` с параметрами вместо `$queryRawUnsafe`. Здесь SQL — статичные строки, инъекции нет, но правило нарушено и служит плохим примером. | По возможности сменить на параметризованные вызовы; шаг RLS оставить read-only. |
| 14 | мелочь | `prisma/migrations/20260701020000_force_row_level_security/migration.sql:17-24` | `FORCE ROW LEVEL SECURITY` выдан списку из 25 таблиц, но `PileGrade`, `DrillingType`, `DowntimeReason`, `TelematicsDevice`, `TelematicsDeviceAssignment`, `MaintenancePlan` в него не входят (им `FORCE` добавят позже — `20260808140000:93,103,113,123,133,83`). | В окне до `20260808140000` у этих таблиц RLS была включена, но не FORCED: владелец таблиц политику не соблюдал. На HEAD уже исправлено, важно лишь как историческая брешь. | Историческая заметка; при чтении `20260701020000` не считать список исчерпывающим. |
| 15 | мелочь | `prisma/schema.prisma:2836`; `prisma/migrations/20260925180000_dlq_replay_identity/migration.sql:4`; `prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:215-219` | `DeadLetterQueue` была оставлена без RLS с обоснованием «не носит организацию ни своим полем, ни через родителя» (`20260903000000:215-219`), но `25.09.2026` у неё появилась колонка `tenantId` (`20260925180000:4`) — обоснование устарело, RLS не добавлен. | Воркер разбирает очередь сквозь все организации (как `OutboxEvent`), поэтому решение может быть верным, но комментарий-обоснование к нему больше не соответствует схеме. До организации №2 — потенциальная межтенантная видимость записей DLQ без явного фильтра. | Либо явно задокументировать «почему RLS не нужен уже при наличии tenantId», либо включить строгую политику и заставить воркер работать через роль опознания. |

### Таблица миграций, затрагивающих RLS (30 файлов)

| миграция | таблицы | форма политики |
|---|---|---|
| `20260425000000_enable_rls_foundation` | `Report`, `Site`, `User` | аудит (fail-open), `:31-42` и далее |
| `20260516100000_extend_rls_tenant_scoped` | `AuditLog`, `ConflictAudit`, `DeviceKey`, `DeviceSyncState`, `DowntimeSummary`, `Media`, `OperatorPerformance`, `ReportAnalytics`, `ReportPhoto`, `ReportStats`, `SiteWeeklyTrend`, `TenantInvoice` | fail-open (`:35-47`) |
| `20260528000000_equipment_tenant_isolation` | `Equipment`, `EquipmentDocument`, `MaintenanceRecord` | fail-open |
| `20260603120100_checklist_engine_rls` | `ChecklistTemplate`, `ChecklistSection`, `ChecklistItem`, `Inspection`, `InspectionAnswer` | fail-open |
| `20260701000000_telemetry_tenant_isolation` | `TelemetryRecord` | fail-open |
| `20260701010000_telegram_config_tenant_isolation` | `TelegramConfig` | fail-open |
| `20260701020000_force_row_level_security` | 25 таблиц | только `FORCE` |
| `20260702000000_drop_stray_rls_tenant_outbox` | `Tenant`, `OutboxEvent` | `DISABLE` RLS |
| `20260709120000_monitoring_tile_template` | `MonitoringTileTemplate` | fail-open + `FORCE` |
| `20260710190000_module_layout_template` | `ModuleLayoutTemplate` | `ALTER POLICY` (переименование) |
| `20260712090000_tenant_settings` | `TenantSettings` | fail-open + `FORCE` |
| `20260728120000_readiness_rules` | `ReadinessRuleSet` | fail-open + `FORCE` |
| `20260808120000_equipment_defects` | `EquipmentDefect` | fail-open + `FORCE` |
| `20260808140000_readiness_tenant_isolation` | `Shift`, `ShiftHandover`, `WorkPermit`, `WorkPermitApproval`, `ReadinessScoreSnapshot`, `CurrentReadiness`, `MeterReading`, `MaintenancePlan`, `PileGrade`, `DrillingType`, `DowntimeReason`, `TelematicsDevice`, `TelematicsDeviceAssignment` | fail-open + `FORCE` |
| `20260813030000_readiness_rls_fail_closed` | 6 таблиц (`Shift`, `ShiftHandover`, `WorkPermit`, `WorkPermitApproval`, `ReadinessScoreSnapshot`, `CurrentReadiness`) | строгая |
| `20260815000000_user_documents` | `UserDocumentType`, `UserDocument` | fail-open + `FORCE` |
| `20260816120000_permit_work_types` | `PermitWorkType` | fail-open + `FORCE` |
| `20260816140000_user_place_presets` | `UserPlacePreset` | fail-open + `FORCE` |
| `20260817230000_rls_drop_null_tenant_escape` | 17 таблиц (`:33-39`) | пересоздание (fail-open по GUC, без `tenantId IS NULL`) |
| `20260819120000_rls_fail_closed_all` | 37 таблиц (`:50-61`) + пост-проверка `:99-107` | строгая |
| `20260819140000_rls_remaining_tenant_tables` | `ReadinessAccessMatrix`, `ReadinessBackfillProgress`, `TenantAuditChain` | строгая |
| `20260820120000_shift_start_waiver` | `ShiftStartWaiver` | строгая |
| `20260823100000_orion_lead` | `OrionLead` | строгая |
| `20260829170000_operator_v3_mobile_new_spec` | `OperatorChecklistTemplate`, `OperatorChecklistExecution`, `OperatorChecklistAnswerRecord`, `OperatorShiftEvidence` | строгая |
| `20260903000000_rls_remaining_tables` | 19 таблиц (`:44-194`) + backfill `:30-35` | строгая |
| `20260903120000_fuel_log` | `FuelLog` | строгая |
| `20260905090000_pile_passport` | `PilePassport` | строгая |
| `20260914090000_pile_driving_set` | `PileDrivingSet` | строгая |
| `20260914100000_user_equipment_permit` | `UserEquipmentPermit` | строгая |
| `20260914110000_ppe_check` | `PpeCheck` | строгая |

### Таблицы с `tenantId` без включённой RLS (4)

| таблица | schema.prisma | почему |
|---|---|---|
| `BriefingRecord` | `:293,295` (`tenantId String`) | **непреднамеренно** — политики нет нигде (находка 1). |
| `OutboxEvent` | `:2079` (`tenantId String?`) | осознанно: RLS выключена `20260702000000:12`; воркер разбирает очередь сквозь организации. |
| `IdempotencyKey` | `:2645` (`tenantId String?`) | осознанно: обоснование `20260819140000:20-25`; кода-читателя нет. |
| `DeadLetterQueue` | `:2836` (`tenantId String?`) | осознанно, но обоснование устарело — `tenantId` появился позже (находка 15). |

### Подозрительные политики («`IS NULL`/`OR`/`current_setting(...,true)` без проверки на пустоту»)

В **финальном состоянии миграций** таких политик нет: все таблицы переведены в строгую форму
`"tenantId" = current_setting('app.current_tenant', true)` (проверено текстовым поиском — см. Методику).
Fail-open форма присутствует только в **истории** (см. таблицу выше: миграции 25.04–16.08.2026) и в
**параллельном скрипте** (находка 2). Ключевые вхождения fail-open-ветки:

- `prisma/migrations/20260425000000_enable_rls_foundation/migration.sql:31-42,53-62,73-82` — три таблицы.
- `prisma/migrations/20260516100000_extend_rls_tenant_scoped/migration.sql:36-45` — динамически, 12 таблиц.
- `prisma/migrations/20260817230000_rls_drop_null_tenant_escape/migration.sql:50-52` — 17 таблиц, всё ещё fail-open по GUC.
- `scripts/apply-full-ddl.sql:204` — **актуальный риск**: `current_setting('app.tenant_id', true) IS NULL` (чужой GUC) + ветка «показать всё».

Почему это даёт доступ при пустой настройке: `current_setting('app.current_tenant', true)` при
незаданном параметре возвращает `NULL`; ветка `… IS NULL` в `USING` делает условие истинным, и
политика пропускает **все** строки таблицы. Строгая форма полагается на то же `NULL` наоборот
(`"tenantId" = NULL` → `NULL` → строка не проходит), поэтому при незаданном тенанте она не отдаёт
ничего — это и есть fail-closed.

### Деструктивные миграции

| # | path:line | операция | защита данных в той же миграции |
|---|---|---|---|
| 1 | `20260526202204_equipment_maintenance/migration.sql:32` | `ALTER TABLE "Report" DROP COLUMN "journalPhotoMediaId"` | **нет** — предпроверки/дампа в файле нет; привело к поломке боя (находка 4). |
| 2 | `20260817220000_drop_unread_projections/migration.sql:18-20` | `DROP TABLE IF EXISTS "ReportStats"/"OperatorPerformance"/"DowntimeSummary"` | частично: в комментарии `:8-16` заявлена предпроверка отсутствия FK и совет снять дамп; SQL-предпроверки нет. |
| 3 | `20260924120000_drop_refresh_token/migration.sql:6` | `DROP TABLE IF EXISTS "RefreshToken"` | частично: комментарий `:1-4` утверждает «0 строк, входящих FK нет»; SQL-предпроверки нет. |
| 4 | `20260913140000_drop_device_sync_last_accepted_sequence/migration.sql:8` | `ALTER TABLE "DeviceSyncState" DROP COLUMN "lastAcceptedSequence"` | частично: комментарий `:1-7` утверждает пустоту/ненужность; SQL-предпроверки нет. |
| 5 | `20260622020000_tenant_dictionaries/migration.sql:249-251` | `DELETE FROM "PileGrade"/"DrillingType"/"DowntimeReason" WHERE "tenantId" IS NULL` | **да**: перед удалением `RAISE EXCEPTION`-проверки (`:47-86`) и временные таблицы-«счётчики» с пост-проверкой (`:213-247`). Это эталон защищённой деструктивной миграции. |

`TRUNCATE` и `DELETE FROM` без условия — не найдены. `DROP TABLE` — только в двух перечисленных файлах.

## Не проверено

- **Фактическое состояние боевой/локальной базы не измерялось.** `pg_class.relrowsecurity`, `relforcerowsecurity` и `pg_policies` не снимались: подключение к проду запрещено (AGENTS.md §1), локальная база не поднималась (задача — только чтение). Все выводы — статические, из текста миграций и кода. Быстрая проверка — `scripts/rls-state.sql`.
- **Наличие строк с `tenantId IS NULL`** в 13 таблицах из находки 3 (кроме трёх, где backfill есть) не проверялось — нужен запрос к базе.
- **Запускался ли `scripts/apply-full-ddl.sql` против прода** — не проверено. Находка 2 реализуется, только если скрипт выполняли; сам факт наличия политик на `app.tenant_id` в базе подтвердить без доступа нельзя.
- **Роль `pilingtrack_app` без `BYPASSRLS`** и наличие `scripts/identity-role-grants.sql`/`DB_IDENTITY_ROLE` на проде — принято из контекста задачи и комментариев миграций, на живом Postgres не подтверждено.
- **Поведение рантайма**: подставляется ли тенант на каждом пути (через `wrapTransaction`), не проверялось исполнением — только чтение кода `src/lib/db.ts` и `src/core/security/tenant-rls.ts`.
- **Таблицы, перечисленные в `scripts/apply-full-ddl.sql`** (`Dictionary`, `Notification`, `EventStore` и др.), в `schema.prisma` отсутствуют; предполагается, что скрипт частично устарел, но это не проверялось построчно.

## Приложение: сравнение

Сравнение сделано **после** независимого прохода; в самом аудите старые отчёты не использовались.

- `docs/audits/hermes-night/R57-migration-upgrade.md`, находка 15 (`:72`) — уже описывает отсутствие RLS у `BriefingRecord` (`20260913140100:5-31`). Моя находка 1 совпадает по сути и месту; независимо получена тем же текстовым поиском.
- R57, находка 13 (`:70`) и `docs/audits/hermes-night/T-IDEMP-RLS-CHECK.md`, находка 8 (`:56`) — уже описывают политики с чужим GUC в `scripts/apply-full-ddl.sql:194-206`. Моя находка 2 совпадает.
- R57, находки 4-6 (`:61-63`) — про предусловия fail-closed RLS и «молчаливый ноль»; пересекается с моей находкой 3 (Nullable+строгая = невидимые строки) и с контекстом находки 6.
- R57, находка 23 (`:80`) — «угаданные имена политик» в `20260903000000`; совпадает с моей находкой 8.
- R57, находка 26 (`:83`) — гвард `scripts/check-migrations.js:34` не покрывает «опасные, но не разрушающие» шаблоны; согласуется с разделом «Деструктивные миграции» (защита только комментариями, кроме `tenant_dictionaries`).
- **Чего, по моим данным, в старых отчётах нет**: явной сводки «16 nullable-`tenantId` при строгой политике + backfill только для трёх» (находка 3) и отдельной находки про устаревшее обоснование отсутствия RLS у `DeadLetterQueue` после появления `tenantId` `25.09.2026` (находка 15). Обе — мои дополнения к картине.

Оценка независимости: ключевые находки 1 и 2 воспроизводятся и совпадают с ранее зафиксированными; расхождений по фактам не обнаружено. Разница в числах: я насчитал **30** файлов миграций с RLS против «29 файлов» в `T-IDEMP-RLS-CHECK.md:20` (у них не учтён, вероятно, `20260925120000`/нумерация); мой счёт — из `grep -rlE` по 109 каталогам.
