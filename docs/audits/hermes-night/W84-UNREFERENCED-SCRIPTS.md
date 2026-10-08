# W84 — Скрипты в `scripts/`, на которые ничто не ссылается

## Итог

- Всего проверено файлов в `scripts/` (включая подпапки `dev/`, `hooks/`, `lib/` и два baseline-файла): **103**.
- Найдено **17 находок**: **критично — 0**, **важно — 4**, **мелочь — 13**.
- Полностью осиротевших скриптов (ни одной ссылки во всём отслеживаемом дереве, кроме самого файла): **16**.
- Отдельно: **21** файл имеет ссылки **только в документации** (руководства, ADR, планы, `.claude/skills/`, прошлые отчёты аудита) — из кода, CI, `package.json`, Docker/compose они не запускаются. Это второй по важности слой кандидатов.
- Отдельная находка вне списка скриптов: `package.json:21` (`postgres:setup`) указывает на **несуществующий** файл `scripts/setup-postgres.js`.
- Топ-5 по значимости: `scripts/fix-passwords.sql` (хэши паролей известных учёток, никем не вызывается с первого коммита), `scripts/republish-readiness-rules.ts` (переиздание набора правил готовности — без ручного запуска политика кода не применяется), `scripts/verify-readiness.ts`, `scripts/reset-one-password.ts` (административный сброс пароля), `package.json:21` (битая команда `npm run postgres:setup`).
- Ничего не удалялось и не менялось. Единственный созданный файл — этот отчёт.

## Методика

Воспроизводится так (git-grep по отслеживаемому дереву — untracked/node_modules/.next не учитываются):

1. Полный список: `git ls-files scripts/` → 103 файла.
2. Для каждого имени ищем литеральные вхождения **по всему репозиторию** двумя запросами — по полному имени файла и по «стему» без расширения (второй нужен, чтобы поймать бесрасширенные импорты TS, например `from './lib/module-boundaries'`):
   - `git grep -lF -- "<имя>"` и `git grep -lF -- "<стем>"`
   - из результата исключается сам файл.
3. Последний меняющий коммит: `git log -1 --format='%h %ad %s' --date=short -- <путь>`.
4. Классификация ссылок: «операционная» (запуск/импорт) — `package.json`, `.github/`, `docker-compose*`, `Dockerfile*`, `deploy/`, другие файлы `scripts/`, `src/`, `tests/`, `e2e/`, `prisma/`, `*.bat/sh` в корне, `.dockerignore`, `.claude/settings.json`; «документарная» — `docs/**`, `*.md`, `.claude/skills/**`.

Оговорки методики (учтены в результатах):
- Поиск по стему даёт ложные срабатывания на общих словах (`Dockerfile.backup` → стем `Dockerfile`); такие случаи проверены вручную по полному имени.
- `git grep` видит только отслеживаемые файлы. Ссылки из untracked-файлов не учитывались (влияние оцениваю как нулевое, отдельно не проверено).

## Находки

### Основная таблица — полностью осиротевшие (0 ссылок, кроме себя)

| # | severity | path:line | Проблема | Сценарий / чем грозит | Предлагаемое исправление |
|---|----------|-----------|----------|----------------------|--------------------------|
| 1 | важно | `scripts/fix-passwords.sql:4` | SQL-скрипт с bcrypt-хэшами «известных» паролей для сид-учёток (`admin@piling.ru` и др.); с первого коммита `c62bae87` (2026-04-12) не вызывается ниоткуда | Осиротевший артефакт с учётными данными в открытом виде: кто найдёт — сможет зайти под сид-учётками, если сиды живы. Плюс неясно, применялся ли он вообще (схема/список юзеров с тех пор менялись) | Решить: либо подтвердить, что не нужен, и удалить (вместе с упоминанием), либо перенести в документированный процедурный шаг. Не трогать без подтверждения владельца, что учёток из файла нет в базе |
| 2 | важно | `scripts/republish-readiness-rules.ts:1` | Переиздание опубликованного набора правил готовности из умолчаний кода. Ни одной ссылки — ни в `package.json`, ни в ранбуках как команда | Расчёт готовности читает **опубликованный** набор из БД: правка `DEFAULT_READINESS_RULES` в коде сама по себе на контуре ничего не меняет. Если этот шаг держится только на памяти, политика кода и поведение модуля расходятся | Добавить npm-команду и строку в ранбук модуля готовности |
| 3 | важно | `scripts/verify-readiness.ts:1` | Проверка модуля техготовности на **реальных** данных (в отличие от юнит-тестов на выдуманных фактах). Ссылок нет | Единственный инструмент «модуль считает то, что заложено, на нашей технике?» осиротел — при следующей правке правил некому быстро проверить результат на данных | Добавить в `package.json` (например `readiness:verify`) и упомянуть в ранбуке/ADR модуля |
| 4 | важно | `scripts/reset-one-password.ts:1` | Разовый сброс пароля одному пользователю на локальной базе (в пару к `reset-passwords.ts`, который есть в `package.json` косвенно — `scripts/reset-passwords.ts` тоже имеет лишь 1 ссылку в доке). Ссылок нет | Административная операция без точки входа: в следующий раз её либо не найдут, либо восстановят заново — риск ошибки при переписывании паролей всему списку | Задокументировать как процедуру (внутренний admin-ранбук) либо пометить как разовый и удалить |
| 5 | мелочь | `scripts/audit-remote.sh:1` | Скрипт удалённого read-only аудита прод-VM; 0 ссылок | Мёртвый ops-инструмент (перекликается с `prod-audit-readonly.sh`, который хотя бы упомянут в доке) | Удалить или сослаться из ранбука аудита |
| 6 | мелочь | `scripts/crop-approved-icons.cjs:1` | Разовая нарезка листа утверждённых иконок в отдельные PNG (sharp); 0 ссылок | Одноразовый инструмент генерации ассетов; исходый «лист» уже, вероятно, не хранится | Удалить или перенести в заметку о генерации иконок |
| 7 | мелочь | `scripts/generate-icons.mjs:1` | Разовая генерация иконок из `public/icon-512.png` (sharp); 0 ссылок | То же — одноразовая генерация ассетов | Удалить или связать с процессом сборки ассетов |
| 8 | мелочь | `scripts/docker-daemon.json:1` | Сниппет конфигурации демона Docker (log-driver, userland-proxy); 0 ссылок, ни к чему не подключён | Настройка, которую применяют вручную; непонятно, применена ли на сервере | Перенести в `docs/` как инструкцию или удалить |
| 9 | мелочь | `scripts/dev/smoke-equipment-details.ts:1` | Dev-smoke `getEquipmentDetails` (`npx tsx ...`); 0 ссылок, включая `scripts/dev/` целиком | Одноразовая ручная проверка; `scripts/dev/` как каталог никем не запускается пачкой | Удалить или превратить в npm-команду `dev:smoke:*` |
| 10 | мелочь | `scripts/dev/smoke-fleet-monitoring.ts:1` | Dev-smoke `getFleetSnapshot()`; 0 ссылок | То же | То же |
| 11 | мелочь | `scripts/seed-maintenance-plans.ts:1` | Заведение регламентов ТО по моточасам на весь парк; 0 ссылок (на него самого ссылался только `backfill-maintenance-regulation.ts`, который тоже имеют 1 ссылку в доке) | Одноразовое наполнение `MaintenancePlan`; на боевом, возможно, уже применено вручную | Задокументировать как одноразовый шаг либо удалить |
| 12 | мелочь | `scripts/seed-sites.sql:1` | `INSERT` объектов строительства (`Site`); 0 ссылок, с первого коммита | Демо-сид с выдуманными объектами («ЖК Центральный»); на боевом не нужен | Удалить (не путать с `prisma/seed.ts`) |
| 13 | мелочь | `scripts/seed-user-document-types.ts:1` | Наполнение справочника видов документов работника по спецификации модуля «Оператор»; 0 ссылок | Наполнение справочника, от которого зависит механизм допуска (`evaluateOperatorClearance`) | Задокументировать порядок наполнения или завести в сид |
| 14 | мелочь | `scripts/tg-send.ts:1` | Ручной тест Telegram-нотификатора; 0 ссылок | Разовый dev-тест уведомлений | Удалить или объединить с `tg-test.ts` |
| 15 | мелочь | `scripts/tg-test.ts:1` | Ручной тест `telegramNotifier.testConnection()`; 0 ссылок | То же | То же |
| 16 | мелочь | `scripts/tg-test-report.ts:6` | Ручная генерация PDF одного отчёта с **зашитым UUID** отчёта (`755f2ca2-...`); 0 ссылок | Захардкоженный id конкретного отчёта — явно одноразовая отладка | Удалить |
| 17 | мелочь | `package.json:21` | Команда `postgres:setup` = `node scripts/setup-postgres.js`, **файла `scripts/setup-postgres.js` в репозитории нет** | `npm run postgres:setup` гарантированно падает; вводит в заблуждение при развёртывании | Удалить битую команду либо восстановить/переименовать файл (уточнить у владельца, какой скрипт имелся в виду — возможно, `apply-postgres-hardening.ts`) |

### Приложение A — ссылки только в документации (из кода/CI/Docker не запускаются)

«Ссылок» здесь = вхождения в `docs/**`, `*.md`, `.claude/skills/**`. Операционных (запуск/импорт) — 0. Это не «мёртвые» в строгом смысле (на них указывает проза), но точки запуска в коде нет.

| # | severity | файл | всего ссылок (из них операц.) | последний коммит |
|---|----------|------|-------------------------------|------------------|
| A1 | мелочь | `scripts/app-role-smoke.ts` | 3 (0) | `2bef97b4` 2026-09-12 test(ci): интеграционные и контрактные проверки идут в конвейере |
| A2 | мелочь | `scripts/backfill-tech-readiness.ts` | 2 (0) | `b205abe6` 2026-08-08 feat(readiness): чтение парка, история, экспорт и журнал аудита |
| A3 | мелочь | `scripts/backfill-close-inspection-maintenance.sql` | 1 (0) | `76e308cf` 2026-08-10 feat(readiness,roles): оператор ведёт осмотр, администратор проводит смену один |
| A4 | мелочь | `scripts/backup-local-db.ps1` | 2 (0) | `a6b254fd` 2026-05-27 chore(scripts): add local dev DB backup script |
| A5 | мелочь | `scripts/Dockerfile.backup` | 2 (0) | `c62bae87` 2026-04-12 Initial commit: PilingTrack project with audit fixes |
| A6 | мелочь | `scripts/generate-orion-equipment-pdfs.ts` | 1 (0) | `62b8cfd9` 2026-07-15 fix(orion): bind equipment profiles to exact sources |
| A7 | мелочь | `scripts/port-forward-all.bat` | 1 (0) | `c62bae87` 2026-04-12 Initial commit |
| A8 | мелочь | `scripts/port-forward-api.bat` | 1 (0) | `c62bae87` 2026-04-12 Initial commit |
| A9 | мелочь | `scripts/prod-audit-readonly.sh` | 3 (0) | `e57a4add` 2026-06-20 chore(tooling): read-only prod audit script + obsidian vault config |
| A10 | мелочь | `scripts/rls-state.sql` | 4 (0) | `7f23b28a` 2026-08-19 feat(security): RLS на трёх последних таблицах с организацией |
| A11 | мелочь | `scripts/rotate-encryption-key.ts` | 2 (0) | `4b5f6dce` 2026-04-30 feat(security): versioned encryption keys + rotation pipeline (H-2) |
| A12 | мелочь | `scripts/run-day-check.cjs` | 1 (0) | `788f30eb` 2026-10-03 (CODEX-E2) Проверить чужие ID двумя ролями на настоящем стенде |
| A13 | мелочь | `scripts/seed-checklist-blocks.ts` | 2 (0) | `e6f15749` 2026-06-09 feat(to): блоки ТО вращателя — ТО-1/2/3 кумулятивно |
| A14 | мелочь | `scripts/test-deploy-workflow.cjs` | 1 (0) | `4ecd6e3e` 2026-10-03 (CODEX-F6) Не позволять GitHub выкладке обходить внешний и compose барьеры |
| A15 | мелочь | `scripts/test-ingress.bat` | 1 (0) | `c62bae87` 2026-04-12 Initial commit |
| A16 | мелочь | `scripts/test-m6-m8.sh` | 1 (0) | `a4398d65` 2026-10-03 (CODEX-D2) Доказать M6–M8 на одноразовом Postgres |
| A17 | мелочь | `scripts/test-pilingtrack.sh` | 2 (0) | `cdf2d23a` 2026-08-17 chore: оснастка — .gitignore, скрипты, конфиги |
| A18 | мелочь | `scripts/test-worker-generation.sh` | 3 (0) | `28898142` 2026-10-03 (CODEX-F1) Возвращать старое поколение при отказе барьера |
| A19 | мелочь | `scripts/tg-debug.ts` | 1 (0) | `8bfd333d` 2026-04-29 fix(reports): correct pile meters + PDF, fix card layout |
| A20 | мелочь | `scripts/verify-orion-equipment-pdfs.py` | 1 (0) | `c10b8517` 2026-07-15 fix(orion): use reachable equipment sources |

Примечание: `scripts/verify-tenant-dictionary-migration.ts` в этот список **не** попал — он импортируется из `tests/integration/tenant-dictionary-migration.spec.ts:6` (бесрасширенный импорт, который поиск по полному имени сначала пропустил). Это живая ссылка, не кандидат.

### Приложение B — полная таблица по всем 103 файлам

Формат: `файл | ссылок всего | из них операционных | последний коммит`. Ноль ссылок — в основной таблице выше.

```
scripts/backfill-audit-feed-text.ts | 1 | 1 | 2d15a86f 2026-09-22 fix(audit): пересчёт старых строк ленты и порядок слов у марки сваи
scripts/backfill-maintenance-regulation.ts | 1 | 1 | 6329b1b8 2026-08-17 feat(maintenance): причина отмены наряда, регламент и места базирования
scripts/backfill-report-analytics.sh | 1 | 1 | 490b5c02 2026-05-21 scripts(backfill): npm run backfill:analytics for missing ReportAnalytics rows
scripts/cleanup-local-artifacts.ps1 | 1 | 1 | 962fa9d4 2026-04-24 refactor: worker leader election, in-process PDF, API polish
scripts/hooks/eslint-on-edit.js | 1 | 1 | 0e6e7820 2026-05-31 refactor: apply simplify findings from code review
scripts/hooks/protect-sensitive-files.js | 1 | 1 | cdf2d23a 2026-08-17 chore: оснастка — скрипты, конфиги
scripts/lib/module-boundaries.ts | 1 | 1 | 665ae722 2026-09-12 refactor(modules): межмодульные импорты только через публичный вход
scripts/reset-passwords.ts | 1 | 1 | 962fa9d4 2026-04-24 refactor: worker leader election, in-process PDF, API polish
scripts/stop-piling.ps1 | 1 | 1 | fed26bfa 2026-04-25 chore: refresh launch/stop scripts for v2.1.0
scripts/test-runner.ts | 1 | 1 | 65f68b17 2026-04-16 Initial commit
scripts/trace-runtime-deps.cjs | 1 | 1 | 40116c88 2026-09-23 build(ws): образ из бандла и трассированных зависимостей
scripts/add-runtime.js | 2 | 0 | cdf2d23a 2026-08-17 chore: оснастка
scripts/audit-fix-tenancy.sql | 2 | 1 | 10330f25 2026-05-16 fix(audit): close production audit recommendations
scripts/free-dev-lock.js | 2 | 2 | 26aeee25 2026-09-13 fix(dev): clear the leftover Next dev lock before starting
scripts/release-start.bat | 2 | 1 | 8a454828 2026-04-25 feat(release): ship start.bat launcher inside standalone zip
scripts/restore-drill-verify.cjs | 2 | 1 | a82f6b26 2026-10-02 test(backup): одноразовое учение восстановления (CODEX-T2-3)
scripts/test-day-stand.cjs | 2 | 1 | b1d988e8 2026-10-03 (CODEX-E7) Проверить ветку на PG Redis S3
scripts/test-day-stand.sh | 2 | 1 | f32edbbf 2026-10-03 (CODEX-E1) Сохранить одноразовый production стенд
scripts/test-redis-cache.js | 2 | 1 | c62bae87 2026-04-12 Initial commit
scripts/.layer-boundaries-baseline.txt | 3 | 2 | 09226688 2026-10-07 refactor(pile-journal): импорт правил operator-mobile сведён в один файл
scripts/backfill-report-analytics.sql | 3 | 1 | 490b5c02 2026-05-21 scripts(backfill): npm run backfill:analytics
scripts/check-integration-results.cjs | 3 | 2 | 96a904c5 2026-10-02 ci(integration): RLS и учение восстановления (CODEX-T2-4)
scripts/check-postgres-rules.js | 3 | 1 | 51d0f757 2026-09-24 chore(db): удалён устаревший postgres-production-hardening.sql
scripts/db-drill-manifest.cjs | 3 | 2 | a82f6b26 2026-10-02 test(backup): одноразовое учение восстановления (CODEX-T2-3)
scripts/pdf-storage-inventory.cjs | 3 | 1 | d6550123 2026-10-02 feat(ops): инвентаризация временных PDF (CODEX-S3-capacity-retention)
scripts/prod-smoke.mjs | 3 | 1 | 23e26b45 2026-09-04 feat(release): проверка боевого стенда после выката
scripts/restore-drill.sh | 3 | 1 | 96a904c5 2026-10-02 ci(integration): RLS и учение восстановления
scripts/restore.sh | 3 | 1 | c62bae87 2026-04-12 Initial commit
scripts/switch-db.js | 3 | 1 | 93116242 2026-05-18 chore(release): 2.4.1 — local prod-DB snapshot workflow
scripts/test-db-dump.cjs | 3 | 1 | a82f6b26 2026-10-02 test(backup): одноразовое учение восстановления
scripts/backfill-projections.ts | 4 | 2 | 11fb8162 2026-05-14 fix(projections): extend backfill to cover ReportAnalytics and ReportStats
scripts/operator-v3-preflight.ts | 4 | 1 | de8ef913 2026-08-29 feat(operator): рабочее место v3
scripts/redis-stress-test.js | 4 | 1 | c62bae87 2026-04-12 Initial commit
scripts/apply-full-ddl.ts | 5 | 1 | 4bad9fed 2026-04-12 Unify Prisma schema
scripts/check-layer-boundaries.ts | 5 | 4 | ae4841f2 2026-09-22 merge: проверка границ слоёв видит многострочные импорты
scripts/generate-env-docker.ps1 | 5 | 1 | bb40d7ed 2026-09-27 feat(auth)!: удалить вход по ПИН-коду
scripts/refresh-prod-snapshot.sh | 5 | 1 | 93116242 2026-05-18 chore(release): 2.4.1
scripts/app-guard.sh | 6 | 1 | 8a30bc00 2026-09-30 fix(ops): сторож app-guard (F-APP-GUARD-b)
scripts/check-text-integrity.js | 6 | 1 | c62bae87 2026-04-12 Initial commit
scripts/copy-standalone-assets.js | 6 | 3 | 8a454828 2026-04-25 feat(release): ship start.bat launcher inside standalone zip
scripts/explain-analyze.ts | 6 | 2 | 51d0f757 2026-09-24 chore(db): удалён устаревший postgres-production-hardening.sql
scripts/patch-postgres-client.js | 6 | 3 | 962fa9d4 2026-04-24 refactor: worker leader election
scripts/quick-load-test.js | 6 | 1 | cdf2d23a 2026-08-17 chore: оснастка
scripts/setup-partitioning.ts | 6 | 2 | 4bad9fed 2026-04-12 Unify Prisma schema
scripts/stress-test-100.js | 6 | 1 | cdf2d23a 2026-08-17 chore: оснастка
scripts/app-role-verify.sql | 7 | 3 | 4c1fe0d6 2026-08-17 feat(infra): приложение ходит в базу ролью без BYPASSRLS
scripts/apply-full-ddl.sql | 7 | 2 | c62bae87 2026-04-12 Initial commit
scripts/apply-postgres-hardening.ts | 7 | 5 | 51d0f757 2026-09-24 chore(db): удалён устаревший postgres-production-hardening.sql
scripts/check-migrations.js | 7 | 2 | 1929ac93 2026-09-30 feat(scripts): гвард миграций (F-MIG-PREFLIGHT-GUARD)
scripts/kill-port.js | 7 | 4 | cdf2d23a 2026-08-17 chore: оснастка
scripts/pitr-basebackup.sh | 7 | 1 | a4ceb54f 2026-09-30 docs(backup): честная шапка pitr-basebackup (F-11)
scripts/staging-local.sh | 7 | 1 | bb40d7ed 2026-09-27 feat(auth)!: удалить вход по ПИН-коду
scripts/.migration-guard-baseline.txt | 8 | 2 | 1929ac93 2026-09-30 feat(scripts): гвард миграций
scripts/test-db-down.sh | 8 | 5 | 2f3ef53b 2026-10-02 test(db): одноразовый стенд Postgres 16 (CODEX-T2-1)
scripts/smoke-auth-access.js | 9 | 1 | ea540b96 2026-06-27 fix(smoke,seed): rewrite smoke-auth-access for Postgres
scripts/test-db-up.sh | 9 | 5 | 96a904c5 2026-10-02 ci(integration): RLS и учение восстановления
scripts/load-test.js | 10 | 2 | c62bae87 2026-04-12 Initial commit
scripts/disk-guard.sh | 11 | 2 | df910b08 2026-07-01 fix(ops): silence disk-guard cooldown-stamp error
scripts/identity-role-grants.sql | 11 | 5 | cc9c9c13 2026-08-19 feat(security): опознание ходит в базу отдельной узкой ролью
scripts/replace-worker-generation.sh | 11 | 5 | 28898142 2026-10-03 (CODEX-F1) Возвращать старое поколение при отказе барьера
scripts/smoke-workers-image.sh | 11 | 4 | 8eee7031 2026-10-02 fix(workers): обязательный smoke образа (CODEX-N1)
scripts/backup.sh | 16 | 5 | fdc0c678 2026-10-02 fix(backup): сверять Redis-ключи всех shell-писателей (CODEX-N3)
scripts/app-role-grants.sql | 17 | 8 | ac22659a 2026-09-23 test(rls): изоляция тенантов больше не пропускается молча
scripts/validate-env.ts | 18 | 3 | d075e2bc 2026-09-30 fix(scripts): предупреждать в проде о переменных (F-ENV-VALIDATE-WARN-r)
scripts/deploy-prod.sh | 19 | 3 | 91005228 2026-10-03 (CODEX-F5) Согласовать команды выкладки и возврата поколения
scripts/backup-postgres.sh | 24 | 7 | 0ea0c6be 2026-10-01 fix(backup): метки бэкапа в Redis с приставкой pilingtrack:
```

## Не проверено

- **История происхождения** осиротевших скриптов (был ли раньше файл/команда, которые на них ссылались, и когда ссылку удалили) — не восстанавливал. Для каждого дан последний коммит, менявший сам файл, но не коммит, «бросивший» его без ссылки.
- **Факт применения на боевом** `fix-passwords.sql`, `seed-sites.sql`, `seed-maintenance-plans.ts`, `seed-user-document-types.ts` — проверить нельзя без доступа к прод-БД (доступ запрещён правилами). Вывод «кандидат на удаление» сделан только по отсутствию ссылок в коде, не по состоянию данных.
- **Почему** `scripts/setup-postgres.js` отсутствует, а команда `postgres:setup` осталась (какой скрипт имелся в виду) — по репозиторию не установил; отнесено в «уточнить у владельца».
- **Ссылки из untracked-файлов** (`.env*`, `.tmp*`, локальные заметки) не искались — `git grep` их не видит. Влияние оцениваю как маловероятное, но это не проверено.
- Прошлые отчёты аудита (`docs/audits/hermes-night/R78-dead-code-candidates.md` и др.) уже упоминают часть этих скриптов; сверку с их выводами по каждому пункту не делал.
- Проверки из §6 AGENTS.md (`tsc`, `lint`, `test:unit`, `playwright --list`, `build`) **не запускались**: задача — только чтение, кода не менялось, добавлять нечего.
