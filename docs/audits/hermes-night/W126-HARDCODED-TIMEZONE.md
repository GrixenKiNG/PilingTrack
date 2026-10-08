# W126 — часовой пояс и дата, прибитые к коду

Только чтение. Изменений в коде нет; создан один файл — этот отчёт.

## Итог

Найдено **29** точек, где пояс или день заданы не через общий помощник: **1 критично**,
**8 важно**, **20 мелочь**. Общий помощник в проекте есть и покрывает большинство
мест: `src/lib/timezone.ts` (`getTodayInTimezone`, `zonedDayStartUtc`,
`formatDateInTimezone`/`formatDateTimeInTimezone`) и
`src/modules/readiness/domain/shifts/tenant-production-date.ts`
(`normalizeTenantTimezone`, `tenantProductionDate`). Контейнер живёт в UTC: ни
`Dockerfile`, ни `docker-compose*.yml` не задают `TZ` (проверено grep).

Топ-5 по важности:
1. **критично** — окно расхода топлива по телеметрии строится наивной строкой
   `new Date(\`${dateFrom}T00:00:00\`)` в поясе процесса (UTC) → сдвиг на 3 часа,
   первая ночь периода теряется, последняя прибавляется; остальные числа того же
   отчёта считаются по дню тенанта (`equipment-analytics-service.ts:71-72` vs
   `:143-144`).
2. **важно** — ключ суточного пересчёта готовности и авто-закрытие суток берут пояс
   как `null` (Москва), хотя рядом, в той же функции, пояс тенанта передаётся
   (`scheduler.ts:257`).
3. **важно** — `getTodayInTimezone()` без пояса тенанта в дефолтной дате отчёта,
   границах периода админ-экранов и проверке «дата не в будущем»: до второго тенанта
   не дефект, после — отчёты ложатся не на тот производственный день (кластер из 7
   адресов).
4. **важно** — «сегодня» для парка зашито константой `FLEET_TZ = 'Europe/Moscow'`
   (`fleet-monitoring.service.ts:29`).
5. **важно** — «сегодня» и границы суток в допуске/инструктажах захардкожены
   `Europe/Moscow` + смещение `+03:00` вместо помощника/пояса тенанта
   (`clearance-overview-query.ts:164-166`).

Хорошая новость: критичная находка прошлого аудита (`37-utc-day-bounds.md` №1 —
UTC-дата в титуле журнала забивки, `pile-passport.service.ts:458`) **устранена**:
файл отрефакторен до 76 строк, выгрузка переехала в `pile-journal-export.ts`, где
дата печати считается в поясе тенанта (`printMoment(new Date(), timezone)`,
`pile-journal-export.ts:104`). Повтор `R134 №23`/`R44 №15` (имя файла журнала по
UTC-дню) — ещё открыт, см. №12.

## Методика

Проверялся коммит `hermes/q4-0926` (HEAD `e94faec1`), рабочее дерево чистое.

1. Поиск по всему репозиторию строк-литералов:
   `\+03:00|\+0300|Europe/Moscow|UTC\+3|MSK` и `setHours\(`,
   `toISOString\(\)\.slice\(|toISOString\(\)\.split\(` (инструмент `search_files`,
   аналог `grep -rn`). Разбор вели по `src/`, `scripts/`, `prisma/`,
   `docker-compose*.yml`, `Dockerfile*`.
2. Поиск общего помощника: `TZ|timezone|toZonedTime|date-fns-tz|zonedDayStartUtc|
   todayInTimezone|tenantProductionDate|normalizeTenantTimezone|getTodayInTimezone`.
   Пакет `date-fns-tz` в проект не подключён — пояс считается через `Intl.DateTimeFormat`
   (`src/lib/timezone.ts:33-52`, `tenant-production-date.ts:13-20`).
3. Проверка окружения: `Dockerfile*` (5 файлов) — ни в одном нет `ENV TZ`;
   `docker-compose*.yml` (6 файлов) и другие `*.yml` — `TZ=`/`Europe/Moscow` не
   найдены. Значит пояс процесса — UTC (голый `node:22-alpine`).
4. Сверка с прошлыми аудитами `37-utc-day-bounds.md`, `R114`, `R154`,
   `R139`, `R141`, `R47`, `35-kpi-consistency.md`, `17-formats.md` — чтобы не
   выдавать исправленное за находку и не дублировать открытое.
5. Проверка «что уже исправлено»: `pile-passport.service.ts` (76 строк, выгрузка в
   `pile-journal-export.ts`), `report-export.service.ts:258-275` — печать в поясе
   тенанта; `maintenance/kpi/route.ts:33-38` — окно KPI через `zonedDayStartUtc`;
   `admin-analytics.tsx:51-56` — период через `getTodayInTimezone()`.

Воспроизведение: из корня репозитория повторить команды из п.1 шагами
`search_files`; итоговые совпадения разобрать по `risk`.

## Находки

| # | severity | path:line | Что делает | Сценарий / почему важно | Как чинить |
|---|---|---|---|---|---|
| 1 | критично | `src/services/analytics/equipment-analytics-service.ts:143-144` | Окно телеметрии расхода топлива: `fromTs = new Date(\`${dateFrom}T00:00:00\`)`, `toTs = new Date(\`${dateTo}T23:59:59.999\`)` — наивные строки в поясе процесса (контейнер UTC). Остальные числа отчёта (`:71-72`, сырой SQL `r.date >= dateFrom AND r.date <= dateTo`) фильтруются строкой `Report.date` дня тенанта | Период 20.09–26.09: по сваям/простою это 20.09 00:00–26.09 24:00 МСК, по топливу — 20.09 03:00–27.09 02:59 МСК. Расход первой ночи теряется, последней — прибавляется: цифры одной страницы расходятся на 3 часа. **Повтор R37 №4 / R154 №2** | `zonedDayStartUtc(dateFrom, tz)` и `zonedDayStartUtc(addDays(dateTo,1), tz)` (пояс читать как в соседних ветках того же сервиса) |
| 2 | важно | `src/modules/readiness/application/scheduler.ts:257` | `tenantProductionDate(now, null).toISOString().slice(0,10)` — пояс тенанта **сознательно не передан**, `settings.timezone` игнорируется; ключ дедупликации суточного пересчёта и событие `DAILY_RECALC` | Сегодня совпадает с МСК. При тенанте в другом поясе суточный пересчёт готовности пошлёт событие с чужим `productionDate`; авто-закрытие смены рядом (`:104`, `:108`) пояс тенанта уже получает — несогласованность внутри одной функции. **Повтор R37 №14 / R59 №12 / R154 №10** | Читать настройки и передавать `timezone`, как в `:104` |
| 3 | важно | `src/modules/reports/application/commands/report-validation.service.ts:38` | `getTodayInTimezone()` без аргумента → умолчание `Europe/Moscow`; `validateReportInput` не принимает `tenantId`/пояс. Проверка «дата отчёта не в будущем» | Сегодня (тенант `orion` = МСК) верно. Тенант восточнее Москвы в 00:00–07:00 местного не может создать отчёт за своё «сегодня» — сервер считает дату будущей и отвечает 400. **Повтор R30 №3 / R154 №4** | Прокинуть пояс тенанта в `validateReportInput` |
| 4 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:65`; `src/components/piling/report-form/use-report-form.ts:245`; `src/components/piling/admin-dashboard.tsx:89`; `src/components/piling/admin-analytics.tsx:51`; `src/components/piling/admin-reports/report-list-format.ts:15`; `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:31`; `src/components/piling/inspections/start-inspection-form.tsx:69` | `getTodayInTimezone()` вызывается без пояса тенанта → везде `Europe/Moscow` (`src/lib/timezone.ts:21`). Это дефолтная дата отчёта, границы «Сегодня/7 дней», дата осмотра ЕО/ТО | Для МСК совпадает с продом. При втором тенанте «Сегодня/7 дней» и дата отчёта по умолчанию уедут на сутки; осмотр, заведённый утром восточнее Москвы, ляжет на прошлые производственные сутки и «осмотр за сегодня» не выполнится. **Повтор R17 №25 / R114 №28 / R141 №8** (правило «до второго тенанта», AGENTS §3) | Прокидывать `tenant.timezone` (в `report-list-format.ts`, `equipment-report-export.tsx`, `start-inspection-form.tsx` пояс уже доступен) |
| 5 | важно | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:29,386` | `const FLEET_TZ = 'Europe/Moscow'` — константа вместо пояса тенанта; `ymd()` форматирует момент через `toLocaleDateString('sv-SE', {timeZone: FLEET_TZ})`. От неё зависят `today`/`activeToday`/`expected`/`idle`, `totals.pilesToday` | Для МСК числа парка верны. При ином поясе карточки установок и «свай сегодня» на дашборде/`/monitoring` съедут на день, а «Отчёты/смены сдано сегодня» на `/admin` — счёт машин по MSK-суткам. **Повтор R37 №13 / R47 №17 / R154 №11** | Прокинуть `tenant.timezone` (`FleetSnapshotOptions.tenantId` уже есть; рядом пояс читается из настроек) |
| 6 | важно | `src/modules/readiness/application/readiness-facts.ts:27-34`; `src/components/piling/to/readiness-model.ts:45-52` | `sameLocalDay()` — `getFullYear/getMonth/getDate` в поясе процесса/браузера; этим решается критерий «осмотр выполнен сегодня» | Сейчас исполняется в браузере (пояс телефона МСК) — результат верный. Модуль уже импортируется как `@/modules/readiness` и выглядит серверным: при переносе вызова на сервер (UTC) или в ночном пересчёте «осмотр за сегодня» будет считаться по чужим суткам — обязательный шаг закрытия смены/приёмки не выполнится. **Повтор R37 №18** | Сравнивать производственный день через `tenantProductionDate` |
| 7 | важно | `src/modules/safety/application/clearance-overview-query.ts:164-165` | «Сегодня» и границы суток захардкожены: `toLocaleDateString('en-CA', {timeZone:'Europe/Moscow'})` + `new Date(\`${today}T00:00:00+03:00\`)` (жёсткое смещение `+03:00`). Пояс тенанта не читается; `monthAgo`/`twoMonthsAgo` — скользящие 30/60 суток | Сегодня для МСК верно (комментарий это признаёт). При тенанте в другом поясе «сегодняшние инструктажи» и допуск считаются по Москве; «месяц» = 30/60 суток расходится с календарным месяцем. **Повтор R37 №12 / R148 №3 / R154 №3** | Брать пояс из настроек, границы — через `tz` |
| 8 | важно | `src/lib/maintenance-due.ts:35-36,55` | `nextMaintenanceDate` (дата `@db.Date` → UTC-полночь) сравнивается с `now` по моменту времени: `byDate = dateMs < nowMs`, `overdueDays = floor((now − dateMs)/сутки)` | Срок ТО «26.09»: с 26.09 03:00 МСК карточка показывает «просрочено», хотя день ещё идёт; `overdueDays` в первые часы даёт 0 вместо 1. Метка экрана ТО, производственные числа не трогает. **Повтор R37 №16** | Сравнивать календарные дни (день тенанта), не моменты |
| 9 | важно | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:138-146`; `src/components/piling/to/fuel-panel.tsx:47-50`; `src/components/piling/to/meter-readings-panel.tsx:32-36` | Локальные `todayYmd()`/`shiftYmd()` строятся по поясу браузера (`getFullYear/getMonth/getDate`); `equipment-monitoring` шлёт `from/to` наивными `new Date(\`${d}T00:00:00\`)`. Границы окна телеметрии — по часам зрителя | У зрителя/тенанта в другом поясе края окна телеметрии сдвинуты; поле `<input type=date>` по умолчанию открывается вчерашним. **Повтор R114 №9 / R154 №5** | `getTodayInTimezone(tz)` / `zonedDayStartUtc` |
| 10 | мелочь | `src/app/api/reports/export/route.ts:62,70,79` | Имя файла `pilingtrack-reports-${today}.csv|.xlsx`, где `today = new Date().toISOString().split('T')[0]` — UTC-день. Сами данные корректны (период — строки дней) | Выгрузка 26.09 в 01:00 МСК получит имя `…-2026-09-25.…` (файл «за 25-е»). **Повтор R37 №8 / R154 №7** | `getTodayInTimezone(timezone)` |
| 11 | мелочь | `src/app/api/pile-passports/export/route.ts:84` | Имя файла `pile-driving-journal-${today}.xlsx`, `today = new Date().toISOString().slice(0,10)` — UTC-день | Ночная выгрузка подшивается с датой предыдущего дня и расходится с титулом внутри файла (титул теперь печатается в поясе тенанта, `pile-journal-export.ts:104`). Экран скачивает файл под именем по поясу тенанта — прямая ссылка и клик дают разные имена. **Повтор R37 №9 / R44 №15 / R134 №23** | Считать день имени по поясу тенанта (в `exportPileJournalXlsx` пояс уже известен) |
| 12 | мелочь | `src/app/api/readiness/export/route.ts:155` | Имя CSV `pilingtrack-readiness-<dataset>-${generatedAt.toISOString().slice(0,10)}.csv` при `generatedAt = new Date()` (`:32`) — UTC-день | Файл выгрузки готовности, приложенный к проверке 26.09 ночью, назван датой 25.09. Пояс тенанта рядом уже есть (`:38`) | `getTodayInTimezone(timezone)` |
| 13 | мелочь | `src/core/storage/s3-service.ts:159` | Ключ объекта экспорта: `…/exports/${new Date().toISOString().split('T')[0]}_${dateRange}.csv` — UTC-день | Ночная выгрузка в S3-ключе выглядит на день раньше; при сортировке/сопоставлении с датой периода расходится. Данные не затронуты. **Повтор R37 №11** | Передавать день параметром или `getTodayInTimezone()` |
| 14 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:95` | Срез «за 30 дней» — `new Date(Date.now() − 30*86_400_000).toISOString().slice(0,10)`, сравнивается со строкой `Report.date` | В 00:00–03:00 МСК граница среза попадает на вчерашний UTC-день: карточка техники («Сваи за 30 дней») теряет/прибавляет один день. **Повтор R37 №7 / R154 №8** | `getTodayInTimezone()`, затем вычесть 30 дней от дня тенанта |
| 15 | мелочь | `src/lib/format.ts:84-92` | `daysUntil()`: `today.setHours(0,0,0,0); date.setHours(0,0,0,0)` — локальная полночь зрителя; `dueText()` строит «просрочено/сегодня/через N дн.» | Отображение срока документа/ТО: у зрителя с чужим поясом или сбитыми часами «сегодня»/«просрочено» съезжает на сутки | Считать день в поясе тенанта |
| 16 | мелочь | `src/components/piling/admin-dashboard.tsx:70-75` | Локальный `daysUntil(iso)`: `today.setHours(0,0,0,0); t.setHours(0,0,0,0)` по поясу браузера | Плитка сроков ТО/документов на дашборде в ночную смену у зрителя с чужим поясом показывает соседние сутки | Использовать общий `daysUntil` с поясом тенанта |
| 17 | мелочь | `src/components/piling/admin-users/user-documents.tsx:160-162` | Дата окончания документа: `new Date(issuedAt)` (строка `YYYY-MM-DD` → UTC-полночь) + `setMonth` + `toISOString().slice(0,10)`. Смешивает UTC-полночь и календарную арифметику | Результат верен при текущих поясах (проверено рассуждением), но `setMonth` перескакивает через короткий месяц/високосный год (см. R154 №1). Готовый корректный `addMonths` есть в `modules/safety/domain/briefing-requirements.ts` | Считать месяцы строкой даты или по UTC-полудню |
| 18 | мелочь | `src/components/piling/admin-dlq.tsx:229` | Формат даты в очереди DLQ: `Intl.DateTimeFormat('ru-RU', {… timeZone:'Europe/Moscow'})` — зашита Москва | Отображение времени события недоставленной очереди в чужом поясе тенанта вводит в заблуждение; пояс организации доступен через bootstrap/настройки | Брать пояс тенанта |
| 19 | мелочь | `src/components/piling/to/readiness/settings/integrations-section.tsx:155`; `src/components/piling/to/readiness/screens/permits-screen.tsx:388`; `src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx:23,25` | Fallback `?? 'Europe/Moscow'` при отсутствии пояса с bootstrap/настроек: вывод «Часовой пояс контура», подпись версии наряда, пояс формы создания смены | Мягкий фолбэк; для МСК верно. Опасен лишь тем, что маскирует отсутствие настройки (форма смены создаст окно по Москве, если bootstrap не ответил) | Оставлять, но логировать фолбэк; для формы шифта — не подставлять молча |
| 20 | мелочь | `src/modules/readiness/application/read-filters.ts:42,53` | `parseReadinessReadFilters(params, timezone = 'Europe/Moscow')` и `catch { normalizedTimezone = 'Europe/Moscow'; }` — собственный дефолт/фолбэк вместо `normalizeTenantTimezone` | Дублирует логику `normalizeTenantTimezone` (`tenant-production-date.ts:3-11`); при расхождении правил нормализации разбор границ периода разойдётся с остальным контуром готовности | Импортировать `normalizeTenantTimezone` |
| 21 | мелочь | `src/modules/readiness/application/csv-export.ts:16` | `const DEFAULT_TIMEZONE = 'Europe/Moscow'` — локальная константа по умолчанию вместо общей | Ещё одна копия дефолта «Москва» (тот же в `tenant-production-date.ts:1`, `timezone.ts:21/33/59/76/106`, `settings.ts:90`) | Единый источник дефолта |
| 22 | мелочь | `src/modules/readiness/application/backfill/backfill-service.ts:37`; `src/modules/readiness/application/projection/project-event.ts:57` | `settings?.timezone ?? 'Europe/Moscow'` — фолбэк при отсутствии настройки в бэкфилле и проекции событий | Для МСК верно; молчаливая подстановка Москвы там, где пояс реально не прочитан, — тот же класс, что `02-silent-failures.md` | Логировать фолбэк; единый источник |
| 23 | мелочь | `src/services/reports/event-handlers.ts:395,399` | `let timeZone = 'Europe/Moscow'`; при чтении настроек `timezone || 'Europe/Moscow'` — пояс для строки времени Telegram-алерта о простое | Строка уходит в мессенджер: при не-московском тенанте/ошибке чтения настроек время в алерте будет московским. Комментарий `:392-394` это признаёт. **Связано с F-R33-1** | Прокидывать пояс события по контексту, не только из настроек |
| 24 | мелочь | `src/core/notifications/telegram.ts:180` | `const timeZone = alert.timeZone || 'Europe/Moscow'` — дефолт для времени в тексте алерта | Тот же класс: получатель вне МСК видит чужой пояс, если вызывающий не передал `timeZone` | Дефолт из настроек/явная ошибка |
| 25 | мелочь | `scripts/verify-readiness.ts:23` | `const TIMEZONE = 'Europe/Moscow'` — зашита в диагностический скрипт | Скрипт считает готовность в московских сутках независимо от настройки тенанта; для отладки второго тенанта даст неверный день | Читать пояс из настроек |
| 26 | мелочь | `scripts/apply-postgres-hardening.ts:67` | CHECK `chk_report_date_not_future`: `"date"::date <= (now() AT TIME ZONE 'Europe/Moscow')::date` — MSK зашита в ограничение БД | Сегодня верно (комментарий `:64-66` объясняет ночную смену). При тенанте с другим поясом ограничение останется московским: «дата не в будущем» будет проверяться по Москве, а не по суткам тенанта | Осознанно принять; при мультитенанте — пересмотреть |
| 27 | мелочь | `scripts/setup-partitioning.ts:55-58` | Границы партиций: `new Date(now.getFullYear(), now.getMonth()+i, 1)` → `toISOString().split('T')[0]` — начало месяца берётся в поясе процесса (UTC), имя партиции — UTC-день | Границы месяца уезжают на сутки для зрителя/процесса не в UTC; на корректность данных влияет только при планировании партиций в не-UTC поясе | Считать месяц по календарю строкой |
| 28 | мелочь | `prisma/schema.prisma:109,919` | Дефолты: `User.timezone String @default("Europe/Moscow")` и `TenantSettings.timezone String @default("Europe/Moscow")` | Дефолт «Москва» на уровне схемы — нормально для текущего продукта, но это ещё одно место, где зашит пояс (наряду с `settings.ts:90`). Историческая миграция `20260712090000` ставила `'UTC+3'`, а `20260730100000` нормализует `UTC+3`→`Europe/Moscow` | Осознанно принять; менять нельзя (schema off-limits, AGENTS §1) |
| 29 | мелочь | `src/app/api/reports/period/route.ts:23`; `src/app/api/reports/export/route.ts:46`; `src/modules/reports/application/queries/pile-journal-types.ts:245-247`; `src/app/api/maintenance/kpi/route.ts:17-20` | Проверки/арифметика дня: `parsed.toISOString().slice(0,10) === value` (отсев `2026-02-31`), `new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10)`, «полдень UTC» трюк +/− сутки | Это корректный приём: работа идёт со строкой-днём, а не с моментом; значение UTC здесь — намеренная календарная арифметика, не пояс процесса. **Находкой не является**, перечислено для полноты описи | — |

## Места, обходящие общий помощник

Общий помощник: `src/lib/timezone.ts` (`getTodayInTimezone:21`, `zonedDayStartUtc:33`,
`formatDateInTimezone:57`, `formatDateTimeInTimezone:74`, `COMMON_TIMEZONES:89`,
`detectBrowserTimezone:105`) и
`src/modules/readiness/domain/shifts/tenant-production-date.ts`
(`normalizeTenantTimezone:3`, `tenantProductionDate:13`). Правильные примеры
использования: `maintenance/kpi/route.ts:9,36-37`, `pile-journal-types.ts:239-240`,
`operator-shift-query.ts:135-136,228-229`, `shifts/commands.ts:111-116`,
`fleet-evidence-panel.tsx:45`, `reports-screen.tsx:39-46`, `maintenance-screen.tsx:40-41`.

Обходят помощник (свой литерал/свой дефолт/локальная арифметика по поясу
процесса или браузера):

- `clearance-overview-query.ts:164-165` — свой `Europe/Moscow` + жёсткое `+03:00`.
- `fleet-monitoring.service.ts:29,386` — своя `FLEET_TZ`.
- `read-filters.ts:42,53` — свой дефолт/фолбэк вместо `normalizeTenantTimezone`.
- `csv-export.ts:16` — своя `DEFAULT_TIMEZONE`.
- `report-validation.service.ts:38` — `getTodayInTimezone()` без пояса тенанта.
- `admin-dlq.tsx:229` — свой `Europe/Moscow`.
- `equipment-monitoring.tsx:138-146`, `to/fuel-panel.tsx:47-50`,
  `to/meter-readings-panel.tsx:32-36` — «сегодня» по браузеру вместо
  `getTodayInTimezone`.
- `scheduler.ts:257` — `tenantProductionDate(now, null)` вместо пояса тенанта.
- `maintenance-due.ts:35-36,55`, `format.ts:84-92`, `admin-dashboard.tsx:70-75` —
  сравнение дат моментами/локальной полночью вместо дня тенанта.
- `readiness-facts.ts:27-34`, `to/readiness-model.ts:45-52` — `sameLocalDay` по
  поясу процесса/браузера.
- `equipment-analytics-service.ts:143-144` — наивные границы окна в поясе процесса.
- `event-handlers.ts:395,399`, `telegram.ts:180` — дефолт «Москва».
- `scripts/verify-readiness.ts:23`, `scripts/apply-postgres-hardening.ts:67` —
  зашита «Москва» в скриптах/ограничении БД.

## Не проверено

- **Поведение `Intl.DateTimeFormat` на `node:22-alpine` без пакета `tzdata`.**
  Проверял только по коду: в образе `node:22-alpine` (`Dockerfile`) `ENV TZ` нет,
  наличия `tzdata` не смотрел. Если `tzdata` нет, `toLocaleDateString(...,
  {timeZone:'Europe/Moscow'})` бросит `RangeError` — тогда «правильные» места
  (находки 3, 5, 7 и весь `lib/timezone.ts`) падали бы, а не считали. Повтор
  оговорки `37-utc-day-bounds.md`.
- **Реальное значение `TenantSettings.timezone` у тенанта `orion` в БД** — не
  смотрел (подключение к БД/проде запрещено, AGENTS §1). Все оценки «сегодня
  верно для МСК» исходят из предположения, что пояс прод-тенанта = `Europe/Moscow`.
- **Итоговое время в контейнере на проде** — вывод «пояс процесса UTC» сделан из
  `Dockerfile*`/`docker-compose*.yml` (нигде нет `TZ`). Реальный запуск/`date` в
  контейнере не выполнял.
- **Замороженный мобильный контур оператора** (`src/modules/operator-mobile/**`,
  `src/components/piling/operator*/**`) — по AGENTS §1 не разбирал. Там есть свои
  суточные границы и `todayInTimezone` (`mobile-shift-query.ts:39,190`),
  `ppe.ts:57`, `shift-close.ts:140`, `production.ts:206`, `equipment.ts:57`,
  `admission.ts:158,281`. Если контур используется в проде, его границы смен/журнала
  надо аудировать отдельно.
- **DST и пояса западнее UTC** — оценки даны для российских поясов (UTC+3…+12).
  Поведение при переходе на летнее время не проверял; в `zonedDayStartUtc` два
  прохода на DST есть, но не замерялись.
- **Файлы `e2e/**`, `tests/**`** — вне задачи; там есть `Europe/Moscow` и
  `toISOString().split('T')[0]` в тестовых фикстурах, на прод не влияют.
- **`docs/**` и `agents/**`** — литералы `Europe/Moscow`/`MSK` в документации и
  вспомогательных агент-скриптах (`agents/qa-director.ts:875` — имя файла отчёта по
  UTC-дню) в таблицу находок не выносил: не влияют на производственные сутки.
