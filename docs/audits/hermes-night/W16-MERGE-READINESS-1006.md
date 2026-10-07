# W16-MERGE-READINESS-1006: готовность ветки hermes/q4-0926 к слиянию в main

Дата: 07.10.2026. Ветка: hermes/q4-0926 (HEAD 965df4a4). База слияния: 9f63f92d (merge-base HEAD main).
Проверка read-only; создан только этот файл.

## Итог

- Коммитов в ветке поверх main: **26** (все 06.10–07.10). Файлов: **74**, +3312 / −316. package.json / lock-файлы **не менялись**.
- Прогоны (код возврата до конвейера): `tsc --noEmit` = **0**; `eslint src e2e --max-warnings 0` = **0**; `vitest run` = **0** (Files 357 passed | 8 skipped; Tests **3501 passed | 229 skipped** из 3730).
- Пробное слияние (git 2.55): **1 конфликт**, add/add, файл `e2e/qa-ac/operator-everywhere.spec.ts`. Больше расхождений нет — остальные 11 общих файлов на обеих сторонах идентичны по blob.
- Замороженные области (`src/**/operator*`, `src/modules/operator-mobile`, `orion`, `prisma/`, `scripts/`, `auth`, `core/security`, `rate-limiter`) ветка **не трогает**. Единственные «operator»-файлы — e2e-спеки `e2e/qa-ac/operator-*.spec.ts` и `e2e/qa-ac/tools/probe-operator.mjs` (тесты, не замороженные src-варианты).
- Топ-5 по важности: (1) конфликт слияния в operator-everywhere.spec.ts — [важно]; (2) W14 меняет источник данных журнала забивки (PilePassport → PileWork, `pile-passport.service.ts:208`) — [важно]; (3) W9 переводит гейт аналитики с роли на право `analytics.read` (`monitoring/page.tsx:10`) — [важно]; (4) 229 пропущенных тестов — зелёный прогон не покрывает интеграцию/env — [мелочь]; (5) e2e operator-спеки добавлены и пересекаются с main — [мелочь].
- **Вердикт: можно сливать** — но не автоматом: сначала вручную разрешить единственный конфликт (см. находку 1), затем обычный merge. Блокеров по коду/типам/линту нет.

## Методика

Выполнено в `D:\PillingR\wt-night` (git-bash, node v26.7.0, git 2.55). Команды можно повторить один-в-один:

1. Перечень: `git log --pretty=format:'%H %ci %s' main..HEAD`; `git log --oneline --stat --no-merges main..HEAD`; `git diff --stat main...HEAD`; `git rev-list --count main..HEAD`.
2. Пробное слияние без записи: новое `git merge-tree --write-tree --name-only HEAD main` (код 1 = конфликт) и старое `git merge-tree $(git merge-base HEAD main) HEAD main` (искал конфликтные маркеры).
3. Пересечение затронутых файлов: `git diff --name-only $MB..HEAD` и `..main` → `comm -12`; для общих файлов сравнивал blob через `git rev-parse main:$f` / `HEAD:$f`.
4. Прогоны (коды брал сразу после команды, без `| tail`): удаление типов `node -e "fs.rmSync('.next/dev/types',{recursive:true,force:true})"` (rm -rf заблокирован политикой), затем `npx tsc --noEmit`, `npx eslint src e2e --max-warnings 0`, `npx vitest run` (вывод в файл, статистика из него).
5. Замороженные/критичные области: фильтр `git diff --name-only main...HEAD | grep -Ei 'prisma/|^scripts/|/auth/|core/security|rate-limiter|orion|operator'`.
6. Содержание ключевых коммитов: `git show <hash> -- <файл>`.

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | e2e/qa-ac/operator-everywhere.spec.ts:120-160 | add/add-конфликт: и main (b72a80ca), и ветка (69be3b00/965df4a4) добавили файл; расхождение в 2 блоках — NEW-5/NEW-6. На main они помечены `test.fail(true, ...)`, в ветке пометки сняты и добавлено чтение колонки «Свай» по заголовку. | Автослияние невозможно; при неверном разрешении (взять версию main) e2e снова начнёт «ожидать падения» уже исправленных дефектов и упадёт. | Разрешить вручную, взяв версию ветки (она учитывает исправления W13/W14). Остальные 11 общих файлов идентичны — трогать не нужно. |
| 2 | важно | src/modules/reports/application/queries/pile-passport.service.ts:208 | W14 сменил источник строк журнала забивки: было `db.pilePassport.findMany`, стало `db.pileWork.findMany` с подключением паспорта по `pileWorkId`; изменены фильтры (период по `occurredAt`/`receivedAt`), сортировка `nulls: last`, тип `pileNumber`/`acceptance` → nullable, добавлены `hasPassport`/`isDraft`/`count`. | Самый крупный коммит (+199/−… в сервисе). Меняет видимый состав и фильтры журнала; риск регрессии отображения, выгрузки .xlsx и приёмки. Тесты обновлены (pile-passport.service.test 294 стр.), но `npm run build` не гонялся. | Перед слиянием прогнать `npm run build` (нужен env/DB) и смоук журнала за период с «пачками» без паспорта. |
| 3 | важно | src/app/(app)/monitoring/page.tsx:10 | W9 перевёл показ блока аналитики с проверки роли (`ADMIN|DISPATCHER`) на право `useAbility('analytics.read')`. | Расширяет видимость: FOREMAN (Мастер) теперь видит аналитику, а сервер её и так отдаёт. Это ожидаемое исправление, но меняет видимую поверхность экрана. | Подтвердить на ревью, что новое поведение совпадает с матрицей прав; тест (page.test.tsx) покрывает кейс. |
| 4 | важно | src/lib/routes.ts:34 | W10 сменил домашний маршрут SAFETY_ENGINEER: `/admin/to` → `/admin/safety` (MECHANIC остаётся на `/admin/to`). | Меняет точку входа роли после логина и корневой редирект; ошибка здесь уводит роль на чужой экран. Покрыто `routes.test.ts`. | Проверить, что `/admin/safety` доступен роли (группа (safety), без доп. права) — на ревью. |
| 5 | мелочь | — (прогон) | `vitest run`: 229 тестов пропущено (8 файлов skipped). Vitest не читает `.env` — интеграция со БД молча скипается. | «Зелёный» прогон не доказывает работу интеграционных путей (в т.ч. W14, работающего с БД-выборкой). | Компенсировать прогоном `npm run build` + точечным e2e/интеграцией с env; в отчёте считать skipped честно. |
| 6 | мелочь | e2e/qa-ac/operator-walk.spec.ts (+565), e2e/qa-ac/tools/probe-operator.mjs (+66) | Ветка добавила e2e-спеки и зонд с «operator» в имени. | Это НЕ замороженные src-варианты (экраны оператора), а тесты/утилита; блокировки не требуют. Но файлы пересекаются с main (blob идентичны — конфликтов нет). | Ничего; учтено как не-нарушение заморозки. |
| 7 | мелочь | e2e/qa-ac/operator-walk.spec.ts (внутри) | Спеки пишут артефакты в абсолютный путь `D:/PillingR/wt-autoclaw/...` и зовут `docker exec … psql`. | В другом worktree/CI путь и контейнер могут отсутствовать → коллекция/прогон e2e упадёт. `npx playwright test --list` в этой задаче не гонялся. | Прогнать `npx playwright test --list` перед слиянием (в отчёте не проверено). |

Коммитов, трогающих `prisma/`, `scripts/`, `auth`, `core/security`, `rate-limiter`, `orion`, замороженные `src/**/operator*` — **не найдено**.

## Таблица коммитов

Риск: Н — низкий, С — средний, В — высокий. «test» — есть ли тест в коммите.

| # | commit | сообщение (кратко) | ключевые файлы | test | риск | почему |
|---|---|---|---|---|---|---|
| 1 | 965df4a4 | fix(pile-journal) W14 | pile-passport.service.ts (+199/−…), pile-journal/index.tsx, spec e2e | да | **В** | смена источника данных журнала (PilePassport→PileWork), фильтры/выгрузка/приёмка |
| 2 | 69be3b00 | test(qa-ac) W13 | 6 spec + operator-walk(+565)+probe | сам тест | Н | только e2e; источник конфликта слияния |
| 3 | c6925aab | fix(admin-equipment) R138 | detail/equipment-detail-overview.tsx, equipment-detail.tsx | да | Н | подписи/склонения |
| 4 | 9d741de6 | fix(inspections-to) R137 | inspection-controls.tsx, maintenance-plans-panel.tsx | да | Н | размер целей 44px |
| 5 | 5e3a1e02 | fix(equipment) R129 | equipment-tile.tsx, equipment-tile-block.tsx, detail | да | Н | подпись «м/ч» |
| 6 | 6fda6990 | fix(admin) R128-7/17/19 | admin-dashboard.tsx, admin-dlq.tsx | да | С | индикация перечитывания + консистентность статистики DLQ |
| 7 | 736b3a50 | fix(monitoring) W9 | (app)/monitoring/page.tsx | да | С | гейт аналитики по праву вместо роли (см. нах. 3) |
| 8 | 278a7809 | docs(audit) W12 | W12-ANALYTICS-ORPHANS.md | н/п | Н | только документ |
| 9 | d7d57bfc | docs(audit) W11 | W11-NO-ACCESS-SCREEN.md | н/п | Н | только документ |
| 10 | 16aa1823 | fix(routes) W10 | src/lib/routes.ts | да | С | домашний маршрут SAFETY_ENGINEER (см. нах. 4) |
| 11 | e7d96829 | docs(audit) W3 | W3-EQUIP-CARD-ZERO.md | н/п | Н | документ |
| 12 | 798ddfa6 | docs(audit) W2 | W2-PILE-JOURNAL.md | н/п | Н | документ |
| 13 | 1ede39c0 | docs(audit) W1 | W1-ROLE-ROUTES.md | н/п | Н | документ |
| 14 | 10ed216e | test(e2e) W8 | e2e/qa-ac/exports.spec.ts | сам тест | Н | e2e только |
| 15 | 3d0ffe66 | fix(settings) W7 | workspace-settings.tsx | да | Н | заголовок вкладки |
| 16 | 31b2ba07 | docs(audit) W6 | W6-NOTIF-BADGES.md | н/п | Н | документ |
| 17 | 4e5d915a | docs(audit) W5 | W5-ANALYTICS-STATUS.md | н/п | Н | документ |
| 18 | bb4c4d09 | docs(audit) W4 | W4-AUDITLOG-STOPPED.md | н/п | Н | документ |
| 19 | 6f123dd2 | fix(briefings) R134 | briefing-journal-print.tsx | да | Н | печатная нумерация листов/перенос кода |
| 20 | e5d779c1 | fix(admin-screens) R133 | admin-analytics.tsx, admin-dashboard.tsx, use-fleet.ts, use-users-list.ts | нет | С | обработка 401 в data-хуках без отдельного теста |
| 21 | 69a3b3a3 | fix(piling) R131 | report-thumbnail.tsx, user-documents.tsx, template-list.tsx | да | Н | title на кнопках-иконках |
| 22 | 130bc5c9 | fix(admin-lists) R130 | admin-equipment.tsx, admin-reports.tsx, user-assignment.tsx | да | С | сброс фильтров/поиск/период экспорта — логика списков |
| 23 | 5b93e914 | fix(monitoring/maintenance/admin-crews) R126 | admin-crews.tsx, maintenance-board.tsx, equipment-tile-block.tsx, fleet-dashboard.tsx | нет | Н/С | верстка на 375px, без тестов |
| 24 | 3d28aa1c | fix(to-audit) R125 | shared.tsx, audit-section.tsx, to-module.tsx, types.ts | да | С | дебаунс фильтров, список типов, индикатор ошибки |
| 25 | e891aa91 | fix(e2e/qa-ac) LINT | 9 e2e-спеков | сам тест | Н | снятие 42 предупреждений ESLint |
| 26 | fc2cc1d7 | merge: main 06.10 в ветку | — (слияние) | н/п | Н | подтягивает main на 06.10 |

## Не проверено

- `npm run build` — не запускался (нужен env/БД; AGENTS §6 прямо допускает отчёт «падает на env», но здесь я его не гонял, значит Next route-типы не проверены). `tsc --noEmit` чистый, но это не заменяет build.
- `npx playwright test --list` — не запускался; число собираемых e2e-тестов не сверялось (спеки пишут в абсолютный путь `D:/PillingR/wt-autoclaw/...` и зовут `docker exec`, вне этого окружения могут не собраться).
- Семантика слияния за пределами конфликтного файла: merge-tree чист, общие файлы идентичны, но осмысленная корректность совмещения W14 (журнал из PileWork) с изменениями main по тем же данным — не проверялась.
- Интеграционные тесты (229 пропущенных) — реальный результат не получен из-за отсутствия `.env`/БД; «зелёный» прогон их не покрывает.
- Коды возврата старого `git merge-tree` синтаксиса не трактовались как признак конфликта — вывод верен по новому `--write-tree` (exit 1, 1 файл).
