# N17-08. Инвентаризация вариантов экрана машиниста (v2, v3, v5, v7, v10, мобильный, откат)

Дата: 2026-10-17. Ветка: `hermes/code-1011`, HEAD на момент работы `b33030eab43e18890a7c5ed1f7692fd089d1517d` (main `1d24e24f` — предок HEAD).
Метод: только чтение кода; приложение не запускалось, браузер не поднимался, прод не трогался. Frozen-зоны (варианты экрана оператора, сайт ORION) читались на чтение, ничего в них не изменено и не предлагается удалять как «мёртвое».

## Сводка для владельца (5 строк)

1. Параллельно живут семь разных экранов машиниста: живой `/operator` (мобайл), четыре версии-кандидата `/operator/v2`, `/operator/v3`, `/operator/v5`, `/operator/v7`(+3 подстраницы), `/operator/v10`, плюс замороженный путь отката `operator-dashboard.tsx`.
2. v3 — не версия, а заглушка: экран есть, а ~46 объявленных артефактов (API, модуль, миграции, e2e) отсутствуют, релизный гейт `npm run operator:v3:preflight` падает (exit=1).
3. Полного набора функций нет ни у одного кандидата: приём передачи смены и заведение дефекта — только у v2; блокировка «смену не сдал другой машинист» — только у v5; подстраницы истории/ТБ — только у v7; личные допуски — у v7 и v10.
4. Общая логика переиспользуется частично: чек-лист/СИЗ/инструктаж/оффлайн-очередь общие у базы, v2, v7, v10, но v5 держит свои копии — правка общего чек-листа до v5 не доходит.
5. Обработка отказов «поехала» по вариантам: на v5/v7 отказ по роли — тупик без кнопки, на v10 отказ по роли замаскирован под «нет связи» с «Повторить», а v5 ещё и не различает истёкшую сессию.

## Итог

* Находок в таблице: **16**. Критично (P0) — **0**, важно (P1) — **9**, мелочь (P2) — **7**. Дополнительных строк-находок нет; полный список точек в приложении.
* Топ-5 по важности: №1 (`/operator/v3` без проверки роли, у v2 проверка есть), №2 (v3 — заглушка, гейт `operator:v3:preflight` = 46 отсутствующих артефактов), №3 (отказ по роли на v7/v5 — тупик без выхода), №4 (v10 маскирует отказ по роли под «нет связи» + «Повторить»), №6 (v5 дублирует общий чек-лист/СИЗ/инструктаж).
* Критичных (блокирующих смену на живом экране) находок нет: живой экран `/operator` — база, а не один из кандидатов. Все находки — про кандидатов и их расхождения.
* Семь вариантов отличаются не оформлением, а составом функций и обработкой ошибок. Ключевые уникаты: v2 — приём передачи (`/api/readiness/handovers/{id}/accept`, `operator-shift-v2.tsx:717`) и дефект (`defect-sheet.tsx:54`); v5 — `blockedShift` (`operator-v5-app.tsx:370`); v7 — подстраницы `history`/`safety`/`assistant`; v10 — личные допуски (`:1453`) и погода (`:353`).
* Общий код: чек-лист `screens/checklist-screen.tsx` (с фото) и оффлайн-очередь `use-offline-queue.ts` переиспользуют база, v2, v7, v10; v5 держит свой чек-лист/СИЗ/инструктаж (`operator-v5-app.tsx:399,164,212`).
* Замороженный откат `src/components/piling/operator-dashboard.tsx` (570 строк) + `src/components/piling/operator/**` (6 файлов, 710 строк) — отдельный контур на `OperatorShiftFacts` (`/api/operator/shift`), `RunInspection`, `ReportForm`; мобильные команды не использует. Не удалять.
* Всё измерено командами из «Методики»; не проверенное помечено в разделе «Не проверено».

## Методика

Точки входа и состав (файлы читались и считались командами из блока ниже):

| Вариант | Маршрут / точка входа | Внутри `(app)`? | Кто попадает | Компоненты |
| --- | --- | --- | --- | --- |
| база | `/operator` — `src/app/(app)/operator/page.tsx:2` → `OperatorMobileApp` | да | `OPERATOR` (и роль по умолчанию) | `src/components/piling/operator-mobile/**` (общий) |
| v2 | `/operator/v2` — `src/app/(app)/operator/v2/page.tsx:3` (роль: только `OPERATOR`, строки 13-15) → `OperatorShiftV2` | да | `OPERATOR` | `src/components/piling/operator-v2/**` + общий мобайл |
| v3 | `/operator/v3` — `src/app/(app)/operator/v3/page.tsx:3` (проверки роли нет) → `OperatorDashboardV3`; `/operator/v3/report` → общий `ReportForm` | да | любая роль `(app)` | `src/components/piling/operator-v3/operator-dashboard-v3.tsx` |
| v5 | `/operator/v5` — `src/app/operator/v5/page.tsx:3` → `OperatorV5App` | нет (вне `(app)`) | по прямой ссылке | `src/components/piling/operator-v5/operator-v5-app.tsx` |
| v7 | `/operator/v7` — `src/app/operator/v7/page.tsx:2` → `OperatorV7App`; подстраницы `/operator/v7/{assistant,history,safety}` | нет | по прямой ссылке | `src/components/piling/operator-mobile/v7/**` |
| v10 | `/operator/v10` — `src/app/operator/v10/page.tsx:2` → `OperatorV10App` | нет | по прямой ссылке | `src/components/piling/operator-mobile/v10/**` |
| откат | `src/components/piling/operator-dashboard.tsx:47` (заморожено) | — | не подключён (путь отката) | `operator-dashboard.tsx` + `src/components/piling/operator/**` |

Проверенные числа (команды ниже, PowerShell-эквиваленты `Get-ChildItem`/`Measure-Object`/`Select-String`):

| Вариант | .ts/.tsx файлов | строк ts/tsx | тест-файлов | кейсов `it/test` | .css файлов | строк css |
| --- | --- | --- | --- | --- | --- | --- |
| база+общий мобайл (без v7/v10) | 57 | 11257 | 22 | 218 | — | — |
| v2 | 12 | 3220 | 4 | 36 | 0 | 0 |
| v3 | 3 | 203 | 0 | 0 | 0 | 0 |
| v5 | 3 | 2180 | 1 | 30 | 2 | 774 |
| v7 | 16 | 3209 | 4 | 18 | 1 | 559 |
| v10 | 6 | 2743 | 2 | 36 | 1 | 227 |
| `src/modules/operator-mobile/**` | 53 | 9489 | 14 | 145 | 0 | 0 |
| откат (`operator-dashboard.tsx`+`operator/**`) | 7 | 1280 | 1 | 12 | — | — |

Тест-файлы v2: `src/app/(app)/operator/v2/page.test.tsx`, `src/components/piling/operator-v2/__tests__/{operator-shift-v2.test.tsx,shift-flow.test.ts,step-bar-model.test.ts}`. v5: `operator-v5-app.test.tsx`. v7: `operator-mobile/v7/__tests__/{operator-v7-app,assistant-v7-app,v7-screens,v7-shift}.test.tsx`. v10: `operator-mobile/v10/__tests__/{operator-v10-flow,operator-v10-port}.test.tsx`.

Как перепроверить (из корня репозитория):

```powershell
# 1. Кто и как попадает на экраны оператора
Select-String -Path 'src\lib\routes.ts' -Pattern 'OPERATOR_HOME_ROUTE|ASSISTANT_HOME_ROUTE|roleHomeRoute'
Get-Content 'src\app\(app)\layout.tsx'                                  # роль → OperatorLayout/AdminLayout
Get-Content 'src\app\(app)\operator-layout-policy.ts'                   # где не рисуется общая нижняя навигация
# 2. Роль на страницах-вариантах
Select-String -Path 'src\app\(app)\operator\v2\page.tsx' -Pattern "role !== 'OPERATOR'"
# 3. Релизный гейт v3 (46 отсутствующих артефактов, exit=1)
npm run operator:v3:preflight ; $LASTEXITCODE
# 4. Обработка 401/403 по вариантам
Select-String -Path 'src\components\piling\operator-mobile\operator-mobile-app.tsx' -Pattern 'status === 401|status === 403'
Select-String -Path 'src\components\piling\operator-v5\operator-v5-app.tsx'        -Pattern 'status === 403|status === 401'
Select-String -Path 'src\components\piling\operator-mobile\v7\operator-v7-app.tsx' -Pattern 'forbidden|status === 401|status === 403'
Select-String -Path 'src\components\piling\operator-mobile\v10\operator-v10-app.tsx' -Pattern 'status === 401|status === 403|loadError'
# 5. Кто какой чек-лист/СИЗ использует
Select-String -Path 'src\components\piling\operator-v5\operator-v5-app.tsx' -Pattern 'function ChecklistScreen|PpeScreenV5|BriefingScreenV5'
Select-String -Path 'src\components\piling\operator-mobile\v7\v7-shift.tsx' -Pattern 'SharedChecklistScreen'
# 6. Уникаты
Select-String -Path 'src\components\piling\operator-v2\operator-shift-v2.tsx' -Pattern 'handovers|/api/operator/shift'
Select-String -Path 'src\components\piling\operator-v5\operator-v5-app.tsx' -Pattern 'blockedShift'
Select-String -Path 'src\components\piling\operator-mobile\v10\operator-v10-app.tsx' -Pattern '/api/safety/my-clearance'
# 7. Счётчики (пример)
Get-ChildItem -Recurse -File 'src\components\piling\operator-v5' | Measure-Object
```

## Матрица «функция × вариант»

Символы: ✔ есть, ✖ нет, «показ» — только отображение без создания. Ссылки — минимальные `path:line`.

| Функция | база | v2 | v3 | v5 | v7 | v10 |
| --- | --- | --- | --- | --- | --- | --- |
| Приёмка смены (`accept-equipment`) | ✔ `operator-mobile-app.tsx:934` | ✔ `operator-shift-v2.tsx:692,749` | ✖ | ✔ `operator-v5-app.tsx:1496` | ✔ `operator-v7-app.tsx:353` | ✔ `operator-v10-app.tsx:1505` |
| Выработка (`log-production`) | ✔ `:874,949` | ✔ `:637` | ✖ | ✔ `:1253` | ✔ `:389` | ✔ `:1574` |
| Осмотр ЕО (чек-лист, `submit-checklist`) | ✔ `:892` | ✔ `:1148` | ✖ | ✔ своя копия `:399` | ✔ общий `v7-shift.tsx:119` | ✔ `:686,1630` |
| Простой (запись `DOWNTIME`) | ✔ | ✔ `sheets.tsx:266` | ✖ | ✔ test `operator-v5-app.test.tsx:681` | ✔ | ✔ test `operator-v10-port.test.tsx:323` |
| Инструктаж (`acknowledge-briefing`) | ✔ `:845` | ✔ `:837` | ✖ | ✔ своя копия `:1361` | ✔ `:335` | ✔ `:1521` |
| СИЗ (`confirm-ppe`) | ✔ `:828` | ✔ `:827` | ✖ | ✔ своя копия `:1347` | ✔ `:325` | ✔ `:1517` |
| Знания (`submit-knowledge`) | ✔ `:860` | ✔ `:847` | ✖ | ✔ `:1375` | ✔ `:343` | ✔ `:1526` |
| Происшествие (`report-incident`) | ✔ `:767` | ✔ `:514` | ✖ | ✔ `:1245` | ✔ `:404` | ✔ `:1540` |
| Завершение/сдача (`finish-work`/`close-shift`) | ✔ `:671,973` | ✔ `:915,779` | ✖ | ✔ `:1447,1538` | ✔ `:287,425` | ✔ `:1598,1608` |
| Фото (`uploadPhoto`) | ✔ общий `checklist-screen.tsx:417` | ✔ общий | ✖ | ✔ свой `:1191` | ✔ общий `v7-shift.tsx:119` | ✔ общий |
| Паспорт сваи (`PILE_PASSPORT`) | ✔ `work-screen.tsx:380` | ✔ `:1318` | ✖ | ✔ `:831` | ✔ `v7-shift.tsx:229` | ✔ `:484` |
| Моточасы (`engineHours`) | ✔ общий | ✔ `:1042` | ✖ | ✔ `:390` | ✔ `v7-screens.tsx:314` | ✔ `:342` |
| Погода | ✔ `admission-screen.tsx:139` | ✔ `weather-card.tsx` | ✖ | ✖ | ✔ `v7-screens.tsx:326` | ✔ `:353` |
| Оффлайн-очередь | ✔ `:490` | ✔ `ui.tsx:44` | ✖ | ✔ `:1131` | ✔ `:136` | ✔ `:1495` |
| Черновики форм (`useLocalFormDraft`) | ✔ `work-screen.tsx:79` | ✔ `sheets.tsx:97` | ✖ | ✔ `:703` | ✔ `:159` | ✔ `:405` |
| «Поправить» (`correct-production`) | ✔ `:755` | ✔ `operator-work-overview.tsx:74` | ✖ | ✔ `:1261` | ✔ `:234` | ✔ `:1586` |
| «Повторить» (перечитать) | ✔ `:549` | ✔ | ✖ | ✔ `:1284` | ✔ `:214` | ✔ `:1740` |
| Сдача старой смены | ✖ | ✔ `:1009` | ✖ | ✔ `:1441` | ✖ | ✔ `:1739` |
| Приём передачи (handover) | ✖ | ✔ `:717` | ✖ | ✖ | ✖ | ✖ |
| Создание дефекта | показ (создаёт помощник `assistant-app.tsx:326`) | ✔ `defect-sheet.tsx:54` | ✖ | показ `:1386` | показ `v7-screens.tsx:461` | показ `:616` |
| Отчёт отдельной формой | ✖ | ✖ | ✔ `v3/report/page.tsx:9` | ✖ | ✖ | ✖ |
| История отчётов | ✖ | ✖ | ✖ | ✖ | ✔ `history-v7-app.tsx:37` | ✖ |
| Мои допуски ТБ | ✖ | ✖ | ✖ | ✖ | ✔ `safety-v7-app.tsx:60` | ✔ `:1453` |

## Что уникально и что потеряется

Уникальные функции по вариантам:

* **v2** — единственный с приёмом передачи смены (`/api/readiness/handovers/{id}/accept`, `operator-shift-v2.tsx:717`) и с созданием дефекта (`/api/readiness/defects`, `defect-sheet.tsx:54`); есть сдача старой смены (`:1009`); читает `OperatorShiftFacts` (`/api/operator/shift`, `:354`).
* **v3** — единственный на отдельной форме отчёта (`ReportForm` → `/api/reports/upsert`); фактически заглушка (см. находку №2).
* **v5** — единственный с `blockedShift` («другой машинист не сдал смену за …», `:370`) и со своими копиями чек-листа/СИЗ/инструктажа (`:399,164,212`).
* **v7** — единственный с подстраницами истории отчётов (`history-v7-app.tsx:37`), «моих допусков» (`safety-v7-app.tsx:60`) и вторым экраном помощника (`assistant-v7-app.tsx:57,72`).
* **v10** — показывает личные допуски прямо на экране (`:1453`) и погоду (`:353`); использует общий чек-лист и общую оффлайн-очередь.
* **база `/operator`** — самый широкий контур ТБ на живом экране: вкладки происшествий/СИЗ/инструктажа/знаний/ТБ (`:784,800,824,842,853`), общий чек-лист с фото и моточасами.

Что потеряется, если оставить по одному варианту:

* Оставить только **базу**: теряется приём передачи, заведение дефекта, сдача старой смены, история отчётов, личные допуски. Сохраняется самый полный контур ТБ и общий чек-лист.
* Оставить только **v2**: теряется погода? нет (есть), теряется — история отчётов, личные допуски; есть приём передачи и дефект. Сохраняются уникальные передача и дефект, которых нет больше нигде.
* Оставить только **v3**: сохранять нечего — экран заглушка (список объектов и отчётов), релизный гейт падает.
* Оставить только **v5**: теряются погода, приём передачи, дефект, погодная подсказка; сохраняется `blockedShift` и свои копии чек-листа/СИЗ.
* Оставить только **v7**: теряются приём передачи, дефект, сдача старой смены; сохраняются подстраницы истории/ТБ/помощника; отказ по роли — тупик.
* Оставить только **v10**: теряются приём передачи, дефект, сдача старой смены? нет (есть `:1739`); теряется — история отчётов, отдельный помощник; отказ по роли замаскирован под «нет связи».
* Замороженный **откат** (`operator-dashboard.tsx`) — единственный на 7-шаговом контуре `OperatorShiftFacts` + `RunInspection` + `ReportForm`; держится как путь отката, не удалять.

## Находки

Severity: критично (P0) — блокирует смену/ложная или чужая запись; важно (P1) — вероятная ошибка или потеря функции; мелочь (P2) — расхождение/шлифовка.

| # | severity | path:line | проблема | сценарий | что менять |
| --- | --- | --- | --- | --- | --- |
| 1 | важно (P1) | `src/app/(app)/operator/v3/page.tsx:1-11` | Страница v3 не проверяет роль — у соседнего v2 проверка есть (`src/app/(app)/operator/v2/page.tsx:13-15`). В `(app)` помощник получает операторскую оболочку (`src/app/(app)/layout.tsx:298`). | Помощник по прямой ссылке `/operator/v3` видит экран машиниста и кнопку «Отправить отчёт» → `/operator/v3/report`. | Добавить проверку роли, как в v2 (серверную защиту API отчёта отдельно проверить — см. «Не проверено»). |
| 2 | важно (P1) | `scripts/operator-v3-preflight.ts:9-61`; гейт `npm run operator:v3:preflight` | v3 — заглушка: гейт перечисляет **46** отсутствующих артефактов (API `/api/operator/v3/*`, `src/modules/operator-v3/**`, ~5 миграций, e2e), exit=1. Существуют только `page.tsx`, `report/page.tsx`, `operator-dashboard-v3.tsx`. | v3 нельзя выпустить; при включении в навигацию экран будет почти пустым. | Либо реализовать артефакты, либо пометить v3 как незапущенный прототип и убрать гейт/навигацию. |
| 3 | важно (P1) | `src/components/piling/operator-mobile/v7/operator-v7-app.tsx:197-206`; `src/components/piling/operator-v5/operator-v5-app.tsx:1265-1277` | Экран «отказ по роли» (403) у v7 и v5 — только текст, без кнопки. База даёт выход: «Войти другим пользователем» (`operator-mobile-app.tsx:518`). | Помощник на `/operator/v7` или `/operator/v5` в тупике: ни «Повторить», ни выхода; v7/v5 вне `(app)`, общей шапки с «Выйти» нет. | Дать кнопку выхода (logout), как в базе. |
| 4 | важно (P1) | `src/components/piling/operator-mobile/v10/operator-v10-app.tsx:1434-1440,1740` | v10 обрабатывает 401 (→ `/login`), но 403 уходит в общий `loadError` → «Состояние смены недоступно» + «Повторить». Братские экраны 403 выделяют отдельно (`operator-mobile-app.tsx:259`, `operator-v7-app.tsx:106`, `operator-v5-app.tsx:1050`). | Не-машинист на `/operator/v10` видит «сбой» и жмёт «Повторить» бесконечно — отказ по роли замаскирован под обрыв связи. | Отдельная ветка 403 с текстом про роль. |
| 5 | важно (P1) | `src/components/piling/operator-v5/operator-v5-app.tsx:1047-1058,1278-1285` | v5 не обрабатывает 401: истёкшая сессия показана как «Нет связи с сервером» + «Повторить». База редиректит на `/login` (`operator-mobile-app.tsx:252-254`), v7 `operator-v7-app.tsx:99-101`, v10 `:1434`. | Сессия истекла — «Повторить» не помогает, машинист застрял на «нет связи». | Добавить ветку 401 → `/login`. |
| 6 | важно (P1) | `src/components/piling/operator-v5/operator-v5-app.tsx:399,164,212` | v5 держит собственные чек-лист, СИЗ и инструктаж вместо общих (`screens/checklist-screen.tsx`, `screens/ppe-screen.tsx`, `screens/briefing-screen.tsx`). Общий чек-лист используют база (`operator-mobile-app.tsx:892`), v2 (`operator-shift-v2.tsx:1148`), v7 (`v7-shift.tsx:119`), v10 (`operator-v10-app.tsx:686,1630`). | Правка общего чек-листа (пункты, снимки, моточасы) до v5 не доходит — поведение в v5 расходится с остальными. | Перевести v5 на общие компоненты или зафиксировать, что v5 заморожен. |
| 7 | важно (P1) | `src/components/piling/operator-v2/operator-shift-v2.tsx:717`; `src/components/piling/operator-v2/defect-sheet.tsx:54` | Приём машины по передаче (`/api/readiness/handovers/{id}/accept`) и заведение дефекта (`/api/readiness/defects`) есть только в v2; остальные дефекты только показывают. | Любой выбор, кроме v2, теряет приёмку по передаче и создание дефекта с телефона машиниста. | Решить: перенести передачу/дефект в выбранный вариант либо явно исключить. |
| 8 | важно (P1) | `operator-shift-v2.tsx:1009`; `operator-v5-app.tsx:1441`; `operator-v10-app.tsx:1739` | «Сдача старой (незакрытой) смены» есть у v2/v5/v10; у базы `/operator` и v7 — нет (в v7 нет ни `oldShift`, ни «Сдать смену за»). | На базе и v7 незакрытая прошлая смена не видна и не сдаётся — расхождение учёта смен. | Добавить в базу/v7 либо считать это осознанным. |
| 9 | важно (P1) | `src/components/piling/operator-v5/operator-v5-app.tsx:370-380` | Признак `blockedShift` («другой машинист не сдал смену за …») использует только v5; v2/v10 вычисляют старую смену сравнением дат (`operator-shift-v2.tsx:428`, `operator-v10-app.tsx:1409`), база/v7 — вовсе нет. | На базе/v7 (и иначе на v2/v10) можно принять установку, не зная, что смену за неё не закрыл предыдущий. | Унифицировать правило блокировки приёмки. |
| 10 | мелочь (P2) | `operator-mobile/v7/assistant-v7-app.tsx:57,72` vs `operator-mobile/assistant-app.tsx` | `/operator/v7/assistant` — второй экран помощника: те же `/api/assistant/*`, но своя реализация; есть и «основной» `/assistant` (`src/app/(app)/assistant/page.tsx:2`). | Два экрана помощника расходятся; правки одного не видны на другом. | Свести к одному экрану помощника. |
| 11 | мелочь (P2) | `operator-mobile/v7/history-v7-app.tsx:37`; `safety-v7-app.tsx:60`; `operator-v10-app.tsx:1453` | История отчётов (`/api/reports/my`) есть только у v7; «мои допуски» (`/api/safety/my-clearance`) — только у v7 и v10. База/v2/v5 личных допусков не показывают. | При выборе другого варианта теряется просмотр личных допусков и истории отчётов. | Учесть при выборе варианта. |
| 12 | мелочь (P2) | `src/app/(app)/operator/v3/report/page.tsx:9`; `operator-v3/operator-dashboard-v3.tsx:93` | v3 пишет отчёт общим `ReportForm` → `/api/reports/upsert` — иной контур записи, чем команды мобильного экрана (`/api/operator/mobile/command`). | Отчёты v3 идут не через команды и не через оффлайн-очередь мобильного экрана. | Осознанно: v3 — отдельный контур (документировать). |
| 13 | мелочь (P2) | `src/components/piling/operator-v2/operator-shift-v2.tsx:354,366` | v2 читает состояние из двух источников: `/api/operator/shift` (факты смены) и `fetchState()` (мобильное состояние). База/v5/v7/v10 используют только мобильное состояние. | Два источника могут разойтись; v2 — единственный кандидат, тянущий `/api/operator/shift` (плюс замороженный откат). | Задокументировать, иначе держать как есть. |
| 14 | мелочь (P2) | `src/components/piling/operator-dashboard.tsx:14-20`; `src/components/piling/operator/**` | Замороженный путь отката: 7-шаговая смена на `OperatorShiftFacts` (`/api/operator/shift`) + `RunInspection` + `ReportForm` + `HandoverDialog`; мобильные команды не использует; 1280 строк. | Удаление сломает откат (владелец ещё выбирает вариант). | Не трогать (frozen). |
| 15 | мелочь (P2) | `src/app/operator/v5/page.tsx`; `v7/page.tsx`; `v10/page.tsx` | v5/v7/v10 (и подстраницы) — вне `(app)`: нет бутстрапа сессии и общей шапки с «Выйти» (осознанно, по комментариям в файлах). | На этих экранах нет общей кнопки выхода; при 403 (находка №3) выхода нет вовсе. | Не менять; учесть при исправлении №3. |
| 16 | мелочь (P2) | `e2e/qa-ac/operator-walk.spec.ts:565-573` | Тест «помощник v7» помечен «(не воспроизводится)»: ожидаемое объяснение про машиниста на `/operator/v7` не совпало — поведение v7 отличается от базы/v5. | Возможное расхождение экрана отказа v7 с ожиданием; требует перепрогона. | Перепрогнать e2e и сверить с кодом. |

## Не проверено

| Пункт | Статус | Почему |
| --- | --- | --- |
| Серверная проверка роли в API отчёта (`/api/reports/upsert`) для сценария находки №1 | НЕ ПРОВЕРЕНО | Маршрут не открывался; проверялся только клиент. Возможно, помощника отсекает уже API, тогда №1 — только клиентская защита. |
| Реальное поведение отказов на живых пользователях (401/403 на v5/v7/v10) | НЕ ПРОВЕРЕНО | Приложение не запускалось, e2e не перепрогонялся; выводы — по коду. |
| Актуальность пометки «(не воспроизводится)» в `operator-walk.spec.ts:565` (находка №16) | ГИПОТЕЗА | Строка прочитана, но текущее поведение v7 не перепроверялось запуском. |
| Навигационные ссылки на v2/v3/v5/v7/v10 в проде | НЕ ПРОВЕРЕНО | Прод не читался. По коду варианты доступны только по прямой ссылке (в `ROLE_NAVIGATION` их нет); e2e ходит на них напрямую. |
| Полный список артефактов v3, «живых» лишь частично | ПРОЙДЕНО (для счётчика) | Гейт запущен: 46 отсутствующих артефактов, exit=1 — число из команды. |

## Приложение. Полный список точек (path:line)

Маршруты и вход:

* `src/app/(app)/operator/page.tsx:2` — база → `OperatorMobileApp`; файл 24 строки.
* `src/app/(app)/operator/v2/page.tsx:3,13-15` — v2, проверка роли; `src/app/(app)/operator/v2/page.test.tsx`.
* `src/app/(app)/operator/v3/page.tsx:3` — v3 без проверки роли; `src/app/(app)/operator/v3/report/page.tsx:9`.
* `src/app/operator/v5/page.tsx:3`; `src/app/operator/v5/operator-v5-app.css`, `operator-v5-screens.css`.
* `src/app/operator/v7/page.tsx:2`; `src/app/operator/v7/{assistant,history,safety}/page.tsx:2`; `operator-v7.css`.
* `src/app/operator/v10/page.tsx:2`; `operator-v10.css`.
* `src/app/(app)/operator-layout-policy.ts:11-15` — `/operator`, `/assistant`, `/operator/v2*` без общей нижней навигации.
* `src/app/(app)/layout.tsx:49-50,285-299` — роль → `OperatorLayout`/`AdminLayout`; спец-ссылка на `/operator/v3`.
* `src/lib/routes.ts:15,18,roleHomeRoute` — `OPERATOR_HOME_ROUTE='/operator'`, `ASSISTANT_HOME_ROUTE='/assistant'`.
* `src/app/api/operator/mobile/state/route.ts:23-25` — 403 «Экран доступен только машинисту» при роли ≠ `OPERATOR`.

API-доступ по вариантам:

* `src/components/piling/operator-mobile/api.ts:356-371` — `fetchState` → `/api/operator/mobile/state`; `:647-709` — `uploadPhoto` → `/api/media`.
* v2: `/api/operator/shift` (`operator-shift-v2.tsx:354`), `/api/readiness/handovers/{id}/accept` (`:717`), `/api/readiness/defects` (`defect-sheet.tsx:54`), `/api/weather` (`weather-card.tsx:70`), `/api/sites/{id}` (`weather-card.tsx:88`), `/api/sites?userId=`+`/api/reports/my` (общий список).
* v7: `/api/assistant/state|command` (`assistant-v7-app.tsx:57,72`), `/api/reports/my` (`history-v7-app.tsx:37`), `/api/safety/my-clearance` (`safety-v7-app.tsx:60`).
* v10: `/api/safety/my-clearance` (`operator-v10-app.tsx:1453`).
* v3: `/api/sites?userId=`, `/api/reports/my?userId=` (`operator-dashboard-v3.tsx:47-48`).
* Замороженный откат: `/api/sites?userId=`, `/api/reports/my?userId=`, `/api/crews/my`, `/api/operator/shift` (`operator-dashboard.tsx:83-86`).

Общие компоненты (переиспользование):

* `src/components/piling/operator-mobile/screens/checklist-screen.tsx:417` — фото в чек-листе (общий: база/v2/v7/v10).
* `src/components/piling/operator-mobile/screens/incidents-tab.tsx:70` — фото происшествия (общий: база/v2).
* `src/components/piling/operator-mobile/screens/pile-passport-form.tsx:134` — черновик паспорта.
* `src/components/piling/operator-mobile/use-offline-queue.ts`, `offline-queue.ts`, `offline-queue-banner.tsx` — общая очередь.
* `src/components/piling/operator-mobile/operator-work-overview.tsx:31` — `canCorrect` только для `v2/v5/v7`.
* `src/components/piling/operator-mobile/safety/admission-steps.ts:6-7` — общее условие ТБ для `/operator`, `/operator/v2`, `/operator/v7`, `/operator/v10`.
* v5-дубли: `operator-v5-app.tsx:399` (`ChecklistScreen`), `:164` (`PpeScreenV5`), `:212` (`BriefingScreenV5`).
* Замороженный откат: `operator-dashboard.tsx:14-20`, `src/components/piling/operator/{handover-dialog,meter-reading-dialog,shift-phase,shift-step-card,shift-task-screen}.tsx`.

Тесты и e2e:

* `src/components/piling/operator-v2/__tests__/{operator-shift-v2.test.tsx,shift-flow.test.ts,step-bar-model.test.ts}`.
* `src/components/piling/operator-v5/__tests__/operator-v5-app.test.tsx`.
* `src/components/piling/operator-mobile/v7/__tests__/{operator-v7-app,assistant-v7-app,v7-screens,v7-shift}.test.tsx`.
* `src/components/piling/operator-mobile/v10/__tests__/{operator-v10-flow,operator-v10-port}.test.tsx`.
* `e2e/qa-ac/operator-walk.spec.ts:136,344,360,502,565-591` — обход всех вариантов, в т.ч. помощниками на v2/v10.
* `src/components/piling/operator/__tests__/shift-phase.test.ts` — тест откатного контура.
