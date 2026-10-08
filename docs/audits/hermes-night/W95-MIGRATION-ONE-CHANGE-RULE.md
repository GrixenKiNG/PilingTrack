# W95 — миграции Prisma, в которых больше одного логического изменения

Только чтение: ни одна миграция и ни `prisma/schema.prisma` не менялись. Единственный созданный файл — этот отчёт.

Правило проекта: `CLAUDE.md:25` — «Одна миграция Prisma = одно логическое изменение». Смешанные миграции трудно откатить и разобрать при аварии. Ниже — опись, не переписывание.

## Итог

- Всего миграций (папок в `prisma/migrations/`, кроме `migration_lock.toml`): **107**. Суммарно создано 87 таблиц.
- **Смешанных** (в одной миграции ≥2 независимых слоя работ: создание новых сущностей / изменение существующих / RLS на чужих таблицах / изменение данных): **19**.
- С изменением **данных** (`INSERT`/`UPDATE`/`DELETE`, в т.ч. внутри `DO`): **11**. С **`DROP`** (таблицы/колонки/констрейнта/индекса/политики): **22**.
- По severity: **критично — 0, важно — 12, мелочь — 7** (в таблице смешанных); плюс отдельные списки «данные» и «DROP» для проверки.
- Прочтено целиком как «одно логическое изменение» и не отмечено: чисто-RLS миграции (в т.ч. большие `DO`-раскатки RLS на 13/19/25 таблиц), создание одной таблицы вместе с её индексами, констрейнтами и её собственной RLS, одиночные `ADD COLUMN`, переименование констрейнтов.
- Топ-5 (важно):
  1. `20260622020000_tenant_dictionaries` — в одной миграции expand + перенос данных + `DELETE` + `NOT NULL`, три справочника; одновременно и DDL, и каскад перепривязки ссылок, и удаление строк.
  2. `20260903000000_rls_remaining_tables` — раскатка RLS на 19 таблиц **и** `UPDATE` (бэкфилл `tenantId`) в одной миграции.
  3. `20260526202204_equipment_maintenance` — `DROP COLUMN` на `Report` + `DROP`/`ADD` внешних ключей на 5 таблицах + создание `MaintenanceRecord`.
  4. `20260517120000_telematics_device_foundation` и `20260517140000_equipment_full_metadata` — создание таблиц вместе с `UPDATE`-бэкфиллом существующих строк `Equipment`.
  5. `20260816150000_permit_approval_rules` — `ADD COLUMN` (с дефолтами) + `UPDATE`-бэкфилл в одной миграции, причём снимок ранее оформленных нарядов.
- Хорошая новость: правило в основном соблюдается с августа 2026; почти все смешанные миграции — май–июль 2026 (до/в начале действия правила). Среди 28 миграций с 13.08.2026 смешаны только `permit_approval_rules`, `operator_v3_safety_incident`, `operator_v3_offline_authority`, `rls_remaining_tables`, `fuel_log`.

## Методика

Всё воспроизводимо из корня `D:\PillingR\wt-night` (Windows + Git Bash, Python нет — считал `node`):

1. Перечень папок: `ls -d prisma/migrations/*/` → 107 (плюс `migration_lock.toml`, исключён).
2. Для каждой прочитан `prisma/migrations/<имя>/migration.sql`. Собственный SQL-разбор (node-скрипт в scratch, не в репозитории) режет файл на операторы верхнего уровня, корректно пропуская `DO $$ … $$` и строковые литералы, и классифицирует каждый оператор: `CREATE TABLE`, `CREATE INDEX`/`CREATE UNIQUE INDEX`, `ALTER TABLE` (+ подвид: `ADD/DROP COLUMN`, `ADD/DROP CONSTRAINT`, `ALTER/ADD COLUMN`, `RENAME`, `ENABLE/FORCE/DISABLE ROW LEVEL SECURITY`), `CREATE/DROP POLICY`, `CREATE TYPE`, `CREATE FUNCTION/TRIGGER`, `INSERT/UPDATE/DELETE`, `DROP TABLE/INDEX`, `DO`, `BEGIN/COMMIT`.
3. Из операторов выведены слои: (A) создание новых сущностей — `CREATE TABLE`/`CREATE TYPE`; (B) изменение существующих — `ALTER TABLE` по таблице, **не** созданной в этой же миграции, `DROP`, `RENAME`; (C) RLS-политики на таблицах, **не** созданных здесь; (D) изменение данных — `INSERT/UPDATE/DELETE` (снаружи и внутри `DO`).
4. **Смешанной** считается миграция с ≥2 из слоёв A–D. Дополнительно слой A+своя-RLS+свои-индексы сознательно НЕ считается смешением: в этом проекте единица логического изменения = «таблица вместе со своей обвязкой». Это соответствует примеру из задания («таблица И политика RLS И бэкфилл данных»).
5. Миграции с `UPDATE/INSERT/DELETE` и с `DROP` выведены отдельными списками (задание п.4).
6. Спорные и соседние файлы прочитаны глазами (например `20260820120000_shift_start_waiver`, `20260710190000_module_layout_template`, `20260622020000_tenant_dictionaries`, `20260903000000_rls_remaining_tables`, `20260906090000_user_role_check_all_roles`).
7. Содержимое миграций не изменялось; `prisma/schema.prisma` не открывался; БД не поднималась (проверки — только по SQL-тексту).

Подсчёт операторов верхнего уровня по всем 107 миграциям (примеры): `20260419190903_init` — 42 `CREATE TABLE` + 134 индекса + 30 констрейнтов; `20260622020000_tenant_dictionaries` — 6 `INSERT`, 4 `UPDATE`, 3 `DELETE` внутри `BEGIN/COMMIT`.

## Находки

### A. Смешанные миграции (нарушают «одно логическое изменение»)

Колонка «что делает» — по видам работ из задания. «Риск» = да/нет и почему.

| # | severity | path:line | что делает | риск и почему | предлагаемый фикс |
|---|----------|-----------|-----------|---------------|-------------------|
| 1 | важно | `prisma/migrations/20260517120000_telematics_device_foundation/migration.sql:1` | A: `CREATE TABLE` `TelematicsDevice`,`TelematicsDeviceAssignment` (+3 enum); D: `UPDATE` ×7 по `Equipment` | **да.** Откат `DROP TABLE` вернёт схему, но бэкфилл `Equipment` необратим; при аварии на бэкфилле разбирать одновременно и DDL, и данные | Разнести в две миграции: сначала таблицы, отдельной — заполнение |
| 2 | важно | `prisma/migrations/20260517140000_equipment_full_metadata/migration.sql:1` | A: `CREATE TABLE` `EquipmentDocument` (+2 enum); D: `UPDATE` ×6 по `Equipment` | **да.** То же: новые таблицы + необратимый бэкфилл в одном файле | Две миграции: DDL и данные отдельно |
| 3 | важно | `prisma/migrations/20260526202204_equipment_maintenance/migration.sql:1` | A: `CREATE TABLE` `MaintenanceRecord`; B: `DROP COLUMN Report.journalPhotoMediaId` + `DROP`/`ADD` FK на `DeviceKey`,`EquipmentDocument`,`TelematicsDevice`,`TelematicsDeviceAssignment`,`Report` | **да.** Деструктивное `DROP COLUMN` соседствует с созданием сущности; откат требует согласованного восстановления и колонки, и констрейнтов | Отдельно: удаление колонки/FK; отдельно: новая таблица |
| 4 | мелочь | `prisma/migrations/20260528000000_equipment_tenant_isolation/migration.sql:1` | B: `ADD COLUMN`+`ALTER COLUMN` на `Equipment`; C: `ENABLE RLS`+`CREATE POLICY` ×3 на `Equipment`,`EquipmentDocument`,`MaintenanceRecord` | **нет.** Один смысл — «тенантизация блока техники»; все правки по одной теме, откат тривиален | Можно оставить, либо вынести RLS отдельной миграцией для единообразия |
| 5 | мелочь | `prisma/migrations/20260621010000_pile_grade_length_mm/migration.sql:1` | B: `ADD COLUMN PileGrade.lengthMm`; D: `UPDATE` (бэкфилл длины) | **нет.** Типовая «add column + backfill», откат = `DROP COLUMN` с данными в имени | Оставить; либо разнести column/backfill, если контролёр требует буквально |
| 6 | важно | `prisma/migrations/20260622020000_tenant_dictionaries/migration.sql:1` | B: `ADD COLUMN`/`ADD CONSTRAINT`/`ALTER COLUMN SET NOT NULL` на `PileGrade`,`DrillingType`,`DowntimeReason`; D: `INSERT`×6, `UPDATE`×4, `DELETE`×3 (перепривязка `PileWork`/`SitePilePlan`/`LeaderDrilling`/`ReportDowntime`, затем `DELETE … WHERE tenantId IS NULL`) | **да, максимальный.** Один файл совмещает expand + миграцию + contract + удаление строк по трём справочникам; при аварии посередине тяжело понять, на какой фазе всё встало | Разбить минимум на три миграции: expand, remap, contract+delete |
| 7 | мелочь | `prisma/migrations/20260622030000_crew_assistant_user_link/migration.sql:1` | B: `ADD COLUMN CrewAssistant.userId`+FK+индекс; D: `UPDATE` (бэкфилл) | **нет.** Одна сущность, откат понятен | Оставить |
| 8 | мелочь | `prisma/migrations/20260701000000_telemetry_tenant_isolation/migration.sql:1` | B: `ADD COLUMN`+`ALTER COLUMN`; C: `ENABLE RLS`+`CREATE POLICY` на `TelemetryRecord` | **нет.** Одна тема — изоляция одной таблицы | Оставить |
| 9 | мелочь | `prisma/migrations/20260701010000_telegram_config_tenant_isolation/migration.sql:1` | B: `ADD COLUMN`+`ALTER COLUMN`; C: `ENABLE RLS`+`CREATE POLICY` на `TelegramConfig` | **нет.** То же, одна таблица | Оставить |
| 10 | важно | `prisma/migrations/20260730100000_readiness_tenant_context/migration.sql:1` | B: `ALTER COLUMN … SET DEFAULT` + `CREATE UNIQUE INDEX`×3 + `ADD CONSTRAINT` FK на `TenantSettings`,`User`,`Equipment`,`Site`; D: `UPDATE TenantSettings`; плюс `DO`-преflight | **да.** Проверка данных + бэкфилл + схема (уникальные индексы и FK) в одном файле | Вынести преflight/бэкфилл времени отдельно от DDL |
| 11 | важно | `prisma/migrations/20260730102000_readiness_snapshots_outbox_idempotency/migration.sql:1` | A: `CREATE TABLE` `ReadinessScoreSnapshot`(+CHECK); B: `ADD COLUMN`×2 на `OutboxEvent`, ×4 на `IdempotencyKey` | **да.** Новая таблица + тенантизация двух существующих таблиц в одном; оставленные nullable-колонки (комментарий :52) намекают на незавершённость одной из тем | Разнести: новая таблица отдельно, тенантизация `OutboxEvent`/`IdempotencyKey` отдельно |
| 12 | важно | `prisma/migrations/20260730103000_audit_chain_v1/migration.sql:1` | A: `CREATE TABLE` `TenantAuditChain` + `CREATE FUNCTION` + `CREATE TRIGGER`; B: `ADD COLUMN AuditLog` | **да.** Новая сущность, функция, триггер и правка `AuditLog` в одном файле — высокий порог разбора при аварии | Разнести таблицу, функцию/триггер и правку `AuditLog` |
| 13 | важно | `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:1` | A: `CREATE TABLE` `Shift`,`ShiftHandover`(+3 enum); B: `DROP`/`ADD CONSTRAINT` на `WorkPermit` | **да.** Создание двух сущностей + правка констрейнта чужой (`WorkPermit`) таблицы | Вынести FK-правку `WorkPermit` отдельно |
| 14 | мелочь | `prisma/migrations/20260816120000_permit_work_types/migration.sql:1` | A: `CREATE TABLE` `PermitWorkType` + её RLS + `INSERT`-засев 6 видов работ | **нет (низкий).** Хотя это буквально «таблица+RLS+данные» из примера задания, всё аддитивно и идемпотентно (`ON CONFLICT DO NOTHING`), откат = `DROP TABLE` | Формально разнести DDL и засев; практической срочности нет |
| 15 | важно | `prisma/migrations/20260816150000_permit_approval_rules/migration.sql:1` | B: `ADD COLUMN`×2 на `PermitWorkType`+`WorkPermit`; D: `UPDATE`×2 (бэкфилл снимка правила для существующих нарядов) | **да.** Схема + необратимый бэкфилл; комментарий (:41) прямо описывает смысл снимка — это данные, которые нельзя восстановить иначе | Отдельная data-миграция после DDL |
| 16 | важно | `prisma/migrations/20260826110000_operator_v3_safety_incident/migration.sql:1` | B: `ADD COLUMN`×5 на `EquipmentDefect`; A: `CREATE TABLE` `SafetyIncident`+индексы | **да.** Две разные сущности одной миграцией (правка дефекта + новая сущность инцидента) | Разделить на «поля дефекта» и «таблица инцидента» |
| 17 | важно | `prisma/migrations/20260826150000_operator_v3_offline_authority/migration.sql:1` | B: `ADD COLUMN DeviceSyncState.lastAcceptedSequence`; A: `CREATE TABLE`×3 (`TrustedOperatorDeviceRecord`,`ServerOfflineAuthorizationKey`,`OfflineWorkAuthorizationRecord`) | **да.** Правка `DeviceSyncState` намекает на откат другой миграции (см. `20260913140000_drop_device_sync_last_accepted_sequence`) — темы связаны, но в одном файле с тремя новыми таблицами | Вынести правку `DeviceSyncState` отдельно |
| 18 | важно | `prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:1` | C: RLS (`ENABLE`+`FORCE`+`DROP/CREATE POLICY`) на 19 таблицах; D: `UPDATE`×3 (`PileWork`,`LeaderDrilling`,`ReportDowntime` — бэкфилл `tenantId` из `Report`, стр.30–34) | **да.** Изменение данных смешано с массовой раскаткой RLS; откат политик и откат бэкфилла — разные операции | Вынести три `UPDATE` в отдельную data-миграцию до раскатки RLS |
| 19 | мелочь | `prisma/migrations/20260903120000_fuel_log/migration.sql:1` | B: `ADD COLUMN Equipment.fuelTankLiters`; A: `CREATE TABLE` `FuelLog`+индексы+FK+RLS | **нет (низкий).** Аддитивно (комментарий :1 явно «без потерь данных»), связанная тема — топливный журнал | Можно оставить либо вынести колонку `Equipment` |

Итого: 19 смешанных — важно 12, мелочь 7, критично 0.

### B. Миграции с изменением данных (`INSERT`/`UPDATE`/`DELETE`)

Отдельная проверка (задание п.4). Помечены: смешанная (см. A) или «чисто данные».

| # | path:line | что меняет | тип |
|---|-----------|-----------|-----|
| 20 | `.../20260517120000_telematics_device_foundation/migration.sql` | `UPDATE`×7 `Equipment` | смешанная (A#1) |
| 21 | `.../20260517140000_equipment_full_metadata/migration.sql` | `UPDATE`×6 `Equipment` | смешанная (A#2) |
| 22 | `.../20260621010000_pile_grade_length_mm/migration.sql` | `UPDATE PileGrade` (длина из имени) | смешанная (A#5) |
| 23 | `.../20260621020000_fix_site_pile_plan_meters/migration.sql` | `UPDATE SitePilePlan.metersPerUnit` по `PileGrade.lengthMm` | **чисто данные** — ок, идемпотентно (только расходящиеся строки) |
| 24 | `.../20260622020000_tenant_dictionaries/migration.sql` | `INSERT`×6/`UPDATE`×4/`DELETE`×3: перепривязка ссылок + удаление строк справочников | смешанная (A#6), деструктивная |
| 25 | `.../20260622030000_crew_assistant_user_link/migration.sql` | `UPDATE CrewAssistant` (связь по точному имени) | смешанная (A#7) |
| 26 | `.../20260730100000_readiness_tenant_context/migration.sql` | `UPDATE TenantSettings.timezone` | смешанная (A#10) |
| 27 | `.../20260816120000_permit_work_types/migration.sql` | `INSERT`-засев `PermitWorkType` | смешанная (A#14) |
| 28 | `.../20260816150000_permit_approval_rules/migration.sql` | `UPDATE`×2: снимок правила для `PermitWorkType` и `WorkPermit` | смешанная (A#15) |
| 29 | `.../20260903000000_rls_remaining_tables/migration.sql` | `UPDATE`×3 `tenantId` из `Report` (стр.30–34) | смешанная (A#18) |
| 30 | `.../20260910210000_report_work_provenance/migration.sql` | `UPDATE`×3: восстановление `tenantId`/`shiftId` у `PileWork`,`LeaderDrilling`,`ReportDowntime` по связи с `Report` | **чисто данные** — ок, но проверить, что бэкфилл не маскирует удалённые документы (комментарий :1–2) |

Всего с изменением данных: 11 (9 смешанных + 2 чистых).

### C. Миграции с `DROP` (нужны для проверки при накатке)

| # | path:line | что удаляет | тип |
|---|-----------|-----------|-----|
| 31 | `.../20260526202204_equipment_maintenance/migration.sql` | `DROP COLUMN Report.journalPhotoMediaId`, `DROP CONSTRAINT`×6 | смешанная/деструктивная (A#3) |
| 32 | `.../20260710190000_module_layout_template/migration.sql:7-17` | `RENAME` таблицы/индекса/политики, `DROP INDEX MonitoringTileTemplate_tenantId_key` | одна сущность (перестройка `MonitoringTileTemplate`→`ModuleLayoutTemplate`), но `RENAME`+`ADD COLUMN`+`DROP INDEX` в одном файле |
| 33 | `.../20260711100000_module_layout_entity_scope/migration.sql` | `DROP INDEX` + `ADD COLUMN` + новый `UNIQUE INDEX` | одна сущность |
| 34 | `.../20260730105000_readiness_shifts_handovers/migration.sql` | `DROP CONSTRAINT` на `WorkPermit` | смешанная (A#13) |
| 35 | `.../20260817220000_drop_unread_projections/migration.sql:18-20` | `DROP TABLE` `ReportStats`,`OperatorPerformance`,`DowntimeSummary` | **чистый DROP** — ок, но на проде по 115 строк (комментарий :15–16): снять дамп перед накаткой |
| 36 | `.../20260820120000_shift_start_waiver/migration.sql` | `DROP POLICY IF EXISTS` на только что созданной `ShiftStartWaiver` | не смешение: идемпотентный паттерн «drop policy if exists + create» на новой таблице |
| 37 | `.../20260820140000_inspection_shift_phase_unique/migration.sql` | `DROP INDEX` + `CREATE UNIQUE INDEX` на `Inspection` | одна сущность |
| 38 | `.../20260820150000_crew_operator_many_rigs/migration.sql` | `DROP INDEX` (снятие уникальности) | одна сущность |
| 39 | `.../20260823100000_orion_lead/migration.sql` | `DROP POLICY IF EXISTS` на новой `OrionLead` | не смешение (идемпотентный паттерн); внимание: касается таблицы ORION-лидов (`OrionLead`), но это схема, не замороженный `src/app/orion/**` |
| 40 | `.../20260826140000_operator_v3_shift_report_identity/migration.sql` | `DROP INDEX`×2 на `Report` + `ADD COLUMN`×3 (`Report` и `Shift`) | пограничное: две таблицы одной темой «идентичность сменного отчёта»; формально не смешение по слоям |
| 41 | `.../20260902010000_production_corrections/migration.sql` | `DROP CONSTRAINT IF EXISTS`×3 + `ADD CONSTRAINT`×3 | одна сущность (пересборка CHECK-ов поправок), деструктив безопасен (`IF EXISTS`) |
| 42 | `.../20260902020000_corrections_allow_negative/migration.sql` | `DROP CONSTRAINT IF EXISTS`×3 + `ADD CONSTRAINT`×3 | одна сущность (уточнение CHECK-ов под поправки), безопасно |
| 43 | `.../20260903000000_rls_remaining_tables/migration.sql` | `DROP POLICY IF EXISTS`×19 | смешанная (A#18) |
| 44 | `.../20260903120000_fuel_log/migration.sql` | `DROP POLICY IF EXISTS` на новой `FuelLog` | смешанная (A#19); паттерн идемпотентный |
| 45 | `.../20260905090000_pile_passport/migration.sql` | `DROP POLICY IF EXISTS` на новой `PilePassport` | идемпотентный паттерн, не смешение |
| 46 | `.../20260906090000_user_role_check_all_roles/migration.sql:18-26` | `DROP CONSTRAINT`×2 (две CHECK-проверки роли) + `ADD CONSTRAINT`×1 `NOT VALID` + `VALIDATE` | одна сущность (сведение двух проверок роли в одну); важно по смыслу (роли `FOREMAN`/`SAFETY_ENGINEER`), но это изолированное логическое изменение |
| 47 | `.../20260913130000_user_tenant_fk_restrict/migration.sql` | `DROP CONSTRAINT` + `ADD CONSTRAINT` (FK `ON DELETE RESTRICT`) | одна сущность |
| 48 | `.../20260913140000_drop_device_sync_last_accepted_sequence/migration.sql` | `DROP COLUMN DeviceSyncState.lastAcceptedSequence` | **чистый DROP** — откатывает колонку из A#17; одна сущность |
| 49 | `.../20260914090000_pile_driving_set/migration.sql` | `DROP POLICY IF EXISTS` на новой `PileDrivingSet` | идемпотентный паттерн |
| 50 | `.../20260914100000_user_equipment_permit/migration.sql` | `DROP POLICY IF EXISTS` на новой `UserEquipmentPermit` | идемпотентный паттерн |
| 51 | `.../20260914110000_ppe_check/migration.sql` | `DROP POLICY IF EXISTS` на новой `PpeCheck` | идемпотентный паттерн |
| 52 | `.../20260924120000_drop_refresh_token/migration.sql:6` | `DROP TABLE IF EXISTS RefreshToken` | **чистый DROP** — ок, в комментарии зафиксировано «на проде 0 строк, входящих FK нет» |

Всего с `DROP`: 22. Из них реально рискованных (деструктивных по данным) — `equipment_maintenance` (#31), `drop_unread_projections` (#35), `drop_refresh_token` (#52); остальные — либо идемпотентный `DROP POLICY IF EXISTS` на новой таблице, либо `DROP/ADD CONSTRAINT IF EXISTS`.

### D. Прочие наблюдения (не нарушения, но стоит знать)

| # | severity | path:line | наблюдение |
|---|----------|-----------|-----------|
| 53 | мелочь | `.../20260419190903_init/migration.sql` | Гигантская стартовая миграция: 42 таблицы, 134 индекса, 30 констрейнтов. Формально «много изменений», но это baseline первого развёртывания — правило к ней неприменимо |
| 54 | мелочь | `.../20260516100000_extend_rls_tenant_scoped/migration.sql:8`, `.../20260701020000_force_row_level_security/migration.sql:14`, `.../20260813030000_readiness_rls_fail_closed/migration.sql`, `.../20260819120000_rls_fail_closed_all/migration.sql`, `.../20260819140000_rls_remaining_tenant_tables/migration.sql`, `.../20260817230000_rls_drop_null_tenant_escape/migration.sql` | Крупные однотемные `DO`-раскатки RLS. Внутри `DO` есть `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — это RLS, а не правка структуры; смешением НЕ считаются. Перечислены, чтобы не путать их с A |
| 55 | мелочь | `.../20260815000000_user_documents/migration.sql`, `.../20260829170000_operator_v3_mobile_new_spec/migration.sql` | Крупные, но монотонные: 2 и 4 новых таблицы со своими RLS/индексами/триггером — каждая как «одна сущность (набор таблиц одной фичи)». Замечаний нет |
| 56 | мелочь | `.../20260913130100_align_constraint_names/migration.sql` | `RENAME` 29 констрейнтов + 8 прочих — одно логическое изменение (приведение имён), просто объёмное |
| 57 | мелочь | `.../20260924120200_rename_user_equipment_permit_unique/migration.sql` | Один оператор `RENAME` индекса — образец соблюдения правила (но не был отнесён к DROP, т.к. это `ALTER INDEX … RENAME`) |

## Не проверено

- **Данные на реальной БД.** Всё выше — по тексту `migration.sql`. Наличие/отсутствие строк, на которые влияют `UPDATE`/`DELETE` (напр. сколько строк затронул бэкфилл `tenant_dictionaries` или `rls_remaining_tables`), не проверялось: БД не поднималась, `.env` не открывался, прод не трогался (запрет AGENTS.md).
- **Порядок применения и статус** миграций в `_prisma_migrations` (что реально накатано на прод, нет ли drift) — не проверялось.
- **Идемпотентность/аварийность на промежуточном состоянии.** Оценивал «на глаз» по тексту; реальный прогон и roll-back-тесты не делал.
- **Отнесение к слоям** выполнено автоматическим разбором + ручной вычиткой спорных файлов; границы «одна логическая сущность» в пограничных случаях (#32, #40, #55) — субъективны и отмечены как таковые.
- **Полнота подсчёта операторов** для `DO`-блоков: содержимое `DO` классифицировалось по ключевым словам, а не исполнялось; возможны пропущенные DDL, динамически собираемые `EXECUTE format(...)` (напр. `extend_rls_tenant_scoped`), но все они относятся к RLS.
- Замороженные зоны (варианты экрана машиниста, ORION-сайт) не затрагивались; миграция `orion_lead` касается только схемы и упомянута как наблюдение, не как работа с замороженным кодом.
