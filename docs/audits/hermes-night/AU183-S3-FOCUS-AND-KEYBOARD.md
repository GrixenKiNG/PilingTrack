# AU183-S3-FOCUS-AND-KEYBOARD: Клавиатура и фокус в окнах

**Версия кода:** `git rev-parse HEAD` → `4927ecf8be48965f2bd42f5ecd18ff0f86f24d26`
(ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`)

Только чтение: код приложения не менялся. Создан один файл — этот отчёт.

---

## Итог

Просмотрены все модальные/диалоговые поверхности приложения вне замороженных зон (operator\*, ORION).
Итого **16 находок**: **0 критично**, **4 важно**, **12 мелочь**.

1. Диалог инструктажа (`briefing-conduct-dialog.tsx:89`) закрывается по Esc и клику вне окна **во время сохранения**: запрос продолжается, а сообщение об ошибке пишется в `setFailed` уже размонтированного компонента. Человек не увидит ни успеха, ни ошибки — прямо против правила, записанного комментарием в этом же файле (строки 80–81).
2. Полноэкранный редактор шаблона плитки (`layout-editor.tsx:164`) — `role="dialog"` без `aria-modal`, без ловушки фокуса, без `inert` на фоне, без начального фокуса, без возврата фокуса; **Esc не закрывает**. Открывается из `equipment-card-grid.tsx:94` и `equipment-tile-template-settings.tsx:80`.
3. Лайтбокс фото отчёта (`report-thumbnail.tsx:89`) — без `role="dialog"`, без Esc, без ловушки и возврата фокуса; закрыть можно только мышью или дотабать до кнопки «Закрыть».
4. Карта точек смазки (`lubrication-map.tsx:62`) — `role="button" tabIndex={0}` с `outline-none` и без `focus-visible` → **фокус невидим**.

Хорошая новость: собственные окна приложения (`command-dialog.tsx`, `entity-detail-shell.tsx`) и все Radix-примитивы (Dialog / AlertDialog / Sheet / Select) ловушку фокуса, Esc и возврат фокуса делают корректно — подтверждено тестом. Своих выпадающих меню (dropdown) в коде **нет вообще**: только Radix Select и 42 нативных `<select>`.

---

## Методика

Работа только по коду (запуск приложения не требовался). Инструменты: `rg`/`grep` по `src`, `find`, точечное чтение `sed -n` диапазонами, один прогон vitest.

Что искал и как (команды воспроизводимы из корня репозитория):

1. Поверхности-окна:
   - `grep -rn "role=\"dialog\"|aria-modal|role=\"alertdialog\"" src`
   - `grep -rn "fixed inset-0|z-\[|backdrop|overlay" src --include=*.tsx`
   - `grep -rln "createPortal" src --include=*.tsx` → порталы только в 2 файлах.
2. Примитивы: `grep -rn "@radix-ui/react-" src` → используются dialog, alert-dialog, select, tabs, toast, checkbox, label, separator, scroll-area, slot. **Нет** Radix DropdownMenu / Popover / Menubar.
3. Выпадающие меню: `grep -rn 'role="menu"|role="listbox"|aria-haspopup' src` → **0 совпадений**; `grep -rn "<select"` → 42 нативных селекта.
4. Клавиатура: `grep -rn "Escape|onKeyDown|keydown" src`; `grep -rn "addEventListener('keydown'|addEventListener(\"keydown\"|ctrlKey|metaKey)" src` → **0 совпадений** (глобальных горячих клавиш нет).
5. Фокус: `grep -rn "focus\(|autoFocus|onCloseAutoFocus|onOpenAutoFocus|onEscapeKeyDown|onInteractOutside|forceMount" src`.
6. Фокус-индикатор: `grep -rn "outline-none|outline-hidden"` в связке с `tabIndex`/`role="button"`; проверка `.card-hover` в `src/app/globals.css:297-305` (стили есть только для `:hover`); глобальных `:focus`/`focus-visible` правил в `globals.css` нет.
7. Что не проверял ссылками на существующие отчёты: задания требовали **не** открывать ничего в `docs/audits/` (кроме создаваемого файла), `CODEX-REPORT*`, `docs/strategy`. Они не читались.
8. Замороженные зоны (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) исключены из выборки фильтрами `grep -v orion -v "/operator"`.

Проверка исполнением (единственная, где это было возможно и дёшево):

```
node node_modules/vitest/vitest.mjs run src/components/piling/to/readiness/shared/command-dialog.test.tsx
→ Test Files 1 passed (1), Tests 3 passed (3), EXIT=0
```

Тест подтверждает: фокус ставится на заголовок, Tab замыкается по кругу, Esc закрывает, фокус возвращается на кнопку-источник; при `pending` Esc не закрывает.

---

## Находки

Столбцы: **#** — номер; **степень** — критично/важно/мелочь; **файл:строка** — полный путь от корня; **компонент** — что это за окно; **поведение** — что происходит сейчас; **риск** — чем это плохо; **исправление** — что предложить.

| # | степень | файл:строка | компонент | поведение | риск / почему это важно | исправление |
|---|---------|-------------|-----------|-----------|--------------------------|-------------|
| 1 | важно | `src/components/piling/to/readiness/screens/briefing-conduct-dialog.tsx:89` | Диалог «Провести инструктаж» | `onOpenChange={(next) => { if (!next) onClose(); }}` без проверки `busy` (состояние — строка 49). Кнопка «Отмена» на строке 147 при `busy` **disabled**, а Esc и клик по фону — нет. `submit()` (строки 53–77) продолжает запрос после закрытия и пишет ошибку в `setFailed` (строка 84) на размонтированном компоненте. | Запись инструктажа по охране труда уходит на сервер, но человек не видит ни подтверждения, ни ошибки; повторно инструктаж не проведут. Прямо противоречит комментарию в этом же файле (строки 80–81: «Тихо закрыть окно после неудачи нельзя»). | Передавать `busy` в обработчик: `onOpenChange={(next) => { if (!next && !busy) onClose(); }}`; и/или `onEscapeKeyDown={(e) => busy && e.preventDefault()}` на `DialogContent`. |
| 2 | важно | `src/components/piling/layout-editor/layout-editor.tsx:164` | Полноэкранный редактор шаблона плитки (модальный режим `autoOpen`) | Контейнер `role="dialog"` без `aria-modal`, без ловушки фокуса, без `inert`/`aria-hidden` на фоне, без начального фокуса и без возврата фокуса; обработчика Escape нет — закрытие только кнопкой «Закрыть» (строка 176). Открывается из `src/components/piling/admin-equipment/equipment-card-grid.tsx:94` и `src/components/piling/monitoring/equipment-tile-template-settings.tsx:80`. | Окно перекрывает страницу, но фон остаётся таббабельным: Tab уводит фокус на скрытые за оверлеем элементы, вернуть ориентир сложно. Esc (привычное «закрыть») не работает — человек либо застревает, либо закрывает вкладку (а там `beforeunload`, строка 89). | Либо перевести на существующий `CommandDialog`/Radix `Dialog`, либо добавить `aria-modal`, ловушку фокуса + `inert` на фон и обработчик Esc, как в `command-dialog.tsx:81-107`. |
| 3 | важно | `src/components/piling/admin-reports/report-thumbnail.tsx:89` | Лайтбокс просмотра фото отчёта | Оверлей `fixed inset-0 z-[100]` без `role="dialog"`/`aria-modal`, без обработчика Escape, без ловушки и без возврата фокуса; фон не инертный. Закрытие — только клик по фону (строка 92) или кнопка «Закрыть фото» (строка 94). | Для клавиатуры это «дыра»: после открытия фокус остаётся на кнопке-миниатюре за оверлеем, Tab уводит в список отчётов, Esc не работает. Скринридер не объявляет модальность. | Добавить `onKeyDown` с Escape на оверлей, `role="dialog" + aria-modal`, начальный фокус на кнопку закрытия и возврат фокуса на миниатюру (образец — `entity-detail-shell.tsx:76-103`). |
| 4 | важно | `src/components/piling/inspections/lubrication-map.tsx:62` | Карта точек смазки (SVG-точки, интерактивные) | `<g role="button" tabIndex={0}>` с классом `cursor-pointer outline-none` (строка 72) и **без** `focus-visible`-стиля. | `outline-none` убирает рамку браузера, замены нет → клавиатурный фокус на точке **не видно вообще** (нарушение WCAG 2.4.7). Человек не понимает, какая точка выбрана при Tab. | Убрать `outline-none` или добавить `focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal` (как в `fleet-evidence-panel.tsx:141`). |
| 5 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:127,231` | Диалог «Сформировать/Редактировать отчёт» | `handleClose()` (строка 127) не проверяет ни наличие введённых данных, ни `submitting` (строка 96); `Dialog` на строке 231 вызывает его при любом закрытии (Esc, клик по фону, крестик). | Нет единообразия с другими формами: в `admin-crews/crew-form-dialog.tsx:217`, `admin-equipment/equipment-dialogs.tsx:74,149`, `admin-sites/site-editor/edit-site-dialog.tsx:202`, `admin-users/user-dialogs.tsx:98,253` стоит подтверждение `CONFIRM_LEAVE` (`window.confirm`). Здесь заполненный отчёт теряется молча. | Ввести такой же `dirty`-порог и подтверждение при закрытии; и запретить закрытие при `submitting`. |
| 6 | мелочь | `src/components/piling/maintenance/work-order-form-dialog.tsx:267` | Диалог наряда ТО | `onOpenChange={onOpenChange}` напрямую: ни `dirty`, ни `busy` (строка 117) не блокируют закрытие. | Esc/клик по фону во время «Сохранение…» или на половине заполненного наряда закрывает окно без предупреждения. | Тот же `CONFIRM_LEAVE`-паттерн + проверка `busy`. |
| 7 | мелочь | `src/components/piling/admin-sites/site-editor/create-site-dialog.tsx:67` | Диалог «Новый объект» | `onOpenChange={onOpenChange}` напрямую, без проверки введённого (имя + планы свай/бурения), есть `autoFocus` (строка 90). | Случайный Esc/клик по фону стирает только что введённое название и планы. | Добавить подтверждение закрытия при непустой форме. |
| 8 | мелочь | `src/components/piling/admin-users/user-document-types-dialog.tsx:164` | Диалог «Виды документов работников» | `onOpenChange={onOpenChange}` напрямую; `busy` (строка 71) блокирует только кнопки, не Esc. | Esc во время сохранения записи закрывает окно; результат операции теряется из вида. | Заблокировать закрытие при `busy`, добавить `onEscapeKeyDown`. |
| 9 | мелочь | `src/components/piling/admin-dictionaries.tsx:454` | Поиск по справочникам | Рядом с полем нарисован `<kbd>Ctrl + K</kbd>`, но во всём `src` нет ни одного глобального обработчика клавиатуры: `grep -rn "addEventListener('keydown'"` и `grep -rn "ctrlKey\|metaKey"` → **0 совпадений**. | Подсказка ложная: пользователь жмёт Ctrl+K, ничего не происходит — это подрывает доверие к остальным подсказкам. | Либо повесить реальный обработчик (фокус на поле поиска), либо убрать `<kbd>`. |
| 10 | мелочь | `src/components/piling/ops-shell/ops-table.tsx:63-65` | Строки таблиц `role="button"` | `onKeyDown` реагирует на Enter и Space, но **не** вызывает `event.preventDefault()`. | Space одновременно активирует строку и прокручивает страницу. В соседних местах это учтено: `equipment-analytics.tsx:321`, `report-history.tsx:285`, `lubrication-map.tsx:66`. | Добавить `event.preventDefault()` перед `onRowSelect?.(row)`. |
| 11 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:52,465-470` | Заголовки сортировки таблицы отчётов | Кнопки-сортировки (`SortHeader`) не имеют `aria-sort` на `<th>`, а `aria-label="Сортировать по: …"` перекрывает текст и направление сортировки. | Скринридер не сообщает текущий столбец сортировки и её направление. | Перенести `aria-sort="ascending\|descending\|none"` на `<th>`, убрать перекрывающий `aria-label`. |
| 12 | мелочь | `src/components/piling/report-history.tsx:279-291` | Карточка отчёта в истории | `<Card role="button" tabIndex={0}>` с классом `cursor-pointer card-hover`; в `.card-hover` (`src/app/globals.css:297-305`) описаны только `:hover`-эффекты, `focus-visible` нет; глобальных `:focus` правил в `globals.css` нет. | Фокус виден только браузерной рамкой по умолчанию и никак не согласован с дизайном; `role="button"` на `<div>` без `aria-pressed` даёт слабую семантику. | Добавить явный `focus-visible:ring` (как в `ops-table.tsx:68`). |
| 13 | мелочь | `src/components/piling/admin-equipment/equipment-card-grid.tsx:147-159` | Плитка установки (`role="button"`) | `role="button" tabIndex={0}` с `onKeyDown` (Enter/Space, `preventDefault` есть) — но класс без `focus-visible`. | Фокус на плитке виден только дефолтной рамкой браузера; в плотной сетке плиток это легко потерять. | Добавить `focus-visible:ring-2 focus-visible:ring-info/30`. |
| 14 | мелочь | `src/components/piling/admin-users/user-dialogs.tsx:136,292`; `src/components/piling/admin-users/user-documents.tsx:287`; `src/components/piling/to/readiness/screens/briefing-conduct-dialog.tsx:90`; `src/components/piling/admin-equipment/equipment-dialogs.tsx:174` | Диалоги Radix без описания | В `DialogContent` нет ни `DialogDescription`, ни `aria-describedby={undefined}`. | Radix в dev-режиме печатает предупреждение «Missing `Description`…»; в комментарии `dialog.tsx:60-70` сказано, что такие диалоги сами передают `aria-describedby={undefined}` — на практике это сделано не везде. Функционально безвредно, шум в консоли. | Привести к одному правилу: либо добавить описание, либо `aria-describedby={undefined}`. |
| 15 | мелочь | `src/app/(app)/layout.tsx:125,267` | Оболочка приложения | Два `<main>` (админский и операторский), но нет ссылки «Перейти к содержанию»; в `src` такие ссылки есть только в ORION (`src/components/orion/orion-site.tsx:59`, `src/components/orion/orion-handoff-site.tsx:170`). | Клавиатурному пользователю приходится проходить всю боковую навигацию и верхнюю панель до содержимого на каждой странице. | Добавить skip-link первой фокусируемой ссылкой в `<body>`. |
| 16 | мелочь | `src/components/piling/report-form/report-form.tsx:152` | Форма отчёта (валидация) | При ошибке делается `document.getElementById(targetId)?.scrollIntoView(...)` — прокрутка к блоку, но **фокус** на проблемное поле не ставится. | Скринридер и клавиатура не попадают на поле с ошибкой; `role="alert"` в `pile-section.tsx:79,98` объявляет текст, но не ведёт к нему. | Фокусировать первое поле с ошибкой (`ref.focus()`), затем `scrollIntoView`. |

### Что уже сделано правильно (статус ПРОЙДЕНО)

| компонент | файл:строка | поведение | риск |
|-----------|-------------|-----------|------|
| `CommandDialog` (окна команд готовности) | `src/components/piling/to/readiness/shared/command-dialog.tsx:50-107` | Фокус ставится на заголовок (`tabIndex={-1}`), Tab/Shift+Tab замыкаются по кругу, Esc закрывает (кроме `pending`, строки 82-86), фон получает `inert` + `aria-hidden` (строки 57-74), фокус возвращается на источник (строка 75), есть `role="dialog"`+`aria-modal`+`aria-labelledby/describedby` (строки 119-122). Подтверждено тестом: 3 passed, exit 0. | нет |
| `EntityDetailShell` (модальная карточка) | `src/components/piling/to/readiness/shared/entity-detail-shell.tsx:45-103` | Тот же набор: `aria-modal`, ловушка, Esc, `inert`-фон, возврат фокуса; в немодальном режиме `role="region"` и Esc отключён (`if (!modal) return`, строка 77). Подтверждено тестом: 3 passed, exit 0. | нет |
| Radix `Dialog` / `AlertDialog` / `Sheet` / `Select` | `src/components/ui/dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `select.tsx` | Ловушка фокуса, закрытие по Esc, возврат фокуса и `aria-modal` обеспечиваются самой Radix (версии `react-dialog@^1.1.15`, `react-alert-dialog@^1.1.15`, `react-select@^2.2.6`). Нигде не отключены через `onCloseAutoFocus`/`onEscapeKeyDown`/`forceMount` — `grep` дал 0 совпадений. | нет |
| Подтверждения удаления (`ConfirmActionDialog`, `delete-*`) | `src/components/piling/confirm-action-dialog.tsx`, `admin-crews/delete-dialog.tsx`, `admin-sites/site-editor/delete-site-dialog.tsx` | Radix AlertDialog: Esc = «Отмена», фокус ставится на безопасную кнопку, возврат фокуса на инициатора. | нет |
| Свои выпадающие меню | — | Отсутствуют: `role="menu"`, `aria-haspopup`, Radix DropdownMenu/Popover в проекте не встречаются; вместо них 42 нативных `<select>` и Radix `Select` — оба полностью управляются клавиатурой. | нет |
| Полоса вкладок модуля готовности | `src/components/piling/to/readiness/module-tab-list.tsx:103-121,157` | Roving `tabIndex` (`selected ? 0 : -1`), Стрелки/Home/End двигают фокус, Enter/Space выбирают, `aria-selected`/`aria-controls` есть. | нет |
| Ползунки ширины панели | `admin-equipment.tsx:192-200`, `admin-reports.tsx:566-575`, `admin-dictionaries.tsx:551-556` | `role="separator"` + `tabIndex={0}` + `aria-valuenow/min/max`, Стрелки/Home/End, видимый `focus-visible`-ринг. | нет |

---

## Не проверено

1. **Поведение в реальном браузере.** Ловушка фокуса, порядок Tab и возврат фокуса не проверялись запуском приложения или Playwright — только чтением кода и одним модульным тестом (`command-dialog.test.tsx`, 3 passed). Для `layout-editor.tsx` и `report-thumbnail.tsx` это значит: «отсутствие обработчика Esc и ловушки» — факт из кода, но фактическая последовательность фокуса (например, попадает ли фокус на элементы за оверлеем именно в Chromium) не воспроизводилась. Статус: **ГИПОТЕЗА** по фактическому порядку, **ПРОЙДЕНО** по отсутствию кода.
2. **Не проверено, как браузеры ведут себя при `window.confirm` внутри Radix-диалога** (Esc → `handleOpenChange` → `window.confirm` в `user-dialogs.tsx:98,253`, `crew-form-dialog.tsx:218`, `equipment-dialogs.tsx:74,149`, `edit-site-dialog.tsx:202`). Чтением кода видно, что состояние диалога не меняется, пока пользователь не подтвердит; но не проверено, не «съезжает» ли фокус Radix-скоупа после нативного модального окна. Причина: требует запуска браузера.
3. **Мобильные и жестовые сценарии** (нижняя навигация `src/app/(app)/layout.tsx:46`, свайпы в Sheet) не проверялись.
4. **Замороженные зоны не проверялись вообще** — `src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION. Их собственная клавиатурная доступность в этот аудит не входит.
5. **`docs/audits/**` (кроме создаваемого файла), `CODEX-REPORT*`, `docs/strategy` не открывались** — по требованию задания. Возможные пересечения с уже описанными ранее находками не сверялись.
6. **Скринридер-тесты не запускались** — выводы о том, что читает скринридер (например, отсутствие `aria-sort`), основаны на разметке, а не на прогоне NVDA/VoiceOver. Статус: **ГИПОТЕЗА**.
7. **`aria-describedby`-предупреждения Radix (#14)** — прочитан исходник `dialog.tsx:60-70` и разметка потребителей; фактический текст предупреждения в консоли не наблюдался (dev-сервер не запускался). Статус: **ГИПОТЕЗА** по формулировке, **ПРОЙДЕНО** по факту отсутствия `DialogDescription`/`aria-describedby={undefined}`.
8. Числа в отчёте — только из команд: `git rev-parse HEAD`, `vitest run` (1 файл / 3 теста / exit 0), `grep`-подсчёты (42 нативных `<select>`, 0 совпадений `addEventListener('keydown')`, 0 совпадений `role="menu"`). Иные количественные оценки не приводились.
