# AU120-S3-ARIA-LABELS — Кнопки-иконки без подписи для скринридера

Версия кода: `git rev-parse HEAD` → `5c69b8059edb1cdc4246e6f180a9f1bbefa4d76e` (ветка `hermes/q4-0926`).
Область: только `src/components/**` (постановка задачи). Только чтение, файлы приложения не менялись.

## Итог

- Иконочная кнопка без доступного имени (aria-label / aria-labelledby / title / sr-only / label / alt) в незамороженном коде нашлась **одна**: крестик закрытия тоста `src/components/ui/toaster.tsx:28` → `ToastClose` (внутри `src/components/ui/toast.tsx:77-86`, `<X className="h-4 w-4" />`), ни `aria-label`, ни `sr-only`. Для сравнения, кнопки закрытия диалога и шторки подписаны (`ui/dialog.tsx:87` sr-only, `ui/sheet.tsx:75` aria-label).
- Кроме неё без доступного имени — два самодельных переключателя-«тумблера» (не иконочные, но это настоящие безымянные кнопки): `admin-equipment/equipment-form.tsx:353` и `admin-sites/site-editor/edit-site-dialog.tsx:276`.
- Числа: в `src/components` 345 `.tsx`-файлов; интерактивных элементов, у которых внутри только иконка/графика и нет текста, — 123; из них с доступным именем — 91 (74%), без имени — 32.
- Из 32 «без имени»: 26 — имя формируется переменной рядом с иконкой (проверено вручную по строкам, текст виден глазами), 6 — без динамики. Из этих 6 четыре оказались ложными срабатываниями скрипта (обёртка `label`+`Checkbox`, `div role="button"` с карточкой, `<th>` с текстом в пропсах, `div` с `QuickLink`), остаются **2 подтверждённых** — те самые тумблеры (находки 2-3).
- Крестик тоста (находка 1) в этих 123 не учтён: скрипт ищет `onClick` или тег `button`, а `<ToastClose />` — компонент, чья «кнопочность» внутри radix-примитива. Это единственное место такой конструкции без подписи (проверено перебором `DialogClose/SheetClose/AlertDialogCancel/ToastClose/...` в `src/components` вне `ui/`).
- Подтверждено (важно): `src/components/ui/toaster.tsx:28` — иконочный крестик закрытия тоста без имени, и два переключателя «Активна»/«Активен» (`equipment-form.tsx:353`, `edit-site-dialog.tsx:276`) без `role="switch"`, `aria-checked` и `aria-label`. Скринридер объявит «кнопка» без названия.
- 10 из 10 нарушений в замороженных экранах оператора (`operator-mobile`, `operator-v2/3/5`, `operator-dashboard.tsx`) — мнимые: подпись приходит переменной рядом с иконкой (см. отдельный раздел).
- Смежно (мелочь): сортировочные `<th onClick>` без `aria-sort`, сегмент-кнопки «По моточасам / По календарю» без `aria-pressed`.
- Общий вывод: подписи у иконочных кнопок в проекте — сложившаяся практика (91 из 123 несут `aria-label` + `title`). Настоящие дыры — крестик закрытия тоста (в примитиве `ui/toast.tsx`) и два инлайновых тумблера, для которых в проекте уже есть готовый `Toggle` с `role="switch"`.

## Методика

Всё воспроизводится командами из корня `D:\PillingR\wt-night`.

1. Версия: `git rev-parse HEAD`.
2. Инвентарь иконок: `rg -l lucide-react src/components --glob *.tsx | wc -l` → 20 файлов; `rg --files src/components -g '*.tsx' | wc -l` → 345 (из них 77 в `__tests__`).
3. Разбор JSX: скрипт на уже установленном `node_modules/typescript` (новых зависимостей нет), обход AST всех `.tsx` в `src/components`. Для каждого элемента с `onClick` либо тега `button/a/Link/Button/IconButton` считается:
   - `hasText` — есть ли в поддереве текстовый узел со словом, строковый/шаблонный литерал со словом, либо (флаг `dyn`) выражение-идентификатор/вызов, которое на рантайме даёт текст;
   - `icon` — есть ли дочерний JSX-элемент, внутри которого нет текста (иконка, `<svg>`, `<Image>`);
   - имя = `aria-label`/`aria-labelledby`/`title` со словом, `sr-only` внутри, либо проп `label`/`alt` со словом.
   Кандидат = `icon && !hasText && !имя`.
4. Двойная проверка регулярками: `rg -U '<(svg|[A-Z][A-Za-z0-9]*)[^<>]*/>\s*</button>'` и то же для `</Button>`; плюс `rg -n 'role="switch"|aria-checked'`, `rg -n 'sr-only'`.
5. Каждый кандидат открыт глазами (`sed -n 'A,B{=;p}' файл`) и отнесён к «подтверждено» / «ложное срабатывание» / «имя из переменной».
6. Отдельно перебраны компоненты, «кнопочность» которых спрятана внутрь (radix и свои обёртки): `rg -n 'DialogClose|SheetClose|AlertDialogCancel|AlertDialogAction|ToastAction|ToastClose|...' src/components -g '*.tsx'` вне `src/components/ui/` — единственное употребление без подписи это `toaster.tsx:28`.
7. Числа по зонам:

```
зона                                    icon-only  с именем  без имени
src/components/piling/operator-mobile        23        17         6
src/components/piling/to                     18         8        10
src/components/piling/admin-equipment        14         9         5
src/components/piling/admin-sites             9         8         1
src/components/piling/report-form             9         9         0
src/components/piling/inspections             8         8         0
src/components/piling/admin-reports           7         7         0
src/components/piling/admin-dictionaries      5         4         1
src/components/piling/maintenance             4         4         0
src/components/piling/admin-users             3         3         0
src/components/piling/layout-editor           3         3         0
src/components/piling/operator-v2             3         2         1
src/components/* (остальные, по 1-2)         17+        -         -
src/components/orion                          2         2         0
src/components/piling/operator-v3             1         0         1
src/components/piling/operator-v5             1         0         1
src/components/piling/operator-dashboard.tsx  1         0         1
ИТОГО                                       123        91        32
```

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|----------|-----------|----------|--------------------------|-------------------|
| 1 | важно | `D:\PillingR\wt-night\src\components\ui\toaster.tsx:28` | иконочная кнопка закрытия тоста: `<ToastClose />` без `aria-label`/`sr-only`; сам компонент — `src/components/ui/toast.tsx:77-86`, внутри только `<X className="h-4 w-4" />` | Скринридер озвучит «кнопка» без названия; закрыть уведомление с клавиатуры можно, но вслепую непонятно, что это за элемент. Единственная иконочная кнопка в проекте без имени | добавить имя в примитив: в `toast.tsx` внутрь `<ToastPrimitives.Close>` положить `<span className="sr-only">Закрыть</span>` (как сделано в `ui/dialog.tsx:87`) либо `aria-label="Закрыть уведомление"` |
| 2 | важно | `D:\PillingR\wt-night\src\components\piling\admin-equipment\equipment-form.tsx:353` | инлайновый тумблер «Активна»: `<button type="button" onClick={...}>` без `role="switch"`, `aria-checked`, `aria-label`; рядом `<Label className="text-sm">Активна</Label>` (строка 349) без `htmlFor` — связь Label↔кнопка не установлена. Внутри только `<span>`-дорожка и кружок | Скринридер на кнопке скажет «кнопка» без названия и без состояния; незрячий администратор не поймёт, включена установка или нет, и не узнает, чем управляет элемент | добавить `role="switch" aria-checked={value} aria-label="Активна"` (или `id` на кнопку + `htmlFor` на Label); в проекте для этого уже есть готовые `Toggle` (`src/components/piling/to/readiness/settings/shared-ui.tsx:58`, `src/components/piling/workspace-settings.tsx:28`), использованные корректно |
| 3 | важно | `D:\PillingR\wt-night\src\components\piling\admin-sites\site-editor\edit-site-dialog.tsx:276` | такой же тумблер «Активен» (строка 275 — `<Label className="text-sm">Активен</Label>` тоже без `htmlFor`); дополнительно у `<button>` нет `type="button"` | то же: элемент без имени и без состояния; диалог открыт в `<Dialog>` (строка 207), формы внутри нет (`<form>` в файле отсутствует — проверено `rg`), поэтому случайного submit не будет, но неявный тип кнопки — лишний риск при будущей правке | `type="button" role="switch" aria-checked={active} aria-label="Активен"` либо вынести на общий `Toggle` |
| 4 | мелочь | `D:\PillingR\wt-night\src\components\piling\admin-equipment\equipment-table.tsx:50,54,55,59` | сортировка по клику на `<th onClick={...}>` без `aria-sort`; вспомогательный `<th>` на строке 55 передаёт текст через проп `words` | Скринридер не сообщает, по какому столбцу идёт сортировка и в каком направлении — состояние списка недоступно. Это не иконочная кнопка, отмечено как смежное | добавить `aria-sort="ascending|descending|none"` на сортируемые `<th>` |
| 5 | мелочь | `D:\PillingR\wt-night\src\components\piling\to\maintenance-plans-panel.tsx:181` и `:190` | кнопки-сегменты «По моточасам» / «По календарю» без `aria-pressed` (текст виден, имя есть) | Выбранный вариант не озвучивается; смежное, не иконочная кнопка | `aria-pressed={trigger === 'HOURS'}` / `=== 'CALENDAR'` |

Проверено и отклонено (чтобы не перепроверять заново) — это 4 из 6 «жёстких» кандидатов скрипта:

| path:line | элемент | почему не находка |
|-----------|---------|-------------------|
| `...\admin-dictionaries\dictionary-table.tsx:216` | `<label onClick={stopPropagation}>` вокруг `<Checkbox aria-label={\`Выбрать ${item.name}\`}>` (строка 217) | имя у чекбокса есть; скрипт принял обёртку-`label` за иконочную кнопку |
| `...\admin-equipment\equipment-card-grid.tsx:146` | `<div role="button" onClick={...}>` с `<LayoutRenderer .../>` внутри | внутри карточка с текстом, «иконкой» скрипт счёл компонент с одними пропсами |
| `...\admin-equipment\equipment-table.tsx:55` | `<th onClick={() => toggle('reportStatus')}><StackedHeader words={['Статус','отчёта','↕']} /></th>` | текст в пропсах `words`, виден на экране |
| `...\admin-equipment\equipment-tile.tsx:140` | `<div onClick={stopPropagation}>` с `<QuickLink ... label="ТО"/>` и `<Link aria-label="Открыть карточку">` | подписи есть у детей |

26 кандидатов «имя из переменной» (весь список виден командой из §Методика п.3) проверены по строкам; в каждом рядом с иконкой рендерится текст переменной (`{t.label}`, `{item.label}`, `{STAGE_CTA[...]}`, `{link.text}`, `{SECTIONS[key]}`, `{r.text}` и т. п.). Постоянные счётчики: 16 таких в незамороженном коде + 10 в замороженном.

## Замороженные экраны (исключены, отдельный список)

Заморожены по AGENTS.md: `src/components/piling/operator*/**` и `src/components/piling/operator-dashboard.tsx` (всего 79 `.tsx` в этих путях вместе с ORION, из них 60 без тестов). В них найдено 29 иконочных интерактивных элементов, 19 — с подписью, 10 — без `aria-label`/`title`/`sr-only`. Все 10 получили имя из переменной рядом с иконкой (проверено по строкам), то есть нарушениями не являются. Правки не предлагаются — зона заморожена.

| path:line | элемент | имя приходит из | статус |
|-----------|---------|-----------------|--------|
| `src/components/piling/operator-dashboard.tsx:450` | `<button>` карточка смены | `{assignment.equipmentName}` и др. (строки 451-453) | ПРОЙДЕНО (не нарушение) |
| `src/components/piling/operator-mobile/screens/safety-tab.tsx:63` | `<button>` раскрытия шага | `{body}` (определён на строке 45, текстовый JSX) | ПРОЙДЕНО |
| `src/components/piling/operator-mobile/v10/v10-ui.tsx:111` | `<button>` вкладки | `<span>{tab.title}</span>` | ПРОЙДЕНО |
| `src/components/piling/operator-mobile/v7/operator-v7-app.tsx:456` | `<button>` дока | `{item.label}` | ПРОЙДЕНО |
| `src/components/piling/operator-mobile/v7/operator-v7-app.tsx:559` | `<button>` чек-листа | `{checklist.title}` и др. | ПРОЙДЕНО |
| `src/components/piling/operator-mobile/v7/v7-ui.tsx:33` | `<button className="back">` | `{back}` (проп-строка) | ПРОЙДЕНО |
| `src/components/piling/operator-mobile/v7/v7-ui.tsx:152` | `<button className="pick">` | `{children}` + `aria-pressed` | ПРОЙДЕНО |
| `src/components/piling/operator-v2/ui.tsx:202` | `<button>` вкладки | `{tab.label}` | ПРОЙДЕНО |
| `src/components/piling/operator-v3/operator-dashboard-v3.tsx:126` | `<button>` CTA | `{action.label}` | ПРОЙДЕНО |
| `src/components/piling/operator-v5/operator-v5-app.tsx:101` | `<button>` вкладки | `{tab.label}` | ПРОЙДЕНО |

ORION (тоже заморожен): 2 иконочных элемента, оба с подписью (`src/components/orion/orion-fleet.tsx`, `src/components/orion/orion-site.tsx`) — статус ПРОЙДЕНО.

## Что не проверено

- `src/app/**` (страницы, серверные компоненты) — НЕ ПРОВЕРЕНО: постановка ограничила область `src/components`. Там могут быть свои иконочные кнопки.
- `src/components/ui/*.tsx` разобраны по строкам (`dialog.tsx`, `sheet.tsx`, `toast.tsx`, `toaster.tsx`, `select.tsx`, `checkbox.tsx`, `alert-dialog.tsx`, `tabs.tsx`); полноценный AST-прогон по ним не делался, подписи найдены чтением. ПРОЙДЕНО частично.
- `src/components/ui/select.tsx:169` — `<ChevronDownIcon className="size-4" />` внутри `SelectPrimitive.ScrollDownButton`: radix обычно помечает такие кнопки `aria-hidden`, но я это не проверял — НЕ ПРОВЕРЕНО (и это не lucide-кнопка, а служебный элемент прокрутки).
- Динамическая сборка в рантайме (иконка приходит из layout-конфигурации пользователя, `LayoutRenderer`) — статический разбор не видит, что отрисуется. ГИПОТЕЗА: правило «подпись рядом с иконкой» соблюдается, но не доказано.
- Фокусные стили, контраст, порядок табуляции, `aria-live`, клавиатурная навигация — вне постановки, НЕ ПРОВЕРЕНО.
- Скрипт-разборчик статистический: он считает «текстом» любой строковый литерал в поддереве, поэтому возможны как ложные срабатывания (перечислены выше), так и пропуски, если подпись задаётся CSS-контентом. ГИПОТЕЗА: пропусков нет, подтверждено перекрёстной проверкой `rg` по `</button>`/`</Button>` и по `aria-label`.
- Тесты/линт/сборка не запускались: правок в код нет, а в рабочем дереве уже есть незакоммиченное изменение `AGENTS.md` (не трогал). НЕ ПРОВЕРЕНО.
