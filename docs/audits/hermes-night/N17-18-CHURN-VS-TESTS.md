# N17-18 — Что часто меняется и плохо проверено тестами

Независимый аудит. Версия кода: `git rev-parse HEAD` = **bf8a6c4e6b3332c23c722e6b9e207d3e85c8b9ae**
(ветка `hermes/code-1011`). Только чтение — код приложения не менялся, закоммичен только этот отчёт.

## Итог

- Метрика изменчивости (1 сентября — 16 октября 2026, без тестов и `src/generated`): **1253 файла, 4274 правки**, 996 коммитов затронули `src`.
- Из 40 самых «горячих» файлов **15 — замороженные варианты экрана оператора** (`src/components/piling/operator*/**`, `src/modules/operator-mobile/**`); они лидируют по правкам, но трогать их нельзя — правки владельца.
- Среди 40 «горячих» файлов **прямого теста нет у 3** — все три замороженные и являются фасадами/контрактами (`mobile-shift-commands.ts`, `view-contracts.ts`, `operator-v2/ui.tsx`), логика которых тестируется ниже по вызовам.
- **Критично: 0. Важно: 6. Мелочь: 5.**
- Топ-5 по риску (частые правки + нет теста, который реально исполняет код): `report-evidence-row.tsx` (глушится в единственном тесте), `api/safety/equipment-permits` (POST — выдача допуска), `api/admin/analytics/overview` (KPI из сырого SQL), `api/user-document-types` (POST/PATCH), `report-history.tsx` (нет теста и нет e2e).
- Числа `it()/test()` — это **не покрытие**, а штука тест-кейсов; реальные проценты покрытия не измерялись (тесты запускать запрещено условием задачи).
- Проект покрыт лучше, чем можно предположить по метрике: у всех не-замороженных «горячих» файлов есть хотя бы один тест, а `pdf-generator/*` и `report-export.service.ts` исполняются косвенно через баррели (проверено).
- `src/services/audit/audit-service.ts` (20 правок, 1037 строк) — не риск: один выделенный тест на 74 кейса; остальные 29 файлов его только глушат (это признак сильной зависимости, а не пробела).

## Методика

Всё воспроизводимо командами; рабочая папка `D:/PillingR/wt-night-code`.

1. Изменчивость (как в задании), без тестов и generated:
   `git log --since=2026-09-01 --name-only --format= -- src` → фильтр `__tests__`, `.test.`, `.spec.`, `src/generated`, `*/generated/*` → сортировка по числу правок. Итог сохранён во временный файл в `%TEMP%` (вне репозитория).
2. Для первых 40 файлов (уже без тестов/generated) тесты искались так:
   - файлы `*.test.ts(x)`/`*.spec.ts(x)` во всём репозитории (469 файлов: `src/**`, `tests/**`, `e2e/**`);
   - связь «тест ↔ файл» — по **резолву импортов** теста (`from '...'`, динамический `import()`, `require()`, `vi.mock`), с разворачиванием алиаса `@/` и относительных путей к пути файла; плюс одноимённые соседи в `__tests__/`;
   - `vi.mock('модуль')` учитывался **отдельно** — такой тест модуль не исполняет, а подменяет;
   - в тестах считались `it(`/`test(` (включая `.skip/.only/.todo/.each`).
3. «Косвенное покрытие» (файл исполняется не напрямую, а через импортер, который тестируется) — обход графа импортов `src` + `tests` + `e2e` от тестов, с исключением `vi.mock`-целей. Это эвристика: она показывает достижимость из теста, а не факт покрытия.
4. Заморозка: `src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**` помечены `FROZEN`; правок по ним не предлагается.
5. Порог покрытия — `vitest.config.ts:71-86`: общие `lines 66 / statements 63 / functions 57 / branches 55` (это «пол-храповик» ~2 пункта ниже факта, не цель), отдельные планки: `src/services/auth/**` 90/90/90/85, `src/core/security/**` 85/85/85/80, `src/lib/rate-limiter.ts` и `src/lib/csrf-protection.ts` 90/90/90/85, `src/modules/readiness/application/permits/**` 90/90/85/80, `.../domain/permits/**` 80/80/80/75, `.../application/shifts/**` 95/95/90/80.

### Топ-40 «горячих» файлов (без тестов и generated)

Столбцы: файл | правок | строк | тест-файлов | `it()/test()` | вывод.
`ЗАМОРОЖЕНО` — править нельзя; `норм` — прямой тест есть; `0` — прямого теста нет.

| # | файл | правок | строк | тестов | it/test | вывод |
|---|------|-------:|------:|-------:|--------:|-------|
| 1 | src/components/piling/operator-mobile/operator-mobile-app.tsx | 38 | 1119 | 3 | 38 | норм — ЗАМОРОЖЕНО |
| 2 | src/components/piling/operator-mobile/v10/operator-v10-app.tsx | 32 | 1772 | 2 | 38 | норм (тесты косвенные, прямых через относительный импорт нет) — ЗАМОРОЖЕНО |
| 3 | src/components/piling/operator-mobile/api.ts | 31 | 755 | 11 | 214 | норм — ЗАМОРОЖЕНО |
| 4 | src/components/piling/admin-dashboard.tsx | 28 | 582 | 1 | 19 | норм (тест реально рендерит экран) |
| 5 | src/components/piling/operator-v2/operator-shift-v2.tsx | 26 | 1503 | 1 | 27 | норм — ЗАМОРОЖЕНО |
| 6 | src/components/piling/admin-reports/admin-reports.tsx | 24 | 631 | 1 | 24 | норм (дочерние модули глушатся) |
| 7 | src/components/piling/operator-v5/operator-v5-app.tsx | 24 | 1584 | 1 | 32 | норм — ЗАМОРОЖЕНО |
| 8 | src/components/piling/admin-equipment/detail/equipment-detail.tsx | 21 | 509 | 1 | 34 | норм |
| 9 | src/services/audit/audit-service.ts | 20 | 1037 | 1 | 74 | норм (но 29 тестов его только глушат) |
| 10 | src/components/piling/admin-sites/index.tsx | 18 | 605 | 1 | 9 | норм (часть дочерних глушится) |
| 11 | src/components/piling/operator-mobile/v7/operator-v7-app.tsx | 18 | 619 | 1 | 6 | тонко — ЗАМОРОЖЕНО |
| 12 | src/components/piling/to/readiness/screens/permits-screen.tsx | 18 | 478 | 3 | 99 | норм |
| 13 | src/components/piling/to/readiness/screens/readiness-centre.tsx | 18 | 1387 | 1 | 39 | норм |
| 14 | src/components/piling/admin-reports/report-form-dialog.tsx | 16 | 462 | 1 | 14 | норм |
| 15 | src/components/piling/operator-mobile/screens/work-screen.tsx | 16 | 563 | 1 | 12 | норм — ЗАМОРОЖЕНО |
| 16 | src/modules/operator-mobile/application/mobile-shift-commands.ts | 16 | 36 | 0 | 0 | **0** — ЗАМОРОЖЕНО (баррель-фасад) |
| 17 | src/components/piling/pile-journal/index.tsx | 15 | 508 | 1 | 18 | норм |
| 18 | src/components/piling/to/to-module.tsx | 15 | 889 | 1 | 43 | норм |
| 19 | src/components/piling/workspace-settings.tsx | 15 | 414 | 1 | 7 | норм |
| 20 | src/modules/operator-mobile/application/commands/production.ts | 15 | 614 | 1 | 17 | норм — ЗАМОРОЖЕНО |
| 21 | src/modules/reports/application/queries/report-query.service.ts | 15 | 350 | 2 | 34 | норм |
| 22 | src/components/piling/monitoring/fleet-dashboard.tsx | 14 | 351 | 1 | 17 | норм |
| 23 | src/services/reports/event-handlers.ts | 14 | 684 | 2 | 33 | норм |
| 24 | src/modules/reports/application/queries/pile-passport.service.ts | 13 | 77 | 3 | 47 | норм |
| 25 | src/app/api/operator/mobile/command/route.ts | 12 | 265 | 2 | 7 | норм (модуль глушится, проверяется только валидация) |
| 26 | src/components/piling/admin-crews/admin-crews.tsx | 12 | 316 | 2 | 13 | норм |
| 27 | src/components/piling/admin-dictionaries.tsx | 12 | 695 | 1 | 24 | норм |
| 28 | src/components/piling/admin-telegram.tsx | 12 | 489 | 1 | 15 | норм |
| 29 | src/components/piling/operator-mobile/screens/closing-screen.tsx | 12 | 247 | 1 | 8 | норм — ЗАМОРОЖЕНО |
| 30 | src/components/piling/operator-mobile/ui.tsx | 12 | 353 | 2 | 11 | норм — ЗАМОРОЖЕНО |
| 31 | src/core/notifications/telegram.ts | 12 | 432 | 1 | 31 | норм (5 тестов глушат) |
| 32 | src/modules/operator-mobile/application/mobile-shift-query.ts | 12 | 769 | 1 | 7 | тонко — ЗАМОРОЖЕНО |
| 33 | src/modules/operator-mobile/domain/view-contracts.ts | 12 | 296 | 0 | 0 | **0** — ЗАМОРОЖЕНО (типы/контракты) |
| 34 | src/components/piling/admin-reports/report-evidence-preview.tsx | 11 | 318 | 1 | 5 | тонко |
| 35 | src/components/piling/maintenance/maintenance-board.tsx | 11 | 506 | 2 | 35 | норм |
| 36 | src/components/piling/operator-mobile/v7/v7-screens.tsx | 11 | 563 | 3 | 14 | норм — ЗАМОРОЖЕНО |
| 37 | src/components/piling/operator-v2/ui.tsx | 11 | 204 | 0 | 0 | **0** — ЗАМОРОЖЕНО |
| 38 | src/components/piling/report-form/use-report-form.ts | 11 | 593 | 1 | 21 | норм |
| 39 | src/components/piling/to/readiness/screens/settings-workspace.tsx | 11 | 669 | 2 | 82 | норм |
| 40 | src/lib/validation-schemas.ts | 11 | 469 | 2 | 48 | норм |

## Находки

Серьёзность по реальному сценарию отказа: «важно» — есть путь, где отсутствие теста приведёт к незамеченному регрессу; «мелочь» — путь есть, но покрыт e2e или малозначим; «важно/ГИПОТЕЗА» — проверено частично.

| # | severity | path:line | проблема | сценарий / почему важно | что сделать |
|---|----------|-----------|----------|--------------------------|-------------|
| 1 | важно | src/components/piling/admin-reports/report-evidence-row.tsx:36 (`ReportsHeader`, `EvidenceReportRow`, KPI-сводка); единственный тест, который его касается, глушит модуль: src/components/piling/admin-reports/__tests__/admin-reports.test.tsx:48 `vi.mock('../report-evidence-row', ...)` | 8 правок, 288 строк, **ни один тест не исполняет этот компонент** — он везде подменён заглушкой | Строки журнала отчётов (статус, тонаж, кнопки «Удалить/Печать») меняются часто; поломка не поймается. Это тот случай, который AGENTS.md называет «проверяет только мок» | отдельный тест-рендер `EvidenceReportRow`/`ReportsHeader` без глушения (или снять `vi.mock`) |
| 2 | важно | src/app/api/safety/equipment-permits/route.ts:64 (`export const POST = withMutation(...)`, выдача/правка допуска к технике); рядом `.../[id]/route.ts` — тоже без тестов | в каталоге `safety/equipment-permits` нет ни одного `__tests__`; в `e2e/` и `tests/` путь `/api/safety/equipment-permits` не упоминается | Допуск к технике — решение по охране труда. `safeParse` (стр. 73-79), проверка `mayManage` (стр. 87) и запись аудита (стр. 90) держатся без тестов | контракт-тест: 400 на кривой payload, 403 без `safety.permits.manage`, 201 + событие аудита |
| 3 | важно | src/app/api/admin/analytics/overview/route.ts:1-14 (273 строки, KPI из `db`/`pileLengthMeters`) | 5 правок, тестов нет; в `e2e/fixtures/disposable-performance.mjs:32` путь только **вызывается для замера времени**, числа не проверяются | Дашборд считает погонные метры, сваи, бурение, % простоев и дельты к прошлому периоду прямо в SQL — ошибка в формуле ничего не сломает, но покажет неверные KPI | тест на числа по фикстуре (метры через `PileGrade.lengthMm`, % простоя = часы/сменные часы) |
| 4 | важно | src/app/api/user-document-types/route.ts:41 (`POST`, создание вида документа) и src/app/api/user-document-types/[id]/route.ts:14 (`PATCH`) | ни одного `__tests__`, ни в `e2e/`, ни в `tests/` имя не встречается | Справочник видов документов работника: создание/правка/отключение без тестов. Регресс валидации (`safeParse`, стр. 47-50 и 20-23) пройдёт молча | тест на 400/201 и на `partial()`-схему в PATCH |
| 5 | важно | src/components/piling/report-history.tsx:31 (`export function ReportHistory()`), импортируется только src/app/(app)/history/page.tsx:3 | 4 правки, 389 строк; ни прямого теста, ни упоминания в e2e/tests | Страница истории отчётов с фильтрами и пагинацией не проверяется вообще; соседний `report-history-service.ts` тестируется, а сама страница — нет | тест-рендер (пустой список / ошибка загрузки / фильтр по объекту) или e2e-джорни |
| 6 | важно | src/app/api/admin/equipment-analytics/route.ts:10 (`GET`, проверка даты стр. 23-26, право `analytics.read` стр. 15) | каталог без `__tests__`; в `e2e/role-audit.spec.js:80` эндпоинт только **подменяется** через `page.route(...503...)`, реальный код не исполняется | Валидация `ISO-дня` появилась именно из-за того, что кривая дата возвращала 500; проверки этой защиты нет | тест: 400 на `dateFrom=2026-1-1`, 403 без права |
| 7 | важно | src/app/api/sites/[id]/route.ts:6 (`hardDeleteSite`, `deactivateSite`) — в каталоге `src/app/api/sites/[id]` нет `__tests__` (у `assign` и `hierarchy` — есть) | 5 правок, 127 строк; DELETE/PUT дёргаются только в уборке e2e (e2e/qa-ac/util.ts:147-148), без проверки результата | Деструктивная операция (жёсткое удаление объекта) без теста — прямое нарушение правила AGENTS.md «тест на разрушающую операцию» | тест на DELETE (204/404) и на запрет без права |
| 8 | мелочь | src/components/piling/report-form/report-form.tsx:7-16; тесты рядом глушат `photo-section` в src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx:47 | 5 правок, 312 строк, прямого теста нет (тестируется хук `use-report-form.ts`, стр. 7) | Форма отчёта — главный путь машиниста. Покрыта e2e (e2e/report-creation-flow.spec.ts, release-critical-path.spec.ts), поэтому регресс заметят в сквозном прогоне, а не юнит-тестом | по желанию: рендер-тест на блокировку кнопки и текст ошибки |
| 9 | мелочь | src/components/piling/report-form/downtime-section.tsx:18 (`DowntimeSectionProps`); единственный импортер — src/components/piling/report-form/report-form.tsx:12 | 5 правок, 97 строк, тестов нет | Секция простоя (часы) — часть формы отчёта; юнит-проверки нет, но путь покрыт e2e | — |
| 10 | мелочь | src/components/piling/to/readiness/shift-create-form.tsx:20 (`useEffect`/`useState`, форма создания смены); импорт src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx:5 | 4 правки, 288 строк, тестов нет | Форма создания смены. Правки были по UX («кнопка молча заводила смену»); регресс UX не поймать тестом | — |
| 11 | мелочь / ГИПОТЕЗА | src/components/piling/admin-users/user-detail.tsx:1-29 (табы «Обзор/Документы/…», `useEntityHistory`) | прямого теста нет; родительский src/components/piling/admin-users/__tests__/admin-users.test.tsx:19 глушит `@/components/piling/ops-shell/use-entity-history`, но не сам `user-detail`, — возможно, он исполняется частично | Не проверял, рендерится ли `UserDetail` в этом тесте — «не проверено» | подтвердить/добавить рендер-тест вкладок |

Дополнительно (проверено, риска нет — не выдавать за пробел):
- src/lib/pdf-generator/components.ts (9 правок, 304 строки), .../single-pdf.ts (8), .../period-pdf.ts (7) — прямых тестов нет, но исполняются косвенно через src/lib/__tests__/pdf-generator.test.ts:162,186 (`await import('@/lib/pdf-generator')`), а `single-pdf.ts`/`period-pdf.ts` тянут `./components` (single-pdf.ts:10). **покрыто косвенно.**
- src/modules/reports/application/queries/report-export.service.ts (7 правок, 367 строк) — ре-экспортируется из report-query.service.ts:330 и вызывается из .../__tests__/export-reports-csv.test.ts:31 (`exportReportsCsv` из `../report-query.service`). **покрыто косвенно.**
- src/app/api/reports/upsert/route.ts (5 правок) и src/app/api/analytics/sites/route.ts (4) — не резолвятся из тестов импортом, но вызываются по URL в e2e (e2e/report-creation-flow.spec.ts:59,129; tests/integration/disposable-idor.spec.ts:13). **покрыто e2e/интеграцией.**

### Приложение: остальные файлы без прямого теста (правок ≥ 4), только путь

Замороженные перечислены для полноты — правок не предлагаем.

- src/modules/operator-mobile/domain/view-contracts.ts (12) — ЗАМОРОЖЕНО
- src/components/piling/operator-v2/ui.tsx (11) — ЗАМОРОЖЕНО
- src/components/piling/operator-mobile/screens/admission-screen.tsx (9) — ЗАМОРОЖЕНО
- src/components/piling/admin-reports/report-evidence-row.tsx (8) — см. находку 1
- src/app/operator/v10/operator-v10.css (7) — ЗАМОРОЖЕНО
- src/modules/reports/index.ts (7) — баррель, покрыт через report-query.service
- src/app/operator/v7/operator-v7.css (6) — ЗАМОРОЖЕНО
- src/components/piling/operator-mobile/assistant-app.tsx (6) — ЗАМОРОЖЕНО
- src/components/piling/operator-mobile/v7/v7-ui.tsx (6) — ЗАМОРОЖЕНО
- src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx (6) — исполняется через fleet-screen.tsx:17 → fleet-screen.test.tsx (косвенно)
- src/components/piling/equipment-analytics.tsx (5) — в src/app/(app)/monitoring/__tests__/page.test.tsx:24 глушится
- src/components/piling/operator-mobile/screens/entries-list.tsx (5) — ЗАМОРОЖЕНО
- src/modules/operator-mobile/index.ts (5) — ЗАМОРОЖЕНО (баррель)
- src/components/piling/admin-analytics-bits.tsx (4)
- src/components/piling/admin-dictionaries/dictionary-form.tsx (4)
- src/components/piling/admin-dictionaries/dictionary-table.tsx (4)
- src/app/operator/v5/*.css, operator-v5/page.tsx (4) — ЗАМОРОЖЕНО
- src/components/orion/orion-handoff-site.module.css (4) — ЗАМОРОЖЕНО
- src/components/piling/operator-mobile/operator-concept.css, screens/equipment-tab.tsx, screens/review-screen.tsx, v10/v10-ui.tsx (4) — ЗАМОРОЖЕНО
- src/components/piling/operator-v2/weather-card.tsx (4), operator-v3/operator-dashboard-v3.tsx (4) — ЗАМОРОЖЕНО
- src/components/piling/pile-journal/pile-detail.tsx (4)
- src/components/piling/to/readiness/screens/documents-screen.tsx (4)
- src/components/piling/to/readiness/screens/equipment-permit-matrix.tsx (4)
- src/components/piling/to/readiness/settings/notifications-section.tsx (4)
- src/core/observability/health-tracker/aggregate.ts (4)
- src/modules/readiness/infrastructure/permits/work-permit-repository.ts (4)
- src/modules/safety/index.ts (4) — баррель
- src/workers/unified-worker/pdf.ts (4)

## Не проверено

- **Проценты покрытия не измерялись.** Тесты и `npm run test:coverage` не запускались (запрещено условием задачи). Все числа — это количество правок, строк и `it()/test()`, а не покрытие.
- **Формальность каждого теста не проверена.** Выборочно открыл и прочитал `admin-dashboard.test.tsx`, `admin-sites-hierarchy.test.tsx`, `workspace-settings.test.tsx`, `admin-reports.test.tsx`, `crew-focus.test.tsx`, `audit-service.test.ts`, `downtime-hours.test.ts` — все оказались настоящими поведенческими тестами (рендер + проверка DOM/ответа), не «проверкой моков». Остальные тесты по существу не оценивал.
- **e2e-покрытие моделировал текстовым поиском** по `e2e/**`, `tests/**` (имена путей и модулей). Playwright не запускал — фактическая исполнимость и прохождение e2e не подтверждены.
- **Косвенное покрытие — эвристика** по графу импортов (разворот `@/` и относительных путей + переходы по импортам). Баррели, `export *`, динамические имена и ре-экспорты могут давать как ложные «покрыто», так и ложные «не покрыто»; спорные случаи (pdf-generator, report-export.service) проверил вручную, остальные — нет.
- **Находка 11 (user-detail.tsx)** — статус ГИПОТЕЗА: не проверял, рендерится ли `UserDetail` внутри `admin-users.test.tsx`.
- **Замороженные зоны** (`src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) прочитаны только для метрики; их непокрытость не оценивалась как риск и правок по ним не предлагается.
- Пороговые значения покрытия взяты из `vitest.config.ts:71-86` на момент чтения; соответствие кода этим порогам не проверялось (нужен прогон с покрытием).
