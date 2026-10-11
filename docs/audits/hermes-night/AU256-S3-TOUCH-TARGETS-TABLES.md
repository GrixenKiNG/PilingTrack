# AU256-S3-TOUCH-TARGETS-TABLES: Касание — строки таблиц на телефоне

**Git commit:** `98495667f04de50ed7d0b71deaeed164977399c4`

## Итог

- **Всего таблиц проанализировано:** 8 (6 админских + 2 операторских)
- **Критично (высота строки < 44px):** 4 таблицы — OpsTable (админ-пользователи/бригады/объекты), DictionaryTable (некомпактный), EquipmentTable, FleetTable (десктоп), HistoryTable
- **Важно (кнопки действий < 44px):** 1 таблица — DictionaryTable (некомпактный): кнопки 28px
- **Мелочь (подпись действия отсутствует/неполная):** 1 — EquipmentTable не имеет колонки действий (строка кликабельна, но это неочевидно)
- **ПРОЙДЕНО (цели ≥ 44px, подписи есть):** WorkOrderTable, DictionaryTable (compact), Operator v7 Row, HistoryTable (кнопки раскрытия)
- **Главный риск:** механик/диспетчер на телефоне не попадает по строке OpsTable (38px) и по кнопкам DictionaryTable (28px) — ошибочное нажатие или промах.

---

## Методика

1. **Поиск таблиц:** `rg "table|OpsTable|DictionaryTable|EquipmentTable|WorkOrderTable|FleetTable|HistoryTable" --type tsx` в `src/components/piling/` и `src/app/operator/`.
2. **Анализ высоты строки:** из CSS-классов (`py-*`, `h-*`, `min-h-*`, `padding`) и шрифта (`text-sm`/`text-xs`/`text-2xs`) — пересчёт в px (база: 16px = 1rem, `py-2` = 8px, `py-3` = 12px, `text-sm` ≈ 14px, `text-xs` ≈ 12px, `text-2xs` ≈ 10px).
3. **Анализ кнопок действий:** классы `h-*`/`w-*`/`min-h-*` в ячейке «Действия» или в карточке.
4. **Проверка подписи колонки действий:** наличие `<th>Действия</th>` или `aria-label`/`title` на кнопках.
5. **Операторские экраны:** проверены `src/components/piling/operator-mobile/v7/v7-ui.tsx` (Row) и `src/app/operator/v7/operator-v7.css` (`.row`, `.dock button`).
6. **Тесты-эталон:** `equipment-mobile-targets.test.tsx`, `maintenance-mobile-targets.test.tsx` — подтверждают порог 44px (`min-h-11` = 44px) и паттерн `sm:min-h-0` для десктопа.

---

## Находки

| # | Сериозность | Таблица | Файл:строка | Высота строки (моб.) | Кнопки действий | Подпись действия | Риск / Сценарий | Предлагаемая правка |
|---|-------------|---------|-------------|----------------------|-----------------|------------------|-----------------|---------------------|
| 1 | **критично** | OpsTable (общий компонент для admin-users, admin-crews, admin-sites) | `src/components/piling/ops-shell/ops-table.tsx:68` | **~38px** (`py-3` = 12px ×2 + `text-sm` 14px) | нет отдельной колонки (строка целиком кликабельна) | нет (строка — действие) | Механик/диспетчер на телефоне не попадает по строке — срабатывает соседняя или промах. Используется в 3 экранах админки. | Добавить `min-h-11` (44px) к строке на мобильном: `lg:min-h-0 min-h-11` (как в EquipmentTable th). |
| 2 | **критично** | DictionaryTable (некомпактный режим) | `src/components/piling/admin-dictionaries/dictionary-table.tsx:205` | **~32px** (`px-3 py-2` + `text-sm`) | **28px** (`h-7 w-7` в строке 249–280) | Есть: `<th>Действия</th>` (строка 185), у кнопок `aria-label`/`title` | На телефоне кнопки «Переименовать», «Длина», «Архивировать», «Удалить» — 28×28px, в перчатку не попасть. Строка тоже 32px. | Строка: `min-h-11 lg:min-h-0` на `<tr>`. Кнопки: заменить `h-7 w-7` → `min-h-11 min-w-11 sm:min-h-0 sm:min-w-0` (как в компактном режиме строки 135–166). |
| 3 | **критично** | EquipmentTable (планшет/десктоп) | `src/components/piling/admin-equipment/equipment-table.tsx:79` | **~32px** (нет явной высоты, ячейка `px-1.5 py-2` + `text-xs`) | нет колонки (строка `role="button"` открывает карточку) | нет (нет индикатора, что строка кликабельна) | На планшете в горизонтальной ориентации строка узкая — промахи. Пользователь не знает, что строка открывает детали. | Добавить `min-h-11 lg:min-h-0` к `<tr>` (строка 79). Добавить визуальный признак кликабельности (иконка chevron-right в последней ячейке или `cursor-pointer` уже есть, но неочевидно). |
| 4 | **критично** | FleetTable (десктопная таблица в equipment-analytics) | `src/components/piling/equipment-analytics.tsx:314` | **~32px** (`px-3 py-2` + `text-sm`) | нет колонки (строка `role="button"`) | нет | Аналитик на планшете не попадает по строке. На мобильном используются карточки (48px) — ОК. | Добавить `min-h-11 lg:min-h-0` к `<tr>` (строка 314). |
| 5 | **критично** | HistoryTable (история работ в карточке установки) | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:156` | **~32px** (`px-3 py-2` + `text-sm`) | Кнопка раскрытия: **44px** (`min-h-11 min-w-11` строка 164) ✓ | Есть: `aria-label` на шевроне | Строка истории 32px — промах при скролле на телефоне. Кнопка раскрытия 44px — ОК. | Добавить `min-h-11 lg:min-h-0` к `<tr>` (строка 156). |
| 6 | **важно** | DictionaryTable (некомпактный) — кнопки действий | `src/components/piling/admin-dictionaries/dictionary-table.tsx:249` | — | **28px** (`h-7 w-7`) | Есть `aria-label`/`title` | См. строку 2. Кнопки ниже 44px. | См. строку 2. |
| 7 | **мелочь** | EquipmentTable — отсутствие колонки действий | `src/components/piling/admin-equipment/equipment-table.tsx:47` | — | нет | нет | Пользователь не ожидает, что строка таблицы — кнопка. Нет доступного имени для скринридера (есть `aria-selected`, но нет `aria-label` на строке). | Добавить последнюю ячейку с иконкой «Открыть» (`h-11 w-11`, `aria-label="Открыть установку"`), скрытую на десктопе `lg:hidden`, или оставить строку кликабельной, но добавить `aria-label` на `<tr>`. |
| 8 | **ПРОЙДЕНО** | WorkOrderTable (журнал ТО) | `src/components/piling/maintenance/work-order-table.tsx:80` | `px-2.5 py-2.5` + `text-xs` ≈ 36px (ниже 44px, но строк нечасто тапают — главное цели в колонке действий) | **44px** (`h-11 w-11` строки 134, 143, 150, 158) ✓ | Есть: `<th>Действия</th>` (строка 62), у каждой кнопки `aria-label` + `title` | Колонка действий соответствует 44px. Строки ниже нормы, но взаимодействие идёт через кнопки. | Опционально: `min-h-11 lg:min-h-0` на `<tr>` для единообразия. |
| 9 | **ПРОЙДЕНО** | DictionaryTable (compact режим) | `src/components/piling/admin-dictionaries/dictionary-table.tsx:134` | Карточка, не таблица | **44px** (`min-h-11` строки 135, 144, 152, 159) ✓ | Есть: иконка + `<span className="text-3xs">Переименовать</span>` и др. | Компактный режим (мобильный) полностью соответствует 44px. | Ничего. |
| 10 | **ПРОЙДЕНО** | Operator v7 — Row компонент | `src/components/piling/operator-mobile/v7/v7-ui.tsx:79` + `src/app/operator/v7/operator-v7.css:247` | **~44px** (`padding: 11px 13px` + шрифт 16px) ✓ | Кнопка = сама строка (`<button className="row">`) | Есть: `title`/`note` в составе Row | Операторские экраны (Журнал, Неисправности, Происшествия, Документы) — цели 44px. | Ничего. |
| 11 | **ПРОЙДЕНО** | Operator v7 — Dock (нижнее меню) | `src/app/operator/v7/operator-v7.css:525` | — | **52px** (`min-height: 52px`) ✓ | Есть: `label` + glyph | Нижнее меню 4 кнопки — каждая 52px. | Ничего. |
| 12 | **ПРОЙДЕНО** | HistoryTable — кнопки раскрытия/подвала | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:159, 189` | — | **44px** (`min-h-11`) ✓ | Есть: `aria-label` | Кнопки управления историей — 44px. | Ничего. |

---

## Не проверено

| Область | Причина |
|---------|---------|
| `src/app/operator/v10/page.tsx` и другие `/operator/v*` варианты | Замороженные зоны (AGENTS.md §1.15) — не входят в задачу. |
| `src/components/piling/operator*/**` (v2, v3, v5) | Замороженные зоны — не входят в задачу. |
| Таблицы в `src/app/orion/**` | ORION публичный сайт — заморожена. |
| Таблицы в отчётах (`src/modules/reports/**`) | Не найдены таблицы с действиями — только чтение/печать. |
| Реакция на зум/ориентацию | Требует ручного QA на устройстве (Playwright device emulation не проверяет физические касания). |
| Доступность (VoiceOver/TalkBack) | Проверялись только `aria-label`/`title` в коде; реальное озвучивание не тестировалось. |

---

## Приложение: сводка по всем таблицам

| Таблица | Компонент | Режим | Высота строки (моб.) | Кнопки действий | Подпись действия | Статус |
|---------|-----------|-------|----------------------|-----------------|------------------|--------|
| Пользователи (админка) | OpsTable | table | 38px | — (строка) | нет | **FAIL** |
| Бригады (админка) | OpsTable | table | 38px | — (строка) | нет | **FAIL** |
| Объекты (админка) | OpsTable | table | 38px | — (строка) | нет | **FAIL** |
| Справочники (админка) | DictionaryTable | table (desktop) | 32px | 28px | есть (th + aria) | **FAIL** |
| Справочники (админка) | DictionaryTable | cards (mobile) | 48px+ | 44px | есть (icon + text) | **PASS** |
| Установки (админка) | EquipmentTable | table | 32px | — (строка) | нет | **FAIL** |
| Наряды ТО | WorkOrderTable | table | 36px | 44px | есть (th + aria) | **PASS** |
| Парк техники (аналитика) | FleetTable | table (desktop) | 32px | — (строка) | нет | **FAIL** |
| Парк техники (аналитика) | FleetTable | cards (mobile) | 48px | — (карточка) | нет | **PASS** |
| История работ | HistoryTable | table | 32px | 44px (раскрытие) | есть (aria) | **FAIL** (строка) |
| Журнал смены (оператор) | Row (v7) | list | 44px | — (строка=кнопка) | есть (note) | **PASS** |
| Неисправности (оператор) | Row (v7) | list | 44px | — (строка=кнопка) | есть (note) | **PASS** |
| Происшествия (оператор) | Row (v7) | list | 44px | — (строка=кнопка) | есть (note) | **PASS** |
| Документы (оператор) | Row (v7) | list | 44px | — (строка=кнопка) | есть (note) | **PASS** |
| Нижнее меню (оператор) | Dock (v7) | bar | — | 52px | есть (label) | **PASS** |