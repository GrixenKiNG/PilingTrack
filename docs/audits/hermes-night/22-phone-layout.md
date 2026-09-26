# 22. Неоператорские экраны на телефоне (375 px) — статический разбор вёрстки

Дата: 2026-09-26. Ветка: `hermes/q3-0925` (worktree `wt-night`). Метод: только чтение кода, браузер не запускался.

Роли из вопроса (диспетчер / механик / мастер) попадают в **админскую оболочку**, а не в операторскую:
`ADMIN | DISPATCHER | MECHANIC | FOREMAN | SAFETY_ENGINEER` → `AdminLayout` (`src/app/(app)/layout.tsx:270-281`).
Значит телефонные экраны этих ролей — это `/admin/*`, `/admin/maintenance/*`, `/admin/to*`, `/monitoring`, `/inspections*`, `/admin/reports`, `/admin/equipment`.
Операторские варианты (`operator*`) и сайт ORION исключены по условию задачи.

## Итог

* Всего находок: **41**. Критично — **4**, важно — **16**, мелочь — **21**.
* Ответ на вопрос «какие экраны ломаются на 375 px»: ломаются, в первую очередь, **«плотные» табличные экраны**, у которых вместо прокрутки стоит `overflow-hidden`:
  `EquipmentTable` (11 колонок) и `HistoryTable` в карточке установки (8 колонок) — содержимое обрезается, горизонтальной прокрутки нет.
* Отдельно и независимо от роли: панель уведомлений/обратной связи (`FeedbackCenter`) имеет жёсткую ширину **440 px** и на телефоне уезжает за левый край экрана — на **всех** экранах приложения.
* Ещё один системный дефект: общий компонент KPI-плиток `KPI_GRID` на телефоне ставит плитки по 2 в ряд, хотя тот же проект в другом файле прямо фиксирует, что плитке нужно ≥250 px и половины строки ей не хватает — числовые значения плиток на 375 px рассыпаются на переносы.
* Самый важный пункт — №1 в таблице: уведомления/обратная связь уезжают за край экрана на каждом экране (жёсткие 440 px при вьюпорте 375 px).

## Методика

Область: `src/components/piling/**` (кроме `operator*`) и `src/app/(app)/**/page.tsx`.
Категории проверялись грепом по фиксированным признакам (все команды можно повторить из корня репозитория):

```bash
# 1. Фиксированные ширины
grep -rn "w-\[[0-9]\+px\]\|min-w-\[[0-9]\+px\]\|w-\[min(\|max-w-\[" src/components/piling src/app/\(app\) --include=*.tsx | grep -v -i operator
grep -rn "width:[^;]*[0-9]\{3,\}px" src --include=*.css | grep -v -i operator
grep -rn "width: '[0-9]" src/components/piling --include=*.tsx | grep -v -i operator
# 2. Таблицы и их обёртки
grep -rn "<table" src/components/piling --include=*.tsx | grep -v -i operator      # затем сверка с overflow-x в том же файле
grep -rn "overflow-x\|overflow-hidden" src/components/piling --include=*.tsx | grep -v -i operator
# 3. Непереносимые подписи и обрезка
grep -rn "whitespace-nowrap\|text-nowrap\|flex-nowrap" src/components/piling --include=*.tsx | grep -v -i operator
grep -rn "truncate" src/components/piling --include=*.tsx | grep -v -i operator
# 4. Сетки без адаптивного префикса
grep -rn "grid-cols-[3-9]" src/components/piling --include=*.tsx | grep -v -i operator
grep -rn "grid-cols-" src/components/piling/to/readiness --include=*.tsx | grep -v "md:\|lg:\|sm:\|xl:\|2xl:"
# 5. Ряды кнопок без переноса
grep -rn "<Button" src/components/piling --include=*.tsx | awk -F: '{n=gsub(/<Button/,"<Button"); if(n>=2) print $1":"$2}'
```

Каждое попадание открывалось и читалось (`read_file`), в таблицу попали только строки, которые я действительно видел; номера строк — из этих чтений.
Правило пересчёта вводного текста в 375 px: ширина вьюпорта 375; админский контент — во всю ширину (сайдбар скрыт `<lg`, `src/app/(app)/layout.tsx:224-247`); внутри карточки с `p-3/p-4` полезная ширина ≈ 311–343 px; для контейнера в две колонки — ≈ 165 px на колонку.

Шкала:
* **критично** — появление горизонтальной прокрутки страницы **или** обрезка значения, по которому принимают решение (без возможности это значение увидеть);
* **важно** — таблица/контент требуют прокрутки, но обёртки нет; либо значение читается только частично (многоточие/перенос числа);
* **мелочь** — косметика: тесно, но данные видны; горизонтальная прокрутка есть, но локальная.

## Находки

| # | severity | path:line | problem | scenario / why it matters | fix |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/feedback-center.tsx:188` | `SheetContent ... className="w-[440px]"` — жёсткая ширина 440 px при вьюпорте 375 px | `SheetContent` базово задаёт `w-3/4` (`src/components/ui/sheet.tsx:63`), но `cn` = clsx+twMerge (`src/lib/utils.ts:4-6`), поэтому `w-[440px]` побеждает. Панель прижата вправо (`side="right"`), значит её левые ~65 px уходят за край экрана и текст шапки/списка обрезан по левому краю; собственной прокрутки по X у панели нет. Триггер стоит в обеих оболочках: `src/app/(app)/layout.tsx:200` (админ-сайдбар) и `:242` (мобильная шапка), т.е. дефект на каждом экране диспетчера/механика/мастера | `w-full max-w-[440px]` или `w-[min(440px,100vw)]` |
| 2 | критично | `src/components/piling/admin-equipment/equipment-table.tsx:41` (таблица :42, значения :104, :142) | 11-колоночная таблица (`Установка…Моточасы…ТО`) лежит в `div.overflow-hidden`; своей `overflow-x-auto` нет, `table-auto`, у ячеек `[&_td]:overflow-hidden` | На 375 px колонкам некуда расти и нечем прокручиваться: содержимое просто обрезается без скролла. Дополнительно «Моточасы» — `truncate` (:104), а метрики свай/бурения помечены `whitespace-nowrap` (:142), т.е. держат минимальную ширину. Диспетчер на телефоне теряет числа свай/бурения/простоя — те самые, по которым он сравнивает установки | заменить `overflow-hidden` на `overflow-x-auto` (или показать карточный режим, как `equipment-tile.tsx`) |
| 3 | критично | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:139` (таблица :141, шапка :144-152) | `HistoryTable`: 8 колонок (Дата/Смена/Объект/Оператор/Свай/Бурение/Простой) внутри `overflow-hidden rounded-lg border`, без `overflow-x-auto`, без `min-w-` | Таблица рендерится в карточке установки (`equipment-detail.tsx:325` — вкладка, `:396` — полная карточка) и в панели `/admin/equipment?…`, где на телефоне карточка идёт во всю ширину. Итог тот же, что в №2: колонки «Свай/Бурение/Простой» сжимаются и обрезаются, скролла нет | добавить обёртку `overflow-x-auto` (и `min-w-[640px]` у таблицы) |
| 4 | критично | `src/components/piling/admin-reports/report-evidence-preview.tsx:99` (ячейки :100-102, `HeaderFact` :225) | `grid grid-cols-3` для «Объект / Установка / Оператор», у значений `truncate` | Панель «Доказательства смены» на телефоне — во всю ширину (≈343 px), на колонку остаётся ≈114 px; длинные имена объектов и установок («УГБ-32 «Борей»») режутся многоточием. Диспетчер не может прочитать, по какому объекту/установке отчёт — это значение, по которому он и открыл панель | `grid-cols-1 gap-1 sm:grid-cols-3`, убрать `truncate` у значений |
| 5 | важно | `src/components/piling/kpi-tile.tsx:90` (обоснование :21-22, иконка :126) | `KPI_GRID = 'grid grid-cols-2 …'` — на телефоне всегда 2 плитки в ряд, при этом файл сам фиксирует «плитке нужно ≥250px» | В 375 px плитка получает ≈165 px, из них 80 px — фиксированная колонка иконки (`w-20`) и 32 px паддинги, т.е. под текст ≈37-50 px; значения `text-2xl … break-words` (:132) рвутся по цифрам, подписи вроде «Операторы на смене» — по буквам. Используется в `equipment-stats-bar.tsx:34` (6 плиток), `report-evidence-row.tsx:146`, `maintenance-board.tsx:255`, `fleet-dashboard.tsx:342`, `ops-kpi-bar.tsx:13`, в экранах техготовности. При этом соседний рендерер прямо отвергает половину строки: «On phones a KPI tile needs the full row… cannot fit into half of 358px» — `layout-editor/page-layout-renderer.tsx:18-21` | в `KPI_GRID` заменить `grid-cols-2` на `grid-cols-1 sm:grid-cols-2` |
| 6 | важно | `src/components/piling/ops-shell/ops-table.tsx:40` (ячейки :74) | Шапка колонок `hidden … lg:grid`, а на телефоне строки-«карточки» с теми же колонками идут подряд без подписей | Тот же приём используют «Объекты» (`admin-sites/index.tsx:180-226`, значения «88px/116px» только для десктопной сетки), «Пользователи» (`admin-users/admin-users.tsx:170-221`), «Отчёты». На 375 px человек видит 6-8 чисел подряд без названий: «12 480», «3», «18», «4 ч 30». Какое из них простой, а какое отчёты — не определить | на `<lg` печатать подпись колонки перед значением (`col.header` внутри `:74`) |
| 7 | важно | `src/components/piling/pile-journal/index.tsx:293` (ячейки :377, :381) | Таблица `min-w-[1100px]`, 13 колонок, ячейки `whitespace-nowrap`; обёртка `overflow-x-auto` есть (:292) | Страница прокрутку не ломает, но на телефоне мастер видит 3-4 колонки из 13 и должен возить таблицу вбок; колонки «Отказ, мм/уд» и «Решение» (:305, :308) — решающие для приёмки сваи — за экраном | для `<sm` свести строку в карточку (номер, дата, длина/глубина, отказ, решение) |
| 8 | важно | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:209` (таблица :210, шапка :213-216) | `OperatorRotationCard`: 4 колонки (Машинист/Период/Смен/Объект) в `overflow-hidden` без `overflow-x-auto` | Та же механика, что в №3: период печатается как «01.05.2026 – 18.06.2026» (:233) и на 343 px не помещается → обрезка без скролла | обёртка `overflow-x-auto` |
| 9 | важно | `src/components/piling/report-form/pile-section.tsx:109` (и `report-form/drilling-section.tsx:78`) | `truncate` на пути куста/пикета (`getPicketPath`) в строке записи | Куст/пикет — идентификатор места сваи; при многоточии мастер не понимает, к какому кусту отнесена свая, а исправлять это он пришёл именно в отчёт. В `drilling-section` то же для бурения | дать строке перенос (`break-words`) либо вынести путь в отдельную строку |
| 10 | важно | `src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:188` (значения :189-190) | Сетка `grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]` с `truncate` **и** на подписи, **и** на значении технической характеристики | Это паспорт установки (модель, объём бака, моточасы). На телефоне значение получает ≈150 px и режется; обрезка одновременно у подписи маскирует, о чём была строка | убрать `truncate` у `<dd>` и разрешить перенос |
| 11 | важно | `src/components/piling/admin-equipment/equipment-tile.tsx:113` | `grid grid-cols-3 gap-2` с тремя парами «подпись + значение» (`Metric`) внутри плитки парка | Плитка на телефоне во всю ширину, но 3 колонки дают ≈100 px на пару: подписи «сваи шт/м.п.», «бурение шт/м.п.» переносятся построчно, значения «12 / 145,5» ломаются | `grid-cols-1 sm:grid-cols-3` или сократить подписи на мобильном |
| 12 | важно | `src/components/piling/maintenance/maintenance-detail-panel.tsx:72` | `grid grid-cols-3` для «Объект / Бригада / Оператор» в панели наряда ТО | Панель на телефоне во всю ширину: ≈110 px на ФИО — «Петров П.П.» сжимается/переносится по словам. Механик сверяет, за кем закреплена установка | `grid-cols-1 sm:grid-cols-3` |
| 13 | важно | `src/components/piling/maintenance/maintenance-detail-panel.tsx:119` | То же `grid grid-cols-3` в блоке «Влияние» | Значения стоимости/часов на 3 колонки по ≈100 px; при «12 345 ₽» и подписях вроде «Трудозатраты» текст переносится в 2-3 строки | `grid-cols-1 sm:grid-cols-3` |
| 14 | важно | `src/components/piling/report-form/submit-bar.tsx:33` | «Итого за смену»: `grid grid-cols-3` с `text-lg font-mono` значениями вида «12 шт. / 340 м.п.» | Строка итогов на 375 px даёт ≈100 px на колонку при нужных ~160; числа переносятся внутри значения, и итог смены читается как каша. Экран `/report` (отчёт оператора) — в области файлов задачи, но по роли это оператор | `grid-cols-1 sm:grid-cols-3` либо уменьшить кегль на мобильном |
| 15 | важно | `src/components/piling/maintenance/work-order-form-dialog.tsx:296` | `grid grid-cols-3` с тремя `input type="date"` («План / Начато / Выполнено») внутри диалога | Диалог ограничен `max-w-[calc(100%-2rem)]` = 343 px, внутри `p-6` → ≈295 px, на поле ≈95 px; нативные date-инпуты имеют собственную минимальную ширину (~110-130 px), поэтому поля вылезают из своих ячеек и из рамки диалога. Прокрутки у `DialogContent` нет | `grid-cols-1 sm:grid-cols-3` |
| 16 | важно | `src/components/piling/maintenance/work-order-form-dialog.tsx:314` | Тот же `grid grid-cols-3` для «Моточасы / Затраты / Стоимость» | Числовые поля с подписями в ≈95 px: подпись переносится, поле сжимается до нечитаемого | `grid-cols-1 sm:grid-cols-3` |
| 17 | важно | `src/components/piling/inspections/start-inspection-form.tsx:251` (таблица :252, «Кол-во» :268) | Таблица расходников (Материал/Маркировка/Кол-во) в `overflow-hidden`, `w-full text-xs`, без `overflow-x-auto` | Колонка «Материал» содержит длинные русские наименования и примечания (:264-265), колонка «Кол-во» — `whitespace-nowrap` (:268). На 375 px таблице нечем прокручиваться: наименования либо рвутся по словам, либо обрезаны | `overflow-x-auto` + `min-w-[420px]` |
| 18 | важно | `src/components/piling/report-form/report-form.tsx:243` | `truncate` на названии выбранного объекта в шапке отчёта (там же `:242` — заголовок) | Объект определяет, куда уйдёт отчёт; при многоточии («Площадка Север…») на телефоне нельзя проверить выбор перед отправкой | перенос вместо обрезки (`break-words`) |
| 19 | важно | `src/components/piling/to/readiness/screens/briefings-screen.tsx:395` (обёртка :394) | Журнал инструктажей: `min-w-[1280px]` (≈11 колонок) в `overflow-x-auto` | Страница не едет, но на телефоне это 1280 px внутри 343 px — просматривать журнал инструктажей (экран инженера ОТ/мастера) практически нельзя; те же 640 px в журнале событий `:543` | для `<md` карточка записи (ФИО, вид записи, дата, результат) |
| 20 | важно | `src/components/piling/report-form/downtime-section.tsx:71` | `truncate` на комментарии простоя | Причина простоя — то, что читает диспетчер/механик; при многоточии причина теряется | перенос вместо `truncate` |
| 21 | мелочь | `src/components/piling/report-history.tsx:322` | `grid grid-cols-3 gap-3` с тремя кластерами «иконка + 12/345,6 + шт/м.п.» в карточке отчёта | `grid-cols-3` = `minmax(0,1fr)`, на 343 px колонка ≈103 px, а кластеру нужно ~130 → содержимое выходит за свою ячейку и наезжает на соседнюю (страница при этом не прокручивается) | `grid-cols-1 sm:grid-cols-3` |
| 22 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:115` | Карточный режим справочника: `dl grid grid-cols-3` («Отчёты / Планы / Обновлено») | Третья колонка несёт дату «15.09.2026» и получает ≈80 px → дата переносится на две строки | `grid-cols-2 sm:grid-cols-3` |
| 23 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:123` | `grid grid-cols-4` с четырьмя кнопками-иконками в карточке справочника | Иконки 44 px в 343 px — помещаются, но целевые зоны вплотную; на узких телефонах (320 px) ряд упирается в края | оставить, при необходимости `grid-cols-4` → `flex-1` |
| 24 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:101` | `truncate` на названии значения справочника в карточке | Названия марок свай («С 120.30-8» и длиннее) обрезаются в списке; в табличном режиме они видны целиком | в карточке разрешить перенос |
| 25 | мелочь | `src/components/piling/admin-users/user-detail.tsx:70` (подписи :78) | `TabsList grid grid-cols-6` с иконкой и `truncate`-подписью вкладки | Шесть вкладок на ≈320-375 px — по ~55 px на вкладку; подписи («Закрепление») усечены; авторский комментарий (:67-69) говорит, что так задумано, но на телефоне читается как набор многоточий | на `<sm` сделать вкладки горизонтально прокручиваемыми с полными подписями |
| 26 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:202` | `grid grid-cols-4` — четыре вкладки карточки установки | ≈85 px на вкладку: «Телеметрия» (длинная подпись) переносится либо жмётся к границе | `flex + overflow-x-auto sm:grid sm:grid-cols-4` |
| 27 | мелочь | `src/components/piling/admin-equipment/equipment-form.tsx:114` | `TabsList grid-cols-4 / grid-cols-3` с иконкой + текстом вкладки | Иконка 16 px + «Тех. характеристики» в ≈90 px — подпись переносится на 2-3 строки | убрать иконки на мобильном или перейти в прокручиваемый ряд |
| 28 | мелочь | `src/components/piling/maintenance/work-order-table.tsx:50` (обёртка :49, `max-w-32 truncate` :90 и :111) | Таблица 10 колонок `min-w-[1050px]` в `overflow-x-auto`; в ячейках «Бригада»/«Ответственный» — `max-w-32 truncate` | Прокрутка локальная (страница не едет), но на телефоне колонка «Действия» с четырьмя кнопками по 44 px и «Замечания» всегда за кадром; вложенные `truncate` режут ФИО даже при прокрутке | карточный режим для `<md` |
| 29 | мелочь | `src/components/piling/pile-journal/driving-sets.tsx:36` (обёртка :35) | `min-w-[420px]` на таблице ходов забивки | 420 > 375: даже одиночная вложенная таблица залогов требует горизонтальной прокрутки внутри раскрытой строки журнала | `min-w-[360px]` либо сжать подписи на мобильном |
| 30 | мелочь | `src/components/piling/admin-sites/index.tsx:407` | `grid grid-cols-3 divide-x` для «Бурение план / Бурение факт / Простой» | Значения в `OpsFact` помечены `truncate` (`ops-shell/ops-detail-panel.tsx:66`); на ≈100 px ячейку «12 345» и «4 ч 30 мин» сужаются до многоточия | `grid-cols-1 sm:grid-cols-3` |
| 31 | мелочь | `src/components/piling/admin-reports/report-evidence-row.tsx:222` | `grid grid-cols-3 justify-items-end` с шестью действиями строки отчёта (миниатюра + 5 кнопок) | В мобильной раскладке строка — одноколоночная, ширина 343 px: 3×44 px в ряд помещаются, но кнопки «Редактировать/Удалить» уезжают во второй ряд и визуально отрываются от миниатюры | сгруппировать действия в `flex flex-wrap` с подписями |
| 32 | мелочь | `src/components/piling/admin-analytics.tsx:292` | `w-36 truncate` на названии установки в блоке «Использование установок» | На телефоне 144 px жёстко резервируются под имя, остальное — полоса прогресса; имя установки всегда обрезано | `min-w-0 flex-1` вместо `w-36` |
| 33 | мелочь | `src/components/piling/to/to-module-bits.tsx:188` (значение :191) | `grid grid-cols-[118px_1fr] gap-3` + `truncate` на значении | 118 px жёстко под подпись остаются и на 375 px; длинные значения («Просрочено ТО: 2 из 7») режутся | `grid-cols-[minmax(90px,auto)_1fr]`, убрать `truncate` |
| 34 | мелочь | `src/components/piling/admin-crews/admin-crews.tsx:107` (и :109, :131) | `truncate` на названии бригады, объекте и установке | В списке бригад на телефоне названия объектов («Площадка Северная-2, 3-я очередь») и установок всегда с многоточием | разрешить перенос в мобильной карточке |
| 35 | мелочь | `src/components/piling/admin-users/admin-users.tsx:177` (и :178-179) | `truncate` на ФИО, e-mail и телефоне в строках списка пользователей | В мобильной раскладке `OpsTable` (см. №6) карточка занимает всю ширину, но e-mail и телефон режутся — а именно по ним ищут «кому звонить» | перенос e-mail/телефона |
| 36 | мелочь | `src/components/piling/admin-reports/report-detail-dialog.tsx:36`; `report-form-dialog.tsx:198`; `admin-sites/site-editor/create-site-dialog.tsx:67`; `edit-site-dialog.tsx:174` | `max-w-lg` **без** `sm:` побеждает базовое `max-w-[calc(100%-2rem)]` (`ui/dialog.tsx:74`, twMerge) | На 375 px диалог получает ширину ровно во вьюпорт: задуманные отступы 16 px исчезают, скруглённые углы липнут к краям экрана | `sm:max-w-lg` |
| 37 | мелочь | `src/components/piling/to/fuel-panel.tsx:157` | `grid grid-cols-3 gap-2 text-center` в сводке «Долив / Расход / л/моточас» | На ≈100 px подпись «Долив, 30 дн.» переносится на две строки, блок выглядит рассыпанным | `grid-cols-1 sm:grid-cols-3` |
| 38 | мелочь | `src/components/piling/admin-equipment/equipment-tile.tsx:100` | `truncate` на названии объекта в плитке установки | В плитке парка объект всегда с многоточием, хотя строка не единственная и место под перенос есть | перенос вместо обрезки |
| 39 | мелочь | `src/components/piling/inspections/inspections-list.tsx:99` | `truncate` на названии установки в строке осмотра | Строка и так `flex-wrap`, а имя установки режется — механик не различает однотипные установки | убрать `truncate`, оставить перенос |
| 40 | мелочь | `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:322` (обёртка :321), `:488` (обёртка :487) | Таблицы `min-w-[900px]` / `min-w-[760px]` в `overflow-x-auto` | Страница не прокручивается (обёртка есть), но на телефоне инженер ОТ возит таблицу вбок на 900 px | карточки для `<md` |
| 41 | мелочь | `src/components/piling/maintenance/work-order-table.tsx:90`, `:111` | `max-w-32 truncate` внутри ячеек «Бригада»/«Ответственный» | Даже при локальной прокрутке таблицы ФИО/название бригады обрезаны на 128 px — на телефоне список нарядов ТО превращается в «Иванов И…» | снять `max-w-32` на мобильном |

### Приложение: однотипные широкие таблицы в обёртках (мелочь, отдельно не расписывались)

Все они имеют `overflow-x-auto` рядом с таблицей, поэтому страница вбок не едет, но на 375 px требуют горизонтальной прокрутки внутри узкого блока:

* `src/components/piling/to/readiness/screens/employee-card.tsx:346` (`min-w-[520px]`, обёртка :345)
* `src/components/piling/to/readiness/screens/knowledge-screen.tsx:133` (`min-w-[680px]`, обёртка :132)
* `src/components/piling/to/readiness/screens/equipment-permit-matrix.tsx:227` (`min-w-[720px]`, обёртка :226)
* `src/components/piling/to/readiness/screens/fleet-screen.tsx:161` (карточка с `overflow-x-auto`)
* `src/components/piling/to/readiness/screens/permits-screen.tsx:235` (десктопная сетка `min-w-[760px]`; мобильный карточный вариант есть — `:248`)
* `src/components/piling/to/readiness/screens/shifts-screen.tsx:189`, `:193` (`min-w-[760px]`, только `md:`; мобильные карточки — `:229`)
* `src/components/piling/to/readiness/screens/reports-screen.tsx:492`, `:509-510` (`min-w-[860px]`, только `md:`; мобильные карточки — `:534`)
* `src/components/piling/to/readiness/settings/audit-section.tsx:85`, `:88` (`min-w-[820px]`, только `md:`; мобильные карточки — `:124`)
* `src/components/piling/to/readiness/settings/checklists-section.tsx:280`, `:290` (`min-w-[620px]`, обёртка :279)
* `src/components/piling/to/readiness/settings/dictionaries-section.tsx:137`, `:144` (`min-w-[760px]`, обёртка :136)
* `src/components/piling/to/readiness/settings/notifications-section.tsx:154`, `:160` (`min-w-[720px]`, обёртка :153)
* `src/components/piling/to/readiness/settings/roles-section.tsx:244`, `:257` (`min-w-[820px]`, обёртка :243)
* `src/components/piling/to/readiness/screens/settings-workspace.tsx:438`, `:442` (`min-w-[286px]`, обёртка :436)
* `src/components/piling/to/readiness-design-views.tsx:286` (`min-w-[820px]`), `:346` (`min-w-[940px]`) — обёртки :285, :345
* `src/components/piling/admin-analytics.tsx:341` (`overflow-x-auto` на `CardContent:340`)
* `src/components/piling/admin-dictionaries/dictionary-table.tsx:163` (обёртка :162)
* `src/components/piling/admin-reports/admin-reports.tsx:319-328` (шапка `lg:grid`, мобильная строка — `report-evidence-row.tsx:187`)

### Что проверено и оказалось в порядке (чтобы не искать заново)

* `KPI`-плитки дашборда `/admin`: полноширинная раскладка на телефоне — `layout-editor/page-layout-renderer.tsx:42` (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-12`) и явный комментарий на `:18-21`.
* `monitoring/fleet-dashboard.tsx:281` — сетка карточек через `minmax(min(100%, <px>), 1fr)`: настроенная ширина плитки не может вытолкнуть страницу вбок.
* `equipment-analytics.tsx:298` — десктопная таблица `hidden md:block`, для телефона есть карточный список (`:267-294`).
* `type=date`-поля фильтров ТО — `w-[150px]`, меньше 343 px, и стоят в `flex-wrap` (`briefings-screen.tsx:307`, `:312`).
* `feedback-center.tsx:209` — внутренние плитки `grid-cols-2` в 440 px панели (см. №1 — это уже про саму ширину панели).
* `layout-editor/layout-editor.tsx:164`, `:181` — мобильные панели редактора `w-[min(90vw,320px)]`, страницу не распирают.
* `pdf-preview-dialog.tsx:46` — `w-[95vw] max-w-[820px]`.
* `pile-journal/journal-title-block.tsx:33`, `:40`, `pile-detail.tsx:87`, `inspections/inspection-item-photos.tsx:177`, `inspections/inspection-controls.tsx:42`, `inspections/inspections-list.tsx:72`, `report-form/shift-info.tsx:45`, `forms/creation-form.tsx:126` — все сетки с `sm:`/`md:`-префиксами.
* Рядов из 3+ кнопок без `flex-wrap` вне таблиц статически не нашлось: единственные совпадения (`to/readiness/screens/shifts-screen.tsx:229`, `:243`) — это как раз мобильный вариант с `flex-1`/`grid-cols-2`; `admin-dictionaries.tsx:548` — `grid-cols-2` с двумя кнопками.
* Пропущенные по условию: `src/components/piling/operator*`, `src/app/operator*`, ORION (`src/app/orion/**`, `src/components/orion/**`).
* `briefings/briefing-journal-print.tsx:159` — это страница печати A4 (`src/app/print/briefing-journal/page.tsx`), к 375 px не относится.

## Не проверено

* **Браузер не запускался** (задача запрещает; в задаче — статический анализ). Все выводы о поведении flex/grid/таблиц — из чтения разметки и правил Tailwind, без замера `scrollWidth`. Поэтому формулировки «обрезается», «вылезает за рамку» в №2, №3, №8, №15, №16 — ожидаемое поведение по механике (`overflow-hidden` без скролла, `minmax(0,1fr)`, собственная минимальная ширина `input[type=date]`), а не измеренный факт.
* Не проверялось, действительно ли нативные `input type="date"` имеют минимальную ширину ~110 px в конкретном браузере владельца (№15, №16) — это зависит от движка и локали.
* Не проверялось, попадает ли `overflow` fixed-элементов (диалоги, sheet) в горизонтальную прокрутку документа в Chrome/Safari — влияет на формулировку №1 (обрезано содержимое) и №36 (полноэкранные диалоги).
* Не проверялась фактическая ширина панели `FeedbackCenter` в браузере: вывод сделан из `twMerge`-разрешения классов (`utils.ts:5` + `sheet.tsx:63` + порядок аргументов `cn` в `feedback-center.tsx:188`).
* `monitoring/design-tuning-panel.tsx`, `equipment-tile-template-settings.tsx`, `equipment-tile-editor.tsx` — просмотрены грепом по признакам задачи (fixed widths, grid-cols 3+, truncate, nowrap): совпадений нет, но рендер плитки с настроенной пользователем шириной (`template.card.width`) на телефоне не проверялся.
* `admin-telegram.tsx`, `admin-sites/hierarchy-tree.tsx`, `admin-equipment/detail/equipment-inspections.tsx`, `admin-equipment/detail/equipment-report-export.tsx`, `ops-shell/ops-filter-bar.tsx`, `analytics-dashboard/kpi-widgets.tsx`, `confirm-action-dialog.tsx` — по тем же признакам совпадений нет; вручную не читались, поэтому «не проверено» (а не «чисто»).
* Не проверялись экраны, доступные только с планшета/десктопа по замыслу (редактор шаблонов, диаграммы Recharts в `admin-analytics.tsx`) — они не входят в вопрос, хотя в области файлов.
* Оценка реальной полезной ширины (311–343 px) — расчётная, из `p-3/p-4` контейнеров; фактическая зависит от того, какие элементы шапки/сайдбара отрисованы.
