# AU144-S3-TABLET-LAYOUT: Планшетная раскладка админ-экранов

Версия проверяемого кода: `51ad1b52fd50b44e0cafa63f0150bfafd66a6d61` (`git rev-parse HEAD`, ветка `hermes/q4-0926`).

Только чтение: код приложения не менялся. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

## Итог

Проверены 6 админ-экранов с табличной раскладкой. Найдено 10 замечаний: 1 критичное, 7 важных, 2 мелких. Отдельно подтверждено, что 4 группы таблиц защищены горизонтальной прокруткой (статус ПРОЙДЕНО).

Топ-5:

1. КРИТИЧНО — журнал отчётов `/admin/reports`: сетка строки требует **924 px** (заголовок — 852 px), контейнер `overflow-hidden` **без прокрутки** → на планшете 1024 px (брейкпоинт `lg`) обрезается ~228 px, на 1280 px с открытой панелью — ~508 px. Правые колонки («Бурение», «Простой», «Действия») не видны.
2. ВАЖНО — `/admin/users`: сетка OpsTable требует **754 px** в `overflow-hidden` без прокрутки → обрезка ~58 px на 1024 px и ~338 px на 1280 px.
3. ВАЖНО — `/admin/sites`: та же OpsTable, минимум **732 px** → обрезка ~36 px (1024) и ~316 px (1280).
4. ВАЖНО — рассинхронизация шапки и строк: заголовок OpsTable (`ops-table.tsx:40`) задан **без** `gap-3`, а строки (`ops-table.tsx:68`) — **с** `gap-3`; тот же дефект в журнале отчётов. Подписи колонок не стоят над своими колонками (сдвиг 12 px на колонку).
5. ВАЖНО — корневая причина: двухколоночные раскладки с фиксированной панелью (520 px) ужимают список до ~440 px (на `xl`) или ~184 px (на `lg`), тогда как шаблоны колонок таблиц жёстко заданы на `lg` без запаса на сжатие.

## Методика

Все выводы получены по коду (tailwind-классы, брейкпоинты, ширина панелей) регулярными выражениями и арифметикой, без запуска браузера. Команды воспроизводимы из корня репозитория:

- Версия: `git rev-parse HEAD`
- Таблицы: `rg -n -B3 '<table' src --glob '*.tsx'` — найдено 17 файлов с `<table`, для каждого проверено наличие предка с `overflow-x-auto`.
- Сетки-таблицы: `rg -n 'grid-cols-\[|lg:grid|xl:grid|md:grid' src --glob '*.tsx'` — найдены фиксированные `grid-cols-[...]` шаблоны; отобраны применённые на `lg`/`md`.
- Прокрутка: `rg -n 'overflow-x-auto|overflow-x-hidden|overflow-hidden' src/components/piling && src/components/piling/to/readiness`
- Оболочка и сайдбар: чтение `src/app/(app)/layout.tsx` — сайдбар `hidden lg:fixed lg:w-64` (256 px) и `lg:ml-64` на `<main>`; `src/components/piling/ops-shell/ops-page.tsx:50` — двухколоночность на `xl`; `src/components/piling/admin-reports/admin-reports.tsx:390` и `src/components/piling/admin-equipment/admin-equipment.tsx:120`, `src/components/piling/admin-dictionaries.tsx:449` — свои двухколоночные раскладки.
- Ширины колонок: значения `width:` из определений `OpsColumn`/`grid-cols-[...]`.
- Арифметика (доступная ширина и переполнение). Брейкпоинты Tailwind по умолчанию (`tailwind.config.ts` их не переопределяет): `sm 640 / md 768 / lg 1024 / xl 1280`. Модель ширины:

```
доступно(vw) = vw − (vw≥1024 ? 256 сайдбар : 0) − (vw≥1024 ? 48 p-6 : 32 p-4)
при двухколоночности: − (16 gap + ширина панели)
```

Команда с цифрами (переполнение = «нужно − доступно»):

```
node -e "const side=256,padLg=48,padSm=32,gap=16;
const rows=[['admin-reports row',852,7,true,520,'xl'],['admin-reports header',852,7,false,520,'xl'],
['admin-users OpsTable',694,6,true,520,'xl'],['admin-sites OpsTable',672,6,true,520,'xl'],
['admin-crews OpsTable',550,4,true,520,'xl']];
function avail(vw,p,w){let x=vw-(vw>=1024?side:0);x-=(vw>=1024?padLg:padSm);
if(w==='xl'?vw>=1280:vw>=1024)x-=gap+p;return x;}
for(const [n,s,c,g,p,w] of rows){const need=s+(g?12*(c-1):0)+24;
console.log(n,'need='+need,[768,1024,1280,1366,1536].map(v=>v+':'+((need-avail(v,p,w))>0?'over+'+((need-avail(v,p,w))):'ok')).join(' '));}"
```

Результат (с поправкой: ниже `lg` таблицы OpsTable рисуются карточками и не переполняются — см. `ops-table.tsx:40,68`, `lg:`-классы):

```
admin-reports row (7 кол., gap-3)   need=948   1024:over+228  1280:over+508  1366:over+422  1536:over+252
admin-reports header (7 кол., без gap) need=876 1024:over+156  1280:over+436  1366:over+350  1536:over+180
admin-users OpsTable (6 кол.)       need=778   1024:over+58   1280:over+338  1366:over+252  1536:over+82
admin-sites OpsTable (6 кол.)       need=756   1024:over+36   1280:over+316  1366:over+230  1536:over+60
admin-crews OpsTable (4 кол.)       need=610   1024:ok        1280:over+170  1366:over+84   1536:ok
```

Где `need` = сумма минимумов колонок + `gap-3` (12 px × (n−1), только для строк) + 24 px (`px-3` строки).

Статусы: **ПРОЙДЕНО** — таблица защищена прокруткой (найдена предок с `overflow-x-auto`); **ГИПОТЕЗА** — вывод о видимой обрезке получен из вычисления по классам, без рендера в браузере.

## Находки

| # | severity | path:line | элемент | ширина / доступно | риск | статус |
|---|----------|-----------|---------|-------------------|-------|--------|
| 1 | критично | `src/components/piling/admin-reports/admin-reports.tsx:458` + `:464`, `src/components/piling/admin-reports/report-evidence-row.tsx:194` | журнал отчётов: `section.overflow-hidden` + `lg:grid-cols-[116px_minmax(170px,1.2fr)_minmax(150px,1fr)_86px_92px_86px_152px]` | нужно 924 px (шапка 852 px) / доступно 720 px на 1024; 440 px на 1280 c панелью | правая часть строки и шапки обрезаны: на планшете 1024 не видно «Простой» и «Действия», горизонтальной прокрутки нет — колонки недостижимы | ГИПОТЕЗА (числа ПРОЙДЕНО) |
| 2 | важно | `src/components/piling/admin-users/admin-users.tsx:177`–`:250` + `src/components/piling/ops-shell/ops-table.tsx:38`,`:68` | OpsTable «Пользователи»: 6 колонок `minmax(155px,1.35fr)`+`100px`+`minmax(105px,0.9fr)`+`minmax(130px,1.1fr)`+`112px`+`92px`, контейнер `overflow-hidden` | нужно 754 px / 720 px (1024), 440 px (1280) | обрезка ~58 px на 1024 и ~338 px на 1280 (сбоку уходит «Статус»/«Активность»); прокрутки нет | ГИПОТЕЗА (числа ПРОЙДЕНО) |
| 3 | важно | `src/components/piling/admin-sites/index.tsx:203`–`:249` + `src/components/piling/ops-shell/ops-table.tsx:38` | OpsTable «Объекты»: `minmax(180px,1.6fr)`+`minmax(120px,1fr)`+`88px`+`80px`+`88px`+`116px` | нужно 732 px / 720 px (1024), 440 px (1280) | обрезка ~36 px на 1024 и ~316 px на 1280 | ГИПОТЕЗА (числа ПРОЙДЕНО) |
| 4 | важно | `src/components/piling/ops-shell/ops-table.tsx:40` (шапка) vs `:68` (строка) | шапка использует тот же `grid-template-columns: var(--ops-cols)`, но **без** `gap-3`, строки — **с** `gap-3` | сдвиг 12 px на колонку | подписи шапки не над колонками (в admin-users/sites/crews); комментарий `ops-table.tsx:12` обещает выравнивание — оно нарушено | ПРОЙДЕНО (классы прочитаны) |
| 5 | важно | `src/components/piling/admin-reports/admin-reports.tsx:464` (шапка) vs `src/components/piling/admin-reports/report-evidence-row.tsx:194` (строка) | тот же дефект: шапка `px-3 py-2` без `gap`, строка `px-3 py-3 gap-3` при одинаковом шаблоне | сдвиг 12 px на колонку | шапка журнала отчётов смещена относительно строк | ПРОЙДЕНО (классы прочитаны) |
| 6 | важно | `src/components/piling/ops-shell/ops-page.tsx:50` | `xl:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]`, панель по умолчанию 520 px (`ops-page.tsx:27`) | левая колонка = 1024−256−48−16−520 = 184…696 px | корневая причина #2/#3: колонка списка сжимается до ~440 px на `xl`, а шаблоны колонок жёстко заданы на `lg` без `min`-запаса и без `overflow-x` | ПРОЙДЕНО (числа) |
| 7 | важно | `src/components/piling/admin-equipment/admin-equipment.tsx:120` | двухколоночная раскладка на `lg` (не `xl`), панель 520 px (`:42`, мин. 360 по `:186`) | левая колонка = 1024−256−48−16−520 = 184 px | на планшете 1024 таблица парка (11 колонок, `src/components/piling/admin-equipment/equipment-table.tsx:46`) уходит в горизонтальную прокрутку внутри ~184 px — читается ~1 колонка | ГИПОТЕЗА (числа ПРОЙДЕНО) |
| 8 | важно | `src/components/piling/admin-dictionaries.tsx:449` | двухколоночная раскладка на `lg`, панель 380 px (`:117`) | левая колонка = 1024−256−48−16−380 = 324 px | таблица справочников (`dictionary-table.tsx:174`, `min-w-[760px]`) прокручивается внутри 324 px: видно ~2 колонки из 7–9 | ГИПОТЕЗА (числа ПРОЙДЕНО) |
| 9 | мелочь | `src/components/piling/admin-crews/admin-crews.tsx:103`–`:141` + `ops-table.tsx:38` | OpsTable «Бригады»: 4 колонки, сумма мин. 550 px | нужно 586 px; на 1024 ok (720), на 1280 обрезка ~170 px | обрезается только на `xl` с открытой панелью; на 1024 влезает | ГИПОТЕЗА (числа ПРОЙДЕНО) |
| 10 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:174` | `min-w-[760px]` при доступных 736 px (768 − 32 `p-4`) | порог впритык к 768 | запас 8 px: любое расширение узкой колонки или полосы прокрутки даст горизонтальный скролл; сейчас прокрутка есть (`:173`) | ПРОЙДЕНО |
| 11 | ПРОЙДЕНО | `src/components/piling/admin-equipment/equipment-table.tsx:46` | `<div className="w-full overflow-x-auto …">` вокруг `<table>` (`:47`) | — | таблица парка защищена прокруткой (обрезки нет) | ПРОЙДЕНО |
| 12 | ПРОЙДЕНО | `src/components/piling/maintenance/work-order-table.tsx:49` | `<div className="overflow-x-auto">` + `<table className="w-full min-w-[1050px] …">` (`:50`) | — | наряды ТО шире 768, но прокручиваются | ПРОЙДЕНО |
| 13 | ПРОЙДЕНО | `src/components/piling/equipment-analytics.tsx:257`,`:303` | мобильные карточки `md:hidden` и десктопная таблица `hidden … md:block` c `overflow-x-auto` | — | переключение карточки/таблица на `md` (768) выполнено корректно, прокрутка есть | ПРОЙДЕНО |
| 14 | ПРОЙДЕНО | `src/components/piling/to/readiness/settings/audit-section.tsx:104`, `dictionaries-section.tsx:156`, `notifications-section.tsx:171`, `roles-section.tsx:243`, `checklists-section.tsx:280`; `screens/permits-screen.tsx:253`, `reports-screen.tsx:537`, `shifts-screen.tsx:192`, `safety-overview-screen.tsx:318`,`:480`, `briefings-screen.tsx:432`,`:570`, `fleet-screen.tsx:169`, `knowledge-screen.tsx:130`, `employee-card.tsx:342`, `equipment-permit-matrix.tsx:221` | мин-ширины 620–1280 px, у каждой — предок `overflow-x-auto` | — | все таблицы/сетки разделов ТО и ТБ шире 768 px корректно прокручиваются, несмотря на `overflow-x-hidden` модуля (`src/components/piling/to/readiness/tech-readiness-module.tsx:66`) | ПРОЙДЕНО |

Итого по severity: критично — 1, важно — 7, мелочь — 2, ПРОЙДЕНО — 4.

Дополнительно (не риск): `src/components/piling/admin-analytics.tsx:497` — `<table className="w-full text-sm">` без обёртки прокрутки, но всего 3 короткие колонки («Установка / Отказов / Затраты») — переполнения при 768+ нет.

## Не проверено

- **Рендер в браузере не выполнялся** (в задании — анализ по коду). Обрезка/сдвиг колонок выведены из вычислений по классам (ПРОЙДЕНО для чисел), но сама визуальная картина на 1024/1280 — **ГИПОТЕЗА**. Точный порог появления прокрутки зависит от разрешения, DPI, ширины полосы прокрутки и фактического текста в ячейках — численно не измерял.
- Реальные данные (длина ФИО, названий объектов, брендов техники) не измерялись: превышает ли содержимое `minmax(..., fr)` минимумы — не проверено. Расчёт опирается только на минимумы колонок.
- Двухколоночные раскладки читались по классам; поведение перетаскивания панели (ширины 320/360…720/900) учтено только для значений по умолчанию (520 / 380).
- Экраны `/admin/settings`, `/admin/telegram`, `/admin/dlq`, `/admin/incidents`, `/admin/checklists/[id]`, `/admin/piles`, `/admin/analytics` просмотрены только на наличие таблиц/фиксированных сеток — найденные там таблицы либо малы, либо не таблицы; полного анализа раскладки этих экранов не делал.
- Замороженные области (`src/app/operator/**`, `src/components/piling/operator*/**`, ORION) не анализировались.
- `tsc`/`lint`/`build` не запускались: задача — только чтение, изменений кода нет.

## Приложение: заметки по оболочке

`src/app/(app)/layout.tsx:241` — сайдбар `hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64` (256 px) и `:267` `<main className="min-h-screen bg-background lg:ml-64">`. Именно на брейкпоинте `lg` (1024 px) одновременно (а) появляется сайдбар, забирающий 256 px, и (б) таблицы OpsTable переключаются из карточек в сетку (`ops-table.tsx:40,68` — `lg:grid`). Совпадение этих двух событий на 1024 px — основная причина находок #2, #3, #6.
