# AU45-S3-TOUCH-TARGETS — размеры целей касания и минимальный шрифт в вариантах оператора

Версия рабочей папки: `git rev-parse HEAD` = **b46527a1262e3d10a65006b1a426b8eb1e2519b3** (ветка `hermes/q4-0926`).
Аудит только на чтение. Зона оператора (`src/components/piling/operator*/`, `src/app/operator/**`) — заморожена, код не менялся.

## Итог

- **критично: 0, важно: 3, мелочь: 9** (12 находок по целям касания) + отдельная таблица шрифтов (**1 важно, 6 мелочь**).
- Проектный стандарт цели — 44 px (заявлен в `src/components/piling/operator-mobile/ui.tsx:14-15` и в `ui.tsx:310-312`); WCAG 2.2 AA «Target Size (Minimum)» ниже — 24 px (`src/app/globals.css:181-182`).
- Топ-5:
  1. `offline-queue-banner.tsx:147-172` — кнопки «Удалить запись / Да, убрать / Повторить / Что введено / Оставить» без `min-h`, высота ≈ 29 px (живой контур). Это разрушительное действие в перчатке.
  2. `pile-passport-form.tsx:287-293` — ссылка-кнопка «убрать» (удаление залога), ≈ 21 px, ни `min-h`, ни `hit-target`.
  3. `operator-dashboard-v3.tsx:177` — кнопка «История», 14 px текст без `min-h` и без `hit-target` (в соседнем `operator-dashboard.tsx:563` та же кнопка имеет `hit-target`).
  4. `operator/`-диалоги на общей `Button` — 36 px (`handover-dialog.tsx:93,96`; `meter-reading-dialog.tsx:169,172`, поля `Input` 36 px: `:136,156`).
  5. Живой модуль `/operator` в остальном дисциплинирован: `BigButton` 48 px, `TabBar` 60 px, `PhaseBar` 44 px, поля 44 px — цели ниже 44 px единичны.

## Методика

Что искал и как это повторить (только чтение, никаких правок):

1. Перечень зоны:
   `find src/app/operator "src/app/(app)/operator" -type f` и `find src/components/piling -iname 'operator*'`;
   CSS зоны: `find src/app/operator "src/app/(app)/operator" -name '*.css'` → `operator-v10.css`, `operator-v5-app.css`, `operator-v5-screens.css`, `operator-v7.css`, плюс `operator-concept.css` и `operator-type.css` в `components/piling/operator-mobile/`.
2. Полное чтение CSS зоны (10 файлов) и `src/app/globals.css` (токены шрифта, `hit-target`, `row-actions`).
3. Поиск размеров в разметке: `search_files` по `min-h-[...]/min-h-N/h-N/py-N/text-(2xs|3xs|xs)/size-N` в `src/components/piling/operator*` и `src/components/piling/operator-mobile/{screens,v7,v10}`.
4. Каскад проверялся по номеру строки: позднее объявление той же специфичности переопределяет раннее (напр. `.ov10-nav .iconbtn` 34 px → 44 px; `.v5 .seg button` 40 px → 44 px).
5. Числа высот посчитаны командой (не «на глаз»):
   ```
   node -e '…'   # offline-queue button: 4*2 + 15*1.4 = 29 px; v10 .ov10-row: 11*2 + 16*1.2 = 41.2 px;
                 # v5 Rowline: 9.6*2 + 16*1.6 = 44.8 px; ui Button h-9 = 2.25rem = 36 px;
                 # text-2xs = 0.6875rem = 11 px, text-3xs = 0.625rem = 10 px'
   ```
6. Наличие класса на экране подтверждал `grep -c 'className="…"'` по файлу варианта (важно для «мёртвого» CSS — см. находки 8, 9).
7. `hit-target` разобран в `src/app/globals.css:185-200`: невидимая накладка `max(100%, 24px)`, на сенсорном вводе/узком экране — `max(100%, 44px)` (`@media (pointer: coarse), (max-width: 767px)`). Кнопка с `hit-target` цель 44 px на пальце получает, без него — нет.

## Находки

### Цели касания меньше 44 px

| # | severity | path:line | элемент / проблема | сценарий / почему важно | предлагаемый фикс | статус |
|---|----------|-----------|--------------------|-------------------------|-------------------|--------|
| 1 | важно | `src/components/piling/operator-mobile/offline-queue-banner.tsx:147-172` | 5 кнопок очереди без `min-h`: «Удалить запись», «Да, убрать», «Оставить», «Что введено», «Повторить» — класс `rounded border … px-2 py-1`; высота ≈ 29 px (живой контур: `text-2xs` поднят до 15 px, `operator-type.css:34`), на базовой шкале ≈ 24 px | Карточка отклонённой записи; «Удалить запись» необратима («внести её заново можно только вручную», строка 146). Промах пальцем в перчатке — либо не нажал, либо нажал не то | Добавить `min-h-11` (44 px) кнопкам; «Удалить» делать не первой по потоку | ПРОЙДЕНО |
| 2 | важно | `src/components/piling/operator-mobile/screens/pile-passport-form.tsx:287-293` | Кнопка-ссылка «убрать» (удаление залога) — `text-2xs font-medium underline`, без `min-h`, высота ≈ 21 px | Удаление одного залога из журнала забивки; рядом стоят поля ввода, легко промахнуться | `min-h-11` или класс `hit-target` | ПРОЙДЕНО |
| 3 | важно | `src/components/piling/operator-v3/operator-dashboard-v3.tsx:177` | Кнопка «История» — `text-sm font-medium text-blue-700`, без `min-h` и без `hit-target`, ≈ 21 px | Переход в историю отчётов; в действующем `operator-dashboard.tsx:563` та же кнопка помечена `hit-target` (44 px на пальце) — здесь защиты нет | Добавить `hit-target` (как в `operator-dashboard.tsx:563`) | ПРОЙДЕНО |
| 4 | мелочь | `src/components/piling/operator/handover-dialog.tsx:93,96` | Кнопки «Отмена»/«Передать» — общая `Button` размера `default` = `h-9` = 36 px (`src/components/ui/button.tsx:25`) | Сдача смены: подтверждение в конце 12-часовой смены | Для операторских окон задать `h-11`/`min-h-11` | ПРОЙДЕНО |
| 5 | мелочь | `src/components/piling/operator/meter-reading-dialog.tsx:169,172` | Кнопки «Отмена»/«Записать» — `Button` `default` = 36 px | Снятие моточасов до смены; поле ввода рядом мелкое | то же | ПРОЙДЕНО |
| 6 | мелочь | `src/components/piling/operator/meter-reading-dialog.tsx:136,156` | Поля `Input` в окне моточасов = `h-9` = 36 px (`src/components/ui/input.tsx:11`) | Ввод числа/примечания пальцем | `h-11` в операторском контексте | ПРОЙДЕНО |
| 7 | мелочь | `src/components/ui/select.tsx:40,110` | `SelectTrigger` `default` = `h-9` = 36 px; `SelectItem` `py-1.5 text-sm` ≈ 32 px | Выбор объекта на экранах оператора (`operator-dashboard.tsx:547`, `operator-dashboard-v3.tsx:161` переопределяют триггер до `h-12`, но пункты списка остаются мелкими) | Пунктам выпадающего списка задать `min-h-11` | ПРОЙДЕНО |
| 8 | мелочь | `src/components/piling/operator-mobile/v10/v10-ui.tsx:157` → `src/app/operator/v10/operator-v10.css:102-104` | Кнопка-строка `.ov10-row`: padding `11px` + одна строка текста → ≈ 41 px (без подписи `.s`); в списках строки без `note` | Строки меню/списков модуля v10 | `min-height:44px` на `.ov10-row` | ГИПОТЕЗА |
| 9 | мелочь | `src/components/piling/operator-mobile/v7/v7-ui.tsx:101` → `src/app/operator/v7/operator-v7.css:247-259` | Кнопка `.ov7 .row` без подписи `.s`: `11px*2 + 16px*1.2` ≈ 41 px | Строки списков модуля v7 | `min-height:44px` на `.ov7 button.row` | ГИПОТЕЗА |
| 10 | мелочь | `src/app/operator/v5/operator-v5-app.css:85-101,136-149` | `.v5-index-toggle` ≈ 31 px, `.v5-index-item` ≈ 38 px — объявлены, но класс `v5-index*` в разметке **не найден** (`grep -rn "v5-index" src e2e tests` → только определения в этом же CSS-файле) | Мёртвый CSS: на реальный экран не влияет, но при возврате «указателя экранов» даст цели < 44 px | Не восстанавливать без `min-h-11`; иначе удалить как мёртвый CSS | ПРОЙДЕНО |
| 11 | мелочь | `src/app/operator/v5/operator-v5-screens.css:90-94` (`.v5 .nav .back`) и `:348-355` (`.v5 .keys span`) | `.nav`/`.keys` в разметке v5-приложения не встречаются (`grep -c 'className="nav"'` = 0, `'className="keys"'` = 0); `.nav .back` — 15 px без `min-h` | Мёртвый CSS; на экран не влияет | Удалить вместе с прочим мёртвым v5-CSS | ПРОЙДЕНО |

### Переопределения, которые выглядят как нарушение, но по каскаду дают 44 px (ПРОЙДЕНО)

| # | severity | path:line | проблема | почему не дефект | статус |
|---|----------|-----------|----------|------------------|--------|
| 12 | мелочь | `src/app/operator/v10/operator-v10.css:71` vs `:244` | `.ov10-nav .iconbtn` 34×34 px | Позже (`:244`) переопределён до `width:44px;height:44px` — эффективно 44 px | ПРОЙДЕНО |
| 13 | мелочь | `src/app/operator/v5/operator-v5-screens.css:510` vs `:618` | `.v5 .seg button` `min-height:40px` | Позже (`:618`) `.v5 .ans button, .v5 .seg button { min-height:44px }` | ПРОЙДЕНО |
| 14 | мелочь | `src/app/operator/v5/operator-v5-screens.css:521` vs `:618` | `.v5 .ans button` `min-height:34px` | Позже (`:618`) переопределён до 44 px | ПРОЙДЕНО |
| 15 | мелочь | `src/app/operator/v7/operator-v7.css:382` vs `:630` | `.ov7 .answers button` без `min-h` | Позже (`:630`) `min-height:44px` | ПРОЙДЕНО |
| 16 | мелочь | `src/app/operator/v7/operator-v7.css:525` vs `:631`, `operator-concept.css:14` | `.ov7 .dock button` 52 px | Итог 60/72 px | ПРОЙДЕНО |
| 17 | мелочь | `src/app/operator/v7/operator-v7.css:143-155` vs `:626` | `.ov7 .navbar .back` padding 0, без `min-h` | Позже (`:626`) `min-height:44px` | ПРОЙДЕНО |

### Минимальные размеры шрифта

Шкала продукта: `--text-2xs` = 0.6875rem = **11 px**, `--text-3xs` = 0.625rem = **10 px** (`src/app/globals.css:79-82`). Живой контур `/operator` их поднимает до 15 px и 14 px (`src/components/piling/operator-mobile/operator-type.css:34-35`), причём **только** внутри `:is(.operator-mobile-theme, .operator-screen)` — на варианты v2/v3/v5/v7/v10 и их `text-*` это не действует (`operator-type.css:12-14`).

| # | severity | path:line | элемент / размер | сценарий | фикс | статус |
|---|----------|-----------|------------------|----------|------|--------|
| 18 | важно | `src/app/operator/v7/operator-v7.css:558` | `.ov7 .dock .badge` — `font-size:12px; line-height:16px` | Счётчик на нижней вкладке (напр. непрочитанное); самое мелкое число на экране | 14 px минимум | ПРОЙДЕНО |
| 19 | мелочь | `src/components/piling/operator-mobile/operator-concept.css:6,7,8` | 13 px: `.oc-stat span/small`, `.oc-entry time/span/small`, `.oc-stages li`, `.oc-additional button` | Эти элементы живут в вариантах v2/v5/v7/v10, где `operator-type.css` не поднят | довести до 14 px в вариантах | ПРОЙДЕНО |
| 20 | мелочь | `src/app/operator/v10/operator-v10.css:61,116,126` | 13 px: `.ov10-status`, `.ov10-badge`, `.ov10-metric .ml` | Строка состояния, бейдж тона, подпись метрики v10 | 14 px | ПРОЙДЕНО |
| 21 | мелочь | `src/app/operator/v7/operator-v7.css:89,160,206,277,301,343,344` | 13 px: `.statusbar`, `.navbar .sync`, `.tl .ph`, `.row .num`, `.chip`, `.metric .ml/.mx` | Метаданные v7 | 14 px | ПРОЙДЕНО |
| 22 | мелочь | `src/app/operator/v5/operator-v5-screens.css:68,123,203,231,337,419,622,624,629` | 13 px (`.bar`, `.kicker`, `.card .lbl`, `.badge`, `.chain .k`, `.tile .k`, `.rowline .m`) | Метаданные v5-экрана | 14 px | ПРОЙДЕНО |
| 23 | мелочь | `src/app/operator/v10/operator-v10.css:95` vs `:247` | `.ov10-tabs button` `font-size:14px` | Позже (`:247`) переопределён до 15 px | — | ПРОЙДЕНО |
| 24 | мелочь | `src/app/operator/…` (v2/v3) | `text-sm` = 14 px как минимальный размер в вариантах v2 и v3 | Ниже порога 14 px в v2/v3 текста нет | — | ПРОЙДЕНО |

## Не проверено

- **Не проверено визуально в браузере.** Размеры в таблице — из статического чтения CSS/классов и арифметики (`node -e`), без рендера. Для вариантов `ГИПОТЕЗА` (находки 8, 9) фактическая высота строки зависит от `line-height` браузера по умолчанию — измерение в браузере не делалось.
- **Не проверено** реальное состояние в перчатке/на солнце: аудит только по числам, без полевых замеров.
- Файлы `src/app/(app)/operator/page.tsx` (действующий `/operator` → `OperatorMobileApp`), `v2/page.tsx`, `v3/page.tsx`, `v3/report/page.tsx` читались как обёртки; маршруты `/operator/v5`, `/operator/v7/*`, `/operator/v10`, `/operator/v2` рендерят те же компоненты, что проверены в CSS. Динамически (запуск приложения) маршруты не открывались.
- **Не проверено** поведение на реальном мобильном устройстве (эмуляция `pointer: coarse` в CSS `hit-target` не запускалась).
- Общая `Button`/`Input`/`Select` (`src/components/ui/*`) — это общепроектные компоненты, а не только операторские; их влияние на **другие** экраны приложения не оценивалось.
- Существующие отчёты в `docs/audits/` (в т.ч. `W96-OPERATOR-TOUCH-TARGETS.md`, `W92-OPERATOR-FONT-SIZES.md`, `54-mobile-targets.md`, `AU34`) **не читались** — независимость первого прохода. Совпадения с ними не сверялись.
- `src/modules/operator-mobile/**` (логика) не проверялась — вне предмета аудита (размеры касания).
