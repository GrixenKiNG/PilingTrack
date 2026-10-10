# AU62-S3-ADMIN-RESPONSIVE — Админ-панель на телефоне (375 px) и планшете по коду

Версия рабочей папки (git rev-parse HEAD, worktree D:\PillingR\wt-night, ветка hermes/q4-0926):
`5e1a8e396e82f9dcda017ada979acbd6d592b630`

Только чтение. Код приложения не менялся; создан один файл этого отчёта. Запускать
приложение запрещено — все выводы получены чтением исходников.

Область: компоненты `src/components/piling/admin-*`, общая оболочка `src/app/(app)/**`
и раздел `/admin/**` (`equipment`, `maintenance`, `checklists`, `settings`, `reports`,
`incidents`, `dlq`, `telegram`, `analytics`, `dictionaries`, `users`, `sites`, `crews`).
Замороженные области (варианты операторских экранов, сайт ORION) не проверялись.

## Итог

Найдено 31 наблюдение: **критично 0, важно 11, мелочь 20**. Данных-разрушающих и
security-проблем в адаптивности нет — это верстка. В целом админка сделана
аккуратно: до `lg` (1024 px) таблицы перестраиваются в карточки/строки, KPI-плитки
на телефоне идут в одну колонку, навигация уходит в выдвижной ящик, диалоги имеют
`max-w-[calc(100%-2rem)]` и `max-h-[90vh]`.

Топ-5:

1. `OpsTable` (`/admin/sites|users|crews`) — заголовок колонок без `gap-3`, строки с
   `gap-3` → подписи колонок не совпадают со столбцами на `lg` и шире
   (`ops-shell/ops-table.tsx:40` против `:68`).
2. Двухколоночный режим «таблица + панель» включается на `lg` (1024 px) в
   `/admin/equipment` (панель 520 px) и `/admin/dictionaries` (панель 380 px); на
   1024 px левой колонке остаётся ~184 px / ~324 px — таблица и вкладки не влезают
   (`admin-equipment.tsx:120`, `admin-dictionaries.tsx:449`). В `/admin/reports`,
   `/admin/sites`, `/admin/users` тот же режим включается на `xl` (1280) — правила
   не одинаковые.
3. Таблица парка `/admin/equipment` — 11 колонок без `min-w` и без перестройки
   (`equipment-table.tsx:46`); на 375 px колонки сжимаются/обрезаются.
4. Журнал нарядов ТО — `min-w-[1050px]` в `overflow-x-auto`
   (`maintenance/work-order-table.tsx:49`); на телефоне только горизонтальная прокрутка.
5. ГИПОТЕЗА: сетка `lg:grid-cols-[…]` внутри секции с `overflow-hidden` при
   недостаточной ширине обрезает правые колонки (`admin-reports.tsx:458,464`,
   `report-evidence-row.tsx:194`, `ops-table.tsx:38`) — на 1024–1227 px у «Отчётов»
   срезается колонка «Действия». Требует визуальной проверки.

## Методика

Всё — чтение файлов и поиск по репозиторию; приложение не запускалось. Команды
(Git Bash, из корня worktree), числа только из их вывода:

```
git rev-parse HEAD                 -> 5e1a8e396e82f9dcda017ada979acbd6d592b630
git status --short                 -> " M AGENTS.md"  (правка не моя, не трогал)
git branch --show-current          -> hermes/q4-0926
wc -l src/components/piling/admin-*.tsx src/components/piling/admin-*/*.tsx
                                   -> 11736 строк (47 файлов)
wc -l src/components/piling/ops-shell/*.tsx  -> таблица/страница/панель (108+107+136+50)
```

Поиск по коду (search_files, ripgrep):

- `admin*` в `src/components/piling` — 27 путей;
- `<table|<thead|<tbody` по `src/components/piling` — 17 файлов;
- `w-[Npx]|min-w-[Npx]|max-w-[Npx]|h-[Npx]` по `src/components/piling` — 121 совпадение;
- `grid-cols-[2-9]` без префикса брейкпоинта по `src/components/piling` — 78 совпадений;
- `DialogContent|SheetContent|AlertDialogContent` — 99 совпадений (перечень ширин диалогов);
- в `to/readiness` — `hidden … md:(grid|block)`, `md:hidden`, `overflow-x-auto` — 33 совпадения.

Арифметика «минимальная ширина сетки» — это расчёт по классам (`minmax(155px,1.35fr)`
и т. п.), не результат работы приложения; такие строки помечены ГИПОТЕЗА.

Статусы в таблицах ниже: **ПРОЙДЕНО** — проверено чтением и претензий нет;
**ГИПОТЕЗА** — вывод из кода/арифметики, визуально не подтверждён;
**НЕ ПРОВЕРЕНО** — не смотрел (см. раздел «Не проверено»).

## Как ведут себя экраны на 375 px

| Экран | Компонент | Поведение на 375 px | файл:строка | Риск |
|---|---|---|---|---|
| /admin (Дашборд) | admin-dashboard | Секции в одну колонку (`grid-cols-1`), KPI-плитки в одну колонку, фильтры `flex-wrap`. ПРОЙДЕНО | `admin-dashboard.tsx:489`, `kpi-tile.tsx:92` | низкий |
| /admin/analytics | admin-analytics | Таблица операторов в `overflow-x-auto`, ячейки `whitespace-nowrap` → горизонтальная прокрутка внутри карточки | `admin-analytics.tsx:376,399` | средний |
| /admin/dictionaries | admin-dictionaries + dictionary-table | Мобильный режим по `matchMedia(max-width:1023px)` → карточки, а не таблица. Вкладки в `overflow-x-auto`. ПРОЙДЕНО | `admin-dictionaries.tsx:62,469`, `dictionary-table.tsx:93` | низкий |
| /admin/users | OpsPage + OpsTable | Ниже `lg` строки-ячейки стекаются в столбик (шаблон сетки не применяется), заголовки скрыты. На `lg`+ — см. находки 1–3, 12 | `ops-table.tsx:40,68`, `user-detail.tsx:86` | средний |
| /admin/sites | OpsPage + OpsTable | Так же: карточки на телефоне; панель объекта уходит под список | `ops-table.tsx:40,68`, `admin-sites/index.tsx:461` | средний |
| /admin/crews | OpsPage + OpsTable | Так же | `ops-table.tsx:40,68`, `admin-crews.tsx:294` | средний |
| /admin/equipment | equipment-table (вид «Таблица») | 11 колонок, `w-full table-auto` без `min-w`; сжимаются/обрезаются, перестройки нет | `equipment-table.tsx:46,47` | высокий |
| /admin/maintenance | work-order-table | `min-w-[1050px]` + `overflow-x-auto` → только горизонтальная прокрутка | `maintenance/work-order-table.tsx:49,50` | средний |
| /admin/reports | EvidenceReportRow | Строка-сетка стекается в один столбик (заголовок `hidden … lg:grid`); на 375 — ПРОЙДЕНО, риск обрезки на 1024–1227 px | `report-evidence-row.tsx:194`, `admin-reports.tsx:464` | средний |
| /admin/incidents | admin-incidents | Карточки (`<ul>/<li>`), без таблиц. ПРОЙДЕНО (мелкие кнопки) | `admin-incidents.tsx:233` | низкий |
| /admin/dlq | admin-dlq | Карточки, без таблиц. ПРОЙДЕНО | `admin-dlq.tsx:311` | низкий |
| /admin/telegram | admin-telegram | Карточки, без таблиц. ПРОЙДЕНО | `admin-telegram.tsx:324` | низкий |
| /admin/settings | workspace-settings | Вкладки в `overflow-x-auto`, карточки в одну колонку. ПРОЙДЕНО | `workspace-settings.tsx:213,232` | низкий |
| /admin/checklists | template-list / template-editor | Список — карточки (`<ul>/<li>`); редактор `max-w-3xl`. ПРОЙДЕНО (мелкая цель удаления) | `template-list.tsx:141,164`, `template-editor.tsx:273` | низкий |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/ops-shell/ops-table.tsx:40` (заголовок) и `:68` (строка) | Заголовок колонок `… lg:grid lg:[grid-template-columns:var(--ops-cols)]` без `gap-3`; строка — тот же шаблон, но с `gap-3`. `fr`-колонки делят остаток от разной ширины, поэтому подписи не совпадают со столбцами на `lg` и шире. ПРОЙДЕНО (по коду) | Диспетчер на ноутбуке читает «Отчёты» под колонкой «Сваи план/факт»; на `/admin/sites`, `/admin/users`, `/admin/crews` все три таблицы | Добавить `lg:gap-3` заголовку (или убрать `gap-3` у строки) |
| 2 | важно | `src/components/piling/ops-shell/ops-table.tsx:38` + `ops-page.tsx:50` | Секция таблицы `overflow-hidden`; левая колонка при `xl` = ширина минус панель (по умолчанию 520 px) и минус `gap-4`. Минимум сетки `/admin/users` ≈ 754 px, `/admin/sites` ≈ 732 px (ГИПОТЕЗА, расчёт по `minmax`) | На 1280–1534 px (ноутбук, iPad landscape) и даже на 1440 правая часть колонок (Статус, Действия) обрезается без прокрутки — обрезка не видна как обрезка | Разрешить `overflow-x-auto` на секции либо включать панель на более широком брейкпоинте / уменьшать `minmax` |
| 3 | важно | `src/components/piling/admin-reports/admin-reports.tsx:458` и `:464`; `report-evidence-row.tsx:194` | Шапка и строки отчётов — `lg:grid-cols-[116px_minmax(170px,1.2fr)_minmax(150px,1fr)_86px_92px_86px_152px]` внутри `overflow-hidden`, и у шапки нет `gap-3`, у строки есть. Минимум сетки ≈ 924 px (с зазорами) — ГИПОТЕЗА | На `lg` (1024) доступно ≈ 720–975 px → колонка «Действия» срезается; плюс рассинхрон шапки и строк | То же: `overflow-x-auto` секции и `lg:gap-3` шапке |
| 4 | важно | `src/components/piling/admin-equipment/admin-equipment.tsx:120` (и `:42`) | Двухколоночный режим включается на `lg` с панелью 520 px: `lg:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]`. На 1024 px левой колонке остаётся ≈ 184 px (768 − 48 − 520 − 16) | На iPad landscape/небольшом ноутбуке список парка (плитки `sm:grid-cols-2`) и таблица 11 колонок превращаются в полосу ~85–184 px | Включать панель на `xl`, как в `OpsPage`/`/admin/reports`, либо уменьшать стартовую ширину панели |
| 5 | важно | `src/components/piling/admin-dictionaries.tsx:449` (и `:117`) | То же с панелью 380 px: на 1024 px левая колонка ≈ 324 px; сводка `md:grid-cols-3` и вкладки «Сваи/Бурение/Простои» (`px-6` на вкладку) не влезают | Админ на планшете видит разрезанную сводку и прокрутку вкладок | На `xl` включать панель (или явный `md`-брейкпоинт перестройки сводки в одну колонку) |
| 6 | важно | `src/components/piling/admin-equipment/equipment-table.tsx:46` и `:47` | Таблица 11 колонок: `w-full table-auto`, без `min-w`, обёртка `overflow-x-auto`; часть ячеек `truncate`/`overflow-hidden`, часть `whitespace-nowrap` (`CompactMetric`) | На телефоне в режиме «Таблица» либо нечитаемо сжатые колонки, либо неполная прокрутка — не перестроено под узкий экран | На узком экране показывать `EquipmentTile` (как дефолт) либо перестраивать строку в карточку, как `OpsTable` |
| 7 | важно | `src/components/piling/maintenance/work-order-table.tsx:49` и `:50` | `overflow-x-auto` + `min-w-[1050px]`; часть колонок `max-w-32 truncate` | На 375 px и в портрете планшета журнал нарядов ТО доступен только перетаскиванием по горизонтали | Перестроить строку в карточку ниже `md` (шаблон уже применён в `to/readiness`) |
| 8 | важно | `src/components/piling/admin-analytics/admin-analytics.tsx:376` и `:399–400` | Таблица операторов `w-full text-sm` в `CardContent overflow-x-auto`; колонки «Сваи/Бурение» и заголовок «Доля простоя в смене, %» не переносятся → широкая сетка | На телефоне аналитика операторов читается по горизонтали, часть столбцов вне экрана | Скрывать второстепенные колонки ниже `sm` или давать `whitespace-normal`/карточки |
| 9 | важно | `src/components/piling/admin-analytics/admin-analytics.tsx:323,493,532` | Фиксированные пиксельные `max-h-[195px]`, `max-h-[92px]` в карточках аналитики; у «Топ проблемных установок» нет `overflow-x` | На низком экране списки обрезаны, а признака «есть ещё» нет; на телефоне прокрутка идёт внутри карточки высотой 92 px | Заменить на `max-h-[min(…,50vh)]` или показывать индикатор |
| 10 | важно | `src/components/piling/admin-reports/report-evidence-row.tsx:229` | Блок действий — `grid grid-cols-3 justify-items-end gap-1` с 6 кнопками (каждая 44×44) + миниатюра; при стеке на телефоне это 2 ряда по 3 кнопки | Строка отчёта на телефоне высокая, кнопки «Подробнее/Редактировать/Удалить» во второй строке легко перепутать | На телефоне выносить действия в отдельный ряд-меню или `grid-cols-3 sm:grid-cols-6` |
| 11 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:305–312, 353–362, 397–404` | Строки добавления — `flex gap-2`: `Select flex-1` + один-два `Input w-20` + кнопка. У `SelectTrigger` нет `min-w-0` (ГИПОТЕЗА) | В диалоге шириной ~343 px на телефоне селект «Тип скважины» может выталкивать поля за край | Дать `min-w-0` селекту и переносить поля на вторую строку ниже `sm` |
| 12 | мелочь | `src/components/piling/admin-users/user-detail.tsx:86` | `TabsList grid grid-cols-6` — шесть вкладок с иконкой и подписью `truncate` | На узкой панели (особенно при находке 4 на другом экране) подписи обрезаются; задумано осознанно (комментарий строки 83–85) | Оставить; при переработке панели — вертикальный список вкладок |
| 13 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:217` | Встроенная шапка «Обзор/Работа/Телеметрия/Паспорт/Закрепление» — `grid grid-cols-4` (или 5) | В узкой правой панели (см. находку 4) подписи вкладок сжимаются до ~46 px | Включать `grid-cols-2` в узкой панели |
| 14 | мелочь | `src/components/piling/inspections/template-editor.tsx:325` | `grid grid-cols-2 gap-3` без `sm:` — два селекта всегда в две колонки | На 375 px два `Select` («Вид ТО», «Тип блока») по ~165 px | `grid-cols-1 sm:grid-cols-2` |
| 15 | мелочь | `src/components/piling/admin-dlq.tsx:270–273` | Кнопки-фильтры (`Ожидают/Повтор…/Отброшены/Все`) без `min-h-11` (в отличие от `ops-filter-bar.tsx:36`) | На телефоне цель ~26 px — ниже 44 px, принятых в проекте (`globals.css:211`) | `min-h-11 sm:min-h-9`, как в фильтрах Ops |
| 16 | мелочь | `src/components/piling/admin-incidents.tsx:195` | Кнопки `Ждут разбора/Все` — `min-h-9` (36 px) | На планшете палец попадает не всегда | `min-h-11 sm:min-h-9` |
| 17 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:411` (и даты `:426,434` — `h-9`) | Быстрые фильтры `min-h-9`, поля дат `h-9` | 36 px-цели на сенсорном экране | `min-h-11 sm:min-h-9` |
| 18 | мелочь | `src/components/piling/admin-dictionaries.tsx:560` | `min-h-[calc(100vh-7rem)]` у панели сведений | На низком окне панель принудительно высокой, пустой низ тянет прокрутку | `min-h` убрать или ограничить `lg:min-h-0` |
| 19 | мелочь | `src/components/piling/admin-equipment/equipment-filters.tsx:68` | `min-w-[200px]` у поля поиска внутри левой колонки, которая на `lg` сужается (см. находку 4) | В узкой колонке поле 200 px выталкивает остальные селекты/строку | `min-w-0` + перенос строк |
| 20 | мелочь | `src/components/piling/inspections/template-list.tsx:164` | Кнопка удаления шаблона — `rounded p-1`, только иконка, без 44 px | На телефоне промах по «Деактивировать» рядом со ссылкой-строкой | `min-h-11 min-w-11 sm:min-h-0 sm:min-w-0` |
| 21 | мелочь | `src/components/piling/admin-analytics/admin-analytics.tsx:328` | Имя установки зафиксировано `w-36` (144 px) в строке использования | На 375 px под имя уходит 144 px из ~311 px, полоса почти не видна | `w-24 sm:w-36` |
| 22 | мелочь | `src/components/piling/admin-dashboard.tsx:421` | Кнопка «Обновить дашборд» — `h-9 w-9` (36 px) | На сенсорном экране цель меньше 44 px | `h-11 w-11 sm:h-9 sm:w-9` |
| 23 | мелочь | `src/components/piling/admin-dashboard.tsx:383–416` | Фильтры дашборда — `input/select` без `min-h-11` (кнопки периода — `min-h-11 sm:min-h-0`) | Смешанные высоты в одной строке; на телефоне часть целей ~28 px | Выровнять по 44 px на узком экране |
| 24 | мелочь | `src/components/piling/admin-telegram.tsx:365–406` | Панель действий карточки — `text-xs` кнопки `px-2 py-1.5` без минимальной высоты | Четыре действия («Тест/Редактировать/…/Удалить») на телефоне мелкие | `min-h-11 sm:min-h-0` на кнопки действий |
| 25 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:172` | Панель деталей (`aside`) без `overflow-hidden`/`min-w-0` в самом `<aside>`; обрезка регулируется левой колонкой, а не панелью | При очень узкой левой колонке панель 520 px может выходить за пределы контейнера на `lg` | Добавить `min-w-0` и ограничение ширины панели по контейнеру |
| 26 | мелочь | `src/components/piling/maintenance/maintenance-board.tsx:315–355` | Фиксированные ширины селектов `w-[138px] w-[128px] w-[150px] w-[118px] w-[128px] w-[74px]` | На 375 px строка фильтров переносится на 4–5 строк (перенос есть, `flex-wrap`) и занимает весь экран по высоте | Оставлять как есть; при желании — сворачивать фильтры на телефоне |
| 27 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:42` (и `admin-dictionaries.tsx:117`) | Стартовая ширина панели задана «магическим» числом (`520`/`380`) и хардкодит 2-колоночную раскладку на `lg` | Связь с находками 4–5: именно это число сжимает левую колонку | Вычислять от брейкпоинта/контейнера, а не константой |
| 28 | мелочь | `src/components/ui/dialog.tsx:74` (и `alert-dialog.tsx:57`) | Базовый диалог — `w-full max-w-[calc(100%-2rem)] … sm:max-w-lg`, но многие вызывающие передают свой `max-w-*`; `cn` = `twMerge` (`src/lib/utils.ts:5`), поэтому переданный `max-w-lg` затирает `max-w-[calc(100%-2rem)]` | У диалогов с `max-w-lg` без `sm:` на телефоне пропадает боковой отступ в 1 rem (края вплотную) | Не передавать `max-w-*` без `sm:`; для мобильного отступа оставлять базовый |
| 29 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:126,134` | Мобильная карточка: `grid grid-cols-3` (метрики) и `grid grid-cols-4` (действия) | На 375 px 4 кнопки по ~84 px с подписями `text-3xs` — тесно, но читаемо; замеров нет (ГИПОТЕЗА) | При необходимости `grid-cols-2` для действий |
| 30 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:584`, `permits-screen.tsx:220` | Разделы техготовности/ТБ: `grid-cols-2 … sm:grid-cols-5`, `grid-cols-2 … lg:grid-cols-4` | На 375 px по 2 колонки — приемлемо; отмечено как проверенное место | Оставить |
| 31 | мелочь | `src/components/piling/to/readiness/screens/*screen.tsx` (напр. `permits-screen.tsx:253,256`, `reports-screen.tsx:537,555`, `shifts-screen.tsx:192,198`) | Таблицы техготовности: `overflow-x-auto` + `hidden … md:grid/md:block` и отдельный `md:hidden` мобильный список | На телефоне таблица заменяется карточками (ПРОЙДЕНО), на планшете — прокрутка. Единая и понятная схема; админских разделов не касается напрямую | Оставить как образец для `equipment-table`/`work-order-table` |

### Что по коду сделано хорошо (ПРОЙДЕНО, чтобы не переделывать)

- Мобильная навигация админки: сайдбар `hidden lg:fixed lg:w-64`, ниже `lg` —
  `Sheet`-ящик (`src/app/(app)/layout.tsx:241,245,253`).
- Оболочка `main` сдвигается `lg:ml-64` только на широком экране
  (`src/app/(app)/layout.tsx:267`).
- KPI-сетка: одна колонка на телефоне, две от `sm`, N колонок от `lg`
  (`src/components/piling/kpi-tile.tsx:92`); пояснение «плитке нужно ≥250 px» там же.
- `PageLayoutRenderer` — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-12`
  (`layout-editor/page-layout-renderer.tsx:55`).
- `OpsTable` ниже `lg` перестраивает строку в столбик и прячет заголовки
  (`ops-table.tsx:40,68`).
- Справочники: переключение таблица↔карточки по `matchMedia(max-width:1023px)`
  (`admin-dictionaries.tsx:58–70`, `dictionary-table.tsx:93,174`).
- Диалоги: `max-w-[calc(100%-2rem)]`, `sm:max-w-lg`, `max-h-[90vh]`, прокрутка
  (`ui/dialog.tsx:74`, `admin-users/user-dialogs.tsx:136,292`, `admin-telegram.tsx:416`).
- Вкладки настроек и справочников в `overflow-x-auto`
  (`workspace-settings.tsx:213`, `admin-dictionaries.tsx:469`).
- `viewport`: `device-width, initialScale 1, viewportFit cover` (`src/app/layout.tsx:66`).
- Пол «читаемости» и 44 px-цели для полевых экранов
  (`src/app/globals.css:337–347`), хит-таргеты `.hit-target`/`.row-actions`
  (`globals.css:185–212`).
- Переключатель вида установок имеет `min-h-11 sm:min-h-0`
  (`admin-equipment/equipment-view-toggle.tsx:28`).

## Не проверено

- Приложение не запускалось: **все** утверждения о фактическом виде на 375/1024/
  1280 px — ГИПОТЕЗА, собранная из Tailwind-классов и арифметики. Проверка — только
  визуально (Playwright/браузер) в реальном окне; замеров `scrollWidth` vs
  `clientWidth` не делалось.
- Растровые проверки не проводились (скриншотов нет).
- Не открывались (по правилу независимости): существующие отчёты в
  `docs/audits/` (кроме перечисления имён каталога), `CODEX-REPORT*`, `docs/strategy`.
- Не читались (остались вне проверки): `pdf-preview-dialog.tsx` (кроме строки 46),
  `layout-editor/*` целиком, `to/readiness/**` целиком (проверены только паттерны
  `hidden md:grid`/`overflow-x-auto` через поиск), `admin-equipment/detail` части
  (`equipment-photos`, `equipment-monitoring`, `equipment-documents`,
  `equipment-report-export`, `equipment-inspections`, `equipment-maintenance`),
  `admin-users/user-documents.tsx`, `user-document-types-dialog.tsx`,
  `admin-sites/site-editor/*`, `admin-crews/crew-form-dialog.tsx` (кроме диалогов),
  `monitoring/fleet-dashboard.tsx`, `equipment-analytics.tsx` (кроме строки `grid-cols-2`),
  `admin-analytics-bits.tsx` (кроме плитки ТО).
- Не проверено поведение `admin-analytics.tsx:305,456` (recharts `ResponsiveContainer`)
  на узком экране — библиотека сама считает ширину, по коду не видно.
- Ширины/высоты диалогов указаны по коду; реальный `max-h` с учётом клавиатуры
  телефона не измерялся.
- Экран `/admin/equipment/[id]` (страница) и встроенный режим используют один
  `equipment-detail.tsx`; проверялась только ветка `embedded`.
</content>
