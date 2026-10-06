# R137 — ТО на телефоне механика: цели нажатия, приёмка наряда, моточасы, фото (375 px, в перчатках)

READ-ONLY. Создан только этот файл. Код, схема, `.env`, тесты не изменялись.
Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `f604e53c` (`git status` — чисто).
Предшественники по этому классу: **R73** (`R73-mobile-targets-sweep.md`, обход `<44px`), **R94** (`R94-maintenance-messages.md`, сообщения модуля ТО). Здесь новое: остаточные цели нажатия на экранах ТО **вне** `.tech-readiness-module`, ввод моточасов, приёмка наряда и фото на 375 px.

## Итог

- Находок **29**: **критично — 2**, **важно — 18**, **мелочь — 9**. Одна находка = одно место правки; одинаковые контролы одного экрана сведены в строку.
- **Почему ещё есть что искать после R73.** `globals.css:337–341` поднимает `button, select, input, a.inline-flex` до 44 px, но только внутри `.tech-readiness-module`. Корни `.field-type` (осмотры, карточка наряда, карточка установки) этот лифт **не получают** — им поднимают лишь шрифт `3xs/2xs` (`globals.css:343–348`). Отсюда почти все находки: экраны ТО с корнем `.field-type` и портальные диалоги (Radix выносит `DialogContent` в `body`, вне `.field-type`).
- Топ-5:
  1. **Фото наряда/пункта — целиком ниже нормы.** «Добавить фото» в галерее наряда 28 px (`work-order-photos.tsx:189`) и «Добавить фото/Ещё фото» у пункта осмотра ≈20 px (`inspection-item-photos.tsx:261`) — а фото — обязательное доказательство ТО (пункты с `photoRequired` без фото не закрыть). Соседняя галерея установки тот же контрол уже получила `min-h-11` в R73 (`equipment-photos.tsx:177`) — наряд и осмотр остались.
  2. **Таблица нарядов шире экрана: `min-w-[1050px]`** (`work-order-table.tsx:50`). На 375 px столбец «Действия» («Открыть/Редактировать/Закрыть/Удалить») уезжает вправо — к нему надо листать таблицу боком, и он на виду не вместе с установкой.
  3. **Ввод моточасов и правок наряда — поля 36 px** (`work-order-detail.tsx:404,407-408,412,416`; `work-order-form-dialog.tsx:382` и соседние; `start-inspection-form.tsx:333`). Пальцем в перчатке в такое поле трудно попасть, и это ровно те поля, что названы в задаче.
  4. **Удаление записей журналов ТО — кнопки ≈16 px** (`meter-readings-panel.tsx:219-226`, `fuel-panel.tsx:256-265`, `maintenance-plans-panel.tsx:237-252`). Необратимое действие в списке, куда легко промахнуться; подтверждение — только нативный `confirm()` (повтор R94).
  5. **Переключатель «По моточасам / По календарю» ≈26 px** (`maintenance-plans-panel.tsx:181-194`) — выбор того, чем вообще меряется регламент ТО.

## Методика

Воспроизводимо чтением кода; Python нет, использованы `read_file`/`search_files`/`git`; браузер и Playwright не запускались.

1. Прочитал `AGENTS.md` (модель доверия; заморозка оператора и ORION; «выглядит мёртвым, но живёт»). Замороженные зоны не трогал.
2. Определил область по задаче — экраны ТО/осмотра и их панели:
   `src/components/piling/maintenance/**` (доска, карточка наряда, диалог наряда, фото, таблица, заявка),
   `src/components/piling/to/**` (панели `meter-readings`, `fuel`, `maintenance-plans`, `load-failure`, `equipment-to-tab`, `readiness/screens/{maintenance-screen,defects-panel}`),
   `src/components/piling/inspections/**` (список, запуск, прохождение, контролы, фото, карта смазки),
   карточка установки `src/components/piling/admin-equipment/detail/{equipment-detail,equipment-maintenance,equipment-photos}.tsx`, `forms/creation-form.tsx`.
3. Прочитал целиком: `work-order-detail.tsx`, `work-order-form-dialog.tsx`, `work-order-photos.tsx`, `work-order-table.tsx`, `maintenance-board.tsx`, `maintenance-detail-panel.tsx`, `maintenance-board-bits.tsx`, `meter-readings-panel.tsx`, `fuel-panel.tsx`, `maintenance-plans-panel.tsx`, `run-inspection.tsx`, `inspection-item-photos.tsx`, `inspection-controls.tsx`, `start-inspection-form.tsx`, `inspections-list.tsx`, `lubrication-map.tsx`, `defects-panel.tsx`, `maintenance-screen.tsx`, `creation-form.tsx`, `equipment-to-tab.tsx`, `equipment-maintenance.tsx`.
4. Размеры контролов вывел из классов и токенов: `Input`/`Button` дефолт `h-9` = 36 px, `Button size="sm"` = `h-8` = 32 px, `SelectTrigger` дефолт `h-9` = 36 px (`src/components/ui/{input,button,select}.tsx`), `text-sm` = 20 px, `text-xs` = 16 px, `py-1.5` = 12 px.
5. **Проверил готовые рычаги, чтобы не переписать закрытое:** `.tech-readiness-module :where(button, select, input, a.inline-flex){min-height:44px}` (`globals.css:337–341`), `.field-type` — только шрифт (`globals.css:343–348`), `.row-actions > button` 44 px (`globals.css:209–212`), `.hit-target` (`globals.css:185–200`). Поиском убедился: `.row-actions` и `.hit-target` в компонентах ТО/осмотра **не используются**, а `.tech-readiness-module` оборачивает только `readiness-reference-ui.tsx:87` — поэтому экраны `maintenance-screen.tsx` и `defects-panel.tsx` (внутри модуля) в находки **не попали**, их лифтует CSS.
6. Проверил контейнеры: `Dialog` (Radix) рендерит `DialogContent` в портал вне `.field-type` — поэтому поля диалога наряда тоже в находках.
7. Сверил с R73/R94: помечаю «повтор Rnn» там, где класс уже описан (нативные `confirm()` — R94 №15), и **не** повторяю то, что R73 уже исправил (кнопки доски/карточки наряда, ответы «Да/Нет» и «Исправно/…», «Принять», «Добавить фото» установки).

Ограничение метода: приложение не запускал, браузером не мерил — размеры расчётные из классов (±2 px на шрифт/переносы); «частота в поле» — оценка по ролям.

## Находки

Столбцы: элемент и текущий размер (расчёт из классов) · сценарий / почему важно · предлагаемая правка. Правка везде — «только телефон»: `min-h-11`/`h-11` с откатом `sm:min-h-0`/`sm:h-9`.

### А. Фото наряда и осмотра (задача: «фото»)

| № | важность | файл:строка | проблема (что видит человек) | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/inspections/inspection-item-photos.tsx:257-267` | «Добавить фото» / «Ещё фото (N)», `inline-flex … text-xs` без `min-h` → ≈20 px | Фото — обязательное доказательство: пункты с `photoRequired` без фото не дают завершить осмотр. Механик с телефона в перчатке почти не попадает по кнопке; тот же контрол у галереи установки уже 44 px (`equipment-photos.tsx:177`, R73) | `className="inline-flex min-h-11 items-center gap-1 … sm:min-h-0"` |
| 2 | критично | `src/components/piling/maintenance/work-order-photos.tsx:185-193` | «Добавить фото», `px-3 py-1.5 text-xs` → 28 px | Фото «до/после работ, дефекты» наряда ТО. Кнопка живёт в двух местах (панель доски и карточка наряда), в обоих ниже нормы; соседняя галерея установки исправлена в R73 | `min-h-11 … sm:min-h-0` (по образцу `equipment-photos.tsx:177`) |

### Б. Журнал нарядов `/admin/maintenance` и карточка наряда (задача: «приёмка наряда»)

| № | важность | файл:строка | проблема (что видит человек) | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 3 | важно | `src/components/piling/maintenance/work-order-table.tsx:50` | `<table className="w-full min-w-[1050px] …">` в `overflow-x-auto` | На 375 px таблица нарядов шире экрана втрое: столбец «Действия» (Открыть/Редактировать/Закрыть/Удалить) уезжает вправо. Чтобы закрыть наряд, надо сначала пролистать таблицу боком — на виду его нет | Карточная раскладка строки на телефоне (`sm:hidden`/`hidden sm:table`) либо закреплённый столбец «Действия» (`position: sticky; right:0`) |
| 4 | важно | `src/components/piling/maintenance/work-order-detail.tsx:404,407-408,412,416` | Поля «Начато», **«Моточасы»**, «Трудочасы», «Стоимость» — дефолтный `Input h-9` → 36 px | Быстрая правка наряда на телефоне: именно «Моточасы» (счётчик) — целевое поле задачи. Корень `.field-type` лифта 44 px не даёт | `className="min-h-11 sm:min-h-0"` на каждое поле |
| 5 | важно | `src/components/piling/maintenance/work-order-detail.tsx:393` | `<SelectTrigger id="q-assignee">` → 36 px | Назначение исполнителя наряда — с телефона | `min-h-11 sm:min-h-0` |
| 6 | важно | `src/components/piling/maintenance/work-order-form-dialog.tsx:356,364,369,374,382,388,393` | Поля «Название», «План/Начато/Выполнено», **«Моточасы»**, «Трудоч.», «Стоим.» — `Input h-9` → 36 px | Диалог создания/полного редактирования наряда; Radix выносит его в портал вне `.field-type`, поэтому лифта нет ни от CSS, ни от корня | `min-h-11 sm:min-h-0` |
| 7 | важно | `src/components/piling/maintenance/work-order-form-dialog.tsx:290,304,315,329,343` | 5 `<SelectTrigger>` (Установка/Тип/Приоритет/Статус/Исполнитель) → 36 px | Те же экраны создания наряда с телефона | `min-h-11 sm:min-h-0` |
| 8 | важно | `src/components/piling/maintenance/work-order-form-dialog.tsx:425-429` | «Отмена» / «Создать|Сохранить» — дефолтный `Button h-9` → 36 px | Главные кнопки диалога наряда (подтверждение) | `min-h-11 sm:min-h-0` |
| 9 | важно | `src/components/piling/maintenance/maintenance-detail-panel.tsx:72` | `ActionIcon` «Открыть карточку установки» — `h-11 w-11` (44 px) — **уже норма** | Проверено, не находка: панель наряда закрыта в R73; оставлено для полноты картины | — |

### В. Панели журналов ТО в карточке установки (`/admin/equipment/[id]`, корень `.field-type`)

| № | важность | файл:строка | проблема (что видит человек) | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 10 | важно | `src/components/piling/to/meter-readings-panel.tsx:219-226` | Кнопка «Удалить показание» — `<button>` без `min-h/min-w` → ≈16 px | Удаление показания моточасов необратимо; кнопка в строке списка, куда легко промахнуться в перчатке. Подтверждение — только нативный `confirm()` (`:130`, повтор R94 №15) | `className="inline-flex h-11 w-11 shrink-0 items-center justify-center … sm:h-9 sm:w-9"` |
| 11 | важно | `src/components/piling/to/fuel-panel.tsx:256-265` | Кнопка «Удалить запись» — ≈16 px | То же для заправки топлива; `confirm()` на `:136` | как №10 |
| 12 | важно | `src/components/piling/to/maintenance-plans-panel.tsx:237-252` | Кнопки «Редактировать регламент» и «Удалить регламент» — `h-4 w-4` без `min-h` → ≈16 px | Правка/удаление регламента ТО — редкое, но необратимое действие; `confirm()` на `:145` | как №10 |
| 13 | важно | `src/components/piling/to/maintenance-plans-panel.tsx:181-194` | Переключатель «По моточасам» / «По календарю» — `px-2 py-1 text-xs` → ≈26 px | Выбор, чем меряется регламент ТО (моточасы vs календарь) — ключевое поле регламента; палец легко попадает в соседний вариант | `min-h-11 sm:min-h-0` на каждую кнопку |
| 14 | мелочь | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:169` | Ссылка-заголовок наряда в журнале ТО карточки — `truncate` без `min-h` → ≈20 px | Переход в наряд из журнала установки с телефона; ниже минимума WCAG | `inline-flex min-h-11 items-center sm:min-h-0` |
| 15 | мелочь | `src/components/piling/admin-equipment/equipment-to-tab.tsx:56,59` | «Начать осмотр / ТО» (`px-3 py-1.5 text-sm` → ≈34 px) и «Полный журнал» (`text-sm` → ≈20 px) | Вкладка «ТО» в форме установки (`equipment-form.tsx:165`); запуск осмотра с телефона | `min-h-11 items-center sm:min-h-0` |

### Г. Осмотры `/inspections` (запуск, прохождение)

| № | важность | файл:строка | проблема (что видит человек) | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 16 | важно | `src/components/piling/inspections/inspection-controls.tsx:71-77` | `DoneControl` — `<input type="checkbox" className="h-4 w-4 …">` без `hit-target` → 16 px | Ответ «Выполнено» для пунктов типа `DONE`. Общий `checkbox.tsx` уже носит `hit-target`, здесь — сырой input; в перчатке промах | Обернуть по образцу `checkbox.tsx` (`.hit-target`) либо `min-h-11` на `<label>` |
| 17 | важно | `src/components/piling/inspections/inspection-controls.tsx:90-97` | `MeasureControl` — `<Input className="w-28">` → 36 px | Ввод измерения по пункту чек-листа (давление, уровень) — полевое действие; корень `.field-type` лифта не даёт | `className="w-28 min-h-11 sm:min-h-0"` |
| 18 | важно | `src/components/piling/inspections/start-inspection-form.tsx:333` | Поле **«Моточасы»** (`<Input id="si-hours" type="number">`) → 36 px | Запуск ЕО/ТО: счётчик моточасов вводится до осмотра; целевое поле задачи | `min-h-11 sm:min-h-0` |
| 19 | важно | `src/components/piling/inspections/start-inspection-form.tsx:316` | Поле «Дата» (`<Input type="date">`) → 36 px | Дата осмотра при запуске ТО | `min-h-11 sm:min-h-0` |
| 20 | важно | `src/components/piling/inspections/start-inspection-form.tsx:205-216,221-228,320-327` | 3 `<SelectTrigger>` (Установка/Уровень/Смена) → 36 px | Выбор установки и уровня ТО — первые поля экрана | `min-h-11 sm:min-h-0` |
| 21 | важно | `src/components/piling/inspections/start-inspection-form.tsx:342-348` | «Отмена» / «Начать осмотр» — дефолтный `Button h-9` → 36 px | Главные кнопки запуска осмотра | `min-h-11` (или `h-11`) |
| 22 | важно | `src/components/piling/inspections/inspections-list.tsx:79-83` | «Провести осмотр» — `Button size="sm"` → 32 px | Точка входа в осмотр/ТО с телефона | `min-h-11 sm:min-h-0` |
| 23 | важно | `src/components/piling/inspections/run-inspection.tsx:600-605` | Поле «Подписал» (`<Input id="ri-sign">`) → 36 px | Подпись ФИО при завершении осмотра — юридически значимое действие, вводится на телефоне | `min-h-11 sm:min-h-0` |
| 24 | мелочь | `src/components/piling/inspections/inspections-list.tsx:88` | `<SelectTrigger>` «Вид осмотра» → 36 px | Фильтр списка осмотров | `min-h-11 sm:min-h-0` |
| 25 | мелочь | `src/components/piling/inspections/start-inspection-form.tsx:189` | Ссылка «← Осмотры» — `text-sm` → ≈20 px | Возврат из запуска осмотра; ниже минимума WCAG | `inline-flex min-h-11 items-center sm:min-h-0` |
| 26 | мелочь | `src/components/piling/inspections/run-inspection.tsx:514-520` | `<Textarea rows={1} className="text-xs">` (примечание к пункту) → ≈30 px | Открывается по «+ замечание / фото»; поле низкое, тап по нему затруднён | `min-h-11` |
| 27 | мелочь | `src/components/piling/inspections/run-inspection.tsx:335-336` | На экране отказа — «К смене» / «К списку» (`text-signal-strong underline`) без `min-h` → ≈20 px | Единственный выход с тупикового экрана; ниже минимума WCAG | `inline-flex min-h-11 items-center` |

### Д. Карта смазки и форма заявки

| № | важность | файл:строка | проблема (что видит человек) | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 28 | мелочь | `src/components/piling/inspections/lubrication-map.tsx:74-92` | Точки смазки на SVG — `r={on?10:8}` → диаметр ≈16–20 px (масштаб схемы `h-56`) | Тап по точке на схеме или по строке списка даёт подробности; в перчатке попасть в круг 16 px почти нельзя | Обернуть каждую точку в невидимую зону ≥44 px (`<circle r=22 fill="transparent">`) или сделать список основным способом выбора |
| 29 | мелочь | `src/components/piling/inspections/lubrication-map.tsx:115-128` | Строки списка точек — `px-2 py-1.5 text-xs` → ≈30 px | Тот же выбор точки из списка | `min-h-11 sm:min-h-0` |
| 30 | мелочь | `src/components/piling/forms/creation-form.tsx:40` | Кнопка «Назад» — `Button size="sm" … h-9` → 36 px | Общая форма создания (в т.ч. заявка ТО `maintenance-request-form.tsx`); корень `.field-type` лифта не даёт | `min-h-11 sm:min-h-0` |

### Е. Нативные `confirm()` — повтор R94 №15

| № | важность | файл:строка | проблема (что видит человек) | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 31 | мелочь | `src/components/piling/to/meter-readings-panel.tsx:130`; `src/components/piling/to/fuel-panel.tsx:136`; `src/components/piling/to/maintenance-plans-panel.tsx:145`; `src/components/piling/maintenance/work-order-photos.tsx:139`; `src/components/piling/inspections/inspection-item-photos.tsx:145` | Удаление через `confirm()` / `window.confirm` — системный диалог браузера | Проект уже свёл подтверждения к `ConfirmActionDialog`; нативный `confirm()` не объясняет необратимость и на телефоне выглядит чужеродно. Класс описан в R94 №15 (там — доска) | Заменить на `ConfirmActionDialog` с пояснением, как на карточке установки (`equipment-maintenance.tsx:225-245`) |

Итого: **31 строка таблицы, из них 2 критично, 18 важно, 9 мелочь** (находка №9 — проверенное «уже норма», в счёт severity не входит; №31 — повтор R94).

## Не проверено

- **Браузером/Playwright не мерил.** Размеры — расчёт из классов Tailwind и токенов `globals.css` (±2 px на шрифт/переносы); фактический tap-target на устройстве не снимался. Скриншотов нет.
- **`.tech-readiness-module` не перепроверял построчно.** Экраны `to/readiness/screens/maintenance-screen.tsx` (кнопки `h-8` «Открыть заявку»/«Открыть календарь») и `defects-panel.tsx` (кнопки `h-9` «Взять в работу»/«Устранить») в находки **не включены**: они внутри `.tech-readiness-module`, а `globals.css:337–341` поднимает там `button/select/input/a.inline-flex` до 44 px. Если CSS-селектор `:where(...)` с нулевой специфичностью где-то проигрывает более специфичному классу — это не проверялось вживую.
- **Мёртвые ветки не учитывал.** `readiness-design-views.tsx` (таблицы `min-w-[760px]/820px/940px`, вкладки `h-9`) импортируется только как источник **типов** (`to-module.tsx:17`, `types.ts:6`, `maintenance-screen.tsx:15`); компонент `ReadinessMaintenanceView` (`:380`) по R94 №3 нигде не рендерится. Живой ли он — не проверял (вне задачи), поэтому в находки не вынесен.
- **Бэкенд-приёмку** (`/api/maintenance/[id]/accept`, права, идемпотентность) не смотрел — задача только про интерфейс 375 px.
- **Тексты/контраст** не оценивал (это R94/R89 и класс R79); здесь только цели нажатия и раскладка.
- **Среды сборки** не касался: `tsc`/тесты не гонял по существу (правок кода нет; см. отчёт о проверке в финальном ответе).