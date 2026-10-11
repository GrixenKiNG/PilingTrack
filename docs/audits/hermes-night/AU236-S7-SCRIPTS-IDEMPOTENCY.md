# AU236-S7-SCRIPTS-IDEMPOTENCY: Скрипты обслуживания: повторный запуск

Версия (git rev-parse HEAD): `f02683856001d6ef7039f3998c28431fab545455`
Ветка: `hermes/q4-0926`. Только чтение; файлы приложения не менялись.

## Итог

Просмотрено scripts/ (104 файла, включая `dev/`, `hooks/`, `lib/`). Оценивались
три свойства: повторный запуск (идемпотентность), наличие режима предпросмотра
(dry-run) и риск необратимой порчи данных/секретов.

- критично — 4: `scripts/reset-passwords.ts` (сброс паролей фиксированному
  списку БЕЗ защиты от боевой базы; пароли в открытом виде в коде),
  `scripts/apply-full-ddl.ts` (запускает `prisma db push --accept-data-loss`
  без подтверждения), `scripts/backup.sh` (успех `pg_dump` определяется по коду
  возврата `tee`, а не самого дампа).
- важно — 11: `scripts/restore.sh` (та же ошибка `$?` после конвейера),
  `scripts/refresh-prod-snapshot.sh` (зашиты IP/ключ/пользователь боевого
  сервера, DROP локальной базы, нет dry-run — два пункта),
  `scripts/fix-passwords.sql` (зашитые хеши известных паролей),
  `scripts/setup-partitioning.ts` (генерирует `DROP TABLE … CASCADE` без гейта),
  `scripts/staging-local.sh` (DROP … WITH FORCE без подтверждения),
  `scripts/redis-stress-test.js` (тест наполняет реальный Redis до 256 МБ),
  плюс три скрипта-наполнителя без dry-run: `seed-checklist-blocks.ts`,
  `backfill-tech-readiness.ts`, `backfill-projections.ts`.
- мелочь — 9 (см. таблицу): неатомарная запись метаданных бэкапа в Redis,
  фикстуры без гарантии уборки, правки `.env`/сгенерированного клиента,
  отправка реальных сообщений в Telegram и др.

Топ-5 по важности:

1. `scripts/reset-passwords.ts` — не защищён от боевой базы (в отличие от
   `reset-one-password.ts`), переводит перечисленные учётки на известные
   пароли и ставит `isActive=true`; сами пароли лежат в коде.
2. `scripts/apply-full-ddl.ts:51` — `npx prisma db push --accept-data-loss`:
   может удалить колонки/данные; ни предпросмотра, ни подтверждения.
3. `scripts/backup.sh:83` — `pg_dump … | tee file` и проверка `$?`: код
   возврата принадлежит `tee`, поэтому битый дамп рапортуется как успешный
   (ровно та ошибка, от которой предостерегает AGENTS §6).
4. `scripts/refresh-prod-snapshot.sh:11-13` — зашиты боевой IP, SSH-пользователь
   и путь к ключу; скрипт сам ходит на боевой сервер (AGENTS §1) и стирает
   локальную базу.
5. `scripts/setup-partitioning.ts:47-72` — генерируемый SQL делает `RENAME`,
   `INSERT … SELECT`, `DROP TABLE … CASCADE` по журнальным таблицам; в репозиторий
   пишется готовый к применению `scripts/partitioning.sql` без предпросмотра.

## Методика

Что и как искал (чтоб можно было повторить):

1. Полный перечень: `search_files target=files path=scripts` (104 файла),
   плюс `ls scripts`.
2. Маркеры «меняет данные»: `search_files content pattern='\.create\(|createMany|
   update|updateMany|upsert|delete|deleteMany'`; `grep` по `ON CONFLICT|INSERT
   INTO|UPDATE |DELETE FROM`; отдельный поиск деструктивных операций
   `migrate reset|migrate dev|db push|accept-data-loss|TRUNCATE|DROP TABLE|
   DROP DATABASE|pg_terminate|--clean`.
3. Маркеры dry-run: `grep -rniE "dry.?run|--dry|DRY_RUN|dryRun" scripts/` —
   совпадения только в `cleanup-report-analytics-orphans.cjs` и `restore.sh`;
   в остальных наполнителях роль предпросмотра играет флаг `--apply`, разобран
   вручную по каждому файлу.
4. Маркеры записи в ФС: `search_files pattern='writeFileSync|writeFile\(|
   unlinkSync|rmSync|copyFileSync|createWriteStream'`.
5. «Опасный конвейер»: разбор `backup_database()`, `backup_current_db()`,
   `restore_database()` в `scripts/backup.sh` и `scripts/restore.sh` на предмет
   проверки кода возврата (`$?`, `PIPESTATUS`).
6. Каждый вывод помечен статусом ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА. Числа —
   только из выполненных команд.

Итоговая классификация по каждому файлу — в таблице «Сводка по scripts/».

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `scripts/reset-passwords.ts:18-31` | Список из 12 учёток с ПАРОЛЯМИ В ОТКРЫТОМ ВИДЕ в коде (`admin123`, `dispatch123`, …) | Пароли в репозитории; любой, кто видит код, знает пароли после запуска | Убрать значения из кода (взять из env на один прогон) |
| 2 | критично | `scripts/reset-passwords.ts:36-43` | `updateMany` без проверки хоста/БД; ставит `isActive:true` | Запуск с боевым `DATABASE_URL_POSTGRES` переведёт `admin@piling.ru` на `admin123` и воскресит отключённые учётки. В соседнем `reset-one-password.ts:22-28` такая защита ЕСТЬ — здесь нет | Портировать предохранитель из `reset-one-password.ts`: только `localhost` + `pilingtrack_test` |
| 3 | критично | `scripts/apply-full-ddl.ts:51` | `execSync('npx prisma db push --schema prisma/schema.prisma --accept-data-loss')` | `db push` со сбросом «принять потерю данных» может молча удалить колонки/строки. Ни предпросмотра, ни подтверждения, ни проверки окружения | Заменить на `prisma migrate deploy`; либо требовать флаг `--yes` и печатать diff до применения |
| 4 | критично | `scripts/backup.sh:83-85` | `pg_dump … 2>&1 | tee "${BACKUP_FILE}.log"`, затем `if [ $? -eq 0 ]` | `$?` после конвейера — код возврата `tee` (почти всегда 0). Падение `pg_dump` рапортуется как «Backup completed successfully», пустой дамп уходит в S3 и в ротацию | Проверять `PIPESTATUS[0]` или писать дамп без `tee`, затем проверять размер (`-s`) |
| 5 | важно | `scripts/restore.sh:171-177` | `pg_dump … | tail -5`, затем `if [ $? -eq 0 ]` | Тот же дефект: код возврата `tail`. Функция «создан пред-бэкап» может отрапортовать успех при упавшем `pg_dump` | `PIPESTATUS[0]` либо убрать конвейер (образец — `restore.sh:205`) |
| 6 | важно | `scripts/refresh-prod-snapshot.sh:11-13` | Зашиты `SSH_HOST="87.242.102.125"`, `SSH_USER="user1"`, `SSH_KEY=~/.ssh/orionpiling`, `PROD_PATH=/opt/pilingtrack` | Утечка адреса и схемы доступа боевого сервера; скрипт сам ходит на боевой сервер и стирает локальную БД | Хост/ключ — в переменные окружения; не держать боевой IP в репозитории; добавить подтверждение |
| 7 | важно | `scripts/refresh-prod-snapshot.sh:30-31` | `DROP DATABASE IF EXISTS pilingtrack_prod_copy` + `CREATE DATABASE` без dry-run и подтверждения | Повторный запуск пересоздаёт локальную копию; при опечатке в имени базы данные копии теряются | Добавить `--dry-run`, `CONFIRM=1`; печатать, какую БД уничтожает |
| 8 | важно | `scripts/fix-passwords.sql:5-14` | Зашитые bcrypt-хеши для `admin/dispatch/operator` (комментарии прямо называют пароли) | Хеши известных паролей в репо = эквивалент хранения паролей. На чистой/сброшенной базе разом ставит три известных пароля | Удалить файл после применения либо заменить на сброс через `reset-one-password.ts` (локально) |
| 9 | важно | `scripts/setup-partitioning.ts:47-72,109` | Генерирует SQL: `RENAME TO _old` → `CREATE … PARTITION BY` → `INSERT … SELECT` → `DROP TABLE …_old CASCADE`; пишет его в `scripts/partitioning.sql` | SQL готов к применению руками; при неверном прогоне теряются журнальные записи (`AuditLog`, `TelemetryRecord`, `OutboxEvent`). Ни предпросмотра, ни проверки заполненности | Вывод в stdout, требовать `--write`, добавить проверку и явное «review this SQL» |
| 10 | важно | `scripts/staging-local.sh:121-130` | На `--refresh-db` (и при первом запуске) без подтверждения: `DROP DATABASE IF EXISTS pilingtrack WITH (FORCE)` | Сносит базу стенда форсом. Ограничено compose-проектом `pilingtrack-staging`, но флаг легко спутать, а FORCE рвёт соединения | Интерактивное подтверждение либо `--yes`; печатать имя проекта перед DROP |
| 11 | важно | `scripts/redis-stress-test.js:7-9,27` | Тест «Memory Pressure — fill to 256MB» работает по `REDIS_URL` (по умолчанию `redis://localhost:6379`) | Наполняет реальный Redis и провоцирует вытеснение ключей; при запуске не на dev-инстансе вытеснит рабочие ключи приложения | Разрешать только отдельный тестовый инстанс/префикс; проверять `REDIS_URL`, запрещать боевой |
| 12 | важно | `scripts/seed-checklist-blocks.ts:937-983` | Нет dry-run: `main()` сразу пишет в БД (`updateMany` ретайра + `create` на каждый блок) | Первый прогон наполняет справочник и выключает устаревшие блоки; откатить нечем, кроме ручной правки. Идемпотентен (skip по name) | Добавить `--apply` (как в `seed-user-document-types.ts`) и режим «показать, что будет создано/выключено» |
| 13 | важно | `scripts/backfill-tech-readiness.ts:5-15` | Нет dry-run и предпросмотра: `main()` сразу вызывает `backfillTenantReadiness` по всем тенантам | Пишет снимки готовности и текущие строки по всему парку. Идемпотентен (дедуп по `triggerId`), но «сколько строк изменится» заранее неизвестно | Добавить `--dry-run` (посчитать оборудование) и `--apply` |
| 14 | важно | `scripts/backfill-projections.ts:14-40` | Нет dry-run: сразу `rebuildAll()`/`rebuildX()` пишут проекции | Перезапись проекций (`operator-performance`, `site-daily` и др.). Повтор идемпотентен (пересчёт), но без предпросмотра | Добавить `--dry-run` |
| 15 | мелочь | `scripts/backup.sh:94-98` | Три ключа метаданных в Redis ставятся отдельными `redis-cli SET`, не атомарно | Потеря одного `SET` оставит свежий timestamp рядом со старым `s3_synced=true` — «успешный» бэкап без выгрузки. В `backup-postgres.sh:158-166` то же делается через `MULTI/EXEC` | Перейти на `MULTI/EXEC`, как в `backup-postgres.sh` |
| 16 | мелочь | `scripts/smoke-auth-access.js:78-187,314-331` | Фикстуры (3 юзера, объект, отчёт) создаются до теста, удаляются в `finally` | Обрыв процесса оставляет мусорные учётки `smoke-*@example.com` и объект; повторный прогон плодит новые | Помечать фикстуры префиксом и чистить их на старте (idempotent setup) |
| 17 | мелочь | `scripts/audit-fix-tenancy.sql:20-42` | `UPDATE … SET tenantId='orion'` и `ALTER TABLE … SET NOT NULL` в одном DO-блоке, без `BEGIN/COMMIT` | Изменение `NOT NULL` необратимо; при прерывании часть таблиц уже ужесточена. Идемпотентно при повторе, но не атомарно | Обернуть в транзакцию; вынести деструктивное `SET NOT NULL` в отдельный шаг |
| 18 | мелочь | `scripts/backfill-close-inspection-maintenance.sql:19-46` | Предпросмотр (`SELECT`) и `UPDATE` в одном файле с `BEGIN/COMMIT` | Нельзя выполнить «только показать» без правки файла — единого dry-run нет | Разделить: режим вывода и режим применения (через `\set`-флаг) |
| 19 | мелочь | `scripts/add-runtime.js:44-76` | Скрипт правит исходники `src/app/api/**/route.ts`, вставляя `export const runtime = 'nodejs'` | Идемпотентен (пропускает файлы с уже добавленной строкой), но массово редактирует рабочие исходники | Оставить как есть; зафиксировать, что это разовая правка |
| 20 | мелочь | `scripts/patch-postgres-client.js:20-57` | Регэксп-патч сгенерированного клиента после `db:generate` | Второй прогон безопасен (паттерны уже не совпадут), но патч хрупок: изменение генератора Prisma сломает регулярку без явной ошибки | Проверять, что патч применился (assert); печатать, что не найдено |
| 21 | мелочь | `scripts/switch-db.js:28-63` | Переписывает `.env`, подменяя имя БД во всех `DATABASE_URL*` | Мутация секретного файла; идемпотентен (если уже на целевой БД — no-op), но правка `.env` из скрипта — риск (AGENTS §1) | Не трогать `.env` автоматически; предложить строку для ручной вставки |
| 22 | мелочь | `scripts/tg-send.ts:9-12` (и `tg-test.ts`, `tg-test-report.ts`) | Каждый запуск отправляет РЕАЛЬНОЕ сообщение в Telegram | Побочный эффект во внешнюю систему; не идемпотентен по определению | Оставить только с явным флагом `--send`, по умолчанию — проверка соединения без отправки |
| 23 | мелочь | `scripts/load-test.js:25-26` | Зашит `TEST_PASSWORD='0000'`; нагрузочный сценарий включает write-операции (upsert отчёта) | Нагрузка пишет данные в целевую базу; пароль учётки в репо | Вынести пароль в env; запускать только против тестового стенда |
| 24 | мелочь | `scripts/generate-orion-equipment-pdfs.ts:34,200` | Пишет PDF и `manifest.json` в `public/orion/**` | Затрагивает замороженную зону ORION (AGENTS §1); перезапись ассетов без предпросмотра | Не запускать без задачи; проверять diff перед коммитом |

### Сводка по scripts/ (скрипт | файл:строка | идемпотентен | dry-run | риск)

Статус: ПРОЙДЕНО — свойство подтверждено чтением кода; ГИПОТЕЗА — вывод по
заголовку/поверхностному чтению, глубоко не проверялось.

| Скрипт | Файл:строка | Идемпотентен | Dry-run | Риск |
|---|---|---|---|---|
| reset-passwords.ts | `scripts/reset-passwords.ts:36` | да (updateMany по email) | нет | критично (нет защиты от боевой БД) |
| reset-one-password.ts | `scripts/reset-one-password.ts:22-28` | да | нет | низкий (заблокирован на localhost+test) |
| apply-full-ddl.ts | `scripts/apply-full-ddl.ts:51` | частично (DDL IF NOT EXISTS) | нет | критично (`db push --accept-data-loss`) |
| apply-postgres-hardening.ts | `scripts/apply-postgres-hardening.ts:53-57` | да (`duplicate_object`, `IF NOT EXISTS`) | нет | низкий (только при DATABASE_PROVIDER=postgres) |
| setup-partitioning.ts | `scripts/setup-partitioning.ts:47-72` | нет (RENAME…) | нет | высокий (генерит DROP … CASCADE) |
| rotate-encryption-key.ts | `scripts/rotate-encryption-key.ts:13-28` | да (пропуск уже на активной версии) | нет | низкий |
| republish-readiness-rules.ts | `scripts/republish-readiness-rules.ts:52-71` | да (changes===0 → выход) | да (`--apply`) | низкий |
| seed-maintenance-plans.ts | `scripts/seed-maintenance-plans.ts:59-63,96` | да (skip существующих) | да (`--apply`) | средний (пишет регламенты) |
| seed-user-document-types.ts | `scripts/seed-user-document-types.ts:109-131` | да (по normalizedName) | да (`--apply`) | низкий |
| seed-checklist-blocks.ts | `scripts/seed-checklist-blocks.ts:955-957` | да (skip по name) | нет | средний (сразу пишет, ретайрит блоки) |
| backfill-maintenance-regulation.ts | `scripts/backfill-maintenance-regulation.ts:69,131` | да (skip если уже учтено) | да (`--apply`) | средний |
| backfill-tech-readiness.ts | `scripts/backfill-tech-readiness.ts:5-15` | да (дедуп `triggerId`) | нет | средний (пишет по всему парку) |
| backfill-projections.ts | `scripts/backfill-projections.ts:14-40` | да (пересчёт проекций) | нет | средний |
| backfill-audit-feed-text.ts | `scripts/backfill-audit-feed-text.ts:47-70` | да (только `title==action`) | да (вывод SQL, не пишет) | низкий (в БД не ходит) |
| backfill-report-analytics.sql | `scripts/backfill-report-analytics.sql:42-66` | да (`ON CONFLICT DO NOTHING`) | да (счётные SELECT) | низкий |
| backfill-report-analytics.sh | `scripts/backfill-report-analytics.sh:20-71` | (обёртка) | `--help` | низкий (`ON_ERROR_STOP`) |
| backfill-close-inspection-maintenance.sql | `scripts/backfill-close-inspection-maintenance.sql:9-19` | да (только COMPLETED и не DONE) | частичный (SELECT в том же файле) | средний |
| audit-fix-tenancy.sql | `scripts/audit-fix-tenancy.sql:20-42` | да (после прогона NULL нет) | нет | средний (SET NOT NULL, без транзакции) |
| fix-passwords.sql | `scripts/fix-passwords.sql:5-14` | да (`NOT LIKE '$2b$%'`) | нет | высокий (хеши известных паролей в репо) |
| seed-sites.sql | `scripts/seed-sites.sql:2-46` | да (`ON CONFLICT DO NOTHING`) | нет | низкий (демо-данные) |
| identity-role-grants.sql | `scripts/identity-role-grants.sql:37-42` | да (IF NOT EXISTS / ALTER ROLE) | нет | средний (меняет права роли) |
| app-role-grants.sql | `scripts/app-role-grants.sql` | НЕ ПРОВЕРЕНО | — | security-critical (AGENTS §1) |
| app-role-verify.sql / app-role-smoke.ts | `scripts/app-role-smoke.ts:44-123` | проверки, запись в откатываемой транзакции | нет | низкий |
| rls-state.sql | `scripts/rls-state.sql` | НЕ ПРОВЕРЕНО | — | security-critical (AGENTS §1) |
| verify-tenant-dictionary-migration.ts | `scripts/verify-tenant-dictionary-migration.ts:20-63` | только SELECT | — | низкий (чтение) |
| verify-readiness.ts | `scripts/verify-readiness.ts:25,107-117` | только SELECT + откат транзакции | — | низкий |
| operator-v3-preflight.ts | `scripts/operator-v3-preflight.ts:137-146` | только чтение FS | — | низкий |
| validate-env.ts | `scripts/validate-env.ts:1-30` | только чтение env | — | низкий |
| check-migrations.js | `scripts/check-migrations.js:144-204` | только чтение миграций | — | низкий (защитный гейт) |
| check-postgres-rules.js | `scripts/check-postgres-rules.js:9-13` | чтение schema | — | низкий |
| check-text-integrity.js | `scripts/check-text-integrity.js:5-19` | чтение | — | низкий |
| check-layer-boundaries.ts | `scripts/check-layer-boundaries.ts:147` | чтение (+запись baseline по флагу) | — | низкий |
| explain-analyze.ts | `scripts/explain-analyze.ts:20-25` | `EXPLAIN ANALYZE` (чтение планов) | — | низкий |
| load-test.js (k6) | `scripts/load-test.js:25-26` | нет (write-сценарий) | нет | средний (пишет данные + пароль в коде) |
| stress-test-100.js | `scripts/stress-test-100.js:10-27` | только чтение API | нет | низкий (ГИПОТЕЗА) |
| quick-load-test.js | `scripts/quick-load-test.js` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| redis-stress-test.js | `scripts/redis-stress-test.js:7-9,27` | нет (наполняет Redis) | нет | высокий (вытеснение ключей) |
| test-redis-cache.js | `scripts/test-redis-cache.js:1-40` | падает на in-memory mock при отсутствии Redis | нет | низкий (ГИПОТЕЗА) |
| backup.sh | `scripts/backup.sh:83-98` | да, но success-check неверен; Redis-ключи неатомарны | `list/verify` (не dry-run) | критично (ложный успех бэкапа) |
| backup-postgres.sh | `scripts/backup-postgres.sh:47-57,158-166` | да (`-s` проверка, MULTI/EXEC) | нет | низкий (аккуратный прод-шаблон) |
| backup-local-db.ps1 | `scripts/backup-local-db.ps1` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| pitr-basebackup.sh | `scripts/pitr-basebackup.sh:64-104` | да (base + retention) | нет | средний (DDL-подобный retention) |
| restore.sh | `scripts/restore.sh:142-155,280-306` | да (создаёт отдельную БД, не трогает оригинал) | да (`--dry-run`) | важно (ложный успех пред-бэкапа, `$?` после конвейера) |
| restore-drill.sh | `scripts/restore-drill.sh:1-40` | да (новый одноразовый контейнер) | нет | низкий (изолирован) |
| restore-drill-verify.cjs | `scripts/restore-drill-verify.cjs` | сравнение дампа и копии | — | низкий |
| test-db-dump.cjs | `scripts/test-db-dump.cjs:20-29` | да (read-only snapshot) | — | низкий |
| db-drill-manifest.cjs | `scripts/db-drill-manifest.cjs:1-15` | только SELECT | — | низкий |
| test-db-up.sh / test-db-down.sh | `scripts/test-db-up.sh`, `scripts/test-db-down.sh` | одноразовые `codex-*` контейнеры | — | низкий (ГИПОТЕЗА) |
| test-m6-m8.sh | `scripts/test-m6-m8.sh:1-9` | одноразовая БД, ловушка на down | — | низкий |
| test-worker-generation.sh | `scripts/test-worker-generation.sh:1-13` | только `codex-*` ресурсы | — | низкий |
| test-deploy-workflow.cjs | `scripts/test-deploy-workflow.cjs:21` | пишет временный ssh-шим | — | низкий (ГИПОТЕЗА) |
| test-day-stand.cjs / .sh | `scripts/test-day-stand.cjs:15-45` | одноразовые `codex-*` контейнеры, ловушка cleanup | — | средний (спавнит процессы/контейнеры) |
| test-pilingtrack.sh | `scripts/test-pilingtrack.sh:1-30` | проверки HTTP (чтение) | нет | низкий (ГИПОТЕЗА) |
| test-ingress.bat | `scripts/test-ingress.bat` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| smoke-workers-image.sh | `scripts/smoke-workers-image.sh:1-25` | одноразовый контейнер `--rm`, ловушка | — | низкий |
| smoke-auth-access.js | `scripts/smoke-auth-access.js:78-187` | почти (фикстуры + cleanup) | нет | средний (мусор при обрыве) |
| prod-audit-readonly.sh | `scripts/prod-audit-readonly.sh:1-14` | только чтение (ps/df/ss/логи/SELECT) | — | низкий |
| audit-remote.sh | `scripts/audit-remote.sh:7-23` | только SELECT | — | низкий |
| cleanup-report-analytics-orphans.cjs | `scripts/cleanup-report-analytics-orphans.cjs:107-112` | да (гейты, бэкап, `codex-pg-*`) | да (`DRY-RUN`) | низкий (сильно ограничен) |
| refresh-prod-snapshot.sh | `scripts/refresh-prod-snapshot.sh:11-31` | нет по сути (DROP+CREATE) | нет | важно (боевой IP в коде, DROP без подтверждения) |
| staging-local.sh | `scripts/staging-local.sh:44-56,123-125` | частично (образы кэширует, БД пересоздаёт) | `--down/--destroy` (не dry-run) | важно (DROP … WITH (FORCE)) |
| switch-db.js | `scripts/switch-db.js:28-63` | да (already on target → no-op) | `status` | средний (правит .env) |
| free-dev-lock.js | `scripts/free-dev-lock.js:71-121` | да (нет замка → выход 0) | — | низкий |
| kill-port.js | `scripts/kill-port.js:12-18` | да | — | низкий |
| stop-piling.ps1 | `scripts/stop-piling.ps1:5-20` | да (нет процесса → «nothing listening») | — | низкий |
| cleanup-local-artifacts.ps1 | `scripts/cleanup-local-artifacts.ps1:1-49` | да (удаляет артефакты, если есть) | — | низкий (только build-артефакты и tmp-*) |
| add-runtime.js | `scripts/add-runtime.js:44-76` | да (skip если `export const runtime`) | — | средний (правит исходники) |
| patch-postgres-client.js | `scripts/patch-postgres-client.js:20-57` | да по факту (паттерны не совпадут) | — | мелочь (хрупко) |
| copy-standalone-assets.js | `scripts/copy-standalone-assets.js:31-53` | да (копирование поверх) | — | низкий |
| trace-runtime-deps.cjs | `scripts/trace-runtime-deps.cjs:19-25` | да (копирует в outDir) | — | низкий |
| generate-icons.mjs / crop-approved-icons.cjs | `scripts/generate-icons.mjs`, `scripts/crop-approved-icons.cjs` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| generate-orion-equipment-pdfs.ts | `scripts/generate-orion-equipment-pdfs.ts:34,200` | да (перезапись) | нет | средний (замороженная зона ORION) |
| verify-orion-equipment-pdfs.py | `scripts/verify-orion-equipment-pdfs.py` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО (Python) |
| pdf-storage-inventory.cjs | `scripts/pdf-storage-inventory.cjs:1-30` | только чтение метаданных | — | низкий |
| tg-send.ts / tg-test.ts / tg-test-report.ts / tg-debug.ts | `scripts/tg-send.ts:9-12` | нет (реальная отправка) | нет | средний (внешний эффект) |
| generate-env-docker.ps1 | `scripts/generate-env-docker.ps1:1-25` | нет (генерит .env) | — | средний (создаёт секреты; перезапись не проверена) |
| release-start.bat / port-forward*.bat | `scripts/release-start.bat`, `scripts/port-forward-*.bat` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| dev/smoke-fleet-monitoring.ts | `scripts/dev/smoke-fleet-monitoring.ts:31-48` | только чтение сервиса | — | низкий |
| dev/smoke-equipment-details.ts | `scripts/dev/smoke-equipment-details.ts` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| hooks/protect-sensitive-files.js, hooks/eslint-on-edit.js | `scripts/hooks/*` | НЕ ПРОВЕРЕНО | — | НЕ ПРОВЕРЕНО |
| lib/module-boundaries.ts | `scripts/lib/module-boundaries.ts` | библиотека (не запускается) | — | низкий |
| deploy-prod.sh | `scripts/deploy-prod.sh` | не анализировался (security-critical, AGENTS §1) | — | НЕ ПРОВЕРЕНО (вне области) |
| replace-worker-generation.sh | `scripts/replace-worker-generation.sh:1-130` | да (барьер STOP/START с автоматическим ROLLBACK) | нет | средний (останавливает/поднимает прод-контейнеры; гейты и проверки есть) |

### Отдельно: конвейеры, скрывающие код возврата (находки №4, №5)

AGENTS §6 прямо предупреждает: «не прогоняй проверку через `| tail`/`| head` —
это скрывает код возврата». Тот же дефект встречается В САМИХ скриптах:

- `scripts/backup.sh:83-85` — `pg_dump … | tee file`; `if [ $? -eq 0 ]` видит статус `tee`.
- `scripts/restore.sh:171-177` — `pg_dump … | tail -5`; `if [ $? -eq 0 ]` видит статус `tail`.
- `scripts/restore.sh:205` — `pg_restore … | tail -20`, но используется
  `${PIPESTATUS[0]}` — сделано ПРАВИЛЬНО (образец для исправления).

Вывод: дефект точечный (два места), а не системный.

## Не проверено

- `scripts/deploy-prod.sh` — не открывался: AGENTS §1 относит `scripts/deploy-*`
  к security-critical; в область этой задачи не входит.
- `scripts/app-role-grants.sql`, `scripts/rls-state.sql` — не открывались
  (гранты/RLS — security-critical, AGENTS §1). Идемпотентность не подтверждена.
- `scripts/quick-load-test.js`, `scripts/backup-local-db.ps1`,
  `scripts/generate-icons.mjs`, `scripts/crop-approved-icons.cjs`,
  `scripts/verify-orion-equipment-pdfs.py`, `scripts/test-ingress.bat`,
  `scripts/release-start.bat`, `scripts/port-forward-*.bat`,
  `scripts/dev/smoke-equipment-details.ts`, `scripts/hooks/*`,
  `scripts/test-db-up.sh`, `scripts/test-db-down.sh`,
  `scripts/test-deploy-workflow.cjs`, `scripts/check-integration-results.cjs` —
  читались только по имени/заголовку либо не открывались; строка таблицы
  помечена «НЕ ПРОВЕРЕНО».
- `scripts/generate-env-docker.ps1` — не проверено, перезаписывает ли файл при
  повторном запуске (логика создания .env разобрана лишь частично).
- Сценарий «фактический повторный запуск на боевой базе» не воспроизводился:
  правила задачи — только чтение, к запуску скриптов доступа нет.
- Не проверялось, включены ли отдельные скрипты в `package.json`/cron/CI и как
  часто вызываются на практике (анализировался только код scripts/).
- Полные тексты `scripts/load-test.js`, `scripts/stress-test-100.js`,
  `scripts/redis-stress-test.js` (кроме заголовков) — оценка по заголовку,
  строка статуса помечена ГИПОТЕЗА.
- `scripts/replace-worker-generation.sh` разобран по коду; вживую (STOP/START
  контейнеров на проде) не проверялся.
