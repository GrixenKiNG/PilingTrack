# AU106-S7-MIGRATIONS-REVIEW-R2 — Миграции Prisma: риски блокировок и обратимости

Версия (git rev-parse HEAD): `917ea83c8e514a42f154ebe96bcfb5eeac7dbec0`
Дата прогона: 2026-10-09. Ветка: `hermes/q4-0926`.
Область: последние 60 каталогов `prisma/migrations/` (от `20260809120000_shift_pre_start_acceptance`
до `20261007130100_pile_work_received_at_fallback_index`; всего 60, `migration_lock.toml` не миграция).

## Резюме для владельца

1. Разрушающих изменений мало: 2 миграции с `DROP TABLE` (3 проекции + RefreshToken) и 1 с `DROP COLUMN` —
   все уже в baseline guard, но отката у них нет ни у одной.
2. Главный риск для 30-ГБ сервера — НЕ странные данные, а блокировки: 15 миграций создают уникальный
   индекс, и почти все — без `CONCURRENTLY`, то есть с короткой блокировкой записи на весь период построения.
3. Самая опасная — `20260826120000_operator_v3_production_intervals`: уникальный индекс на `PileWork`
   (самая крупная таблица) строится не-параллельно (стр. 14) — на большом объёме это минуты запрета записи.
4. Проверка данных до миграции существует (`scripts/check-migrations.js`), но покрывает только 4 вида
   операций и только миграции новее `20260930000000`; в нашей шестидесятке таких «рисковых» миграций
   нет — то есть сейчас этот предохранитель фактически ничего не проверяет.
5. Отката нет ни у одной из 60 миграций: Prisma не хранит down-скрипты, а блокировка и деструктив
   лечатся только откатом из бэкапа. Рекомендация в конце таблицы.

## Методика (можно повторить)

Читался только текст `prisma/migrations/<dir>/migration.sql` и `scripts/check-migrations.js`;
в БД не ходили, код приложения не меняли, чужие отчёты в `docs/audits/` не читались.

- Список последних 60 каталогов:
  `ls -d prisma/migrations/*/ | tail -60`
- По каждому файлу: строк, `DROP`, `CREATE INDEX`, `CREATE INDEX CONCURRENTLY`, `ALTER TABLE`, `UPDATE/DELETE`:
  `for d in ...; do grep -ciE '<шаблон>' prisma/migrations/$d/migration.sql; done`
- Точечно: `rg -n 'SET NOT NULL|DROP COLUMN|CREATE UNIQUE INDEX|ADD CONSTRAINT|NOT VALID|lock_timeout' prisma/migrations`
- Предохранитель: `node scripts/check-migrations.js` → exit 0; baseline `scripts/.migration-guard-baseline.txt`.
- Схема больших таблиц: `grep -nE 'model (PileWork|Report|TelemetryRecord|OutboxEvent|AuditLog|Media)' prisma/schema.prisma`
- Проверка поведения Prisma с `CREATE INDEX CONCURRENTLY` — по документации Prisma (context7).

Итоговые числа по 60 миграциям: `DROP TABLE` — 2 файла (3 шт. в одном), `DROP COLUMN` — 1,
`DROP INDEX` — 2, `CREATE UNIQUE INDEX` — 15 файлов, `CREATE INDEX` (вкл. UNIQUE) — 40 файлов,
с `CONCURRENTLY` — только 2 файла, `UPDATE` — 3 файла, `SET NOT NULL` — 1, `NOT VALID`+`VALIDATE` — 1.

## Находки

Формат severity: критично / важно / мелочь. Статус: ПРОЙДЕНО (значение подтверждено чтением файла),
ГИПОТЕЗА (вывод, требующий прогона), НЕ ПРОВЕРЕНО.

| # | severity | path:line | что делает / проблема | сценарий | предлагаемое |
|---|----------|-----------|------------------------|----------|--------------|
| 1 | критично | prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:14 | `CREATE UNIQUE INDEX "PileWork_tenantId_clientCommandId_key"` без `CONCURRENTLY` на `PileWork` — самой крупной таблице. Статус: ПРОЙДЕНО | Построение индекса берёт SHARE-лок: запись в `PileWork` (журнал забивки) заблокирована на всё время построения. На 30 ГБ это минуты, у операторов «зависает» сохранение. | Вариант с `CONCURRENTLY` отдельной миграцией без BEGIN (как `20261007130000`) или вне окна смены |
| 2 | критично | prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:15 | `CREATE INDEX "PileWork_tenantId_shiftId_occurredAt_idx"` без `CONCURRENTLY` на `PileWork`. Статус: ПРОЙДЕНО | Второй блокирующий build на той же большой таблице в той же миграции (суммарно дольше). | `CONCURRENTLY` |
| 3 | важно | prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:13 | `ADD COLUMN "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` на `PileWork`. Статус: ГИПОТЕЗА | В PG11+ константный/стабильный DEFAULT не переписывает таблицу, но `NOT NULL` на непустой таблице и отсутствие предпроверки — отдельный риск падения. | Подтвердить на копии прод-БД, что колонка добавилась без rewrite |
| 4 | важно | prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:23 | `CREATE UNIQUE INDEX "LeaderDrilling_tenantId_clientCommandId_key"` без `CONCURRENTLY`. ПРОЙДЕНО | Тот же класс, что №1, на `LeaderDrilling`. | `CONCURRENTLY` |
| 5 | важно | prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:24 | `CREATE INDEX "LeaderDrilling_tenantId_shiftId_occurredAt_idx"` без `CONCURRENTLY`. ПРОЙДЕНО | Блокировка записи на время build. | `CONCURRENTLY` |
| 6 | важно | prisma/migrations/20260902010000_production_corrections/migration.sql:36 | `ADD CONSTRAINT "PileWork_correction_needs_note" CHECK (...)` без `NOT VALID` — проверяет ВСЕ строки `PileWork` под ACCESS EXCLUSIVE-локом. ПРОЙДЕНО | На большой таблице — длинная блокировка чтения и записи; нет предпроверки, миграция старше cutoff guard (см. №20), в baseline её нет. | `NOT VALID` + отдельный `VALIDATE CONSTRAINT` (как в №16) или предпроверка |
| 7 | важно | prisma/migrations/20260902010000_production_corrections/migration.sql:40 | То же для `LeaderDrilling` (`LeaderDrilling_correction_needs_note`). ПРОЙДЕНО | Тот же риск. | `NOT VALID` + `VALIDATE` |
| 8 | важно | prisma/migrations/20260902010000_production_corrections/migration.sql:44 | То же для `ReportDowntime` (`ReportDowntime_correction_needs_note`). ПРОЙДЕНО | Тот же риск. | `NOT VALID` + `VALIDATE` |
| 9 | важно | prisma/migrations/20260902020000_corrections_allow_negative/migration.sql:10,11 | `DROP CONSTRAINT chk_pile_count_positive` затем `ADD CONSTRAINT ... CHECK (CASE ...)` без `NOT VALID` на `PileWork`. ПРОЙДЕНО | Снимает старую защиту и валидирует новую по всем строкам под ACCESS EXCLUSIVE — блокирует таблицу. | `NOT VALID` + `VALIDATE` |
| 10 | важно | prisma/migrations/20260902020000_corrections_allow_negative/migration.sql:14,15 | То же для `LeaderDrilling` (`chk_drilling_meters_positive`). ПРОЙДЕНО | Тот же риск. | `NOT VALID` + `VALIDATE` |
| 11 | важно | prisma/migrations/20260902020000_corrections_allow_negative/migration.sql:18,19 | То же для `ReportDowntime` (`chk_downtime_duration_positive`). ПРОЙДЕНО | Тот же риск. | `NOT VALID` + `VALIDATE` |
| 12 | важно | prisma/migrations/20260910210000_report_work_provenance/migration.sql:3 | Безусловный `UPDATE "PileWork" ... FROM "Report"` (заполнение `tenantId`/`shiftId`). ПРОЙДЕНО | На большой `PileWork` — UPDATE многих строк в одной транзакции миграции; блокировки строк и рост WAL. Guard `DELETE FROM` не ловит, т.к. это `UPDATE` (см. №19). | Предпроверка числа строк, разбивка батчами, отдельная миграция |
| 13 | важно | prisma/migrations/20260910210000_report_work_provenance/migration.sql:9,15 | То же для `LeaderDrilling` и `ReportDowntime`. ПРОЙДЕНО | Тот же риск. | см. №12 |
| 14 | важно | prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:30,32,34 | Безусловный `UPDATE` `tenantId` по трём таблицам выработки ДО включения строгой RLS. ПРОЙДЕНО | Массовый UPDATE на большой `PileWork`; если прервётся — часть строк останется с пустым tenantId и строгая политика их скроет. | Предпроверка остатка `WHERE tenantId IS NULL`, повторяемость |
| 15 | важно | prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:44,45 | `ENABLE` + `FORCE ROW LEVEL SECURITY` на `PileWork` (и далее по списку, стр. 50–193). ПРОЙДЕНО | `FORCE RLS` применяет политику и к владельцу таблицы; запрос собственника без `app.current_tenant` начнёт отдавать 0 строк — тихая потеря в журнале. | Проследить, что все читатели `PileWork` ставят `app.current_tenant` |
| 16 | ПРОЙДЕНО (плюс) | prisma/migrations/20260906090000_user_role_check_all_roles/migration.sql:24,26 | `ADD CONSTRAINT ... CHECK ... NOT VALID` + отдельный `VALIDATE CONSTRAINT` — правильный образец, не держит долгую блокировку. | — | Использовать как эталон для №6–11 |
| 17 | важно | prisma/migrations/20260826140000_operator_v3_shift_report_identity/migration.sql:4 | `CREATE UNIQUE INDEX "Report_tenantId_shiftId_key"` без `CONCURRENTLY`; строки 1–2 снимают прежние уникальные индексы `Report_userId_siteId_date_key`. ПРОЙДЕНО | Блокирующий build на `Report`; между №1 и этим шагом уникальность временно слабее (частичный индекс вернули в №18). | `CONCURRENTLY` отдельной миграцией |
| 18 | важно | prisma/migrations/20260829200000_report_legacy_identity_guard/migration.sql:15 | `CREATE UNIQUE INDEX "Report_user_site_date_without_shift_key" ... WHERE shiftId IS NULL` без `CONCURRENTLY`. ПРОЙДЕНО | Блокирующий build; падёт, если на проде уже есть дубли (userId,siteId,date) без смены — предпроверки нет. | Предпроверка дублей + `CONCURRENTLY` |
| 19 | важно | scripts/check-migrations.js:57 и scripts/check-migrations.js:104-120 | Guard ловит `DROP COLUMN|DROP TABLE|TRUNCATE|DELETE FROM` и 4 вида data-dependent DDL, но НЕ ловит: `CREATE INDEX` без `CONCURRENTLY`, `UPDATE`, `DELETE` без `FROM`, `ALTER COLUMN TYPE`, volatile `DEFAULT`, `DROP INDEX`. ПРОЙДЕНО | Именно эти классы и создают блокировки/потерю данных (№1,2,12,14), но проходят guard молча. | Дополнить регэкспы guard (хотя бы `CREATE INDEX` без CONCURRENTLY и `^\s*UPDATE`) |
| 20 | важно | scripts/check-migrations.js:54 | `GUARD_SINCE = '20260930000000'`: data-dependent DDL проверяется только для миграций новее 30.09.2026. Среди нашей шестидесятки таких всего 2 (`20261007130000`, `20261007130100`), и в обеих нет рисковой операции. ПРОЙДЕНО | Сейчас второй предохранитель фактически ничего не проверяет; все CHECK/UNIQUE из №4–18 старше cutoff. | Не понижать cutoff; для повторного прогона на прод брать копию БД (как задумано) |
| 21 | важно | prisma/migrations/20260829200100_downtime_reason_required/migration.sql:16 | `ADD CONSTRAINT "ReportDowntime_reason_present" CHECK (...)` без `NOT VALID`. ПРОЙДЕНО | Полный скан `ReportDowntime` под блокировкой; предпроверки нет. | `NOT VALID` + `VALIDATE` |
| 22 | важно | prisma/migrations/20260924120100_site_weekly_trend_tenant_not_null/migration.sql:7 | `ALTER COLUMN "tenantId" SET NOT NULL`. Комментарий (стр.1–6) утверждает, что на проде ограничение уже стоит вручную → no-op. Статус: ГИПОТЕЗА | Если на какой-то среде NOT NULL ещё нет, операция валидирует всю таблицу (скан + блокировка). | Подтвердить на копии прод-БД, что столбец уже NOT NULL |
| 23 | мелочь | prisma/migrations/20260815120000_shift_auto_close/migration.sql:16 | `CREATE INDEX "Shift_tenantId_autoClosedAt_idx"` без `CONCURRENTLY`. ПРОЙДЕНО | Блокировка записи на время build; `Shift` меньше, но накапливается. | `CONCURRENTLY` |
| 24 | мелочь | prisma/migrations/20260813020000_defect_source_key/migration.sql:8 | `CREATE INDEX "EquipmentDefect_tenantId_sourceKey_status_idx"` без `CONCURRENTLY`. ПРОЙДЕНО | Блокировка записи. | `CONCURRENTLY` |
| 25 | мелочь | prisma/migrations/20260903120000_fuel_log/migration.sql:28,31 | Два `CREATE INDEX` на `FuelLog` без `CONCURRENTLY`. ПРОЙДЕНО | `FuelLog` новая (пустая на момент наката) — риск низкий; при повторном накате на наполненную таблицу — блокировка. | Оставить; учитывать при повторном применении |
| 26 | мелочь | prisma/migrations/20260816150000_permit_approval_rules/migration.sql:27,28,31,32 | `ADD COLUMN ... NOT NULL DEFAULT ARRAY[...]` / `BOOLEAN NOT NULL DEFAULT true` на `PermitWorkType` и `WorkPermit`. ПРОЙДЕНО | Константный DEFAULT в PG11+ без rewrite; дополнительно стр.36,44 перезаписывают значения `UPDATE`. | Ок для малых таблиц |
| 27 | важно (необратимо) | prisma/migrations/20260817220000_drop_unread_projections/migration.sql:18-20 | `DROP TABLE "ReportStats"/"OperatorPerformance"/"DowntimeSummary"`. ПРОЙДЕНО | Данные удаляются безвозвратно; откат — только из бэкапа. Уже в baseline (`scripts/.migration-guard-baseline.txt`), но baseline ≠ обратимость. | Снять дамп перед накатом (как в комментарии стр.15–16) |
| 28 | важно (необратимо) | prisma/migrations/20260924120000_drop_refresh_token/migration.sql:6 | `DROP TABLE "RefreshToken"`. ПРОЙДЕНО | Необратимо; таблица заявлена пустой. | Ок (в baseline), но отката нет |
| 29 | важно (необратимо) | prisma/migrations/20260913140000_drop_device_sync_last_accepted_sequence/migration.sql:8 | `ALTER TABLE "DeviceSyncState" DROP COLUMN "lastAcceptedSequence"`. ПРОЙДЕНО | Необратимо; колонка заявлена неиспользуемой и пустой. | Ок (в baseline) |
| 30 | мелочь | prisma/migrations/20260913130000_user_tenant_fk_restrict/migration.sql:5 | `DROP CONSTRAINT` + `ADD CONSTRAINT ... FOREIGN KEY` на `User`. ПРОЙДЕНО | Добавление FK валидирует ссылки (скан `User`); таблица мала. | Ок |
| 31 | мелочь | prisma/migrations/20260820140000_inspection_shift_phase_unique/migration.sql:15,17 | `DROP INDEX` обычного + `CREATE UNIQUE INDEX` на `Inspection`. ПРОЙДЕНО | Уникальный build без `CONCURRENTLY` на `Inspection`; падёт на дублях `(tenantId,shiftId,phase)` — предпроверки нет. | Предпроверка дублей; `CONCURRENTLY` |
| 32 | мелочь | prisma/migrations/20260914100000_user_equipment_permit/migration.sql:33 | `CREATE UNIQUE INDEX` на `UserEquipmentPermit`. ПРОЙДЕНО | Новая таблица — риск низкий. | Ок |
| 33 | мелочь | prisma/migrations/20260914110000_ppe_check/migration.sql:21 | `CREATE UNIQUE INDEX` на `PpeCheck`. ПРОЙДЕНО | Новая таблица — риск низкий. | Ок |
| 34 | важно (обратимость) | prisma/migrations/20261007130000_pile_work_tenant_occurred_at_index/migration.sql:2-4 | Единственные миграции, использующие `CREATE INDEX CONCURRENTLY`, полагаются на то, что файл выполняется вне транзакции. Статус: НЕ ПРОВЕРЕНО в этом репозитории | Документация Prisma (context7, prisma.io) прямо говорит: `CREATE INDEX CONCURRENTLY` нельзя в транзакции, надо «ensure the migration runs outside a transaction block»; поведение `prisma migrate deploy` из этого репозитория на реальной БД я не запускал. | Прогнать `npx prisma migrate deploy` (или `migrate status`) на тестовой БД и подтвердить, что обе CONCURRENTLY-миграции применяются |
| 35 | важно (обратимость) | prisma/migrations/*/migration.sql (все 60) | У всех 60 миграций нет down-скрипта: Prisma не хранит откаты. Статус: ПРОЙДЕНО | Любая упавшая миграция оставляет P3009 и блокирует следующие выкладки до ручного `migrate resolve --rolled-back`; деструктив и блокировки откатываются только бэкапом. | Держать актуальный бэкап перед накатом; для рискованных — накат в окно с минимальной нагрузкой |

### Итоги по категориям

- Критично: 2 (№1, 2 — не-параллельный уникальный индекс и индекс на `PileWork`).
- Важно: 17 (блокирующие CHECK/индексы/UPDATE, `SET NOT NULL`, пробелы предохранителя, необратимость, CONCURRENTLY-в-транзакции).
- Мелочь: 12.
- Ни в одной из 60 миграций нет встроенного отката; деструктивных — 3 (все в baseline).
- Итого таблица: 35 строк.

## Что не проверено

1. Фактический размер и число строк таблиц на боевом 30-ГБ сервере — доступа к прод-БД и её копии нет;
   «самая крупная таблица» (`PileWork`) — вывод по смыслу (журнал забивки), не по `pg_class`. Статус: НЕ ПРОВЕРЕНО.
2. Реальное поведение `prisma migrate deploy` (Prisma 7.8) с двумя `CREATE INDEX CONCURRENTLY`-миграциями
   в этом репозитории: обёртка в транзакцию не запускалась (нет БД, запуск запрещён правилами). См. №34 — ГИПОТЕЗА.
3. Факт, что на проде `SiteWeeklyTrend.tenantId` уже `NOT NULL` (утверждение в комментарии миграции) — не проверял.
4. Наличие/отсутствие дублей `(tenantId, shiftId, phase)`, `(userId, siteId, date)`, `(tenantId, clientCommandId)`
   в боевых данных на момент наката — только по комментариям миграций, не по `SELECT`. Статус: НЕ ПРОВЕРЕНО.
5. Влияние `FORCE ROW LEVEL SECURITY` на пути чтения `PileWork` в коде (все ли ставят `app.current_tenant`) —
   это уже за рамками аудита миграций; не проверял.
6. Я не проверял, применялись ли эти миграции на прод в одном порядке без пропусков (только `migration_lock.toml`,
   provider `postgresql`); сверку `_prisma_migrations` с прод-БД не делал.
7. Миграции из «замороженных» областей (operator-v3) рассматривались только со стороны БД; сам UI не трогал.
