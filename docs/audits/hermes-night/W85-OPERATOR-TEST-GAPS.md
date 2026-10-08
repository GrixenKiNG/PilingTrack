# W85 — пробелы в тестах операторского модуля

## Итог

Пройдены все 109 исходных `.ts`/`.tsx` файлов с `operator` в пути: `src/components/piling/**` (с учётом `operator-dashboard.tsx`, `operator/`, `operator-v2/v3/v5/next/mobile`, `v7/v10`, `admin-equipment/detail/operator-rotation.ts`) и весь `src/modules/operator-mobile/**`. Прямой тест (`__tests__/` или соседний `*.test.*`, импортирующий файл) найден у 63 файлов, отсутствует у 46.

По severity: **критично — 1, важно — 24, мелочь — 21**.

Топ-5 по значимости:
1. `src/modules/operator-mobile/application/mobile-shift-query.ts` (750 строк, критично) — единственное чтение всего экрана оператора, отдаётся через `/api/operator/mobile/state`; ни прямого теста, ни теста маршрута нет.
2. `src/modules/operator-mobile/domain/production-permit.ts` (142) — правило «что запрещает работу» (решение владельца 19.09.2026), без теста.
3. `src/modules/operator-mobile/application/commands/incidents.ts` (166) и `commands/equipment.ts` (161) — команды (происшествия, приёмка техники) без прямого теста, маршрут `/api/operator/mobile/command` тоже не покрыт.
4. `src/components/piling/operator-mobile/assistant-app.tsx` (347) — живёт на боевом маршруте `/assistant`, теста нет.
5. `src/components/piling/operator-mobile/v7/v7-screens.tsx` (543) — набор экранов боевого маршрута `/operator/v7`, теста нет.

Оговорка: часть файлов покрыта Playwright e2e (`e2e/operator-next/*`, `e2e/qa/operator-versions.spec.ts`) и косвенно — через фасад `index.ts`; эта связь не проверялась (см. «Не проверено»).

## Методика

1. Собрал список файлов: рекурсивный обход `src/components/piling/**` и `src/modules/operator-mobile/**`, фильтр по подстроке `operator` в пути, расширения `.ts`/`.tsx`, исключены `*.test.*` и файлы внутри `__tests__/` (это тестовая обвязка, а не код под тестом). Итого 109 файлов.
2. Для каждого файла-кандидата искал прямой тест: собрал все `*.test.ts(x)` под `src/`, из каждого распарсил спецификаторы импорта (`from`, `import(...)`, `require(...)`) и разрешил их относительно файла теста (алиас `@/` → `src/`, относительные пути), с учётом расширений и `index`. Файл считается покрытым, если хоть один тест импортирует именно его путь. Скрипт: временный, вне репозитория (`.../hermes/cache/scratch/scan2.js`), в коммит не попал.
3. Проверил корректность разрешения вручную на выборке (`instructions.test.ts`, `operator-mobile-rules.test.ts`, `offline-queue.test.ts`, `operator-work-overview.test.tsx`) — совпадает.
4. Строки считал `wc -l`.
5. Крупные непокрытые файлы открыл, чтобы отделить боевую логику от типов/баррелей (`view-contracts.ts` — только типы; `mobile-shift-commands.ts` и `index.ts` — реэкспорт-фасады; `production-permit.ts`, `security-checklist-period.ts`, `ppe.ts` — бизнес-правила). Проверил, кто импортирует модуль (`@/modules/operator-mobile`) и какие маршруты подключены (`src/app/(app)/operator/page.tsx`, `src/app/(app)/assistant/page.tsx`, `src/app/operator/v7/page.tsx`, `src/app/operator/v10/page.tsx`, `src/app/api/operator/mobile/*`).

Скрипт воспроизводится командой (при наличии node):
`node <scratch>/scan2.js .` — печатает JSON `{s, lc, hit}` по каждому файлу.

## Находки

Сортировка: сначала файлы **без** теста, крупные сверху. Severity: критично — боевой код в живом маршруте/API; важно — остальной код живого модуля `operator-mobile` и его подкомпонентов; мелочь — замороженные/устаревшие варианты экрана, мелкие табы, типы, баррели.

| # | severity | path:line (строк) | тест | проблема | сценарий / почему важно | предлагаемый тест |
|---|---|---|---|---|---|---|
| 1 | критично | `src/modules/operator-mobile/application/mobile-shift-query.ts:138` (750) | нет | Всё чтение экрана оператора (`queryOperatorMobileState`) не имеет ни юнит-, ни route-теста | Регрессия в сборке состояния (`/api/operator/mobile/state`) уйдёт в прод незамеченной: экран оператора собран из десятков полей (фазы, чек-листы, допуск, запреты, погода-предупреждения) | Юнит на сборку состояния на моках `db` + route-тест `state/route.ts` (успех/ошибка/tенант) |
| 2 | важно | `src/modules/operator-mobile/domain/production-permit.ts:1` (142) | нет | Правило «что запрещает вести работу» без теста | Здесь и решение владельца 19.09.2026 (продолжать операцию нельзя, журнал всегда открыт): ошибочный запрет/разрешение = либо ложная остановка, либо проход при критическом дефекте | Табличный тест `productionPermit`: критический дефект, просроченное удостоверение, отсутствие СИЗ, разрешающие случаи |
| 3 | важно | `src/components/piling/operator-mobile/assistant-app.tsx:1` (347) | нет | Экран помощника на боевом маршруте `/assistant` без теста | `src/app/(app)/assistant/page.tsx:2` рендерит именно его; изменения не ловятся | Render-тест ключевых состояний (загрузка/данные/ошибка) |
| 4 | важно | `src/components/piling/operator-mobile/v7/v7-screens.tsx:1` (543) | нет | Набор экранов боевого маршрута `/operator/v7` без теста | `operator-v7-app.tsx` покрыт (`v7-...test`), а его экраны — нет; регрессия UI уйдёт на живой маршрут | Тесты на рендер основных экранов v7 |
| 5 | важно | `src/components/piling/operator-mobile/v7/v7-identity.tsx:1` (335) | нет | Экран идентификации v7 без теста | Путь начала смены оператора | Render-тест формы идентификации и валидации |
| 6 | важно | `src/components/piling/operator-mobile/v7/assistant-v7-app.tsx:1` (321) | нет | Приложение помощника v7 без теста | Боевой маршрут `src/app/operator/v7/assistant/page.tsx:2` | Render/flow-тест |
| 7 | важно | `src/components/piling/operator-mobile/v7/safety-v7-app.tsx:1` (290) | нет | Приложение ТБ v7 без теста | Боевой маршрут `src/app/operator/v7/safety/page.tsx:2` | Render/flow-тест |
| 8 | важно | `src/components/piling/operator-mobile/v7/v7-ui.tsx:1` (283) | нет | Общие UI-компоненты v7 без теста | Используются всеми экранами v7 | Snapshot/render ключевых компонентов |
| 9 | важно | `src/components/piling/operator-mobile/v10/v10-ui.tsx:1` (198) | нет | UI-компоненты v10 без теста | `operator-v10-app.tsx` покрыт, его UI-слой — нет | Render-тесты компонентов v10 |
| 10 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:1` (166) | нет | Команда регистрации происшествия без прямого теста | Маршрут `/api/operator/mobile/command` не покрыт; происшествие — запись факта, важная для ОТ | Тест команды (валидация, сохранение, ошибки) |
| 11 | важно | `src/modules/operator-mobile/application/assistant-query.ts:1` (161) | нет | Чтение состояния помощника без теста | Маршрут `/api/assistant/state` | Юнит на сборку состояния помощника |
| 12 | важно | `src/modules/operator-mobile/application/commands/equipment.ts:1` (161) | нет | Команда приёмки техники без прямого теста | Начало смены зависит от приёмки | Тест команды acceptEquipment |
| 13 | важно | `src/components/piling/operator-mobile/screens/admission-screen.tsx:1` (201) | нет | Экран допуска (живой `/operator`) без теста | Ключевой экран старта смены | Render/flow-тест допуска |
| 14 | важно | `src/components/piling/operator-mobile/screens/assistant-defect-form.tsx:1` (195) | нет | Форма дефекта помощника без теста | Запись неисправности | Render-тест формы + валидация |
| 15 | важно | `src/components/piling/operator-mobile/screens/review-screen.tsx:1` (181) | нет | Экран проверки/итогов без теста | Показывает данные перед закрытием смены | Render-тест |
| 16 | важно | `src/components/piling/operator-mobile/screens/identity-screen.tsx:1` (142) | нет | Экран идентификации (живой `/operator`) без теста | Вход в смену | Render-тест |
| 17 | важно | `src/components/piling/operator-mobile/screens/entries-list.tsx:1` (133) | нет | Список записей без теста | Отображение выработки/простоев | Render-тест |
| 18 | важно | `src/components/piling/operator-mobile/screens/ppe-screen.tsx:1` (107) | нет | Экран СИЗ без теста | Проверка каски/СИЗ перед работами | Render-тест |
| 19 | важно | `src/components/piling/operator-mobile/screens/documents-panel.tsx:1` (104) | нет | Панель документов без теста | Допуск по удостоверениям | Render-тест |
| 20 | важно | `src/modules/operator-mobile/domain/safety-checklist-period.ts:1` (99) | нет | Периодичность чек-листа ТБ без теста | Кодирует норматив (не каждый день, а по графику) — ошибочный период тихо меняет поведение | Юнит на `safetyChecklistPeriod`/`isPeriodicSafetyStage` |
| 21 | важно | `src/components/piling/operator-mobile/downtime-interval.ts:1` (80) | нет | Компонентная логика простоя без теста | Отличается от покрытого `modules/.../domain/downtime-interval.ts` | Тест границ интервалов |
| 22 | важно | `src/components/piling/operator-mobile/safety/documents-summary.ts:1` (74) | нет | Сводка по документам без теста | Влияет на допуск | Юнит на сводку |
| 23 | важно | `src/modules/operator-mobile/domain/ppe.ts:1` (64) | нет | Каталог СИЗ и правило шага без теста | Решение владельца «нехватка не запирает экран» — легко сломать | Юнит на правило прохождения шага СИЗ |
| 24 | важно | `src/components/piling/operator-mobile/safety/known-answers.ts:1` (62) | нет | Банк ответов ТБ (часть) без теста | Проверяемые ответы по ТБ | Юнит сверки ответов |
| 25 | важно | `src/modules/operator-mobile/application/defect-views.ts:1` (57) | нет | Преобразование дефектов в вид для телефона без теста | Общий код двух экранов — расхождение подписей | Юнит `toDefectViews` |
| 26 | мелочь | `src/components/piling/operator-dashboard.tsx:1` (604) | нет | Старый дашборд оператора (документированный rollback-путь) без теста | Заморожен (AGENTS.md §1), живого маршрута нет | Не требуется; тест только при возврате варианта |
| 27 | мелочь | `src/components/piling/operator-next/checklist-run.tsx:1` (448) | нет | Компонент чек-листа варианта operator-next без теста | Вариант/заморожено | Тест при выборе варианта |
| 28 | мелочь | `src/components/piling/operator-next/passport-form.tsx:1` (355) | нет | Форма паспорта сваи operator-next без теста | Вариант/заморожено | Тест при выборе варианта |
| 29 | мелочь | `src/components/piling/operator-mobile/v7/history-v7-app.tsx:1` (181) | нет | Приложение истории v7 без теста | Боевой маршрут `src/app/operator/v7/history/page.tsx:2`, но вариант | Render-тест |
| 30 | мелочь | `src/components/piling/operator-v2/sheets.tsx:1` (281) | нет | Шторки v2 без теста | Замороженный вариант | Не требуется |
| 31 | мелочь | `src/components/piling/operator-v3/operator-dashboard-v3.tsx:1` (200) | нет | Дашборд v3 без теста | Замороженный вариант | Не требуется |
| 32 | мелочь | `src/components/piling/operator-v2/ui.tsx:1` (208) | нет | UI v2 без теста | Замороженный вариант | Не требуется |
| 33 | мелочь | `src/components/piling/operator-v2/weather-card.tsx:1` (207) | нет | Погодная карточка v2 без теста | Замороженный вариант | Не требуется |
| 34 | мелочь | `src/components/piling/operator/meter-reading-dialog.tsx:1` (185) | нет | Диалог снятия показаний старого дашборда без теста | Rollback-путь | Не требуется |
| 35 | мелочь | `src/components/piling/operator-v2/defect-sheet.tsx:1` (171) | нет | Лист дефекта v2 без теста | Замороженный вариант | Не требуется |
| 36 | мелочь | `src/components/piling/operator/handover-dialog.tsx:1` (104) | нет | Диалог передачи смены (старый дашборд) без теста | Rollback-путь | Не требуется |
| 37 | мелочь | `src/components/piling/operator/shift-step-card.tsx:1` (101) | нет | Карточка шага смены (старый дашборд) без теста | Rollback-путь | Не требуется |
| 38 | мелочь | `src/components/piling/operator-document-reminder.tsx:1` (94) | нет | Напоминание о документах без теста | Отдельный компонент, вне вариантов | Тест рендера/условия показа (если жив) |
| 39 | мелочь | `src/components/piling/operator-mobile/screens/safety-tab.tsx:1` (82) | нет | Вкладка ТБ без теста | Мелкий подкомпонент | Render при необходимости |
| 40 | мелочь | `src/components/piling/operator/shift-task-screen.tsx:1` (73) | нет | Экран задачи смены (старый дашборд) без теста | Rollback-путь | Не требуется |
| 41 | мелочь | `src/components/piling/operator-mobile/screens/equipment-tab.tsx:1` (58) | нет | Вкладка техники без теста | Мелкий подкомпонент | Render при необходимости |
| 42 | мелочь | `src/components/piling/operator-mobile/screens/profile-tab.tsx:1` (56) | нет | Вкладка профиля без теста | Мелкий подкомпонент | Render при необходимости |
| 43 | мелочь | `src/modules/operator-mobile/domain/view-contracts.ts:1` (292) | нет | Только описания типов (ни одного исполняемого значения, по комментарию файла) | Тест не нужен | Не требуется |
| 44 | мелочь | `src/modules/operator-mobile/domain/defect-labels.ts:1` (37) | нет | Словари слов для уровней неисправности без теста | Статичные метки | Юнит на покрытие всех уровней (по желанию) |
| 45 | мелочь | `src/modules/operator-mobile/application/mobile-shift-commands.ts:1` (36) | нет | Реэкспорт-фасад (комментарий: «бочка, а не код») | Логика вынесена в `commands/*` | Не требуется |
| 46 | мелочь | `src/modules/operator-mobile/index.ts:1` (22) | нет | Фасад модуля (реэкспорт) | Логики нет | Не требуется |

## Приложение: файлы с найденным тестом

Формат: файл | строк | тест.

| файл | строк | тест |
|---|---|---|
| src/components/piling/operator-mobile/v10/operator-v10-app.tsx | 1717 | src/components/piling/operator-mobile/v10/__tests__/operator-v10-flow.test.tsx |
| src/components/piling/operator-v5/operator-v5-app.tsx | 1313 | src/components/piling/operator-v5/__tests__/operator-v5-app.test.tsx |
| src/components/piling/operator-v2/operator-shift-v2.tsx | 1257 | src/components/piling/operator-v2/__tests__/operator-shift-v2.test.tsx |
| src/components/piling/operator-mobile/operator-mobile-app.tsx | 1005 | src/components/piling/operator-mobile/__tests__/operator-mobile-app.test.tsx |
| src/components/piling/operator-next/operator-next-app.tsx | 989 | src/components/piling/operator-next/__tests__/operator-next-app.test.tsx |
| src/components/piling/operator-mobile/api.ts | 754 | src/components/piling/operator-mobile/offline-queue.test.ts (и __tests__/api.test.ts) |
| src/components/piling/operator-mobile/v7/operator-v7-app.tsx | 569 | src/components/piling/operator-mobile/v7/__tests__/operator-v7-app.test.tsx |
| src/modules/operator-mobile/domain/checklist-catalog.ts | 559 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/modules/operator-mobile/application/commands/production.ts | 552 | src/modules/operator-mobile/application/commands/__tests__/production.test.ts |
| src/components/piling/operator-mobile/screens/checklist-screen.tsx | 539 | src/components/piling/operator-mobile/screens/checklist-screen.test.tsx |
| src/components/piling/operator-mobile/screens/work-screen.tsx | 526 | src/components/piling/operator-mobile/screens/__tests__/work-screen.test.tsx |
| src/components/piling/operator-mobile/v7/v7-shift.tsx | 482 | src/components/piling/operator-mobile/v7/__tests__/v7-shift.test.tsx |
| src/modules/operator-mobile/domain/knowledge-bank.ts | 481 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-mobile/offline-queue.ts | 476 | src/components/piling/operator-mobile/offline-queue-banner.test.tsx |
| src/components/piling/operator-next/work.tsx | 460 | src/components/piling/operator-next/__tests__/operator-next-rules.test.tsx |
| src/modules/operator-mobile/application/commands/shared.ts | 431 | src/modules/operator-mobile/application/commands/__tests__/production.test.ts |
| src/components/piling/operator-mobile/screens/pile-passport-form.tsx | 405 | src/components/piling/operator-mobile/screens/__tests__/pile-passport-form.test.tsx |
| src/modules/operator-mobile/application/commands/admission.ts | 355 | src/modules/operator-mobile/application/commands/__tests__/admission.test.ts |
| src/components/piling/operator-mobile/ui.tsx | 345 | src/components/piling/operator-mobile/ui.test.tsx |
| src/modules/operator-mobile/application/commands/shift-close.ts | 341 | src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts |
| src/components/piling/operator-mobile/screens/incidents-tab.tsx | 312 | src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx |
| src/modules/operator-mobile/application/commands/checklist.ts | 310 | src/modules/operator-mobile/application/commands/__tests__/checklist.test.ts |
| src/modules/operator-mobile/domain/pile-passport.ts | 281 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/modules/operator-mobile/domain/work-warnings.ts | 275 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-next/shift-start.tsx | 256 | src/components/piling/operator-next/__tests__/operator-next-rules.test.tsx |
| src/components/piling/operator-v2/shift-flow.ts | 253 | src/components/piling/operator-v2/__tests__/shift-flow.test.ts |
| src/components/piling/operator-mobile/screens/closing-screen.tsx | 233 | src/components/piling/operator-mobile/screens/closing-screen.test.tsx |
| src/components/piling/operator-mobile/screens/knowledge-screen.tsx | 224 | src/components/piling/operator-mobile/screens/__tests__/knowledge-screen.test.tsx |
| src/components/piling/operator-next/report-send.tsx | 223 | src/components/piling/operator-next/__tests__/operator-next-rules.test.tsx |
| src/components/piling/operator-next/parts.tsx | 217 | src/components/piling/operator-next/__tests__/operator-next-rules.test.tsx |
| src/modules/operator-mobile/application/commands/production-corrections.ts | 216 | src/modules/operator-mobile/application/commands/__tests__/production-corrections.test.ts |
| src/components/piling/operator-next/drafts.ts | 188 | src/components/piling/operator-next/__tests__/draft-storage.test.ts |
| src/components/piling/operator/shift-phase.ts | 184 | src/components/piling/operator/__tests__/shift-phase.test.ts |
| src/components/piling/operator-mobile/offline-queue-banner.tsx | 182 | src/components/piling/operator-mobile/offline-queue-banner.test.tsx |
| src/modules/operator-mobile/domain/shift-phases.ts | 165 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/modules/operator-mobile/application/briefing-journal-query.ts | 157 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-mobile/warnings-panel.tsx | 140 | src/components/piling/operator-mobile/__tests__/field-readability.test.tsx |
| src/modules/operator-mobile/domain/briefing-journal-view.ts | 140 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/modules/operator-mobile/domain/checklist-run.ts | 135 | src/modules/operator-mobile/application/commands/__tests__/checklist.test.ts |
| src/modules/operator-mobile/domain/incidents.ts | 125 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-next/draft-storage.ts | 124 | src/components/piling/operator-next/__tests__/draft-storage.test.ts |
| src/modules/operator-mobile/domain/operator-admission.ts | 123 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-next/admission.tsx | 121 | src/components/piling/operator-next/__tests__/operator-next-rules.test.tsx |
| src/modules/operator-mobile/domain/checklist-types.ts | 121 | src/modules/operator-mobile/application/commands/__tests__/checklist.test.ts |
| src/modules/operator-mobile/domain/shift-conditions.ts | 118 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-mobile/safety/admission-steps.ts | 117 | src/components/piling/operator-mobile/ui.test.tsx |
| src/modules/operator-mobile/domain/hazard-classification.ts | 116 | src/modules/operator-mobile/domain/__tests__/hazard-classification.test.ts |
| src/modules/operator-mobile/domain/slinger-briefing.ts | 101 | src/modules/safety/__tests__/instructions.test.ts |
| src/components/piling/operator-mobile/operator-status-strip.tsx | 96 | src/components/piling/operator-mobile/ui.test.tsx |
| src/components/piling/operator-mobile/use-offline-queue.ts | 86 | src/components/piling/operator-mobile/__tests__/use-offline-queue.test.tsx |
| src/components/piling/operator-mobile/screens/briefing-screen.tsx | 85 | src/components/piling/operator-mobile/screens/__tests__/briefing-screen.test.tsx |
| src/modules/operator-mobile/domain/safety-briefing.ts | 85 | src/modules/safety/__tests__/instructions.test.ts |
| src/components/piling/operator-next/words.ts | 81 | src/components/piling/operator-next/__tests__/operator-next-rules.test.tsx |
| src/modules/operator-mobile/domain/operator-credentials.ts | 76 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/modules/operator-mobile/domain/shift-window.ts | 72 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/components/piling/operator-mobile/operator-work-overview.tsx | 63 | src/components/piling/operator-mobile/operator-work-overview.test.tsx |
| src/components/piling/operator-next/queue-snapshot.ts | 61 | src/components/piling/operator-next/__tests__/queue-snapshot.test.ts |
| src/components/piling/admin-equipment/detail/operator-rotation.ts | 58 | src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts |
| src/modules/operator-mobile/domain/downtime-interval.ts | 53 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts |
| src/modules/operator-mobile/contracts.ts | 51 | src/components/piling/operator-mobile/operator-work-overview.test.tsx |
| src/components/piling/operator-next/command-keys.ts | 43 | src/components/piling/operator-next/__tests__/command-keys.test.ts |
| src/components/piling/operator-next/single-flight.ts | 39 | src/components/piling/operator-next/__tests__/single-flight.test.ts |
| src/modules/operator-mobile/application/knowledge-attempt.ts | 31 | src/modules/operator-mobile/application/knowledge-attempt.test.ts |

## Не проверено

- **Косвенное покрытие через фасад `index.ts`.** Многие файлы `src/modules/operator-mobile/**` не импортируются тестами напрямую, но могут исполняться внутри покрытых команд/запросов. Сопоставление «какой тест задевает какой файл косвенно» не делалось.
- **e2e (Playwright).** В репозитории есть `e2e/operator-next/*.spec.ts`, `e2e/qa/operator-versions.spec.ts`, `e2e/qa-ac/operator-everywhere.spec.ts` и др. (28 spec-файлов). Какие из непокрытых компонентов они реально гоняют — не проверял (задача ограничена поиском в `__tests__/` и соседних `*.test.*`).
- **Фактический прогон тестов не делался** (задача read-only, тесты не запускались), поэтому «тест найден» = «файл импортируется тестом», а не «поведение реально проверяется». Глубину покрытий внутри найденных тестов не оценивал.
- **`operator-mobile/__tests__/api.test.ts` (933 строки)** — какому набору поведения он соответствует (api.ts покрыт по крайней мере двумя файлами), не разбирал.
- Замороженные области (`operator/**`, варианты экрана, ORION) не анализировались глубже факта отсутствия теста; правок не вносилось.
