# R79 — мелкий текст (11–13px) на экранах `/admin/**` и `/inspections` с телефона в поле

Только чтение: код не менялся, ни один существующий файл не тронут. Задача — найти экраны `/admin/**` и `/inspections`, которыми пользуются с телефона в поле (прораб/мастер, механик), где **основной** текст (не служебные метки) набран `text-xs`/`text-2xs`/`text-3xs`, и выбрать способ правки: (А) `.field-type` на корень экрана, (Б) точечно по компонентам, (В) общий медиазапрос для админ-оболочки.

## Итог

- Всего находок: **35** — критично **3**, важно **20**, мелочь **12**.
- Дефект QA D-20260930-008 подтверждён и системен. Ночные правки F-MOB-* подняли **кнопки**; текст поднят только там, где экран уже носил `.field-type` (осмотры, ТО-борд, форма отчёта) — то есть на `/inspections` и `/admin/maintenance` **уже работает** (`globals.css:343-348`), а вся остальная админка — нет.
- Второй разрыв, которого не закрывает ни один из трёх вариантов в чистом виде: лифт берёт **только** `.text-3xs`/`.text-2xs` (10/11px → 13px), а **`.text-xs` (12px) не поднимает вовсе** (`globals.css:344`). Дефект же говорит «11–13px» — значит 12px-текст останется мелким при любом из вариантов, пока селектор не расширят.
- Третий разрыв: `.field-type` — класс-предок, а диалоги рендерятся в **портал** (`src/components/ui/dialog.tsx:58`, `sheet.tsx:56`), то есть `.field-type` на корне экрана до содержимого диалогов не достаёт. Все правки через А/В на диалоги не подействуют.
- Топ-5 находок:
  1. `src/components/piling/pile-journal/pile-detail.tsx:87` — сетка 15 фактов (отказ факт./проектный, длина, глубина, отметки, молот, энергия), `text-2xs` = 11px, а именно по ней мастер жмёт «Принять сваю»/«На добивку». Экран **не** носит `.field-type` (`pile-journal/index.tsx:193`) → лифта нет.
  2. `src/components/piling/pile-journal/index.tsx:294` — вся таблица журнала забивки `text-2xs` = 11px (даты, № сваи, марка, длина, отказ) + бейдж решения `text-3xs` = 10px (`:346`).
  3. `src/components/piling/admin-equipment/equipment-table.tsx:47` — таблица парка целиком `text-xs` = 12px; в списке экранов механика это основная рабочая информация, и её не берёт даже существующий лифт.
  4. `src/components/piling/ops-shell/ops-page.tsx:45` — корень общей оболочки **трёх** экранов (`/admin/sites`, `/admin/crews`, `/admin/users`) без `.field-type`: одна правка закрывает три экрана.
  5. `src/components/piling/kpi-tile.tsx:130,137` — подписи и детали KPI-плиток `text-xs` = 12px; общий компонент дашборда, ТО, отчётов, мониторинга.

**Рекомендация: вариант В** (общий медиазапрос для админ-оболочки) — 1–2 файла против ~33 при точечной правке; см. раздел «Варианты и риск» ниже, включая обязательное расширение селектора на `.text-xs` и отдельную задачу на диалоги-порталы.

**Первые 3 экрана для следующей задачи F-MOB-*:**
1. **`/admin/reports?view=piles` — «Журнал забивки»** (`src/components/piling/pile-journal/**`) — мастер; решение по свае принимается с телефона у машины. Кнопки уже подняты (`F-MOB-PILES`), текст — нет.
2. **`/admin/equipment` + карточка `/admin/equipment/[id]` — «Установки»** (`src/components/piling/admin-equipment/**`) — механик; паспорт, история ТО, документы машины.
3. **`/admin/sites` — «Объекты»** (`src/components/piling/admin-sites/**`) — мастер/прораб; структура кустов и пикетов, план/факт, экипаж и помощники. Через общий `OpsPage` правка здесь же закрывает `/admin/crews` и `/admin/users`.

## Методика

Воспроизводимо, по шагам:

1. Прочитал `AGENTS.md`: модель доверия (ADMIN/DISPATCHER — платформенные роли, видят все тенанты), замороженные зоны (`operator*/**`, ORION), список «выглядит мёртвым, но должно остаться». Операторские экраны и ORION не трогал.
2. Разобрал существующий механизм подъёма текста и его историю:
   - `git log --oneline -- src/app/globals.css` → `f361da6a` (F-R14-1) — расширил селектор и поднял планку: `@media (max-width: 639px)` → `@media (max-width: 1023px), (pointer: coarse)`, селектор `.tech-readiness-module` → `:is(.tech-readiness-module, .field-type)`, размер `0.75rem` (12px) → `0.8125rem` (13px). Прочитал сам diff.
   - Текущее состояние: `src/app/globals.css:337-341` (тач-цели 44px в `.tech-readiness-module`) и `globals.css:343-348` (лифт 3xs/2xs → 13px).
   - `operator-type.css:16-35` — отдельная шкала оператора (переопределяет токены `--text-*`, `.text-2xs` → 14px, `.text-3xs` → 13px). Это не наш случай: действует только внутри `.operator-mobile-theme`/`.operator-screen`.
3. `grep` по `text-3xs|text-2xs|text-\[1[0-2]px\]` по всему `src/` (count + content). **Брекетов `text-[11px]`/`text-[13px]` в `src/` нет ни одного** — единственное совпадение по `text-\[1[0-2]px\]` это комментарий `globals.css:78`; watchdog — `eslint.config.mjs:61-63` (`no-restricted-syntax` на `Literal[value=/text-\[\d+px\]/]`).
4. Нашёл все 9 корней с `.field-type`: `forms/creation-form.tsx:38`, `maintenance/work-order-detail.tsx:252`, `maintenance/maintenance-board.tsx:244`, `inspections/template-list.tsx:69`, `inspections/template-editor.tsx:174`, `inspections/start-inspection-form.tsx:185`, `inspections/run-inspection.tsx:308`, `inspections/inspections-list.tsx:62`, `report-form/report-form.tsx:236`. Сопоставил с перечнем экранов: `/inspections`, `/admin/maintenance`, `/admin/checklists` — покрыты, вся остальная админка — нет.
5. Проверил, что `/admin/to` и `/admin/safety` покрыты обёрткой `.tech-readiness-module`: `to/readiness-reference-ui.tsx:87` (корень шапки модуля) — обе ветки модуля техготовности и модуль ТБ рендерятся внутри (подтверждено использованием `ReadinessReferenceUi` в `to/to-module.tsx:45,728` и импортом `AdminIncidents` из `readiness-reference-ui.tsx:26`).
6. Определил «частоту в поле» по ролям, а не по статистике: `src/components/piling/icons/role-navigation.ts:97-160` — MECHANIC: `/admin/to`, `/admin/equipment`, `/admin/maintenance`, `/admin/crews`, `/admin/safety`; FOREMAN: дашборд, мониторинг, `/admin/sites`, `/admin/to`, `/admin/crews`, `/admin/safety`, `/admin/reports`, `/admin/analytics`. Доступ в раздел: `src/app/(app)/admin/layout.tsx:12` (ADMIN, DISPATCHER, FOREMAN, MECHANIC, SAFETY_ENGINEER). Экраны `/inspections` живут прямо в `(app)` без собственного guard — их рисует оболочка из `src/app/(app)/layout.tsx:267-289` (для этих ролей это `AdminLayout`).
7. Каждую строку-кандидат открывал и читал в контексте (`read_file`), классифицировал текст: основной (значение/данные/решение) или служебный (метка поля, декор, сноска).
8. Проверил, чем закрыты три экрана при классе на их корне: `admin-equipment.tsx:96`, `admin-reports/admin-reports.tsx:223`, `admin-incidents/admin-incidents.tsx:128`, `admin-users/admin-users.tsx:291`, `admin-crews/admin-crews.tsx:207`, `admin-sites/index.tsx:282` — все через `OpsPage` (`ops-shell/ops-page.tsx:45`); `admin-sites`, `admin-crews`, `admin-users` используют один общий `OpsPage` (проверено поиском `OpsPage`: три вызова).
9. Проверил порталы: `src/components/ui/dialog.tsx:21-24,58` (`DialogPortal` без `container`) и `src/components/ui/sheet.tsx:25-28,56` — содержимое уходит в `document.body`, то есть вне поддерева `.field-type`.
10. Проверил, не сломает ли правку существующие тесты: `pile-journal/__tests__/pile-journal.test.tsx:99-122`, `admin-equipment/__tests__/equipment-mobile-targets.test.tsx:92-184`, `inspections/__tests__/inspection-mobile-targets.test.tsx:71-118`, `to/__tests__/to-panels-mobile-targets.test.tsx:35-85` — везде `toHaveClass(...)` проверяет **наличие** перечисленных классов, лишние классы не мешают (кроме `not.toHaveClass`). Точечная правка (Б) класс-тесты не ломает.

Ограничения метода: приложение не запускал, в браузере не мерил; размеры — из классов Tailwind и токенов `globals.css:79-82` (`--text-2xs: 0.6875rem` = 11px, `--text-3xs: 0.625rem` = 10px; `text-xs` = 12px по умолчанию Tailwind v4).

## Находки

### А. `/admin/reports?view=piles` — «Журнал забивки» (мастер; телефон в поле — да)

Вкладка живёт внутри `ReportsModule` (`admin-reports/reports-module.tsx:79`, роут `/admin/piles/page.tsx:12` редиректит сюда). Ни `reports-module.tsx:61`, ни корень `PileJournal` класса `.field-type` не носят.

| # | severity | path:line | проблема | сценарий / почему важно | предлагаю |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/pile-journal/index.tsx:193` | корень экрана `className="space-y-3 p-4"` — нет `.field-type`; лифт 3xs/2xs не действует ни на телефоне, ни на планшете | весь экран мастера с телефона: журнал, довод по свае, решение | вариант А: `+ field-type` (одна строка; закрывает и `pile-detail`, и `driving-sets`, и `journal-title-block`) |
| 2 | критично | `src/components/piling/pile-journal/pile-detail.tsx:87` | сетка 15 фактов `text-2xs` = 11px: «Отказ фактический/проектный», длина, глубина, отметки головы, удары, отклонение, молот, энергия удара | это и есть основание решения «Принять сваю»/«На добивку» (`:135,139`), мастер читает её стоя у машины на солнце | `.field-type` на корне (№1) или `text-sm sm:text-2xs` на сетке |
| 3 | важно | `src/components/piling/pile-journal/pile-detail.tsx:57-59` | баннер-довод «Свая не добита» / «Проектный отказ не заведён» — `text-2xs` = 11px | довод выделен цветом как главный, но набран мельче основного текста формы | поднять вместе с №2 |
| 4 | важно | `src/components/piling/pile-journal/index.tsx:294` | вся таблица журнала `text-2xs` = 11px (дата, № сваи, куст/пикет, марка, длина, глубина, отметка головы, залоги, отказ, «по норме») | нормативная форма СП 45.13330, которую мастер читает столбцами; 11px на 375px | `.field-type` на корне (№1) |
| 5 | важно | `src/components/piling/pile-journal/index.tsx:346` | бейдж решения `rounded px-1.5 py-0.5 text-3xs` = 10px (Принята / На добивку / Не разобрана) | статус сваи — самый маленький текст на самом важном столбце | то же |
| 6 | важно | `src/components/piling/pile-journal/driving-sets.tsx:36` (+`:22`, `:78`) | таблица хода забивки по залогам `text-2xs` = 11px; сообщение «Залоги не записаны» `:22` 2xs; сноска СП `:78` `text-3xs` | по залогам видно, как свая входила — по ним считается отказ, по которому решают | то же |
| 7 | важно | `src/components/piling/pile-journal/journal-title-block.tsx:24,28,33,67` | титульный блок и 4 факта в шапке журнала — `text-2xs` = 11px | шапка нормативной формы (копёр, молот, объект) — то, по чему журнал идентифицируют | то же |
| 8 | мелочь | `src/components/piling/pile-journal/index.tsx:197,223,237,246,256,275` | интро-абзац, подписи полей фильтра («Объект», «Забита с», «по», «№ сваи»), предупреждение о 500 сваях — `text-2xs` | служебные подписи; в поле читаются реже | можно оставить 11px или поднять заодно |

### Б. `/admin/equipment` и карточка `/admin/equipment/[id]` — «Установки» (механик; телефон — да)

| # | severity | path:line | проблема | сценарий / почему важно | предлагаю |
|---|---|---|---|---|---|
| 9 | важно | `src/components/piling/admin-equipment/admin-equipment.tsx:96` | корень `space-y-4 p-4 lg:p-6` — нет `.field-type`; лифта нет на всём экране | рабочее место механика с телефона | вариант А (одна строка) |
| 10 | важно | `src/components/piling/admin-equipment/equipment-table.tsx:47` (+`th`: `:42,43,56,57,58`) | таблица парка целиком `text-xs` = 12px (и `thead`, и ячейки) | в виде «Таблица» это основная рабочая информация: установка, объект, бригада, оператор, статусы, сваи, бурение, простой, моточасы. **Даже существующий лифт text-xs не берёт** | `text-xs` → поднять в медиазапросе (см. №33) или `sm:`-парой |
| 11 | важно | `src/components/piling/admin-equipment/equipment-tile.tsx:161` (+`:134`) | подписи метрик плитки (`Metric`) — `text-3xs` = 10px; «Нет отчёта» — `text-2xs` | плитка в виде «Плитки»: значение крупное (`text-sm`), а подпись к нему 10px — понять, что за цифра, с телефона тяжело | `.field-type` на корне (№9) |
| 12 | важно | `src/components/piling/admin-equipment/equipment-to-tab.tsx:79,84` | тип и статус записи ТО в карточке — `text-2xs` = 11px | механик смотрит историю ТО машины по телефону | то же |
| 13 | важно | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:64,73,376` (+`:310`) | подписи паспорта (`dt`) и подписи истории работ — `text-2xs` = 11px; сноска о телеметрии `:310` `text-3xs` | паспорт установки: марка, год, заводской №, наработка | то же |
| 14 | важно | `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:84,93` | подписи полей дат «С»/«По» в блоке «Отчёт (печать/PDF)» по установке — `text-2xs` | рабочий отчёт механика, формируется с телефона | то же |
| 15 | мелочь | `admin-equipment/detail/equipment-maintenance.tsx:168`; `admin-equipment/detail/equipment-inspections.tsx:77,80` | бейджи статуса ТО и уровня/статуса осмотра — `text-2xs` | статусы внутри карточки; подписи рядом уже крупнее | то же |
| 16 | мелочь | `admin-equipment/detail/equipment-monitoring.tsx:216,220,257,274,290,297` | подписи дат, сноска о порогах, относительное время, подписи датчиков — `text-2xs`/`text-3xs` | телеметрия спит до подключения железа — срочности нет (см. AGENTS.md) | по остаточному принципу |
| 17 | мелочь | `admin-equipment/equipment-form.tsx:293`; `admin-equipment/equipment-card-grid.tsx:172` | метка группы в форме и «Эта плитка/Изменена» в конструкторе — `text-2xs` | форма и конструктор плиток — кабинетные действия | можно оставить |

### В. Общая оболочка `OpsPage` + «Объекты» / «Бригады» / «Пользователи»

| # | severity | path:line | проблема | сценарий / почему важно | предлагаю |
|---|---|---|---|---|---|
| 18 | важно | `src/components/piling/ops-shell/ops-page.tsx:45` | корень `OpsPage` (`min-h-full space-y-4 bg-muted/60 p-4 lg:p-6`) — нет `.field-type` | это корень **трёх** экранов сразу (`admin-sites/index.tsx:282`, `admin-crews/admin-crews.tsx:208`, `admin-users/admin-users.tsx:292`) — одна правка закрывает три | вариант А: одна строка |
| 19 | важно | `src/components/piling/ops-shell/ops-detail-panel.tsx:65,67` (+`:31,105,107,109,115,117,121`) | `OpsFact`: подпись факта `text-3xs` = 10px и подстрока `text-3xs`; подзаголовок панели, история изменений — `text-2xs` | правая панель деталей общая для объектов/бригад/пользователей — блоки с доступами и историей | то же |
| 20 | важно | `src/components/piling/admin-sites/index.tsx:204,523,528,554` (+`:201,220,518`) | объект/экипаж/помощники в карточке объекта, бейджи «Выполнен», «План/факт» — `text-2xs`; бейдж состояния `:518` `text-3xs` | мастер/прораб смотрит, кто на объекте и что по смене — это рабочая информация, не декор (ср. 54-mobile-targets №12) | через `OpsPage` (№18) |
| 21 | важно | `src/components/piling/admin-sites/hierarchy-tree.tsx:59,87,94` | «Нет кустов»/«Нет пикетов» и сводка по пикету — `text-3xs`/`text-2xs` | дерево кустов/пикетов — основа навигации по объекту (domain: Site→PileField→Cluster→Picket) | то же |
| 22 | мелочь | `admin-sites/site-editor/pile-plan-section.tsx:59,100`; `drilling-plan-section.tsx:41,73`; `admin-sites/user-assignment.tsx:115` | порядковый номер и суммарные метры по строке плана, e-mail в списке назначений — `text-3xs` | редактор плана свай/бурения — кабинетная работа | можно оставить |
| 23 | мелочь | `src/components/piling/admin-crews/admin-crews.tsx:108,121,288` | объект бригады, число помощников, состав в панели — `text-2xs` | бригада нужна в поле (механик возвращает машину бригаде), но сами строки — подпись под названием | через `OpsPage` |
| 24 | важно | `src/components/piling/admin-users/admin-users.tsx:178,179,197,203,214,216,226,227` | почта `text-2xs`, телефон/установка/«через экипаж»/источник активности — `text-3xs` | роль ADMIN в поле — редко; но экран тот же `OpsPage` и получит лифт бесплатно (ср. 54-mobile-targets №19) | через `OpsPage` |
| 25 | мелочь | `src/components/piling/admin-users/user-detail.tsx:75,101,106,146` | подписи вкладок `text-3xs` (10px), заголовок панели «Объекты», предупреждение — `text-2xs` | кабинет ADMIN | можно оставить |
| 26 | мелочь | `src/components/piling/admin-users/user-document-types-dialog.tsx:214,218,238,244,248` | подписи кнопок диалога «Виды документов» — `text-2xs` **внутри диалога** | диалог рендерится в портал — `.field-type` его не накроет (№34); если поднимать, то только точечно | точечно (вариант Б), иначе не поднимется |

### Г. «Отчёты смен», дашборд, аналитика

| # | severity | path:line | проблема | сценарий / почему важно | предлагаю |
|---|---|---|---|---|---|
| 27 | важно | `admin-reports/report-evidence-row.tsx:199,215,250` (+`:59`) | «смена» `text-2xs`, «редактор» `text-2xs`, подстрока метрики (`м.п.`) `text-2xs`, бейдж числа отчётов `text-3xs` | строка журнала отчётов: мастер видит, чья смена и какие объёмы | через корень `AdminReports` |
| 28 | важно | `admin-reports/report-evidence-preview.tsx:74,223,225,233,275,279` (+`:111,113,115,121,123,129`) | подзаголовок «Доказательства смены · дата», пары «подпись-значение» (`text-3xs`), статус-бейдж, история изменений (`text-2xs`/`text-3xs`) | правая панель — основной рабочий блок журнала отчётов (ср. 54-mobile-targets №13) | то же |
| 29 | мелочь | `admin-reports/report-detail-dialog.tsx:81,139`; `admin-reports/report-form-dialog.tsx:297,385,407` | `text-3xs` внутри диалогов «Детали отчёта» и правки отчёта | портал → `.field-type` не действует (№34) | только точечно, и только если признать нужным |
| 30 | мелочь | `admin-reports/admin-reports.tsx:329` | шапка таблицы отчётов `text-2xs uppercase` | раскладка включается только `lg:grid` (≥1024px) — на телефоне эта строка не видна | можно не трогать |
| 31 | мелочь | `src/components/piling/admin-analytics.tsx:308,412,419` | сноска «Доля дней периода…», метка «Объект:» и пилюли выбора объекта — `text-2xs` | аналитика — кабинетный экран (ср. 54-mobile-targets №12, 15) | точечно при желании |
| 32 | важно | `src/components/piling/kpi-tile.tsx:130,137` | подпись плитки и `detail` — `text-xs` = 12px | **общий** компонент: дашборд, `/admin/maintenance`, «Отчёты», мониторинг — подпись говорит, что за показатель | поднять в медиазапросе админ-оболочки (№33) |

### Д. Механизм и ограничения (влияет на выбор варианта)

| # | severity | path:line | проблема | сценарий / почему важно | предлагаю |
|---|---|---|---|---|---|
| 33 | критично | `src/app/globals.css:344` | лифт `:is(.tech-readiness-module, .field-type) :where(.text-3xs, .text-2xs)` поднимает **только** 2xs/3xs до 13px; `.text-xs` (12px) остаётся как есть | дефект QA говорит «11–13px»: 12px-текст (напр. `equipment-table.tsx:47`, `kpi-tile.tsx:130`) не будет исправлен ни вариантом А, ни В, пока селектор не расширят на `.text-xs` | добавить `.text-xs` в `:where(...)` — но это затронет ~696 вхождений `text-xs` в `src/components/piling/**`; предлагаю отдельным шагом и с узким `max-width: 767px`, а не 1023px |
| 34 | важно | `src/components/ui/dialog.tsx:58`; `src/components/ui/sheet.tsx:56` | `DialogPortal`/`SheetPortal` без `container` → содержимое рендерится в `document.body`, вне поддерева `.field-type` | все правки через А/В (класс на корне) диалоги **не** поднимут: `report-form-dialog`, `report-detail-dialog`, `user-document-types-dialog` останутся 10–11px | либо точечно (Б) внутри диалогов, либо задавать `container` портала внутри `.field-type`-корня — это уже изменение общего `ui/dialog` |
| 35 | важно | `eslint.config.mjs:61-63` | `text-[Npx]` запрещён правилом `no-restricted-syntax`; в шкале нет токена 13px (`globals.css:79-82` определяет только 2xs=11px и 3xs=10px; `text-xs`=12px, `text-sm`=14px) | вариант Б «точечно» **не может** выйти на 13px: либо `text-xs sm:text-2xs` (12px на телефоне — дефект не закрыт), либо `text-sm sm:text-2xs` (прыжок 11→14px, ломает иерархию) | если выбирать Б — сначала добавить токен 13px в `@theme` (`globals.css:17-83`), иначе линт-базлайн в 0 предупреждений съедет |
| 36 | мелочь | `src/app/globals.css:343` | медиазапрос включает `(pointer: coarse)` без ограничения ширины | сенсорный ноутбук/планшет на 1200–1440px получит 13px в плотных `lg`-таблицах (фиксированные px-колонки: `admin-reports.tsx:329` — 116px/170px/…; `equipment-table.tsx:47`) — возможны новые переносы/обрезка | при варианте В ограничить `(max-width: 767px)`, если приоритет — телефон |

### Что уже покрыто (проверено, правок не требует)

- `/inspections` целиком: корни `.field-type` — `inspections-list.tsx:62`, `run-inspection.tsx:308`, `start-inspection-form.tsx:185`, `template-list.tsx:69`, `template-editor.tsx:174`; внутри — `run-inspection.tsx:421,471,488`, `inspections-list.tsx:102,105`, `start-inspection-form.tsx:247,248,253,261,282,293,302`, `lubrication-map.tsx:103,124,127,133` (рендерится из `start-inspection-form.tsx:309`).
- `/admin/maintenance` целиком: корень `maintenance-board.tsx:244` с `.field-type`; внутри — `work-order-table.tsx:51,83,87,94,100,106,114`, `maintenance-detail-panel.tsx:174,183,211,213` (оба рендерятся из борда `:352` и `:420`), `work-order-detail.tsx:252,259`.
- `/admin/to` и `/admin/safety`: корень `.tech-readiness-module` (`to/readiness-reference-ui.tsx:87`); там же и точечная правка `c2870bba` (F-MOB-READINESS-TEXT, `readiness-centre.tsx`).
- `/admin/checklists`: корни `template-list.tsx:69` и `template-editor.tsx:174` с `.field-type`.
- Операторская шкала: `operator-mobile/operator-type.css:16-35` (замороженная зона, не трогать).

## Варианты правки: риск и число файлов

Правки касаются только текстового лифта. **Общее для А и В:** действует тот же медиазапрос `@media (max-width: 1023px), (pointer: coarse)` — значит на десктопе ≥1024px с мышью ничего не меняется; почти вся плотная десктопная раскладка админки включается на `lg:`/`xl:` (≥1024px), то есть при срабатывании лифта десктопные сетки уже свёрнуты в одноколоночную мобильную раскладку. Это существенно снижает риск для таблиц: у таблиц есть `overflow-x-auto`, у сеток — однократный переход в столбец.

### Вариант А — `.field-type` на корень экранов

Файлов: **8** (закрывает все полевые роли), либо **12** с кабинетами.

| Файл | Строка корня | Закрывает |
|---|---|---|
| `pile-journal/index.tsx` | 193 | Журнал забивки (+ `pile-detail`, `driving-sets`, `journal-title-block`) |
| `admin-equipment/admin-equipment.tsx` | 96 | Установки |
| `ops-shell/ops-page.tsx` | 45 | **сразу 3**: Объекты, Бригады, Пользователи |
| `admin-reports/admin-reports.tsx` | 223 | Отчёты смен (без класса не берётся ветка `mayJournal=false`, `reports-module.tsx:53`) |
| `admin-dashboard.tsx` | 323 | Дашборд |
| `admin-analytics.tsx` | 218 | Аналитика |
| `admin-incidents/admin-incidents.tsx` | 128 | Происшествия |
| `admin-dictionaries.tsx` | 440 | Справочники |
| (по желанию) `equipment-analytics.tsx`, `monitoring/fleet-dashboard.tsx`, `admin-dlq.tsx:117`, `admin-telegram.tsx:205` | корни | Мониторинг, DLQ, Telegram |

Риск вёрстки: **низкий-средний**. На телефоне (≤1023px) десктопных таблиц в этих экранах почти нет — раскладки уже одноколоночные. Остаточный риск: `(pointer: coarse)` без ограничения ширины (№36) → сенсорный планшет/ноутбук на 1200px+ получит 13px в `lg`-таблицах (`equipment-table.tsx:47`) и в `lg:grid` шапке отчётов (`admin-reports.tsx:329`) — фиксированные px-колонки могут начать переносить текст. Диалоги не затрагиваются вообще (№34). Не закрывает 12px (№33).

### Вариант Б — точечно поднимать классы в компонентах

Файлов: **≈33** — `pile-journal` 4, `admin-equipment` 9, `admin-reports` 5, `admin-users` 3, `admin-sites` 6, `admin-crews` 1, `admin-incidents` 1, `admin-analytics` 1, `ops-shell` 2, плюс `kpi-tile.tsx` и `admin-dictionaries` (полный перечень — по таблице находок; адресно — только те строки, что в графе «path:line»).

Риск вёрстки: **минимальный по десктопу** — парный шаблон (`… sm:…`) меняет только телефон, десктоп не трогается вовсе; к тому же это единственный вариант, который достаёт до **диалогов** (№34). Но: (а) 33 файла против правила «минимальная правка» из AGENTS.md §2; (б) **13px недостижим** — токена нет, `text-[13px]` запрещён линтом (№35), значит фактический результат — 12px (`text-xs sm:text-2xs`) при заявленной цели 13px; (в) высок риск, что часть экранов забудут, и дефект вернётся; (г) класс-тесты F-MOB-* не ломаются, но при `sm:`-парах придётся следить за уже существующими `min-h-11 … sm:min-h-*` в тех же строках.

### Вариант В — общий медиазапрос для админ-оболочки

Файлов: **1**, если переиспользовать `.field-type` и повесить его на `<main>` админ-оболочки (`src/app/(app)/layout.tsx:249`); **2**, если завести отдельный класс (`.admin-shell`) и расширить селектор в `globals.css:344`.

Закрывает все `/admin/**`, включая будущие экраны, а также `/monitoring` и `/inspections` для MECHANIC/FOREMAN/ADMIN (они идут через `AdminLayout`, `layout.tsx:267-289`). Операторские роли на `/inspections` идут через `OperatorLayout` — у них своя шкала.

Риск вёрстки: **средний** — тот же медиазапрос, но охват шире: 13px получат и заведомо кабинетные экраны (Аналитика, DLQ, Telegram, Справочники, Настройки, мониторинг), где на сенсорном устройстве плотные `lg`-таблицы/фиксированные колонки. Плюс, как и А, не закрывает 12px (№33) и диалоги-порталы (№34). Смягчение: ограничить медиазапрос `(max-width: 767px)` — тогда телефон получает 13px, планшеты и сенсорные ноутбуки остаются как были.

## Рекомендация

**Вариант В** — 1–2 файла против ~33 у Б и без риска «забыли экран»; вся прицельная ценность варианта А сохраняется. Порядок шагов:

1. Расширить селектор в `globals.css:344` на `.text-xs` и повесить класс-маркер на `<main>` админ-оболочки `(app)/layout.tsx:249` (или добавить в `:is(...)` новый класс `.admin-shell`). Ограничить `(max-width: 767px), (pointer: coarse)` — цель дефекта это телефон 375px.
2. Проверить глазами на 375px три экрана из списка ниже и на 1024px/1440px — что десктопные таблицы (`equipment-table.tsx:47`, `admin-reports.tsx:329`) не поехали.
3. Отдельной задачей — **диалоги** (№34): они в портале и любым из трёх вариантов не поднимутся. Если признать нужным, то только точечно (Б) либо через `container` портала.
4. Если владелец против широкого охвата — минимальная альтернатива: вариант А на 8 файлов, начиная с трёх экранов ниже (в первую очередь `pile-journal/index.tsx:193` и `ops-page.tsx:45` — это 4 экрана двумя строками).

**Первые 3 экрана:** `/admin/reports?view=piles` (Журнал забивки, мастер) → `/admin/equipment` + карточка (Установки, механик) → `/admin/sites` (Объекты, мастер/прораб; через `OpsPage` сразу тянет за собой `/admin/crews` и `/admin/users`).

## Не проверено

- **Приложение не запускал, браузером не мерил.** Все размеры — расчёт из классов Tailwind и токенов `globals.css:79-82`; `getBoundingClientRect` на 375px не снимал. Расхождение ±2px из-за шрифта/переносов возможно.
- **Визуальную регрессию вариантов не проверял** (код не менялся по условию задачи): не смотрел живьём, как 13px ляжет в `equipment-table.tsx:47` и в `lg:grid` шапке `admin-reports.tsx:329`. Вывод «срабатывание лифта приходится на уже свёрнутую одноколоночную раскладку» — из того, что плотные раскладки помечены `lg:`/`xl:` (≥1024px), а не из замера.
- **Портал диалогов** — вывод из кода (`DialogPortal` без `container`, `dialog.tsx:58`); фактически в браузере не убеждался, что `.field-type` до них не достаёт.
- **`(pointer: coarse)` на сенсорных ноутбуках/планшетах 1024px+** не проверял — риск №36 оценочный.
- **Частота использования** — оценка по `icons/role-navigation.ts:97-160` и `admin/layout.tsx:12`, а не по статистике использования (её в задаче нет). Мой порядок экранов отличается от R73 (там тройка включала `/admin/maintenance` и `/inspections`, которые здесь уже закрыты CSS).
- **Проверки из AGENTS.md §6** (tsc, lint, test:unit, `playwright --list`, build) **не запускал** — задача read-only, изменений в коде нет; числа тестов не привожу.
- **Не разбирал** `/admin/checklists`, `/admin/settings`, `/admin/dlq`, `/admin/telegram` подробно (кабинеты, вне полевого контура), а также компоненты `ui/select`, `ui/dropdown-menu`, `ui/sheet`, `ui/dialog` (радикс) — размеры их триггеров внутри контента не измерял.
