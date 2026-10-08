# W96 — размер нажимаемых элементов экрана машиниста

Только чтение. Ни один существующий файл не изменён. Область: `src/components/piling/operator-mobile/**` и `src/app/operator/**`. Обе зоны объявлены в `AGENTS.md` §1 как замороженные (варианты экрана оператора); опись сделана по прямому указанию задачи, код не трогался.

## Итог

- Порог: 44 px = класс `h-11` / `min-h-11` (2.75 rem). Вспомогательные значения Tailwind: `py-1`=4 px, `py-2`=8 px, `py-3`=12 px, `p-3`=12 px, `h-9`=36 px, `min-h-12`=48 px, `min-h-16`=64 px.
- Интерактивных элементов в разметке области: **≈204 явных тега** — `<button>` ~83, `<Button>` 43 (компонент v7 → CSS-класс `.ov7 .btn`), `<BigButton>` 42 (→ `min-h-12`), `<input>` 22, `<textarea>` 8, `<select>` 5, `<a>` 1. Плюс кнопки, которые порождают компоненты, а не пишутся тегом: `Pick` (12), `Row` с `onClick` (до 58 использований), `Dock` (3 модуля), `TabBar`/`Tabbar`, `Navbar` (иконка-кнопка).
- **Меньше 44 px — 10 элементов** (таблица ниже). Почти все — в живом контуре `/operator`, а не в прототипах-вариантах v5/v7/v10.
- **Без явно заданного размера — 3 элемента** (размер определяется содержимым, ориентировочно ≈40–74 px; не измерено в браузере).
- Хорошая новость: основная масса кнопок сделана «под перчатку» осознанно — `BigButton` = `min-h-12` (48 px), нижние вкладки `min-h-[60px]`/`min-height:52px`, кружки хода смены `size-11` с прозрачной областью 44 px (`ui.tsx:288`), поля ввода v10 и v7 — `min-height:44px`/`h-12`, кнопки `.ov7 .btn` — `min-height:48px`.
- Топ-5 самых важных:
  1. `screens/../offline-queue-banner.tsx:147,151,159,163,169` — пять кнопок очереди отправки (`px-2 py-1`, ~22 px): «Повторить», «Удалить запись», «Да, убрать», «Оставить», «Что введено».
  2. `screens/work-screen.tsx:406` — «Закончился сейчас» (окончание простоя), `h-9` = 36 px; самый частый случай при записи простоя.
  3. `v7/v7-shift.tsx:253,257` — поля `<input type="time">` («Простой начался» / «Закончился») без CSS-правила: `.ov7 input[type="text"], input[type="number"]` их не покрывает, остаётся браузерный размер.
  4. `screens/work-screen.tsx:312` — кнопка-напоминание «ТБ по забивке/бурению: срок через N дн.», `px-3 py-2 text-2xs`, ~35 px.
  5. `screens/pile-passport-form.tsx:287` — кнопка «убрать» (удаление залога/строки паспорта), `text-2xs underline`, без height/padding, ~16 px.

## Методика

Воспроизводимо (git-bash, из корня `D:/PillingR/wt-night`):

1. Прочитал `AGENTS.md`: замороженные зоны, список «выглядит мёртвым, но должно остаться». Правок не делал.
2. Перечислил файлы области: `find src/components/piling/operator-mobile -name '*.tsx' -not -name '*.test.tsx'` (34 файла) и `find src/app/operator -type f`.
3. Нашёл интерактивные теги: `rg -n -e '<(button|Button|a|input|select|textarea|Link)\b'` по обеим папкам, исключая `*.test.tsx`; отдельно `rg '<input\b'`, `<select\b`, `<textarea\b`, `<a\b`.
4. Посчитал по видам: `for t in button Button BigButton input select textarea; do rg -c "<$t\b" ...; done`.
5. Извлёк классы Tailwind: `rg -n -A5 '<button\b' | rg 'className'`, а также запросы по `h-9`, `h-8`, `h-7`, `h-5`, `size-[5-8]`, `py-1`, `py-1.5`, `py-2`, `p-3`, `text-2xs`, `text-3xs`.
6. Понял, что размер почти всегда задаёт не Tailwind, а собственный CSS. Нашёл его: `rg --glob '*.css'` по `src/app/operator`, `src/app/globals.css` и по CSS рядом с компонентами (`operator-concept.css`, `operator-type.css`). Прочитал целиком `src/app/operator/v10/operator-v10.css` и решением блоки `src/app/operator/v7/operator-v7.css` (в т.ч. строку 626 — доступные цели нажатия). Определяющие правила: `.ov10-btn` (padding 15px → ~49 px), `.ov10-nav .iconbtn` (44×44, override строки 243), `.ov10-row` (padding 11px + иконка 38 px), `.ov10-rowbtn` (`min-height:44px`), `.ov10-tabs button` (52 px), `.ov10 input/select` (`min-height:44px`), `.ov7 .btn` (`min-height:48px`), `.ov7 .row` / `.ov7 .pick`, `.ov7 .navbar .back` (`min-height:44px`), `.ov7 input[type="text"|"number"]` (padding 11px → ~44 px), `.oc-action` (`min-height:60px`), `.oc-form-back` (`min-height:48px`), `.oc-additional button` (`min-height:44px`), `.ov7/.v5 .dock button` (`min-height:60–76px`).
7. Каждый элемент-кандидат открыл (`read_file`) и классифицировал: кнопка / поле ввода / декоративный элемент. Отдельно проверил ловушки: чекбокс `h-5 w-5` в `pile-passport-form.tsx:68` — он внутри `<label className="flex min-h-12 ...">` (`:67`), значит цель нажатия — вся строка 48 px, а не сам квадрат 20 px; файловые `<input type="file">` — `sr-only`/`hidden` (`incidents-tab.tsx:282`, `checklist-screen.tsx:439`), нажимаются через видимую кнопку; `size-5/6/8` в `ui.tsx:265,335`, `operator-status-strip.tsx:83`, `ppe-screen.tsx:87` — декоративные значки/значки состояния, не цели нажатия.
8. Сверился с прошлым аудитом `docs/audits/hermes-night/W92-OPERATOR-FONT-SIZES.md` (шкала шрифта в живом контуре поднимается `operator-type.css`: `text-2xs` → 14 px) — на выводы о высоте это не влияет, высоту задаёт padding.

Ограничения метода: приложение не запускал, в браузере пиксели не мерил. Все числа — расчёт из классов Tailwind и правил CSS. Где правило отсутствует, фактическую высоту не подтверждал («не проверено»).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|----------|-----------|----------|-------------------------|---------------------|
| 1 | важно | `src/components/piling/operator-mobile/offline-queue-banner.tsx:147` | `<button>` «Да, убрать» — `rounded ... px-2 py-1 font-semibold`, ни `h-*`, ни `min-h-*`; высота ≈ 8 px padding + строка ~14 px ≈ **22 px** | Удаление записи из очереди офлайн-отправки. В перчатке на морозе в 22 px легко промахнуться мимо подтверждения/отмены. | `min-h-11` (44 px) и/или `py-2.5` |
| 2 | важно | `src/components/piling/operator-mobile/offline-queue-banner.tsx:151` | `<button>` «Оставить» — `px-2 py-1`, ~22 px | Отмена удаления записи; промах ведёт к удалению отправки. | `min-h-11` |
| 3 | важно | `src/components/piling/operator-mobile/offline-queue-banner.tsx:159` | `<button>` «Удалить запись» — `px-2 py-1 text-white`, ~22 px | Вход в удаление записи из очереди — необратимая ветка. | `min-h-11` |
| 4 | важно | `src/components/piling/operator-mobile/offline-queue-banner.tsx:163` | `<button>` «Скрыть/Что введено» — `px-2 py-1`, ~22 px | Раскрыть, что именно записано в очереди, перед решением об удалении. | `min-h-11` |
| 5 | важно | `src/components/piling/operator-mobile/offline-queue-banner.tsx:169` | `<button>` «Повторить» — `px-2 py-1 font-normal`, ~22 px | Самое частое действие очереди — повторить отправку записи. Мелкая цель там, где связи нет и торопятся. | `min-h-11` |
| 6 | важно | `src/components/piling/operator-mobile/screens/work-screen.tsx:406` | `<button>` «Закончился сейчас» — `h-9` = **36 px** (меньше порога) | Машина только что пошла — самый частый случай при записи простоя; кнопка стоит рядом с полями времени. | `h-11`/`min-h-11` |
| 7 | важно | `src/components/piling/operator-mobile/screens/work-screen.tsx:312` | `<button>` «ТБ по забивке/бурению: срок через N дн.» — `px-3 py-2 text-2xs`, ни `h-*`, ни `min-h-*`; ≈ 8+8+~19 ≈ **35 px** | Открывает чек-лист ТБ до истечения срока. Невысокая цель, неочевидно нажимаемая. | `min-h-11` |
| 8 | важно | `src/components/piling/operator-mobile/screens/pile-passport-form.tsx:287` | `<button>` «убрать» (удаление залога/строки) — `text-2xs font-medium underline`, без height/padding; ≈ **16 px** | Удаление уже введённой строки паспорта сваи. Текст-ссылка 16 px — мимо легко, а действие разрушительное. | `min-h-11` + отступ |
| 9 | важно | `src/components/piling/operator-mobile/v7/v7-shift.tsx:253` | `<input type="time">` «Простой начался» — правило `.ov7 input[type="text"], input[type="number"], textarea, select` (`src/app/operator/v7/operator-v7.css:403-406`) не покрывает `type="time"` → размер браузерный | Запись простоя: поля времени без заданной высоты; на телефоне браузерное поле обычно ниже 44 px. | добавить `.ov7 input[type="time"]` в блок `:403` |
| 10 | важно | `src/components/piling/operator-mobile/v7/v7-shift.tsx:257` | `<input type="time">` «Закончился» — то же, правила нет | Окончание простоя. Тот же дефект, что №9. | то же |
| 11 | мелочь | `src/components/piling/operator-mobile/screens/documents-panel.tsx:52` | `<button>` раскрытия «Документы (N)» — `flex w-full items-center gap-3 text-left`, ни `h-*`, ни `min-h-*`, ни `py-*`; содержимое (Sign 20 px + две строки) даёт ≈ **40 px** | Раскрыть список документов смены. Размер не задан — не подтверждено, что ≥44. | `min-h-11` |
| 12 | мелочь | `src/components/piling/operator-mobile/screens/knowledge-screen.tsx:196` | `<button>` варианта ответа — `w-full rounded-lg border bg-card p-3 text-sm leading-snug`, без `min-h`; при `text-sm`→17 px и `p-3` ≈ **44 px**, но неявно | Выбор ответа в проверке знаний. Одна строка — ровно на границе порога. | `min-h-11` |
| 13 | мелочь | `src/components/piling/operator-mobile/screens/safety-tab.tsx:63` | `<button>` шага допуска — `flex w-full items-start gap-2 py-3 text-left`, без `min-h`; по содержимому (три строки) ≈ **74 px** — вероятно ≥44, но явного размера нет | Переход к ППЭ/инструктажу/проверке знаний. Фактический размер не измерял. | `min-h-11` для гарантии |
| 14 | мелочь | `src/components/piling/operator-mobile/screens/work-screen.tsx:435`, `checklist-screen.tsx:423`, `closing-screen.tsx:150`, `assistant-defect-form.tsx:178`, `pile-passport-form.tsx:382`, `incidents-tab.tsx:253`, `v10/operator-v10-app.tsx:1094` | `<textarea>` у всех — `rows=2..4`, `p-3`/`px-3 py-2`, но ни у одного нет `min-height` (в отличие от `.ov7 textarea { min-height: 84px }` и `.ov10-textarea { min-height: 78px }`); высокий за счёт строк | Ввод примечаний/описания происшествия. По `rows` высоты хватает, но размер не задан правилом и зависит от шрифта. | задать `min-height` |

Соответствия «размер ≥ 44 px, правок не нужно» (для полноты картины, без строк в таблице): `.ov7 .btn` («Назад», «Записать», «Закрыть смену» и т.п.), `BigButton` (`min-h-12`) на всех экранах `screens/**`, `.ov7 .row`/`button.row`, `.ov7 .pick`, `.ov7 .navbar .back`, `.ov7/.v5 .dock button`, нижние вкладки `TabBar` (`min-h-[60px]`) и `Tabbar` v10 (52 px), кружки хода смены `size-11` (`ui.tsx:288`), `.ov10-btn`, `.ov10-row`, `.ov10-rowbtn`, `.ov10-chips button`, `.ov10-nav .iconbtn` (44×44), `.oc-action`/`.oc-finish`/`.oc-additional button`/`.oc-form-back`, `min-h-11` чекбокс-строка паспорта (`pile-passport-form.tsx:67`), все поля ввода с `h-11`/`h-12`/`min-height:44px`.

`<a>` в области один — `v7/operator-v7-app.tsx:416`, ссылка «История» в боковой навигации `.oc-desktop-nav` (текстовый размер ≥44 px, и только на десктопе, `min-height:60px`); на телефоне панель скрыта. Не находка.

## Не проверено

- Фактическая высота в браузере: приложение не запускал, DOM не мерил; все пиксели — расчёт из классов Tailwind и правил CSS. Особенно это касается находок 11–14, где правило не задаёт размер (значения ≈40/44/74 px — оценка по содержимому).
- Находки 9–10: точный браузерный размер `<input type="time">` на телефоне не измерял; вывод «< 44 px» — из отсутствия CSS-правила для `type="time"`, не из замера.
- Псевдо-элементы и области нажатия, которые браузер строит сам (например, попап календаря у `type="time"`), не учитывал.
- Компоненты, отдающие готовую вёрстку из `@/components/ui/*` (если такие кнопки попадают в эти экраны через `Slot`/`asChild`), отдельно не трассировал: в области прямых вызовов таких не нашёл.
- Маршруты-прототипы вне `src/app/operator` (`/operator/v2`, `/operator/next` → `@/components/piling/operator-next`, `/operator/v5` → `operator-v5`) в область не входили и не проверялись.
