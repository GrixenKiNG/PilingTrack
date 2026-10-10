# AU11-S6-MIGRATION-ROLLBACK: совместимость отката приложения с последними миграциями

Версия (HEAD рабочей папки): `f4c60b8771972e5bb1f6ac01fd2203f72fd8f2de`
(ветка `hermes/q4-0926`). Все 12 последних миграций уже влиты в `origin/main`
(`git merge-base --is-ancestor 1ac24e79 origin/main` → yes).

Источник правды — SQL миграций и код. Отчёты в `docs/audits/`, `CODEX-REPORT*`,
`docs/strategy` не читались (независимый первый проход).

## Итог

Проверено 12 последних миграций (плюс соседняя `20260913140100_briefing_record`
как контекст: без неё не читается `20260913150000`).

- Откат образа приложения (старый образ + новая схема) ломает **1 миграция**:
  `20260924120000_drop_refresh_token` (важно). Ещё **1 миграция** опасна только
  при откате к образу старше 03.07.2026: `20260924120100_site_weekly_trend_tenant_not_null`.
- Остальные 10 — строго аддитивные (новая таблица / новая nullable-колонка /
  `ADD COLUMN ... NOT NULL DEFAULT ''` / новый индекс) → старый образ на новой
  схеме работает.
- Опасение «Prisma заворачивает миграции в транзакцию, значит два
  `CREATE INDEX CONCURRENTLY` не накатятся» — **не подтвердилось**: на одноразовой
  PostgreSQL `prisma migrate deploy` (Prisma 7.8) прошёл `exit 0`, оба индекса
  созданы и `indisvalid = true` (см. Методику).
- Ручных DB-шагов при откате образа не требуется ни для одной миграции, кроме
  `drop_refresh_token` (если какой-то клиент ещё зовёт `/api/auth/refresh`).
  Prisma не хранит down-миграций: возврат самой схемы — только ручной SQL.
- Сквозной риск, не ломающий запуск: данные, записанные новой версией
  (залоги, допуски, СИЗ, подписи инструктажей, `archivedAt`, идентичность DLQ),
  после отката образа становятся невидимыми в интерфейсе (тихая «потеря» для
  пользователя, физически данные целы).

## Методика

- Версия: `git rev-parse HEAD` → `f4c60b87…`; последние 12 каталогов миграций —
  `ls prisma/migrations | tail -12`.
- Все `migration.sql` последних 12 (+1) миграций прочитаны целиком
  (`read_file`), построчно классифицированы: ADD/создать (аддитивно),
  DROP/переименовать/NOT NULL без default (ломает откат).
- Ссылки старого кода искал по git-ревизии: `git grep -n "refreshToken\|RefreshToken" a92cc8ab^ -- src`.
- Текущий код: `search_files` по `RefreshToken` в `src/` → 0 совпадений.
- Эмпирическая проверка наката на одноразовой БД (своя, не прод):
  `docker run -d --name hermes-migtest-… postgres:16`;
  `INTEGRATION_DATABASE_URL_OWNER=… npx --no-install prisma migrate deploy --config prisma.integration.config.ts` → `exit 0`
  (`All migrations have been successfully applied`); в `_prisma_migrations` 109
  строк (109 = число каталогов миграций, `migration_lock.toml` не миграция).
- Проверка схемы в этой же БД: `select ... from pg_index where ...` (индексы
  `PileWork_tenantId_occurredAt_idx`, `PileWork_tenantId_receivedAt_null_occurredAt_idx`
  присутствуют, `indisvalid = t`); `to_regclass('"RefreshToken"') is null` → `t`;
  `attnotnull` для `SiteWeeklyTrend.tenantId` → `t`.
- Проверка «старая вставка на новой схеме»: вставка в `BriefingRecord` без новых
  колонок → успешна, `instructorName=''`, `reason=''`, `type = NULL`
  (`SET session_replication_role=replica` — только чтобы обойти не относящийся к
  делу FK на `User`); вставка в `SiteWeeklyTrend` без `tenantId` → ошибка
  `violates not-null constraint`. Контейнер удалён после проверки.
- Опасные операции по 12 файлам искал сплошным чтением каждого файла (в них нет
  ни `DELETE`, ни `TRUNCATE`, ни `SET DATA TYPE`; единственные неаддитивные —
  `DROP TABLE`, `SET NOT NULL`, `ALTER INDEX … RENAME`).

## Находки

### A. Матрица по каждой из 12 последних миграций

| # | Миграция | Что меняет | Старый образ на новой схеме | Ручные шаги отката |
|---|----------|-----------|------------------------------|--------------------|
| 1 | `20260913150000_briefing_type_instructor_signatures` (`migration.sql:12-18`) | `ALTER TABLE BriefingRecord ADD COLUMN` ×6: `type` (nullable), `instructorId` (nullable), `instructorName NOT NULL DEFAULT ''`, `reason NOT NULL DEFAULT ''`, `employeeSignedAt`, `instructorSignedAt` (nullable) + индекс | Да — все колонки nullable или с default; старые вставки без них работают (проверено) | Нет |
| 2 | `20260914090000_pile_driving_set` (`migration.sql:11-32`) | Новая таблица `PileDrivingSet` + unique + FK (Cascade) + RLS (FORCE) | Да — старая версия таблицу не знает и не пишет | Нет |
| 3 | `20260914100000_user_equipment_permit` (`migration.sql:13-46`) | Новая таблица `UserEquipmentPermit` + 2 enum + 3 индекса + FK (Restrict) + RLS | Да | Нет |
| 4 | `20260914110000_ppe_check` (`migration.sql:7-29`) | Новая таблица `PpeCheck` + unique + FK (Restrict) + RLS | Да | Нет |
| 5 | `20260924120000_drop_refresh_token` (`migration.sql:6`) | `DROP TABLE IF EXISTS "RefreshToken"` | **Нет** — образ до `a92cc8ab` ещё обращается к таблице | Возможен (см. B-1) |
| 6 | `20260924120100_site_weekly_trend_tenant_not_null` (`migration.sql:7`) | `ALTER COLUMN "tenantId" SET NOT NULL` | Да для свежих образов; **нет** для образа старше `a8b1aa4` (03.07.2026) | Возможен (см. B-2) |
| 7 | `20260924120200_rename_user_equipment_permit_unique` (`migration.sql:5`) | `ALTER INDEX … RENAME TO …equipment_key` (только каталог) | Да — рантайм не зависит от имён индексов | Нет |
| 8 | `20260925120000_report_feedback_period_indexes` (`migration.sql:5-6`) | 2 × `CREATE INDEX` (без CONCURRENTLY) | Да | Нет |
| 9 | `20260925180000_dlq_replay_identity` (`migration.sql:4-6`) | `ADD COLUMN` ×3 в `DeadLetterQueue` (`tenantId`, `aggregateType`, `consumer`), все nullable | Да | Нет |
| 10 | `20260926213000_pile_grade_archived_at` (`migration.sql:4`) | `ADD COLUMN "archivedAt" TIMESTAMPTZ(3)` (nullable) в `PileGrade` | Да | Нет |
| 11 | `20261007130000_pile_work_tenant_occurred_at_index` (`migration.sql:3-4`) | `CREATE INDEX CONCURRENTLY "PileWork_tenantId_occurredAt_idx"` | Да | Нет |
| 12 | `20261007130100_pile_work_received_at_fallback_index` (`migration.sql:3-4`) | `CREATE INDEX CONCURRENTLY` частичный `(tenantId, receivedAt) WHERE occurredAt IS NULL` | Да | Нет |

Соседняя (13-я, вне «последних 12», приведена как контекст):
`20260913140100_briefing_record/migration.sql:5-22` создаёт таблицу `BriefingRecord`
(и enum `BriefingRecordKind`). Для старого образа тоже аддитивна.

Итог таблицы: **опасен откат образа только к коммиту до `a92cc8ab`** (24.09.2026)
из-за №5; **условно опасен** откат к коммиту до `a8b1aa4` (03.07.2026) из-за №6.

### B. Находки по важности

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое решение |
|---|----------|-----------|----------|-------------------------|----------------------|
| 1 | важно | `prisma/migrations/20260924120000_drop_refresh_token/migration.sql:6` | Таблица `RefreshToken` удалена, а образ приложения, собранный до `a92cc8ab` (24.09.2026 09:09), к ней обращается: `a92cc8ab^:src/core/security/refresh-tokens.ts:126` (`db.refreshToken.findUnique`) и `a92cc8ab^:src/app/api/auth/refresh/route.ts:42` (`rotateRefreshToken`) | Откат образа на релиз до 24.09.2026: любой `POST/DELETE /api/auth/refresh` падает с «relation "RefreshToken" does not exist» (500). Обычный вход не рушится — `createRefreshToken` нигде не вызывался, таблица была пуста (проверено: 0 совпадений `RefreshToken` в текущем `src/`, файла `src/core/security/refresh-tokens.ts` нет) | Перед откатом к образу < 24.09.2026 не пользоваться `/api/auth/refresh`; при необходимости вручную пересоздать `RefreshToken` (структура — `prisma/migrations/20260419190903_init/migration.sql:632`) |
| 2 | важно | `prisma/migrations/20260924120100_site_weekly_trend_tenant_not_null/migration.sql:7` | `SiteWeeklyTrend.tenantId` закреплён `NOT NULL`; откат образа к версии без заполнения `tenantId` | Откат к образу старше `a8b1aa4` (03.07.2026): ночная перестройка `SiteWeeklyTrend` сначала чистит таблицу (`rebuild.ts:165`), затем пишет строки; без `tenantId` вставка падает (проверено на одноразовой PG: `violates not-null constraint`), таблица остаётся пустой. Для свежих образов безопасно — `rebuild.ts:153` подставляет `tenantId` всегда, а на проде ограничение уже стояло вручную (`migration.sql:1-6`) | Не откатывать ниже `a8b1aa4`; либо вручную `ALTER TABLE "SiteWeeklyTrend" ALTER COLUMN "tenantId" DROP NOT NULL` |
| 3 | мелочь | `prisma/migrations/20260913150000_briefing_type_instructor_signatures/migration.sql:15-16` | Две новые колонки `NOT NULL DEFAULT ''` | Формально «NOT NULL» настораживает, но default есть → старые вставки проходят (проверено: вставка без этих колонок успешна, значения `''`) | Действий не требуется |
| 4 | мелочь | `prisma/migrations/20260914090000_pile_driving_set/migration.sql:11`, `20260914100000_user_equipment_permit/migration.sql:13`, `20260914110000_ppe_check/migration.sql:7` | Три новые таблицы | Запуску старого образа не мешают, но данные, записанные новой версией (залоги, матрица допусков, проверки СИЗ), после отката образа в интерфейсе не видны — для пользователя это выглядит как пропажа | При откате предупредить, что данные новых разделов временно не отображаются; физически их не удалять |
| 5 | мелочь | `prisma/migrations/20260926213000_pile_grade_archived_at/migration.sql:4`, `20260925180000_dlq_replay_identity/migration.sql:4-6` | Новые nullable-колонки (`PileGrade.archivedAt`, поля идентичности DLQ) | Тот же эффект невидимости после отката: правило «принимать сваи по архивной марке» и различение потребителя при повторе DLQ перестанут действовать, данные останутся | То же |
| 6 | инфо (ПРОЙДЕНО) | `prisma/migrations/20261007130000_pile_work_tenant_occurred_at_index/migration.sql:3-4`, `prisma/migrations/20261007130100_pile_work_received_at_fallback_index/migration.sql:3-4` | `CREATE INDEX CONCURRENTLY` в теле миграции Prisma | Было опасение, что Prisma накатывает миграции в транзакции и CONCURRENTLY не выполнится. Проверено эмпирически: `migrate deploy` (Prisma 7.8) → `exit 0`, оба индекса созданы и `indisvalid = true`. На откат образа не влияет | Действий не требуется |
| 7 | мелочь | `prisma/migrations/20260925120000_report_feedback_period_indexes/migration.sql:5-6` | Два `CREATE INDEX` без `CONCURRENTLY` (в т.ч. по `Report`) | Берут `SHARE`-блокировку на время построения (запись в таблицу кратко блокируется). Обоснование в файле: «база ~130 МБ». На откат образа не влияет; риск только на этапе наката | На копии боевой базы замерить время; при росте таблиц выносить отдельным шагом |
| 8 | мелочь | `prisma/migrations/20260924120200_rename_user_equipment_permit_unique/migration.sql:5` | Переименование индекса | Рантайму имя индекса не нужно → откат образа безопасен. Нюанс: `schema.prisma` старого образа ждёт прежнее имя, поэтому `prisma migrate diff/status` старой версии покажет drift (только инструментальное неудобство, не запуск) | Учесть, что команда `prisma migrate` при откате потребует `--config`; на рантайм не влияет |
| 9 | мелочь (инфо) | `prisma/migrations/*/migration.sql` (весь набор) | У Prisma нет down-миграций | Откат образа БД не трогает; но возврат **схемы** назад возможен только ручным SQL (drop таблиц/колонок, пересоздание `RefreshToken`), причём `RefreshToken` уже удалена вместе с данными | Держать ручные «обратные» SQL для необратимых шагов (`DROP TABLE`, `SET NOT NULL`) рядом с репетицией отката |

## Не проверено

- Поведение на **проде**: доступа к боевой БД нет (правила задачи), факт наката
  этих 12 миграций на прод не проверен. Эмпирика — на одноразовой **PostgreSQL 16**
  (пустая база); прод по `docker-compose.yml:345` — `postgres:18-alpine`
  (`image: postgres:18-alpine`), поведение `migrate deploy` там не воспроизводил.
- Какой именно коммит будет целью отката (предыдущий релиз) — не определён:
  релизные документы по условию не читались; вывод «образ старше `a92cc8ab`/`a8b1aa4`»
  построен на датах коммитов из git, а не на дате выкладки.
- Есть ли внешние/старые клиенты, реально дергающие `POST /api/auth/refresh`
  (мобильное приложение, закешированный фронт) — не проверено; поэтому вред от
  находки B-1 оценён как «важно», а не «критично».
- Объём данных, который «станет невидимым» после отката (пп. B-4, B-5), оценён
  только качественно: боевых выгрузок нет, числа по строкам не считал.
- Влияние на другие ветки/окружения (кроме `hermes/q4-0926` и `origin/main`)
  не проверял.
