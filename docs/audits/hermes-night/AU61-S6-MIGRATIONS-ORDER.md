# AU61-S6-MIGRATIONS-ORDER — Порядок и состав последних миграций

Аудит только для чтения. Версия (HEAD рабочей папки): `a982a4e3b0627d1949398344842566bd000c1578`
(branch `hermes/q4-0926`, git worktree D:\PillingR\wt-night). Отчёт создан этим прогоном; чужие отчёты
в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

## Итог

Окно — последние 25 миграций по имени (`20260902010000` … `20261007130100`). Факты, а не оценки:
все 25 меток уникальны и строго возрастают, но одна миграция помечена временем **раньше** уже
закоммиченных (`20260914090000_pile_driving_set` добавлена коммитом `6d7af34a` 14.09.2026 23:25, тогда как
`20260914100000` и `20260914110000` — коммитами `ef20127e` 07:54 и `3f4ae2b5` 11:43 того же дня).
Состав: 26 создающих индексов, из них без `CONCURRENTLY` — 22; 7 CHECK-ограничений, из них с
`NOT VALID` — 1; 1 `SET NOT NULL`, 1 `DROP TABLE`, 1 `DROP COLUMN`, 6 backfill-`UPDATE`.
Разбивка по важности: **критично 0, важно 9, мелочь 10** (всего 19 находок, номера 1–19).
Топ-5: (1) индексы без `CONCURRENTLY` на растущих `Report`/`FeedbackEvent` (№1); (2) индексы и CHECK
без `NOT VALID` на `PileWork` (№2–4); (3) метка миграции раньше уже применённых (№5); (4) миграция
`20260903000000` совмещает backfill и RLS на 19 таблиц в одном файле (№6); (5) два необратимых
`DROP` (№7–8). Ни одного дефекта уровня «данные теряются молча» при текущем порядке наката не
подтверждено.

## Методика

Что и как искал (все команды — read-only, выполнены в D:\PillingR\wt-night):

```
git rev-parse HEAD                          # a982a4e3b0627d1949398344842566bd000c1578
ls prisma/migrations | wc -l                # 110 (109 каталогов + migration_lock.toml)
ls prisma/migrations | grep -v migration_lock | sort > migs.txt ; tail -25 migs.txt
ls prisma/migrations | grep -v migration_lock | cut -d_ -f1 | sort | uniq -d   # 20260820150000
tail -25 migs.txt | awk -F_ '{print $1}' | sort -c                            # метки строго возрастают
git log --reverse --diff-filter=A --name-only --format='COMMIT %h %cI' -- 'prisma/migrations/*/migration.sql'
git log --diff-filter=A --format=%cI -1 -- prisma/migrations/<dir>            # дата добавления каждого каталога
node -e '...' (подсчёт операторов по 25 файлам)                                # числа ниже
grep / search_files по src, tests, e2e, scripts на ссылки на имена constraint/index и пути миграций
```

Чтение содержимого: каждый из 25 файлов `prisma/migrations/<dir>/migration.sql` прочитан построчно
(`read_file`), плюс `prisma/schema.prisma`, `scripts/app-role-grants.sql`, `scripts/audit-fix-tenancy.sql`,
`scripts/apply-postgres-hardening.ts`, `scripts/identity-role-grants.sql`.
Поведение Prisma (порядок применения по имени, `CONCURRENTLY` вне транзакции) подтверждено документацией
через context7 (`/websites/prisma_io`): «Prisma ORM 7 … applies them in name order, so where a migration
sits in the history is decided by its name»; «`CREATE INDEX CONCURRENTLY` cannot run inside a transaction».

Числа команды `node` по 25 файлам окна:
`CREATE INDEX` без CONCURRENTLY — 17; `CREATE UNIQUE INDEX` без CONCURRENTLY — 5; `CREATE INDEX CONCURRENTLY` — 4;
`ADD CONSTRAINT … CHECK` — 7 (из них `NOT VALID` — 1); `ADD CONSTRAINT … FOREIGN KEY` — 7;
`SET NOT NULL` — 1; backfill-`UPDATE` — 6; `DROP TABLE` — 1; `DROP COLUMN` — 1; `CREATE TABLE` — 6;
`ADD COLUMN` — 23; `ENABLE/FORCE ROW LEVEL SECURITY` и `CREATE POLICY` — по 24; переименований `RENAME` — 38.

## Порядок меток — статус

| # | Проверка | Результат | Статус |
|---|---|---|---|
| O1 | Метки 25 последних уникальны и строго возрастают (`sort -c`) | да | ПРОЙДЕНО |
| O2 | Нет миграции с меткой позже предыдущей (нарушение порядка внутри каталога) | нарушений нет | ПРОЙДЕНО |
| O3 | Есть ли метка раньше уже закоммиченной миграции | да: `20260914090000` (коммит 23:25) помечена раньше `20260914100000` (07:54) и `20260914110000` (11:43) | ПРОЙДЕНО (факт по git) |
| O4 | Были ли эти три уже применены на проде к моменту добавления `090900` | определить нельзя: `_prisma_migrations` не читалась, доступа к проду нет | НЕ ПРОВЕРЕНО |
| O5 | Две миграции с одинаковой меткой | да, но вне окна: `20260820150000_crew_operator_many_rigs` / `20260820150000_document_required_for_operator` | ПРОЙДЕНО |
| O6 | Функциональная зависимость `20260914090000` от более поздних по имени | нет: она создаёт новую таблицу `PileDrivingSet` и ничего из них не использует | ПРОЙДЕНО |

## Состав 25 миграций

Столбец «1 изменение?» — оценка правила «одна миграция — одно логическое изменение».
Столбец «блокирует» — операции, держащие тяжёлую блокировку на существующей таблице.

| № | Миграция | Что меняет (файл:строка) | 1 изменение? | Блокирует | Отдельный шаг на проде |
|---|---|---|---|---|---|
| 1 | 20260902010000_production_corrections | +correctsId/correctionNote в PileWork, LeaderDrilling, ReportDowntime; 3 индекса; 3 CHECK (migration.sql:15-45) | да (одна тема) | CREATE INDEX ×3; ADD CHECK без NOT VALID ×3 | нет |
| 2 | 20260902020000_corrections_allow_negative | DROP+ADD трёх CHECK (migration.sql:9-19) | да | перевалидация 3 таблиц | нет |
| 3 | 20260903000000_rls_remaining_tables | backfill tenantId + RLS на 19 таблицах (migration.sql:15-219) | **нет** (данные + безопасность) | UPDATE ×3; ACCESS EXCLUSIVE ×19 таблиц | нет |
| 4 | 20260903120000_fuel_log | `Equipment.fuelTankLiters` + новая `FuelLog` + RLS (migration.sql:9-47) | **нет** (ALTER + CREATE) | нет (новая таблица) | нет |
| 5 | 20260905090000_pile_passport | новая `PilePassport` + 4 индекса + FK + RLS (migration.sql:5-66) | да | нет (пустая таблица) | нет |
| 6 | 20260905140000_pile_passport_follower | +followerUsed (migration.sql:4) | да | нет (ADD COLUMN с default, PG11+) | нет |
| 7 | 20260905160000_pile_passport_acceptance | enum `PileAcceptance`, 4 колонки, индекс (migration.sql:5-19) | да | CREATE INDEX без CONCURRENTLY по PilePassport | нет |
| 8 | 20260906090000_user_role_check_all_roles | сводит две CHECK-проверки роли в одну, NOT VALID + VALIDATE (migration.sql:18-26) | да | нет (NOT VALID) | нет |
| 9 | 20260910210000_report_work_provenance | backfill tenantId/shiftId (migration.sql:3-20) | да | UPDATE по таблицам под FORCE RLS | нет |
| 10 | 20260913130000_user_tenant_fk_restrict | `User_tenantId_fkey` → ON DELETE RESTRICT (migration.sql:4-5) | да | DROP+ADD FK (валидация User) | нет |
| 11 | 20260913130100_align_constraint_names | 37 переименований constraint/index (migration.sql:5-41) | да | нет (только каталог) | нет |
| 12 | 20260913140000_drop_device_sync_last_accepted_sequence | DROP COLUMN (migration.sql:8) | да | ACCESS EXCLUSIVE (метаданные) | нет |
| 13 | 20260913140100_briefing_record | новая `BriefingRecord` + 2 индекса + FK (migration.sql:5-31) | да | нет (пустая таблица) | нет |
| 14 | 20260913150000_briefing_type_instructor_signatures | 6 колонок + индекс (migration.sql:9-21) | да | CREATE INDEX без CONCURRENTLY | нет |
| 15 | 20260914090000_pile_driving_set | новая `PileDrivingSet` + 2 индекса + FK + RLS (migration.sql:11-42) | да | нет (пустая таблица) | нет |
| 16 | 20260914100000_user_equipment_permit | 2 enum + новая `UserEquipmentPermit` + 3 индекса + FK + RLS (migration.sql:7-57) | да | нет (пустая таблица) | нет |
| 17 | 20260914110000_ppe_check | новая `PpeCheck` + 2 индекса + FK + RLS (migration.sql:7-39) | да | нет (пустая таблица) | нет |
| 18 | 20260924120000_drop_refresh_token | DROP TABLE RefreshToken (migration.sql:6) | да | ACCESS EXCLUSIVE; необратимо | да: подтвердить пустоту таблицы и наличие бэкапа |
| 19 | 20260924120100_site_weekly_trend_tenant_not_null | SET NOT NULL (migration.sql:7) | да | скан+ACCESS EXCLUSIVE | да: на проде no-op, на восстановленной БД может упасть |
| 20 | 20260924120200_rename_user_equipment_permit_unique | переименование индекса (migration.sql:5) | да | нет | нет |
| 21 | 20260925120000_report_feedback_period_indexes | 2 индекса без CONCURRENTLY (migration.sql:5-6) | да | CREATE INDEX по Report и FeedbackEvent | нет |
| 22 | 20260925180000_dlq_replay_identity | +3 колонки в DeadLetterQueue (migration.sql:4-6) | да | нет (nullable) | нет |
| 23 | 20260926213000_pile_grade_archived_at | +PileGrade.archivedAt (migration.sql:4) | да | нет | нет |
| 24 | 20261007130000_pile_work_tenant_occurred_at_index | CREATE INDEX CONCURRENTLY (migration.sql:3-4) | да | нет | да: проверить indisvalid после наката |
| 25 | 20261007130100_pile_work_received_at_fallback_index | CREATE INDEX CONCURRENTLY (migration.sql:3-4) | да | нет | да: проверить indisvalid после наката |

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что сделать |
|---|---|---|---|---|---|
| 1 | важно | prisma/migrations/20260925120000_report_feedback_period_indexes/migration.sql:5-6 | `CREATE INDEX` без `CONCURRENTLY` по `Report(tenantId,date)` и `FeedbackEvent(scope,targetId,createdAt)` | `Report` и `FeedbackEvent` растут вместе с историей; неconcurrent `CREATE INDEX` берёт SHARE-блокировку и на время построения блокирует записи в эти таблицы. На момент наката база была ~130 МБ (это утверждение комментария, не проверял), но таблица растёт. К 07.10 в проекте уже умеют `CONCURRENTLY` — здесь правило ещё нарушено | разбить на две миграции с `CREATE INDEX CONCURRENTLY` (одно утверждение в файле) |
| 2 | важно | prisma/migrations/20260902010000_production_corrections/migration.sql:29-31 | 3 индекса без `CONCURRENTLY`, в т.ч. по `PileWork` — журналу забивки | `PileWork` — самая крупная растущая таблица; построение индекса блокирует запись в журнал | `CONCURRENTLY` отдельными миграциями |
| 3 | важно | prisma/migrations/20260902010000_production_corrections/migration.sql:35-45 | `ADD CONSTRAINT … CHECK` без `NOT VALID` на PileWork/LeaderDrilling/ReportDowntime | добавление CHECK валидирует все строки под ACCESS EXCLUSIVE; на большой таблице — долгая блокировка чтения и записи. В проекте есть корректный образец (`20260906090000:21-26`) | `NOT VALID` + отдельный `VALIDATE CONSTRAINT` |
| 4 | важно | prisma/migrations/20260902020000_corrections_allow_negative/migration.sql:9-19 | `DROP`+`ADD` тех же трёх CHECK | повторная полная валидация трёх таблиц в одной миграции; к тому же двойная работа поверх №3 | `NOT VALID` + `VALIDATE CONSTRAINT` |
| 5 | важно | prisma/migrations/20260914090000_pile_driving_set/ (метка) vs коммиты `6d7af34a`/`ef20127e`/`3f4ae2b5` | метка миграции раньше уже закоммиченных | Prisma применяет миграции **по имени**. `20260914090000` добавлена 14.09.2026 23:25 — после `20260914100000` (07:54) и `20260914110000` (11:43). Если прод накатил те две раньше, эта миграция встала «в прошлое»: журнал прогонов и порядок имён расходятся, что затрудняет аудит и откат. Функциональной зависимости нет (создаёт новую таблицу), поэтому расхождение схемы маловероятно | пронумеровать по факту наката (`20260915000000…`) либо подтвердить по `_prisma_migrations`, что порядок совпал с именем |
| 6 | важно | prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:15-219 | 219 строк: backfill данных (`UPDATE` :30-35), RLS на 19 таблицах (:44-194) и перечень исключений (:196-219) | это два логических изменения в одном файле; при падении на середине Prisma пометит миграцию failed, но часть политик уже создана → ручной разбор. Плюс это самая длинная миграция окна | разделить: `…_rls_backfill_data` и `…_rls_policies` |
| 7 | важно | prisma/migrations/20260924120000_drop_refresh_token/migration.sql:6 | `DROP TABLE IF EXISTS "RefreshToken"` | необратимая потеря данных, если утверждение комментария «0 строк на проде» неверно. Комментарий опирается на проверку, которую я не воспроизводил (доступа к проду нет) | отдельным шагом на проде: `SELECT count(*)` перед накатом + свежий бэкап |
| 8 | важно | prisma/migrations/20260913140000_drop_device_sync_last_accepted_sequence/migration.sql:8 | `DROP COLUMN "lastAcceptedSequence"` | необратимо; столбец уходил из таблицы, оставшейся от удалённой фичи (пустая по комментарию) | подтвердить пустоту/бэкап перед накатом |
| 9 | важно | prisma/migrations/20260924120100_site_weekly_trend_tenant_not_null/migration.sql:7 + scripts/audit-fix-tenancy.sql:32-42 | `NOT NULL` для `SiteWeeklyTrend` пришёл вне миграций (ручной скрипт), миграция лишь «закрепляет» его | скрипт ставит `SET NOT NULL` на **все** таблицы с nullable `tenantId`, а в истории миграций закреплена только одна. Значит история миграций ≠ фактическая схема: новая база из миграций получит другой набор ограничений, чем прод | закрепить в миграциях все фактически применённые `NOT NULL` (по списку из скрипта) либо удалить ручной скрипт из процесса |
| 10 | важно | prisma/migrations/20260910210000_report_work_provenance/migration.sql:3-20 | backfill `UPDATE` по таблицам, где ранее включён `FORCE ROW LEVEL SECURITY` (`20260903000000:44-60`) | при текущем порядке наката безопасно: миграции выполняет роль-владелец-суперпользователь (`scripts/app-role-grants.sql:5-6,12-13` — `piling`, `rolsuper=t`, `rolbypassrls=t`), а суперпользователь обходит RLS даже с FORCE. Но если миграции когда-нибудь накатит `pilingtrack_app` (NOBYPASSRLS, `scripts/app-role-grants.sql:73-74`), политика `tenantId = current_setting('app.current_tenant', true)` отфильтрует все строки, и `UPDATE` молча обновит 0 строк, завершившись успешно | либо явно `SET LOCAL app.current_tenant`, либо `ALTER TABLE … NO FORCE` вокруг backfill, либо документировать жёстко: миграции только ролью-владельцем |
| 11 | мелочь | prisma/migrations/20260903120000_fuel_log/migration.sql:9 и :12-25 | в одной миграции — `ALTER TABLE Equipment ADD COLUMN` и новая таблица `FuelLog` | два логических изменения в файле (нарушение правила, последствия низкие) | разнести, если файл будет пересобираться |
| 12 | мелочь | prisma/migrations/20260820150000_crew_operator_many_rigs/ и …_document_required_for_operator/ | две миграции с одинаковой меткой (вне окна 25) | порядок между ними задаёт имя файла (`…crew_operator…` < `…document_required…`), а не время; при переименовании каталога порядок изменится | развести метки |
| 13 | мелочь | prisma/migrations/20260906090000_user_role_check_all_roles/migration.sql:11 | комментарий ссылается на `scripts/postgres-production-hardening.sql` | такого файла нет (переименован в `scripts/apply-postgres-hardening.ts`); читатель пойдёт по несуществующему пути | поправить ссылку в комментарии |
| 14 | мелочь | scripts/apply-postgres-hardening.ts:68-70 vs prisma/migrations/20260902020000_corrections_allow_negative/migration.sql:9-19 | у `chk_pile_count_positive`/`chk_drilling_meters_positive`/`chk_downtime_duration_positive` два владельца; версия в скрипте устарела | скрипт добавляет старое условие (`count > 0` и т.п.) без учёта поправок (`correctsId`). На базе, где миграция 020200 уже прошла, `DO … EXCEPTION duplicate_object` сохранит миграционную версию — ок. Но если скрипт отработает на базе, где ограничения нет, отрицательная поправка станет невозможной | привести список в скрипте в соответствие с миграцией или убрать эти три из скрипта |
| 15 | мелочь | prisma/migrations/20260913130100_align_constraint_names/migration.sql:5-41 | 37 переименований constraint/index | прямых ссылок на старые имена в `src/`, `tests/`, `e2e/` не найдено (поиск вернул 0; единственные совпадения — сгенерированный клиент в `src/generated`, исключённый из поиска). Полной гарантии нет | оставить как есть; при сомнении прогнать `prisma migrate diff` на прод-схеме |
| 16 | мелочь | prisma/migrations/20260905160000…:19; 20260913140100…:25,28; 20260913150000…:21 | `CREATE INDEX` без `CONCURRENTLY` по существующим таблицам | таблицы малы/только созданы на момент наката, риск сейчас низкий, но правило единое | при пересборке — `CONCURRENTLY` |
| 17 | мелочь | prisma/migrations/20261007130000…:3-4 и 20261007130100…:3-4 | `CREATE INDEX CONCURRENTLY` без пост-проверки | при сбое построения CONCURRENTLY остаётся INVALID-индекс, который «есть» в каталоге, но не используется; отдельного шага проверки в репозитории нет | добавить в прод-чеклист `SELECT indisvalid FROM pg_index` и `REINDEX INDEX CONCURRENTLY` при false |
| 18 | мелочь | prisma/migrations/20260913130000_user_tenant_fk_restrict/migration.sql:4-5 | `DROP`+`ADD` внешнего ключа `User_tenantId_fkey` | добавление FK валидирует всю таблицу `User` (небольшая, риск низкий) | при желании `NOT VALID` + `VALIDATE CONSTRAINT` |
| 19 | мелочь | коммит `6c402f88` | одним коммитом добавлены три несвязанные миграции (fk_restrict, align_names, drop_column) | это про трассируемость релиза, не про состав миграций; усложняет откат одной правки | отдельный коммит на логическое изменение |

## Не проверено

- **O4 / №5:** были ли `20260914100000` и `20260914110000` фактически применены на проде до `20260914090000` — доступа к `_prisma_migrations` на проде нет, БД не читалась. Вывод про «порядок меток» держится только на датах коммитов git.
- **№1, №3, №4, №18:** реальное время и наличие блокировок на проде не измерялись (нет доступа к БД и прода); оценка «блокирует» — по семантике операторов PostgreSQL, размеры таблиц на проде не подтверждены.
- **№7, №8:** утверждения комментариев «0 строк на проде» / «таблица пуста в каждом окружении» не воспроизводил.
- **№9:** не проверял, действительно ли `scripts/audit-fix-tenancy.sql` был прогнан на проде и какой именно набор таблиц остался с `NOT NULL` вне миграций; сверял только по тексту скрипта и `prisma/schema.prisma` (`SiteWeeklyTrend` — уже `String` без `?`, schema.prisma:2143).
- **№15:** поиск ссылок на старые имена ограничений/индексов не покрыл сгенерированный клиент `src/generated/**` (исключён из поиска по умолчанию) и содержимое `.env`/секретов (не читал по правилам AGENTS.md).
- **Внешние объекты:** `scripts/apply-postgres-hardening.ts:105-151` создаёт партиальные индексы (`idx_users_active_email` и др.), которых нет ни в одной миграции, — это отдельный источник расхождения схемы; в рамки «последних 25 миграций» не входит и детально не разбирался.
- **`prisma migrate diff`/`migrate status`** не запускал (требует БД; `prisma migrate dev/reset/push` запрещены AGENTS.md).
- **Строки** во всех `path:line` этого отчёта открыты через `read_file`; номера соответствуют прочитанному файлу.
