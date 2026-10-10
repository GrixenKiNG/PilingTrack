# AU27-S6-TIMEZONES-DAY-BOUNDS — Часовые пояса и границы суток отчёта

Версия кода: `f79c50ae6d955ccdbdc84eb1f43efdba81633f80` (`git rev-parse HEAD`, ветка `hermes/q4-0926`, 1 изменённый файл — `AGENTS.md`, к аудиту отношения не имеет).
Независимый первый проход: существующие отчёты в `docs/audits/**`, `CODEX-REPORT*` и `docs/strategy` не читались.

## Итог

- Найдено **18** точек вычисления «дня» отчёта/смены и смежных суточных величин: **критично 0**, **важно 13**, **мелочь 5**. Живого риска для единственного тенанта `orion` (МСК) нет ни в одной: все правила по умолчанию совпадают с его поясом, и `getTodayInTimezone()` без аргумента даёт верные сутки.
- Главный факт: «производственный день» в продукте — это **строка `YYYY-MM-DD` по поясу тенанта** (`Report.date`, `Shift.productionDate`), и в ядре смены/готовности он считается правильно через `tenantProductionDate(now, timezone)` (`tenant-production-date.ts:13-19`). Автозакрытие смены, ночная смена через полночь и окно переработки реализованы корректно и по поясу смены (`scheduler.ts:73-111`), с тестами на дневную и ночную смены.
- Системный дефект один: **клиент админки/оператора зовёт `getTodayInTimezone()` без пояса тенанта** — 8 экранов (дефолтная дата отчёта, фильтры «Сегодня/Вчера/7 дней», период аналитики, дата осмотра ЕО/ТО). Пояс тенанта на этих экранах не запрашивается, хотя доступен через `GET /api/settings` (`settings/route.ts:15-21`). До второго тенанта это скрыто, после — «сегодня» уедет на сутки.
- Второй дефект: **`report-validation.service.ts:38`** — проверка «дата отчёта не в будущем» берёт московские сутки без учёта пояса тенанта; тенант восточнее Москвы в 00:00–07:00 местного не сможет создать отчёт за своё «сегодня» (400).
- Расхождение внутри продукта: **мобильный экран оператора считает производственный день по личному поясу пользователя** (`User.timezone`), а `Shift.productionDate` создаётся по поясу тенанта (`mobile-shift-query.ts:190` против `shifts/commands.ts:111-116`). При расхождении поясов смена «не находится».
- Оставшиеся мелочи — UTC/браузерные/хардкод-МСК сутки на периферии (мониторинг парка, инструктажи ОТ, окно телеметрии, «Журнал выгружен» в формах ТО).

## Методика

Что искал и как (команды можно повторить из корня репозитория):

1. Помощники суток: найден один центр — `src/lib/timezone.ts` (`getTodayInTimezone:21`, `zonedDayStartUtc:33`, `formatDateInTimezone:57`, `formatDateTimeInTimezone:74`, `COMMON_TIMEZONES:89`, `detectBrowserTimezone:105`) плюс `src/modules/readiness/domain/shifts/tenant-production-date.ts` (`normalizeTenantTimezone:3`, `tenantProductionDate:13`).
   - `search_files pattern='timezone*|*time*' target=files` — 1 файл `src/lib/timezone.ts`; далее поиск по символам.
2. Вызовы помощников и ручные сутки:
   - `search_files pattern='getTodayInTimezone|zonedDayStartUtc|detectBrowserTimezone|formatDateInTimezone|formatDateTimeInTimezone|COMMON_TIMEZONES'`
   - `search_files pattern='toISOString|toLocaleDateString|toLocaleString|getTimezoneOffset|setHours\(|setDate\('`
   - `search_files pattern='T00:00:00|T23:59|T12:00:00'`
   - `search_files pattern='slice\(0, ?10\)|slice\(0, ?16\)'`
3. Производственный день и смена: `productionDate`, границы суток, автозакрытие, ночная смена:
   - `search_files pattern='productionDate'`, `pattern='autoclose|autoClose|auto_close'`, `pattern='nightShift|SHIFT_WINDOW|shiftWindow|night_shift'`, `pattern='startOfDay|endOfDay|startOfWeek'`.
4. Недельная аналитика: `search_files pattern='SiteWeeklyTrend|weekStart|weekOf|ISOWeek|getUTCDay'`; прочитаны `projections/projection-handlers.ts` и `projections/rebuild.ts`.
5. Пояс тенанта на клиенте: `search_files pattern='tenant.*timezone|timezone.*tenant|FLEET_TZ|todayYmd|todayInput|getFullYear\(\)|getUTCDay'`, `pattern='x-tenant-timezone|tenantTimezone|tenant.timezone'`.
6. Доступность пояса на клиенте: `src/app/api/settings/route.ts` (GET отдаёт `getSettings(tenantId)` целиком, включая `timezone`).
7. Каждое утверждение проверено чтением файла; в таблицах указан `путь:строка` реально открытого места.

Ограничение методики: это чтение кода без исполнения и без прогонов тестов по часовым поясам; числовые примеры в сценариях — арифметические иллюстрации, а не результат прогона.

## Находки

Столбец «Статус»: ПРОЙДЕНО — правило реализовано корректно; ГИПОТЕЗА — вывод из чтения кода без прогона; НЕ ПРОВЕРЕНО — не удалось подтвердить по коду.

### Ядро (сервер): день отчёта и смены

| # | Важность | Место | Проблема | Сценарий / почему важно | Предлагаемое исправление | Статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/modules/reports/application/commands/report-validation.service.ts:38` | `validateReportDateNotInFuture` берёт `getTodayInTimezone()` без аргумента → всегда `Europe/Moscow` (`lib/timezone.ts:21`). `validateReportInput` (`:103-121`) не принимает ни `tenantId`, ни пояс. | Тенант восточнее Москвы (напр. Владивосток +10) в 00:00–07:00 местного создаёт отчёт за своё «сегодня»: сервер считает дату будущей и отвечает 400. Сегодня тенант один и он МСК — не проявляется. | Прокинуть `tenantId`/`timezone` в `validateReportInput` и считать через `tenantProductionDate`. | ГИПОТЕЗА |
| 2 | важно | `src/modules/operator-mobile/application/mobile-shift-query.ts:190` (и `:155`, `:192`) | Производственный день мобильного экрана считается по **личному** поясу: `todayInTimezone(profile?.timezone ?? 'Europe/Moscow', now)`, где `profile = db.user.findFirst(... timezone ...)`. | `Shift.productionDate` создаётся по поясу **тенанта** (`shifts/commands.ts:111,116`). Если `User.timezone` ≠ `TenantSettings.timezone`, поиск сегодняшней смены (`:379-383`) и проверка СИЗ (`:193-196`) идут по чужим суткам — смена «пропадает». Модуль заморожен (AGENTS.md §1). | Брать пояс из настроек тенанта, единообразно с `tenantProductionDate`. | ГИПОТЕЗА |
| 3 | ПРОЙДЕНО | `src/modules/readiness/application/scheduler.ts:73-111,161-193` | Автозакрытие и ночная смена. Конец смены задан часами суток (`SHIFT_END_HOUR DAY:19 NIGHT:7`), запас 5 ч, день сравнивается через `tenantProductionDate(now, timezone)`, час — через `Intl` в поясе **смены** (`:107-110`). | Дневная закрывается с 00:00 D+1, ночная — с 12:00 D+1; ночная смена 19:00→07:00 через полночь не обрывается. Покрыто тестами `scheduler.test.ts:143-195`. Арифметика `productionDate + 24ч` — по UTC-полуночи даты, корректна. | — | ПРОЙДЕНО |
| 4 | ПРОЙДЕНО | `src/modules/readiness/application/operator-shift-query.ts:135-136,224-229,236-237` | «Сегодня» оператора: `startOfTenantDay = zonedDayStartUtc(tenantProductionDate(now, timezone))`; окно показаний счётчика строится от местной полуночи. | Показание счётчика, снятое в 01:30 МСК, попадает в «сегодня» — шаг закрытия смены не блокируется. | — | ПРОЙДЕНО |
| 5 | ПРОЙДЕНО | `src/modules/readiness/domain/shifts/tenant-production-date.ts:13-19`; `shifts/commands.ts:111,116` | Единое правило производственного дня и `timezone` смены: `normalizeTenantTimezone` + `tenantProductionDate`, `Intl` с `en-CA`. | Смена хранит свой пояс; дальнейшие расчёты (автозакрытие, окно) используют его. | — | ПРОЙДЕНО |
| 6 | мелочь | `src/services/reports/event-handlers.ts` (окно недели) — см. `src/modules/reports/application/projections/projection-handlers.ts:42-53` | Без `refDate` неделя берётся от `new Date()` и день недели — `reference.getUTCDay()`. | Событийный путь передаёт дату отчёта (комментарий `:26-30`) и работает верно; UTC-день недели расходится с местным только в резервном часовом проходе «текущая неделя» (напр. местное воскресенье 00:30 МСК = суббота 21:30 UTC → бакет прошлой недели). Влияние ограничено часовой досборкой. | Брать опорный день в поясе тенанта. | ГИПОТЕЗА |

### Клиент админки/оператора: `getTodayInTimezone()` без пояса тенанта

| # | Важность | Место | Проблема | Сценарий / почему важно | Предлагаемое исправление | Статус |
|---|---|---|---|---|---|---|
| 7 | важно | `src/components/piling/report-form/use-report-form.ts:245` | `useEffect(() => { if (!date) setDate(getTodayInTimezone()); })` — дефолтная дата отчёта по МСК без пояса тенанта. | У тенанта восточнее/западнее Москвы форма откроется вчерашним/завтрашним днём. | Передавать `timezone` (есть на сервере через `/api/settings`). | ГИПОТЕЗА |
| 8 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:65` | `useState(editReport?.date || getTodayInTimezone())` — дефолт даты в админском диалоге. | То же: отчёт, заведённый ночью, ляжет на неверный производственный день. | То же. | ГИПОТЕЗА |
| 9 | важно | `src/components/piling/admin-reports/report-list-format.ts:14-22` | `todayYmd()` = `getTodayInTimezone()` (МСК); `shiftYmd` — арифметика от него. Используется фильтрами в `admin-reports.tsx:121-125,237-246`, а `report.date` — день тенанта. | Кнопки «Сегодня / Вчера / 7 дней» и период выгрузки у тенанта не в МСК уедут на сутки. | Брать день тенанта. | ГИПОТЕЗА |
| 10 | важно | `src/components/piling/admin-analytics.tsx:65-70` | Период «последние 7 дней» строится от `getTodayInTimezone()` (МСК). | Ночью/утром у тенанта не в МСК последние сутки выпадают из периода; недельный итог не сходится с журналом. | То же. | ГИПОТЕЗА |
| 11 | важно | `src/components/piling/admin-dashboard.tsx:78-87` | `rangeFor(...)` → `getTodayInTimezone()` (МСК) для режимов `today`/`7d`. | Фильтр «Сегодня» на дашборде показывает московские сутки. | То же. | ГИПОТЕЗА |
| 12 | важно | `src/components/piling/inspections/start-inspection-form.tsx:69` | Дата ЕО/ТО по умолчанию — `getTodayInTimezone()` (МСК). А критерий «осмотр за сегодня» в готовности считается по поясу тенанта (`readiness-score.ts:97-106`). | У тенанта восточнее Москвы утренний осмотр ложится на прошлые сутки → «осмотр за сегодня» не выполнен, машина «не готова», причина невидима. | Брать пояс тенанта для дефолта и единым правилом для критерия. | ГИПОТЕЗА |
| 13 | важно | `src/components/piling/equipment-analytics.tsx:70-77,85,166-168` | `todayYmd()`/`shiftYmd()` строятся по **часам браузера** (`getFullYear/getMonth/getDate`), а не по поясу тенанта и не через помощник. | Аналитик на машине с поясом, отличным от тенанта, просит «30 дней» со сдвигом на сутки относительно журнала и дашборда. | Использовать `todayYmd/shiftYmd` из `report-list-format.ts` (с поясом тенанта). | ГИПОТЕЗА |

### Замороженные и легаси-контуры (не правились, зафиксировано)

| # | Важность | Место | Проблема | Сценарий / почему важно | Предлагаемое исправление | Статус |
|---|---|---|---|---|---|---|
| 14 | важно | `src/modules/operator-mobile/domain/briefing-journal-view.ts:98-102,105-110,123-139` | `toDayValue`/`currentMonthRange`/`startOfDay`/`endOfDay` — `getFullYear/getMonth/getDate` и `new Date(y,m,d,23,59,59)` по **локальным часам зрителя**; границы периода уходят на сервер мгновениями. | Журнал инструктажей по умолчанию и его края считаются по часам браузера: у зрителя в ином поясе записи последнего дня месяца выпадают. Модуль заморожен (AGENTS.md §1). | Не трогать; учесть при разморозке. | ГИПОТЕЗА |
| 15 | важно | `src/components/piling/to/readiness-model.ts:45-52,80`; `src/modules/readiness/application/readiness-facts.ts:27-34,52` | `sameLocalDay` — `getFullYear/getMonth/getDate` в поясе процесса/браузера; этим решается «осмотр выполнен сегодня». | Сейчас исполняется на клиенте (пояс телефона) — для МСК верно. При переносе вызова в серверный ночной пересчёт (UTC) критерий поедет на сутки. Легаси-путь: проектная документация требует не использовать его в проде (`tech-readiness-production-frontend-design.md:78`). | Не переносить на сервер без смены правила дня. | ГИПОТЕЗА |
| 16 | важно | `src/services/analytics/equipment-analytics-service.ts:146-149` | Окно расхода топлива по телеметрии — уже через `zonedDayStartUtc(dateFrom, timezone)` и `timezone` из настроек. | Ранее окно сдвигалось на +3 ч; сейчас границы совпадают с днём тенанта. Остальные числа отчёта фильтруются строкой `Report.date` (`:130-131`). | — | ПРОЙДЕНО |
| 17 | важно | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:139-144,161-162` | `todayYmd()` = `getTodayInTimezone()` (МСК), а окно строится `zonedDayStartUtc(from)`/`zonedDayStartUtc(shiftYmd(1,to))` тоже без пояса тенанта. | Для тенанта не в МСК края окна телеметрии сдвинуты на сутки. | Передавать пояс тенанта, как в `reports-screen.tsx:39`. | ГИПОТЕЗА |
| 18 | мелочь | `src/components/piling/to/fuel-panel.tsx:48,58`; `src/components/piling/to/meter-readings-panel.tsx:34,50` | `todayInput = () => getTodayInTimezone()` (МСК), хотя рядом доступен `bootstrap.tenant.timezone` (`readiness/api/contracts.ts:29`). | Поле даты откроется московским днём у тенанта в ином поясе. | `getTodayInTimezone(bootstrap.tenant.timezone)`. | ГИПОТЕЗА |
| 19 | мелочь | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:29,114-117,383-386` | `FLEET_TZ = 'Europe/Moscow'` захардкожен; `ymd()` строит «сегодня»/«7 дней»/«2 дня» по нему. | «Сегодня/ожидается/работает» для парка считается по московским суткам у любого тенанта. | Брать пояс из настроек тенанта. | ГИПОТЕЗА |
| 20 | мелочь | `src/modules/safety/application/clearance-overview-query.ts:164-168` | «Сегодня» захардкожено `Europe/Moscow` + `+03:00`; `monthAgo`/`twoMonthsAgo` — скользящие 30/60 суток (момент), а не календарный месяц. | Для МСК сегодня верно; «месяц» = 30 суток расходится с календарным (28/29/31) и со вторым тенантом. | Пояс тенанта + календарная граница месяца. | ГИПОТЕЗА |
| 21 | мелочь | `src/lib/format.ts:88-92` (`daysUntil`) | «Сегодня» берётся `toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })`, пояс захардкожен. Используется `dueText` и через него `checkMaintenanceDue` (`maintenance-due.ts:8,31-37`). | Сроки ТО («просрочено/сегодня/через N дн.») считаются против московских суток у тенанта в ином поясе. | Принять пояс параметром (по умолчанию — пояс тенанта). | ГИПОТЕЗА |
| 22 | важно | `src/components/piling/maintenance/work-order-form-dialog.tsx:80` | `toInputDate = iso.slice(0, 10)` — день из ISO-**момента** берётся как UTC-день, и это значение отправляется обратно при сохранении наряда. | Наряд ТО, закрытый 26.09 в 00:30 МСК (в базе `2026-09-25T21:30Z`), при открытии формы покажет 25.09; сохранение без правок вернёт смещённую дату. Расчёт, чувствительный к сдвигу пояса. | Считать день в поясе тенанта (аналог `formatRuDate`/`formatDateTimeInTimezone`). | ГИПОТЕЗА |

### Проверено и корректно (положительные результаты)

| # | Место | Что проверено | Статус |
|---|---|---|---|
| 23 | `src/app/api/reports/export/route.ts:64-65,73,82`; `src/app/api/pile-passports/export/route.ts:87`; `src/app/api/readiness/export/route.ts:155-156` | Имя файла выгрузки отчётов, журнала забивки и готовности считается `getTodayInTimezone(timezone)` / `toLocaleDateString(..., {timeZone})` — по поясу тенанта. | ПРОЙДЕНО |
| 24 | `src/modules/reports/application/queries/pile-journal-export.ts:104`; `report-export.service.ts:289,306` | Отметка «Журнал выгружен» / «Выгружено» печатается `printMoment(new Date(), timezone)` по поясу тенанта. | ПРОЙДЕНО |
| 25 | `src/app/api/maintenance/kpi/route.ts:33-38,53` | Границы окна KPI из дня тенанта: `zonedDayStartUtc(value/addDays(value,1), timezone)`; `timezone` из настроек. | ПРОЙДЕНО |
| 26 | `src/components/piling/to/readiness/screens/shifts-screen.tsx:48-58`; `src/components/piling/to/readiness/screens/reports-screen.tsx:39,58,266-269` | «Сегодня/7 дней» и недельные бакеты в контуре готовности считаются `getTodayInTimezone(tenant.timezone)` и `tenantDay(..., timezone)`. | ПРОЙДЕНО |
| 27 | `src/app/api/settings/route.ts:15-21` | `GET /api/settings` отдаёт настройки тенанта (включая `timezone`) любому аутентифицированному — значит пояс доступен клиенту, исправление находок 7–13 не требует новой инфраструктуры. | ПРОЙДЕНО |
| 28 | `src/modules/reports/application/queries/pile-journal-types.ts:232-242`; `pile-journal-totals.ts:128-129` | Границы периода журнала забивки — `zonedDayStartUtc(date, timezone)`; день строки — `dayInTimezone`. | ПРОЙДЕНО |

## Не проверено

1. **Поведение на переходе на летнее время (DST).** `zonedDayStartUtc` (`lib/timezone.ts:33-52`) и `localHourInstant` (`shift-window.ts:52-58`) используют двухпроходный расчёт смещения, но фактический результат на дате перехода не замерялся. Для `Europe/Moscow` перехода нет, поэтому на текущем тенанте риск нулевой; для поясов со сменой времени — не проверено.
2. **Реальное поведение всех находок прогоном.** Числа в сценариях (00:30 МСК и т. п.) — арифметическая иллюстрация из чтения кода, а не результат выполнения. Тесты с конкретными поясами найдены только у `maintenance/kpi` (`route.test.ts:73-84`) и `equipment-analytics-service` (`equipment-analytics-service.test.ts:43`); для клиентских экранов (находки 7–13) прогонов с поясами не выполнялось.
3. **Влияние резервного UTC-дня недели** (`projection-handlers.ts:42-53`, находка 6): оценка ограничена чтением кода; не проверено, вызывает ли часовой проход реальную запись строки `SiteWeeklyTrend` не за ту неделю на проде.
4. **Живое значение `User.timezone` и `TenantSettings.timezone`** на проде (находка 2): к продакшн-БД доступа нет (AGENTS.md §1). Если у всех пользователей пояс совпадает с тенантом, расхождение не проявляется.
5. **Полный перечень мест `slice(0,10)`/`toISOString()`** (свыше 200 совпадений): разобраны только те, что относятся к «дню отчёта/смены» и к формам ТО; прочие (логи, аудит, технические поля) не проверялись.
6. **`getReportsByPeriodRaw`** (`report-query.service.ts:82-83`, `core/infrastructure/raw-queries.ts`): предполагается, что границы периода сравниваются со строкой `Report.date`; сам SQL не открывался построчно.
