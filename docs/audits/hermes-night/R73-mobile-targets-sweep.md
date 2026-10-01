# R73 — Мелкие цели нажатия (<44px) на телефоне: обход экранов /admin/** и компонентов src/components/piling/**

Только чтение: код не менялся, ни один существующий файл не тронут. Задача — найти кнопки, переключатели, чекбоксы и ссылки-действия высотой меньше 44px на ширине <640px на экранах, которые НЕ входят в список исправленных за ночь 30.09 (Отчёты, Мониторинг, Настройки, Бригады, Объекты, Справочники, Дашборд), и назвать топ-5 экранов для следующих задач F-MOB-*.

## Итог

- Всего находок: **57** (критично — 3, важно — 34, мелочь — 20). Одна находка = одно место правки; одинаковые контролы одного экрана сведены в одну строку, чтобы отчёт читался.
- Хорошая новость: приём правки один и тот же и уже принят в проекте — `min-h-11 … sm:min-h-…` (или `sm:min-h-0`), см. `workspace-settings.tsx:233`, `admin-crews.tsx:268`, `equipment-view-toggle.tsx:28`. Десктоп при этом не меняется.
- Плохая новость: три экрана построены на `h-8`/`h-9`/`size="sm"` почти целиком — **Журнал забивки (/admin/piles)**, **ТО (/admin/maintenance)** и **Осмотры (/inspections)**; там правки идут пачкой в одном-двух файлах.
- Отдельно: контуры **ТБ и допуски (`/admin/safety`, компоненты `to/readiness/**`)** и **Центр готовности (`/admin/to`)** уже закрыты CSS — `globals.css:337–341` поднимает `button, select, input, a.inline-flex` до 44px внутри `.tech-readiness-module` при `max-width:767px`. Поэтому в таблице их нет (см. «Методика», п.6). Чего CSS не покрывает — чекбоксы, `div[role=button]` и ссылки без `inline-flex`; таких в `to/**` не нашлось. Исключение — панели `to/fuel-panel.tsx` и соседние: они стоят в карточке установки, **вне** `.tech-readiness-module` (№55, №56).
- Топ-5 экранов для следующих задач F-MOB-* (по выгоде «число правок → закрытых полевых действий»):
  1. **`/admin/piles` — Журнал забивки** (мастер, телефон): фильтры 32px, «Выгрузить журнал» 32px и «Принять сваю»/«На добивку» 32px — подпись решения мастера по свае.
  2. **`/admin/maintenance` — ТО** (механик, телефон): чипы фильтров 32px, 5 селектов 36px, кнопки наряда 32px, «Закрыть ТО»/«Печать» 36px, пагинация 32px.
  3. **`/inspections` — осмотры** (оператор/механик, телефон): кнопки ответа «Да/Нет» 32px и «Исправно/Замечание/Неисправно/Не проверено» 28px — самая частая полевая цель в продукте; шаги разделов 36px.
  4. **`/admin/equipment` — Установки** (механик, телефон): «ТО»/«Документы» в плитке 28px, «Добавить фото» 28px, переключатель «Активна» 40×24, сортировка таблицы 32px, 5 селектов фильтра 32px, чипы периода отчёта 24px.
  5. **`/admin/users` + `/monitoring`** (кабинеты, но цели мелкие): «Редактировать/Заблокировать/Удалить» 32px, правка/удаление документа 36×36; ретраи-ссылки и фильтры мониторинга 20–32px.

## Методика

Что и как искал (воспроизводимо):

1. Прочитал `AGENTS.md` (модель доверия; замороженные зоны; «выглядит мёртвым, но должно остаться»). Операторские `operator*/**` и ORION не трогал — по задаче.
2. Собрал точный список исправленного за ночь, чтобы не переписывать чужую работу: `git log origin/main..HEAD` → F-MOB-REPORTS-BUTTONS (`report-evidence-row.tsx`), F-MOB-MONITORING-BUTTONS (`equipment-analytics.tsx`), F-MOB-SETTINGS (`workspace-settings.tsx`), F-MOB-CREWS-ACTIONS, F-MOB-SITES-ACTIONS, F-MOB-DICT-CHECKBOX, F-MOB-DASH-PERIOD, F-MOB-READINESS-TEXT. Прочитал диffы — принятый приём: `min-h-11 sm:min-h-0` / `h-11 sm:h-9`.
3. Определил область: страницы `/admin/**` = `src/app/(app)/admin/**` **плюс** две группы вне этой папки, но по тому же URL — `(readiness-admin)/admin/to/**` и `(safety)/admin/safety/**`; компоненты — `src/components/piling/**` без `operator*` и без `__tests__`.
4. Область реального использования: `src/app/(app)/admin/layout.tsx:12` пускает в раздел `ADMIN, DISPATCHER, FOREMAN, MECHANIC, SAFETY_ENGINEER`; `(safety)/layout.tsx:17–23` — вообще всем ролям, включая машиниста и помощника. Отсюда оценка «частота в поле».
5. Цели искал по шаблонам: `size="sm"` (h-8 = 32px), `size="icon"` (size-9 = 36px), дефолтный `Button` (h-9 = 36px, `button.tsx:25–28`), `h-8`, `h-9`, `min-h-9`, `py-1`/`py-1.5`/`py-2` + `text-xs`/`text-2xs`, `type="checkbox"`/`Checkbox`, `role="switch"`, `role="button"`, ссылки-действия `<Link class="… py-…">`. Размеры считал из классов Tailwind (`text-xs` 16px, `text-sm` 20px, `py-1` 8px, `py-1.5` 12px, `py-2` 16px) и токенов `globals.css`.
6. Учёл два готовых рычага: `.hit-target` (`globals.css:185–200`, 24px всегда и 44px при `pointer:coarse`/`max-width:767px`) и `globals.css:337–341` (44px для `button, select, input, a.inline-flex` внутри `.tech-readiness-module`). Поэтому чекбоксы (`checkbox.tsx:21` уже с `hit-target`) и почти весь `to/**` в находки не попали — иначе отчёт был бы на треть ложным.
7. Каждую строку открывал и читал в контексте (`read_file`/`sed -n`), а не по одному grep-совпадению.

Ограничения метода: приложение не запускал, браузером не мерил — размеры расчётные из классов (±2px на шрифт/переносы); «частота в поле» — оценка по ролям из `layout.tsx`, а не по статистике использования.

## Находки

Столбцы: элемент и текущий размер (расчёт из классов) · частота в поле (мастер/механик/диспетчер с телефона) · предлагаемая правка. Правка везде — «только телефон»: `min-h-11`/`h-11` с откатом `sm:min-h-0`/`sm:h-9`.

### А. `/admin/piles` — Журнал забивки (мастер; телефон — да)

| № | severity | path:line | элемент / сейчас | почему важно | предлагаю |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/pile-journal/pile-detail.tsx:135, 139` | «Принять сваю» и «На добивку», `size="sm" … h-8 text-xs` → 32px | главное полевое решение мастера по свае, принимается с телефона у машины; промах падает на соседнюю кнопку пары | `className="h-11 text-xs sm:h-8"` |
| 2 | важно | `src/components/piling/pile-journal/index.tsx:202` | «Выгрузить журнал (.xlsx)», `size="sm" … h-8` → 32px | выгрузка журнала — регулярное действие мастера с телефона | `h-11 sm:h-8` |
| 3 | важно | `src/components/piling/pile-journal/index.tsx:211–219` | 4 кнопки статуса-фильтра («Все/Принятые/…»), `size="sm" … h-8` → 32px | основной фильтр экрана; ряд кнопок идёт прямо под палец | `min-h-11 sm:min-h-8` |
| 4 | важно | `src/components/piling/pile-journal/index.tsx:226, 239, 248, 258` | `<select>` «Объект», два `<input type=date>`, «№ сваи» — `h-8` → 32px | фильтры берутся пальцем на объекте | `min-h-11 sm:h-8` |
| 5 | мелочь | `src/components/piling/pile-journal/index.tsx:266` | «Сбросить» (фильтры), `size="sm" variant="ghost" h-8` → 32px | редкое действие рядом с фильтрами | `min-h-11 sm:min-h-8` |

### Б. `/admin/maintenance` — ТО и наряды (механик; телефон — да)

| № | severity | path:line | элемент / сейчас | почему важно | предлагаю |
|---|---|---|---|---|---|
| 6 | важно | `src/components/piling/maintenance/maintenance-board-bits.tsx:19` | `QuickChip`, `h-8 px-3 text-xs` → 32px | 6 чипов быстрого фильтра в шапке журнала ТО (`maintenance-board.tsx:271–276`) — первое, что нажимает механик | `min-h-11 sm:min-h-8` |
| 7 | важно | `src/components/piling/maintenance/maintenance-board.tsx:281, 291, 301, 311, 321` | 5 `<SelectTrigger className="h-9 …">` (установка/объект/исполнитель/тип/приоритет) → 36px | компактные селекты фильтра, все под палец | `h-11 sm:h-9` |
| 8 | важно | `src/components/piling/maintenance/maintenance-board.tsx:335, 338` | «Задача ТО» и «План-график» (`asChild`→`<Link>`), `size="sm" … h-9` → 36px | создание наряда и переход к регламентам ТО с телефона | `h-11 sm:h-9` |
| 9 | важно | `src/components/piling/maintenance/maintenance-board.tsx:397` | страницы пагинации `h-8 w-8` → 32px | листание журнала на телефоне; соседние «‹/›» уже 44px (`:385,:410`) — ряд неровный | `min-h-11 min-w-11 sm:h-8 sm:w-8` |
| 10 | мелочь | `src/components/piling/maintenance/maintenance-board.tsx:369` | «Показать по:» `<SelectTrigger className="h-8 w-[74px]">` → 32px | редкая настройка размера страницы | `h-11 sm:h-8` |
| 11 | важно | `src/components/piling/maintenance/maintenance-detail-panel.tsx:139–155` | «Закрыть ТО» и «Печать» в подвале панели, `size="sm" … h-9` → 36px | закрытие наряда — финальное действие механика с телефона | `h-11 sm:h-9` |
| 12 | мелочь | `src/components/piling/maintenance/maintenance-detail-panel.tsx:132` | «Показать все события», `text-xs` → ≈16px | ссылка-действие ниже минимума WCAG 24px | `inline-flex min-h-11 items-center sm:min-h-0` |
| 13 | важно | `src/components/piling/maintenance/work-order-detail.tsx:285, 293, 305, 308, 318, 401` | кнопки стадии наряда, «Полное редактирование», «Не отменять/Отменить наряд», «Сохранить» — `size="sm"` → 32px | исполнитель ведёт наряд с телефона; отмена наряда необратима, промах по паре опасен | `min-h-11 sm:min-h-0` |
| 14 | мелочь | `src/components/piling/maintenance/work-order-detail.tsx:429` | «Принять» (приёмка работ админом), `size="sm"` → 32px | админ на телефоне — редко | `min-h-11 sm:min-h-0` |

### В. `/inspections` — осмотры (оператор, механик; телефон — да; самая частая полевая цель)

| № | severity | path:line | элемент / сейчас | почему важно | предлагаю |
|---|---|---|---|---|---|
| 15 | критично | `src/components/piling/inspections/inspection-controls.tsx:13–25` | `YesNoControl`: «Да»/«Нет», `py-1.5 text-sm` → 32px | ответ на пункт чек-листа — то, что машинист нажимает десятки раз за осмотр, стоя у машины | `min-h-11 sm:min-h-0` |
| 16 | критично | `src/components/piling/inspections/inspection-controls.tsx:44–55` | `Status4Control`: «Исправно/Замечание/Неисправно/Не проверено», `py-1.5 text-xs` → 28px | 4 кнопки в ряд на 375px: ≈42px ширины и 28px высоты — попасть в нужную почти нельзя | `min-h-11 sm:min-h-0` |
| 17 | важно | `src/components/piling/inspections/run-inspection.tsx:383` | шаги разделов `h-9 min-w-9` → 36px | навигация по разделам осмотра, ряд листается пальцем | `min-h-11 min-w-11 sm:h-9 sm:min-w-9` |
| 18 | важно | `src/components/piling/inspections/run-inspection.tsx:467` | «+ замечание / фото», `text-2xs` → ≈18px | открывает поле примечания и камеру — ниже минимума WCAG | `inline-flex min-h-11 items-center sm:min-h-0` |
| 19 | важно | `src/components/piling/inspections/run-inspection.tsx:541, 554, 573, 581` | «Сохранить черновик», «Завершить осмотр», «Отмена/Подтвердить» (подпись), дефолтный `Button h-9` → 36px | главные кнопки экрана осмотра; подпись ФИО — юридически значимое действие | `min-h-11` (или `h-11`) |
| 20 | мелочь | `src/components/piling/inspections/run-inspection.tsx:312` | «← К смене», `text-sm` → ≈20px | возврат к смене, ниже минимума WCAG | `inline-flex min-h-11 items-center sm:min-h-0` |
| 21 | мелочь | `src/components/piling/inspections/start-inspection-form.tsx:275` | «скопировать расходники», `size="sm" h-7 px-2 text-xs` → 28px | вспомогательное действие, ниже минимума WCAG | `min-h-11 sm:min-h-7` |

### Г. `/admin/equipment` и карточка установки (механик, диспетчер; телефон — да)

| № | severity | path:line | элемент / сейчас | почему важно | предлагаю |
|---|---|---|---|---|---|
| 22 | важно | `src/components/piling/admin-equipment/equipment-tile.tsx:170` (вызовы `:141–142`) | `QuickLink` «ТО» / «Документы» в плитке, `py-1.5 text-xs` → 28px | быстрый переход в карточку установки — типичное действие механика с телефона | `min-h-11 sm:min-h-0` |
| 23 | важно | `src/components/piling/admin-equipment/equipment-card-block.tsx:44` (вызовы `:47, 50, 53`) | то же в раскладке «Конструктор»: `linkClass`, `py-1.5 text-xs` → 28px | тот же переход во второй раскладке плиток | `min-h-11 sm:min-h-0` |
| 24 | важно | `src/components/piling/admin-equipment/detail/equipment-photos.tsx:159` | «Добавить фото», `px-3 py-1.5 text-xs` → 28px | механик фотографирует установку прямо в карточке | `min-h-11 sm:min-h-0` |
| 25 | важно | `src/components/piling/admin-equipment/equipment-form.tsx:303` (класс `:306–309`) | `ActiveToggle` «Активна»: `relative w-10 h-6` → 40×24 | переключатель состояния техники в форме; дорожка 24px — вдвое ниже нормы | обернуть по образцу `workspace-settings.tsx:233`: `grid min-h-11 w-11 place-items-center … sm:min-h-0` |
| 26 | важно | `src/components/piling/admin-equipment/equipment-table.tsx:37` (обработчики `:45–54`) | сортировка столбцов `<th>`, `px-1.5 py-2 text-xs` → ≈32px | в раскладке «Таблица» сортировка — основная работа с колонками | `inline-flex min-h-11 items-center sm:min-h-0` |
| 27 | важно | `src/components/piling/admin-equipment/equipment-filters.tsx:34` | 5 нативных `<select>` фильтра, `px-3 py-2 text-xs` → 32px | фильтр парка с телефона | `min-h-11 sm:min-h-0` |
| 28 | важно | `src/components/piling/admin-equipment/admin-equipment.tsx:140` | «Сбросить фильтры», `text-xs underline` → ≈16px | ссылка-действие ниже минимума WCAG 24px | `inline-flex min-h-11 items-center px-2 -mx-2 sm:min-h-0` |
| 29 | важно | `src/components/piling/admin-equipment/equipment-detail-parts.tsx:41, 159, 189` | заголовок сворачиваемого раздела (`w-full … text-sm` → ≈20px), шеврон «Развернуть историю» (`p-0.5` → ≈20px), «Показать всю историю (N)» (`py-1.5 text-xs` → 28px) | сворачивание разделов паспорта и раскрытие истории работ установки — всё на телефоне | `min-h-11 sm:min-h-0` (шеврону ещё `min-w-11`) |
| 30 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:204` | вкладки карточки во встроенном режиме, `px-2 py-2 text-xs` → 32px | переключение разделов карточки на /admin/equipment | `min-h-11 sm:min-h-0` |
| 31 | важно | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:145` | «Добавить» (запись ТО), `size="sm"` → 32px | механик заводит ТО из карточки установки с телефона | `min-h-11 sm:min-h-0` |
| 32 | мелочь | `.../detail/equipment-documents.tsx:171`; `.../detail/equipment-inspections.tsx:55`; `.../detail/equipment-detail.tsx:182` | «Добавить» документ, переход к осмотрам, «Редактировать» в шапке — `size="sm"` / дефолт → 32–36px | кабинетные действия в карточке | `min-h-11 sm:min-h-0` |
| 33 | мелочь | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:208, 217, 221, 224–226` | чипы «Сегодня/7 дней/30 дней» (`px-2 py-1 text-xs` → 24px) и `<input type=date>` (`px-2 py-1 text-sm` → 28px) | телеметрии в бою нет (спит до железа) — не срочно | `min-h-11 sm:min-h-0` |
| 34 | важно | `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:78, 89, 98, 102–104` | чипы «Сегодня/7 дней/30 дней» → 24px, даты «С/По» → 28px | это **не** мониторинг, а «Отчёт (печать/PDF)» по установке — рабочий отчёт механика | `min-h-11 sm:min-h-0` |
| 35 | мелочь | `src/components/piling/admin-equipment/equipment-card-grid.tsx:167` (класс `:171–176`) | «Эта плитка / Изменена», `px-2 py-1 text-2xs` → ≈24px, видна только на hover | ADMIN в «Конструкторе»; на телефоне hover нет — цель почти недостижима | `min-h-11 sm:min-h-0` + показывать всегда на `max-sm` |

### Д. `/admin/users` — Пользователи и документы (ADMIN; телефон — редко)

| № | severity | path:line | элемент / сейчас | почему важно | предлагаю |
|---|---|---|---|---|---|
| 36 | важно | `src/components/piling/admin-users/user-detail.tsx:130, 134, 140` | «Редактировать / Заблокировать / Удалить», `h-8 text-xs` → 32px | блокировка доступа — значимое действие; кнопки идут рядом | `h-11 sm:h-8` |
| 37 | мелочь | `src/components/piling/admin-users/user-documents.tsx:266, 269` (+`219, 241`) | `size="icon"` правка/удаление документа → 36×36; «Повторить/Добавить» `size="sm"` → 32px | плотная строка списка документов | `min-h-11 min-w-11 sm:min-h-0 sm:min-w-0` |
| 38 | мелочь | `src/components/piling/admin-users/user-document-types-dialog.tsx:214, 218, 238, 244, 248, 258` | «Сохранить/Отмена/Изменить/Требовать/Включить» `h-8 text-2xs` → 32px, удаление `h-8 w-8` → 32×32 | диалог «Виды документов», кабинет ADMIN | `min-h-11 sm:min-h-8` |
| 39 | мелочь | `src/components/piling/admin-users/admin-users.tsx:279, 282` | «Виды документов» / «Новый пользователь», `h-10` → 40px | почти норма, но ниже 44px | `h-11 sm:h-10` |

### Е. Прочие экраны `/admin/**` (кабинеты)

| № | severity | path:line | элемент / сейчас | почему важно | предлагаю |
|---|---|---|---|---|---|
| 40 | важно | `src/components/piling/admin-reports/admin-reports.tsx:281, 310, 372` | быстрые фильтры `min-h-9` → 36px, «Применить/Сбросить» период `h-9`, «Загрузить ещё отчёты» (дефолт) → 36px | диспетчер с телефона фильтрует и листает журнал отчётов (шапка экрана правилась ночью, эти цели — нет) | `min-h-11 sm:min-h-9` |
| 41 | важно | `src/components/piling/admin-reports/report-evidence-preview.tsx:196, 200, 206, 210` (+`:83`) | «Открыть PDF / Скачать / Печать / Редактировать» `h-9` → 36px; закрытие панели `h-8 w-8` → 32×32 | панель доказательств смены — основной рабочий блок журнала отчётов | `h-11 sm:h-9` |
| 42 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:284, 334, 376, 306, 346, 389` (+`:363`) | «+» (сваи/бурение/простой) `size="sm" … h-9` → 36px; удаление строки `h-4 w-4` → ≈16px; ссылка сброса → ≈16px | форма правки отчёта, кабинет | `h-11 sm:h-9`; удаление — `min-h-11 min-w-11` |
| 43 | мелочь | `src/components/piling/admin-reports/report-detail-dialog.tsx:44` | «Предпросмотр PDF», `px-3 py-1.5 text-xs` → 28px | «Детали отчёта» | `min-h-11 sm:min-h-0` |
| 44 | мелочь | `src/components/piling/admin-dlq.tsx:149, 217, 229, 239` | фильтры статуса `px-3 py-1.5 text-xs` → 28px, «Показать payload» `text-xs` → 16px, «Повтор/Отбросить» `h-8` → 32px | DLQ — кабинет админа | `min-h-11 sm:min-h-0` |
| 45 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:145, 251, 258, 268` | «Ждут разбора/Все», «Записать разбор/Отмена/Открыть», `min-h-9` → 36px | разбор происшествий обычно за столом | `min-h-11 sm:min-h-9` |
| 46 | мелочь | `src/components/piling/admin-telegram.tsx:286, 298, 305, 319` | «Тест / Редактировать / Выключить / Удалить», `text-xs px-2 py-1.5` → 28px | кабинет админа | `min-h-11 sm:min-h-0` |
| 47 | мелочь | `src/components/piling/inspections/template-list.tsx:72, 103`; `template-editor.tsx:180, 277, 290, 297`; `template-editor-parts.tsx:125, 139, 148, 157, 163, 172, 189, 201, 265, 274, 283` | «Новый шаблон»/«Отмена»/«Добавить раздел» `size="sm"` → 32px; деактивация `rounded p-1` → ≈24px; `SelectTrigger/Input h-8` → 32px; **чекбоксы 16px в `<label class="… text-xs">`** → ≈20px; селект уровня дефекта `px-2 py-1` → 24px; перемещение/удаление `p-1` → ≈24px | `/admin/checklists` и `/admin/checklists/[id]` — редактор шаблонов, кабинет; здесь же единственный найденный чекбокс без увеличенной метки | `min-h-11 sm:min-h-0`/`sm:min-h-8`, метки чекбоксов — `min-h-11` |

### Ж. Общие компоненты (одна правка — много экранов)

| № | severity | path:line | элемент / сейчас | какой экран/сколько | предлагаю |
|---|---|---|---|---|---|
| 48 | важно | `src/components/piling/admin-dashboard.tsx:370, 361, 366` (+`353, 357`) | «Обновить дашборд» `h-9 w-9` → 36×36; нативные `<select>` «Все объекты/Все установки» `px-2 py-1 text-xs` → 24px; `<input type=date>` → 24px | Дашборд; селекты — ниже минимума WCAG | `h-11 w-11 sm:h-9 sm:w-9` и `min-h-11 sm:min-h-0` |
| 49 | мелочь | `src/components/piling/admin-dashboard-bits.tsx:221` | подвал секции «Показать все …», `px-3 py-2 text-xs` → 32px | Дашборд, списки рисков/задач | `min-h-11 sm:min-h-0` |
| 50 | важно | `src/components/piling/feedback-center.tsx:200, 240, 245, 304, 314` | «Обновить / Отметить всё как прочитанное / Очистить локальные / Отметить как прочитанное / Подтвердить», `h-8 text-xs` → 32px | колокольчик в шапке **всех** экранов (сам колокольчик `:176` уже 44px) | `min-h-11 sm:min-h-8` |
| 51 | важно | `src/components/piling/async-ui.tsx:70–77` | `QueryErrorBanner` «Повторить», `size="sm"` → 32px | **общий баннер ошибки**: пользователи, справочники, DLQ, отчёты, ТО — одна правка на все | `min-h-11 sm:min-h-0` |
| 52 | важно | `src/components/piling/pdf-preview-dialog.tsx:52` | «Печать», `size="sm" … h-8` → 32px | общий диалог просмотра PDF (отчёты, история, журнал) | `min-h-11 sm:min-h-8` |
| 53 | важно | `src/components/piling/ops-shell/ops-detail-panel.tsx:38` | «Закрыть панель», `grid h-8 w-8` → 32×32 | общая панель деталей: Пользователи, Бригады, Объекты | `min-h-11 min-w-11 sm:h-8 sm:w-8` |
| 54 | важно | `src/components/piling/monitoring/fleet-dashboard.tsx:141, 170, 179, 191, 226` | «Повторить загрузку» / «Обновить» `text-sm underline` → ≈20px; `<select>` фильтров `px-3 py-2 text-xs` → 32px | /monitoring (диспетчер с телефона); ссылки — ниже минимума WCAG | `inline-flex min-h-11 items-center` и `min-h-11 sm:min-h-0` |
| 55 | важно | `src/components/piling/to/fuel-panel.tsx:175, 222` (+`191, 202, 216, 220`) | «Добавить запись» / «Сохранить» `size="sm" … h-9 w-full` → 36px; `<Input className="h-9">` → 36px | панель стоит в карточке установки (`equipment-detail.tsx:311`) — **вне** `.tech-readiness-module`, значит CSS её не поднимает | `h-11 sm:h-9` |
| 56 | важно | `src/components/piling/to/maintenance-plans-panel.tsx:165, 205`; `src/components/piling/to/meter-readings-panel.tsx:151, 183` | «Добавить»/«Сохранить», `size="sm" … h-9 w-full` → 36px | панели регламентов ТО и замеров | `h-11 sm:h-9` |
| 57 | мелочь | `src/components/piling/to/load-failure.tsx:29`; `acting-as-banner.tsx:54`; `to/readiness/acting-role-switch.tsx:47`; `layout-editor/page-layout-editor.tsx:44, 52`; `forms/creation-form.tsx:40`; `report-history.tsx:261` | «Повторить» `size="sm"` → 32px; «Вернуться к своей роли» и селект роли `min-h-9` → 36px; «Сбросить/Сохранить» (шаблоны плиток) `min-h-9` → 36px; «Назад» `h-9` → 36px; «Показать все отчёты» `text-sm` → ≈20px | панели `to/**`, баннер «Действую как», Настройки→Шаблоны плиток, общая оболочка форм, /history | `min-h-11 sm:min-h-9` / `min-h-11 sm:min-h-0` |

**Свод по severity:** критично — 3 (№1, 15, 16); важно — 34; мелочь — 20; всего **57**.

### Что проверено и уже в порядке (правок не требует)

- Чекбоксы выбора строк: `checkbox.tsx:21` уже несёт `.hit-target` (44px на сенсорном).
- `ops-shell/ops-filter-bar.tsx:36`, `admin-reports/reports-module.tsx:69`, `admin-analytics.tsx:323, 383, 419`, `admin-dashboard.tsx:342`, `equipment-view-toggle.tsx:28`, `admin-crews.tsx:268–273`, `admin-sites/index.tsx:421–425`, `dictionary-table.tsx:74, 85–88`, `admin-equipment.tsx:108` — уже `min-h-11`.
- `maintenance/work-order-table.tsx:124–152`, `maintenance-board-bits.tsx:35` (`ActionIcon`), `report-thumbnail.tsx:68`, `admin-equipment.tsx:199`, `report-history.tsx:302, 354` — по 44px.
- Переключатель `to/readiness/settings/shared-ui.tsx:79` — образец `min-h-11 min-w-11`.
- `report-form/**` (полевые формы оператора): `pile-section.tsx:75, 96`, `downtime-section.tsx:47, 62`, `drilling-section.tsx:65` — уже ≥44px.
- Весь `to/readiness/**` и `/admin/safety` — поднят CSS `globals.css:337–341`.

## Не проверено

- **Приложение не запускал, браузером не мерил.** Все размеры — расчёт из классов Tailwind/токенов (`text-xs`=16px, `text-sm`=20px, `h-8`=32px, `h-9`=36px, `min-h-9`=36px, `h-10`=40px). Замер `getBoundingClientRect` на 375px не делал; расхождение на шрифте/переносах ±2px возможно.
- **Визуальную регрессию правок не проверял** (код не менялся по условию задачи) — в частности, не смотрел, как `min-h-11` разложит ряды фильтров в Журнале забивки (`pile-journal/index.tsx:208–270`, 5 контролов в строку) и в шапке ТО (`maintenance-board.tsx:270–343`).
- **E2E/unit не запускал** — задача read-only, проверки по §6 AGENTS.md (tsc, lint, test:unit, `playwright --list`, build) не выполнялись. Чисел тестов не привожу.
- **Оценка «прораб/диспетчер/механик с телефона — да/нет» — по ролям из `layout.tsx:12` и `(safety)/layout.tsx:17`, а не по статистике использования** (её в задаче нет). «Редко» — моя оценка частоты, не измерение.
- **`size="icon"` (36×36) считал находкой**, хотя это штатный размер иконки-кнопки в дизайн-системе; если 36px для кабинетных экранов владелец считает достаточным, пункты №37, 38, 41, 53 можно снять.
- **Спорный HTML в `template-list.tsx:103`**: `<button>` вложен в `<Link>` (`<a>`), т.е. кнопка удаления внутри ссылки. Это существующая особенность, правка в scope R73 не входит, поведение в браузере не проверял — отмечаю как вопрос, а не находку.
- **`equipment-card-grid.tsx:167`** (кнопка, видимая на hover) живьём не проверял: возможно, на тач-устройствах она доступна иначе, чем я предположил.
- **Тёмная тема, планшеты 768–1023px, `pointer:coarse` на десктопе** — не проверял; `components/ui/select.tsx`, `dropdown-menu`, `sheet`, `dialog` (радикс) отдельно не разбирал — размеры их триггеров внутри контента не измерял.
- **Экраны вне `/admin/**` и вне уже названных** (`/report`, `/assistant`, `/operator*`, ORION) — по условию задачи не разбирал, хотя компоненты `report-form/**` формально попадают в область `src/components/piling/**` (беглый просмотр: там цели уже ≥44px).
