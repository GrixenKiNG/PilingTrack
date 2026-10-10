# AU193-S3 — Поля даты и времени в PilingTrack

Версия кода: `git rev-parse HEAD` = `fb09a45cac403a9b3237f82f25217ad55c8f0932`
Ветка: `hermes/q4-0926`. Задача только на чтение; код приложения не менялся.

## Итог

Резюме для владельца (5 строк):

1. В формах дата всегда нативная (`<input type="date">`, «ГГГГ-ММ-ДД»), время — `<input type="time">` («ЧЧ:ММ»). Свободного текста для дат нет — это ПРОЙДЕНО.
2. Ни у одного поля даты/времени нет ограничений `min`/`max` — ввести можно любой год, включая будущий. На части путей запись будущей даты сервер не отсекает (осмотры, снятие показаний, топливо, дата покупки) — это важно.
3. Часовой пояс: часть экранов считает «сегодня» в поясе организации, часть — в поясе браузера/жёстко Москвой. Это даёт расхождение на сутки у нерусско-московских поясов — важно.
4. Один путь (матрица допусков) переводит дату в момент через `new Date(\`${date}T23:59:59\`)` без пояса — ровно тот приём, от которого в этом же репозитории предупреждает `permit-form.tsx`. Сохранённый момент зависит от пояса браузера — важно.
5. Проверка «дата отчёта не в будущем» есть (`report-validation.service.ts:35`), но считает границу по Москве, а не по поясу тенанта. Для одной площадки в Москве это не мешает.

Счёт по важности: критично — 0, важно — 5, мелочь — 6. Топ-5 по влиянию:
`equipment-permit-matrix.tsx:105`, `equipment-analytics.tsx:70`, `report-form-dialog.tsx:65`,
отсутствие `min`/`max` + будущие даты на путях записи, `report-validation.service.ts:38`.

## Методика

Что искали и как это повторить (rg/поиск по исходникам, файлы открывались):

- Все поля ввода: поиск `type="date"|type="time"|type="datetime-local"|type="month"|type="week"` по `src/` (полный обход, 26 файлов с `type="date"`, 5 файлов с `type="time"`; `datetime-local`/`month`/`week` не найдены).
- Ограничения: поиск `type="date"` рядом с `min=`/`max=` в `src/**/*.tsx` — 0 совпадений.
- Преобразование даты в момент: чтение `src/lib/timezone.ts`, `src/lib/format.ts`, `shift-create-form.tsx`, `permit-form.tsx`, `equipment-permit-matrix.tsx`.
- Серверная проверка: чтение zod-схем `src/modules/readiness/application/{shifts,permits}/schemas.ts`, `src/lib/validation-schemas.ts`, `src/app/api/**/route.ts`, `src/modules/reports/application/commands/report-validation.service.ts`.
- Будущие даты: поиск `validateReportDateNotInFuture`, `validateShiftWindow`, `будущ|future`, `getTime() >`, чтение `src/modules/readiness/domain/shifts/shift.ts`.
- «Сегодня» по поясу: поиск `getTodayInTimezone|todayYmd|toDayValue`, чтение `report-list-format.ts`, `equipment-monitoring.tsx`, `equipment-analytics.tsx`.
- Численный прогон: два варианта функции «момент по стенным часам пояса» (`shift-create-form` — один проход; `permit-form` — два прохода) исполнены `node` и свечены для поясов Europe/Moscow и Asia/Vladivostok.
- Мобильный ввод: чтение `src/components/ui/input.tsx` (базовая высота) и классов `h-8/h-9/h-10/h-11` у полей дат; тесты `to-panels-mobile-targets.test.tsx`, `pile-journal.test.tsx`.

## Находки

### Таблица полей (поле | файл:строка | формат | проверка | риск)

Полные пути от корня репозитория.

| Поле | Файл:строка | Формат | Проверка (клиент / сервер) | Риск |
| --- | --- | --- | --- | --- |
| Дата смены | src/components/piling/to/readiness/shift-create-form.tsx:253 | ГГГГ-ММ-ДД | клиент: обязательность; сервер: `shifts/schemas.ts:5` `datetime({offset})` | нет min/max, будущее не ограничено (для планирования — норма) — мелочь |
| Время начала/конца смены | src/components/piling/to/readiness/shift-create-form.tsx:263, :273 | ЧЧ:ММ | сервер: `validateShiftWindow` (окончание позже начала) `shift.ts:3` | ПРОЙДЕНО |
| Дата/время наряда-допуска (4 поля) | src/components/piling/to/readiness/forms/permit-form.tsx:396,:401,:406,:411 | ГГГГ-ММ-ДД / ЧЧ:ММ | клиент: `periodInvalid` (:181); сервер: `permits/schemas.ts:34-35` | нет min/max — мелочь |
| Дата отчёта | src/components/piling/admin-reports/report-form-dialog.tsx:274 | ГГГГ-ММ-ДД | сервер: `validation-schemas.ts:247` (regex) + «не в будущем» `report-validation.service.ts:35` | дефолт «сегодня» = Москва, не пояс тенанта — важно (см. F-4) |
| Начало/конец смены в отчёте | src/components/piling/admin-reports/report-form-dialog.tsx:278, :280 | ЧЧ:ММ | клиент: нет; сервер: `validation-schemas.ts:249-250` (regex) | порядок начало/конец не проверяется (ночная смена оправдана) — мелочь |
| Начало/конец смены (оператор, отчёт) | src/components/piling/report-form/shift-info.tsx:47, :49 | ЧЧ:ММ | как выше | мелочь |
| Дата осмотра | src/components/piling/inspections/start-inspection-form.tsx:316 | ГГГГ-ММ-ДД | сервер: `inspections/route.ts:16` `z.coerce.date()` | нет min/max и нет отсечки будущего — важно |
| Документ: выдан / действует до | src/components/piling/admin-users/user-documents.tsx:310, :314 | ГГГГ-ММ-ДД | сервер: `users/[id]/documents/route.ts:16-17` | нет min/max — мелочь |
| Документ техники: выдан / до | src/components/piling/admin-equipment/detail/equipment-documents.tsx:265, :274 | ГГГГ-ММ-ДД | сервер: `equipment/[id]/documents/route.ts:22-23` | нет min/max — мелочь |
| Дата покупки / след. ТО по дате | src/components/piling/admin-equipment/equipment-form.tsx:290, :297 | ГГГГ-ММ-ДД | сервер: `validation-schemas.ts:177,182` (`optDate`) | нет min/max — мелочь |
| План / начато / выполнено (ТО) | src/components/piling/maintenance/work-order-form-dialog.tsx:364, :369, :374 | ГГГГ-ММ-ДД | сервер: `equipment/[id]/maintenance/route.ts:25-27` | нет min/max — мелочь |
| Начато (быстрое ТО) | src/components/piling/maintenance/work-order-detail.tsx:404 | ГГГГ-ММ-ДД | тот же | мелочь |
| Желаемая дата (заявка) | src/components/piling/maintenance/maintenance-request-form.tsx:212 | ГГГГ-ММ-ДД | сервер не проверено детально | ГИПОТЕЗА |
| Действует до (матрица допусков) | src/components/piling/to/readiness/screens/equipment-permit-matrix.tsx:193 | ГГГГ-ММ-ДД | клиент: преобразование :105; сервер: `safety/equipment-permits/route.ts:20` | пояс браузера в преобразовании — важно (F-1) |
| Дата снятия (моточасы) | src/components/piling/to/meter-readings-panel.tsx:174 | ГГГГ-ММ-ДД | сервер: `equipment/[id]/meter-readings/route.ts:37` | будущее не отсекается — важно |
| Дата (топливо) | src/components/piling/to/fuel-panel.tsx:213 | ГГГГ-ММ-ДД | сервер: `equipment/[id]/fuel/route.ts:36` | будущее не отсекается — важно |
| Период (дашборд) | src/components/piling/admin-dashboard.tsx:398, :402 | ГГГГ-ММ-ДД | фильтр (чтение) | нет min/max — мелочь |
| Период отчётов | src/components/piling/admin-reports/admin-reports.tsx:422, :430 | ГГГГ-ММ-ДД | сервер: `reports/admin` / `reports/export` | ПРОЙДЕНО |
| Период телеметрии | src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:217, :221 | ГГГГ-ММ-ДД | «сегодня» = `getTodayInTimezone()` :140 | ПРОЙДЕНО |
| Период экспорта отчётов | src/components/piling/admin-equipment/detail/equipment-report-export.tsx:146, :155 | ГГГГ-ММ-ДД | «сегодня» = `getTodayInTimezone(tz)` :31 | ПРОЙДЕНО |
| Период аналитики (техника) | src/components/piling/equipment-analytics.tsx:159, :163 | ГГГГ-ММ-ДД | «сегодня» считает сам, по поясу браузера :70-72 | важно (F-2) |
| Период инструктажей | src/components/piling/to/readiness/screens/briefings-screen.tsx:345, :350 | ГГГГ-ММ-ДД | фильтр (чтение) | мелочь |
| Фильтр «С/По дату» (готовность) | src/components/piling/to/readiness/screens/shared.tsx:165, :166 | ГГГГ-ММ-ДД | фильтр (чтение) | мелочь |
| Журнал свай: забита с/по | src/components/piling/pile-journal/index.tsx:303, :312 | ГГГГ-ММ-ДД | порядок с/по — тест `pile-journal.test.tsx:220` | ПРОЙДЕНО |

### Таблица выводов (# | важность | файл:строка | проблема | сценарий / почему важно | как чинить)

| # | Важность | Файл:строка | Проблема | Сценарий / почему важно | Предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| F-1 | важно | src/components/piling/to/readiness/screens/equipment-permit-matrix.tsx:105 | Дата «действует до» переводится в момент как `new Date(\`${validUntil}T23:59:59\`).toISOString()` — без пояса, то есть в поясе браузера. | Строка без `Z` парсится как местное время. «До 15.12» из Владивостока (+10) сохранится как 15.12 13:59:59Z, из Москвы — 15.12 20:59:59Z. Один и тот же срок хранится по-разному в зависимости от того, кто ввёл. Это ровно тот приём, от которого предупреждает `permit-form.tsx:57-66` («наряд уехал на три часа вперёд», проверено 16.08.2026). | Считать конец дня по поясу организации, как в `permit-form.tsx:91` `instantInTenantTimezone` (или `zonedDayStartUtc(date, tz)` + сутки). |
| F-2 | важно | src/components/piling/equipment-analytics.tsx:70-72 | Локальная `todayYmd()` берёт `new Date()` и `getFullYear/getMonth/getDate` — пояс браузера, а не пояс организации. | У диспетчера с браузером не в поясе производства «Сегодня»/«30 дней» по умолчанию считаются вокруг чужой полуночи, и период съезжает на сутки. Остальные экраны (`report-list-format.ts:14`, `equipment-monitoring.tsx:139`) ходят через `getTodayInTimezone()`. Разнобой читается как разные цифры. | Заменить на `getTodayInTimezone(tenant.timezone)` (или общий хелпер), как в соседних экранах. |
| F-3 | важно | src/components/piling/admin-reports/report-form-dialog.tsx:65 (и импорт :31) | Дефолт даты отчёта `getTodayInTimezone()` без аргумента → жёстко `Europe/Moscow` (`lib/timezone.ts:21`). | Для тенанта не в Москве «сегодня» подставляется по Москве. `shift-create-form.tsx:102` в этом же продукте передаёт пояс тенанта явно — здесь параметр потерян. На практике один тенант «orion», поэтому сейчас почти не видно. | Передавать пояс тенанта (`bootstrap.tenant.timezone`), как в `shift-create-form`. |
| F-4 | важно | src/modules/reports/application/commands/report-validation.service.ts:38 | Граница «дата не в будущем» считается через `getTodayInTimezone()` с дефолтом Москвы, а не по поясу тенанта. | В поясах восточнее/западнее Москвы «сегодня» по правилу и по поясу тенанта расходятся на несколько часов: законная дата у границы суток может быть отклонена или пропущена. | Брать пояс тенанта (как `normalizeTenantTimezone` в `shifts/commands.ts:111`). |
| F-5 | важно | по всему `src/**/*.tsx`: 0 полей с `min`/`max`; серверные схемы `inspections/route.ts:16`, `equipment/[id]/meter-readings/route.ts:37`, `equipment/[id]/fuel/route.ts:36`, `validation-schemas.ts:177,182` принимают `z.coerce.date()` без отсечки будущего | Ни браузер, ни сервер не мешают ввести и сохранить будущую дату там, где будущее бессмысленно. | «Дата снятия» моточасов, «Дата» топлива, «Дата осмотра», «Дата покупки» могут быть в 2099 году. Будущая дата снятия моточасов сдвигает расчёт ТО по моточасам/датчикам; будущая покупка искажает аналитику. Смены/наряды — отдельно: у них будущее допустимо (планирование). | Добавить `max={today}` у «дат факта» (показания, топливо, осмотр, покупка) и серверную проверку диапазона там же; смены/наряды не трогать. |
| F-6 | мелочь | src/components/piling/to/readiness/shift-create-form.tsx:77-84 против src/components/piling/to/readiness/forms/permit-form.tsx:67-98 | Две разные реализации одного понятия «момент по стенным часам пояса»: одна в один проход (`shift-create-form`), другая в два прохода через `Intl.formatToParts` (`permit-form`). | Численно сверил запуском `node` (v26.7.0): для 2026-09-26 07:00 и поясов Europe/Moscow / Asia/Vladivostok обе дают одинаковый результат (04:00Z и 21:00Z пред.; совпадают). Разница проявилась бы только на переходах летнего/зимнего времени, которых в поясах из `COMMON_TIMEZONES` нет. Риск — поддерживаемость: правку внесут в одну копию и забудут вторую. | Вынести общий `instantInTenantTimezone` в `lib/timezone.ts` и использовать в обоих местах. |
| F-7 | мелочь | src/components/ui/input.tsx:11 | Базовая высота `Input` — `h-9` (36px), меньше удобной цели нажатия 44px; панели `to/` перекрывают её до `h-11` (`meter-readings-panel.tsx:174`, `fuel-panel.tsx:213`), а админ-формы — нет (`report-form-dialog.tsx:274` `h-10`, `briefings-screen.tsx:345` `h-8`, `shared.tsx:165` `h-9`). | На телефоне попасть по полю даты в админ-экране труднее; эталон — `h-11 sm:h-9`, закреплён тестом `to-panels-mobile-targets.test.tsx` и `pile-journal.test.tsx:116`. | Привести мобильную высоту полей даты к `h-11 sm:h-9` там, где экраном пользуются с телефона. |
| F-8 | мелочь | src/components/piling/admin-reports/report-form-dialog.tsx:170-176, :278,:280 | В форме отчёта нет клиентской проверки «конец смены после начала»; сервер (`validation-schemas.ts:249-250`) проверяет только формат ЧЧ:ММ. | Ночная смена 19:00→07:00 законна, поэтому строгий порядок требовать нельзя; но опечатка (конец раньше начала в дневной смене) не ловится нигде, кроме расчёта простоя (`report-validation.service.ts:11`). | Решить явно: либо подсказка при end≤start для дневного типа, либо оставить и зафиксировать как норму. |
| F-9 | мелочь | src/app/api/**/*.ts (напр. `inspections/route.ts:16`, `equipment/[id]/documents/route.ts:22`, `equipment/[id]/meter-readings/route.ts:37`) | `z.coerce.date()` на строке `ГГГГ-ММ-ДД` даёт полночь UTC, а не «день тенанта». | Безопасно только потому, что показ идёт через `formatRuDate` (`lib/format.ts:56`, режет строку) и `daysUntil` (`:89`, отдельная ветка для дат). Любой новый код, который отформатирует это поле через `toLocaleDateString()` в поясе западнее UTC, покажет предыдущий день. | Оставить даты-факты как даты, а не моменты; для сравнений использовать `zonedDayStartUtc`/`daysUntil`. |
| F-10 | мелочь | src/components/piling/equipment-analytics.tsx:84-85, equipment-monitoring.tsx:151-152, admin-reports.tsx:237 | Дефолтные диапазоны (`shiftYmd(-29)`, `shiftYmd(-6)`) считаются арифметикой по UTC-строке (`report-list-format.ts:20`, `equipment-monitoring.tsx:142`). | Для целых суток это верно; при переходе поясов учтено через полдень `T12:00:00.000Z`. Отмечено как проверенное, не ошибка. | — |
| F-11 | мелочь | src/components/piling/to/meter-readings-panel.tsx:174, src/components/piling/to/fuel-panel.tsx:213 | Поле «Дата снятия»/«Дата» не помечено `required` рядом со своим `type="date"`. | В панели есть текст «Заполните хотя бы одно поле» (`fuel-panel.tsx:210`), т.е. дата не обязательна по замыслу; риск лишь UX. | Убедиться, что пустая дата трактуется как «сегодня» только явно, а не молча. |

## Не проверено

- Точная серверная схема заявки на ТО (`maintenance-request-form.tsx:212`) — файл маршрута не открывал; статус ГИПОТЕЗА.
- Реальный мобильный ввод (нативное поведение `<input type="date">`/`type="time"` на Android/iOS) — по коду проверить нельзя, эмулятора телефона не запускал. Все выводы по этой части — только о размерах цели нажатия и формате.
- Поведение часового пояса браузера в среде выполнения не подтверждено запуском: на этом хосте Node не принимал `TZ` из MSYS-шелла (`process.env.TZ` оставался пустым). Численная сверка F-6 проведена на поясе процесса (UTC) с явной передачей целевого пояса в функции, поэтому расхождение пояса браузера могло остаться незамеченным.
- Визуальная проверка форм (скриншоты) не выполнялась.
- Замороженные области (варианты экрана оператора `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, сайт ORION) не разбирались по правилу AGENTS.md; поле времени простоя оператора упомянуто только как контекст.
- Проверка «дата ≤ сегодня» для будущих дат подтверждена чтением кода, но не тестом на живом сервере (запись не отправлял — задача только чтение).
