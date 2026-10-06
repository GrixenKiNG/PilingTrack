# R154 — Производственный день: календарные границы в админке

READ-ONLY. Существующие файлы не менялись, код и тесты не создавались; единственная запись — этот
отчёт. Рабочая копия `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `caed862d3a744d2e3bd431b7943a7a1c7eec029f`
(`git rev-parse HEAD`), `git status` — чисто на момент чтения. `.env*` не читались, к БД/production/SSH
не подключались, push/merge/deploy не выполнялись. Замороженные зоны (варианты экрана оператора, ORION,
`src/modules/operator-mobile/**`) разбирались только как источник помощников, потребляемых админским
экраном; их правка вне scope.

Область: административные отчёты (`admin-reports/**`, `admin-analytics.tsx`, `admin-dashboard.tsx`),
смены (`to/readiness/screens/shifts-screen.tsx`), обслуживание (`to/readiness/screens/maintenance-screen.tsx`),
границы суток «сегодня/вчера/7 дней на 00:00», конец месяца/года и високосный день, пояс организации.
Разделение «строка дня `@db.Date`/`Report.date String`» против «момент `timestamptz`».

## Итог

- Находок **12**: **критично — 0**, **важно — 4**, **мелочь — 8**. Потери данных нет; расхождения —
  в границах суток и в трактовке пояса.
- **В проде сегодня (один тенант `orion`, Москва) почти всё верно**: для московского зрителя
  «браузерный пояс = пояс тенанта», поэтому класс «пояс браузера/процесса» не воспроизводится. Он
  проявится при втором тенанте или при переносе сервера — это правило «до второго тенанта» (AGENTS.md §3).
- Единственная находка, воспроизводимая **сегодня и для московского зрителя**, — **№1**: подстановка
  даты окончания документа через `setMonth` переезжает через конец месяца и в високосный год.
- Топ-5:
  1. **важно** — `user-documents.tsx:160-161`: `expires.setMonth(getMonth()+months)` даёт «2026-03-03»
     для «31.01.2026 + 1 месяц» вместо 28.02; в високосный 2028 даёт 02.03 вместо 29.02.
  2. **важно** — `equipment-analytics-service.ts:142-143`: окно топлива по телеметрии строится наивными
     строками `…T00:00:00` в поясе процесса (UTC) → сдвиг +3 ч, тогда как сваи/простой того же отчёта
     режутся по дню `Report.date`. **Повтор R37 №4.**
  3. **важно** — `clearance-overview-query.ts:164-168`: «сегодня/за месяц/за два месяца» жёстко
     московские, а «месяц» — это `now − 30 суток` (момент), а не календарный месяц. **Повтор R37 №12.**
  4. **важно** — `getTodayInTimezone()` вызывается **без пояса тенанта** в админских отчётах/дашборде
     (`admin-dashboard.tsx:89,285`, `admin-analytics.tsx:51`, `report-list-format.ts:15`,
     `report-form-dialog.tsx:65`, `start-inspection-form.tsx:69`, `report-validation.service.ts:38`):
     подставляется `Europe/Moscow`. **Повтор R114 №28.**
  5. **мелочь** — локальные `todayYmd/shiftYmd` по поясу браузера (`equipment-monitoring.tsx:138-146,163-164`,
     `equipment-analytics.tsx:71-77`, `fuel-panel.tsx:47-50`, `meter-readings-panel.tsx:32-36`).
- **Закрытые пункты R114/F-R141/R37** (переоткрытию не подлежат) вынесены в раздел «Сверка с прошлыми
  аудитами»: F-R141-TODAY, F-R141-SHIFT-WEEK (R114 №10 / R141 №17), R114 №8, R37 №2, R37 №3 — все
  исправлены и (кроме R37 №2) покрыты тестами.

## Методика

Только чтение; GitNexus `impact` не запускался (символы не менялись), проверки §6 AGENTS.md
(`tsc`, `lint`, `test:unit`, `playwright --list`, `build`) не запускались — задача read-only.
Все `path:line` — по фактически открытым файлам. Воспроизведение:

1. Правила: `AGENTS.md` (модель доверия, заморозки, «выглядит мёртвым»), `CLAUDE.md` не требовался.
   Зафиксирован HEAD `caed862d…` (`git rev-parse HEAD`, `git status`).
2. Типы полей-дат: `prisma/schema.prisma` (чтение без правок) — `Report.date String // YYYY-MM-DD`,
   `Shift.productionDate @db.Date`, `MaintenanceRecord.scheduledAt/startedAt/completedAt @db.Timestamptz`,
   `Equipment.nextMaintenanceDate Timestamptz`; различение «строка дня» / «момент» из R114/R37.
3. Помощники дня: `src/lib/timezone.ts` (`getTodayInTimezone:21`, `zonedDayStartUtc:33`,
   `formatDateInTimezone:57`, `formatDateTimeInTimezone:74`), `src/lib/format.ts` (`formatRuDate:56`,
   `daysUntil:84`), `src/modules/readiness/domain/shifts/tenant-production-date.ts` (`tenantProductionDate:13`),
   `src/modules/readiness/application/read-filters.ts` (`localBoundaryToUtc:16`, эталон).
4. Сплошные поиски `search_files` по `src/`: `toISOString()\.slice(0, ?10)`, `toISOString()\.split('T')`,
   `T00:00:00|T23:59:59|T12:00:00`, `getTodayInTimezone\(|tenantProductionDate\(|zonedDayStartUtc\(`,
   `setMonth|new Date\([a-z]+, ?[a-z]|Date\.now\(\) ?-|getTimezoneOffset`,
   `вчера|Вчера|7 дней|неделю|Неделя`, `setHours\(0|startOfDay|endOfDay|getFullYear\(\)|Date\.UTC\(`.
5. Точечные прочтения: `admin-reports.tsx` (фильтры 32-42, 120-133, 235-254), `report-list-format.ts`,
   `use-reports-data.ts`, `report-filters.tsx`, `admin-analytics.tsx:38-56`, `admin-dashboard.tsx:70-94`,
   `to/readiness/screens/{shifts-,maintenance-,reports-,briefings-}screen.tsx`,
   `to/readiness/screens/shared.tsx:128-151` (полоса фильтров — `<input type=date>` → «ГГГГ-ММ-ДД»),
   `to/readiness/shift-create-form.tsx`, `forms/permit-form.tsx`, `admin-users/user-documents.tsx`,
   `admin-equipment/detail/equipment-monitoring.tsx`, `equipment-analytics.tsx`, `to/fuel-panel.tsx`,
   `to/meter-readings-panel.tsx`, `modules/safety/domain/briefing-requirements.ts`,
   `modules/safety/application/clearance-overview-query.ts`, `modules/readiness/application/operator-shift-query.ts`,
   `modules/readiness/application/scheduler.ts`, `app/api/{reports/export,reports/period,maintenance/kpi,admin/analytics/overview}/route.ts`,
   `core/infrastructure/raw-queries.ts:58-83`, `services/analytics/equipment-analytics-service.ts`,
   `modules/equipment/application/queries/equipment-query.service.ts`, `lib/pm-due.ts`, `lib/document-expiry.ts`.
6. Проверка значений — `node` (Python нет): `TZ=Europe/Moscow node -e "…setMonth…"` для точных дат
   находки №1 (см. ниже).
7. Сверка прошлых аудитов (прочитаны целиком): `R114-date-time-format.md`, `R141-readiness-board.md`,
   `R144-maintenance-date-consistency.md`, `37-utc-day-bounds.md`, `MR-CHECK-1004.md`; текстовый поиск
   `F-R141-TODAY|F-R141-SHIFT-WEEK` → `maintenance-screen.tsx:36,72` и `to-module-shell.test.tsx:315-321`.
   Закрытое помечено «повтор Rnn» и в таблицу находок не вынесено.

**Принято корректным (в таблицу не вынесено):**
- `admin-reports/report-list-format.ts:14-22` (`todayYmd`/`shiftYmd` через **полдень UTC**) и такой же
  `shiftDay` в `admin-analytics.tsx:39-40`, `admin-dashboard.tsx:85-86`, `equipment-report-export.tsx:35-37`
  — арифметика календарных дней **без перевода часов**, верна на конце месяца/года и в високосный день.
  (Замечание к ним — только про пояс, находка №4.)
- `admin-reports.tsx:243-245` — фильтры «Сегодня/Вчера/7 дней» сравнивают `report.date` (строку дня
  тенанта) с границами дня тенанта; `>= weekStart && <= today` — корректное включительное окно 7 дней.
- `reports-screen.tsx:39-71,111-120` (TO-контур) — период и предыдущее окно считаются **днями тенанта**
  (`tenantDay`), а не мгновениями; `dayToUtc`/`shiftDay` — UTC-арифметика по строке дня.
- `readiness/application/read-filters.ts:16-40` — `localBoundaryToUtc` строит границы `from`/`to` по
  поясу тенанта (эталон для остальных); `parseReadinessReadFilters` различает `ГГГГ-ММ-ДД` и ISO.
- `app/api/{reports/period,admin/analytics/overview,reports/export}/route.ts` — проверка дат
  «реальная календарная дата» (`toISOString().slice(0,10) === value`) отсекает `2026-02-31`; период
  фильтруется строкой `Report.date` (`raw-queries.ts:58-83`, `overview/route.ts:50-54`).
- `briefings-screen.tsx:174-195` и `shifts-screen.tsx:49-58` — «сегодня/вчера/неделя» по поясу тенанта
  (см. закрытые пункты).
- `maintenance/kpi/route.ts:33-38` — окно KPI из дня тенанта (`zonedDayStartUtc(addDays(...))`).

## Находки

| № | Severity | path:line | Проблема | Сценарий / ожидаемый диапазон | Что предложить |
|---|----------|-----------|----------|-------------------------------|----------------|
| 1 | важно | `src/components/piling/admin-users/user-documents.tsx:160-162` | Подстановка даты окончания документа: `expires.setMonth(expires.getMonth()+months)`. `setMonth` перескакивает через короткий месяц и високосный год; `new Date(issuedAt)` разбирает день как UTC-полночь, а `getMonth/setMonth` работают в поясе браузера. Готовый корректный `addMonths` уже есть в `modules/safety/domain/briefing-requirements.ts:78-86`, но здесь не используется | Дата выдачи **31.01.2026**, срок **1 месяц** → ожидается **28.02.2026**, фактически **03.03.2026**. 31.01.2027 + 1 мес → ожидается 28.02.2027, факт **03.03.2027**. 31.01.2028 + 1 мес → ожидается **29.02.2028** (високосный), факт **02.03.2028**. Проверено `node` (`TZ=Europe/Moscow`). Поле редактируемое, но если админ не поправит — в карточку ляжет неверный срок медосмотра/удостоверения | Вызвать `addMonths(new Date(issuedAt), months)` из `briefing-requirements.ts`; гнать `issuedAt` через тот же помощник, что и остальные даты (день тенанта) |
| 2 | важно | `src/services/analytics/equipment-analytics-service.ts:142-143` | Окно расхода топлива по телеметрии: `fromTs = new Date(`${dateFrom}T00:00:00`)`, `toTs = new Date(`${dateTo}T23:59:59.999`)` — наивные строки в поясе процесса (контейнер UTC). Остальные числа того же отчёта (`:70-71`) фильтруются строкой `Report.date` дня тенанта | Период 20.09–26.09: по сваям/простою это 20.09 00:00–26.09 24:00 МСК, по топливу — 20.09 03:00–27.09 03:00 МСК. Расход первой ночи теряется, последней — приписывается. **Повтор R37 №4**, телеметрия сейчас спит (`fuelLiters`=0) | `zonedDayStartUtc(dateFrom, timezone)` / `zonedDayStartUtc(addDays(dateTo,1), timezone)` (образец — `pile-passport.service.ts:166-167`, `maintenance/kpi/route.ts:33-38`) |
| 3 | важно | `src/modules/safety/application/clearance-overview-query.ts:164-168` | «Сегодня» жёстко `Europe/Moscow`, а `monthAgo`/`twoMonthsAgo` — это `now − 30/60 суток` (**момент**, скользящее окно), а не календарный месяц. Пояс тенанта не читается | Сегодня для МСК верно (комментарий это признаёт). При тенанте в другом поясе «инструктажи за месяц» съедут на сутки; «месяц»=30 суток даёт расхождение с календарным месяцем в 28/29/31 день. **Повтор R37 №12.** Правило «до второго тенанта» | Взять пояс из настроек (`normalizeTenantTimezone`) и считать через `zonedDayStartUtc`/`tenantProductionDate`; «месяц» — календарный, не 30 суток |
| 4 | важно | `admin-dashboard.tsx:89,285`; `admin-analytics.tsx:51`; `admin-reports/report-list-format.ts:15`; `admin-reports/report-form-dialog.tsx:65`; `inspections/start-inspection-form.tsx:69`; `modules/reports/application/commands/report-validation.service.ts:38` | `getTodayInTimezone()` вызывается **без пояса тенанта** → умолчание `Europe/Moscow`. Производственный день берётся по Москве, а не по `tenant.timezone` | Сегодня (тенант `orion`=МСК) совпадает. При тенанте восточнее Москвы «Сегодня/7 дней», дата отчёта по умолчанию, дата осмотра и проверка «дата не в будущем» уедут на сутки у ночных операций. **Повтор R114 №28.** | Прокидывать `bootstrap.tenant.timezone` (на сервере — `getSettings(tenantId).timezone`) во все вызовы `getTodayInTimezone` |
| 5 | мелочь | `admin-equipment/detail/equipment-monitoring.tsx:138-146` и `:163-164`; `equipment-analytics.tsx:71-77`; `to/fuel-panel.tsx:47-50`; `to/meter-readings-panel.tsx:32-36` | Локальные `todayYmd`/`shiftYmd` строятся по поясу браузера (`getFullYear/getMonth/getDate`); `equipment-monitoring` шлёт `from/to` наивными `new Date(`${d}T00:00:00`). Границы окна телеметрии — по часам зрителя, а не тенанта | Для московского браузера верно; при зрителе/тенанте в другом поясе края окна телеметрии сдвинуты. **Класс R114 №17.** Правило «до второго тенанта» | Считать день через `getTodayInTimezone(tenant.timezone)`/`shiftDay`; границы — `zonedDayStartUtc` |
| 6 | мелочь | `src/lib/pm-due.ts:71-72` | `dueDate = lastDoneAt + intervalDays * 86_400_000` (момент) и `daysRemaining = floor((dueDate − now)/сутки)`. Срок регламента ТО считается прибавкой миллисекунд, а не календарных дней | `lastDoneAt` 26.09 01:00 МСК → срок «26.10» моментом; при показе в поясе тенанта день срока может оказать 25.10 — «через N дней» уедет на сутки. **Повтор R37 №17** (используется клиентом и планировщиком `maintenance-regulation.ts`) | Складывать календарные дни по строке дня (`addDays`), сравнивать дни, а не моменты |
| 7 | мелочь | `src/app/api/reports/export/route.ts:62` | Имя файла `pilingtrack-reports-${today}.csv|.xlsx`, где `today = new Date().toISOString().split('T')[0]` — UTC-день | Выгрузка 26.09 в 01:00 МСК получит имя `…-2026-09-25.…` (файл «за 25-е», данные — за выбранный период). **Повтор R37 №8** | `getTodayInTimezone(timezone)`; пояс тенанта |
| 8 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:89` | `cutoff = new Date(Date.now() - 30*86_400_000).toISOString().slice(0,10)` сравнивается со строкой `Report.date` | В 00:00–03:00 МСК граница среза попадает на вчерашний UTC-день: карточка техники («Сваи за 30 дней») теряет/прибавляет один день. **Повтор R37 №7** | `getTodayInTimezone()`, затем вычесть 30 дней от дня тенанта |
| 9 | мелочь | `src/modules/operator-mobile/domain/briefing-journal-view.ts:105-110,123-138` | `currentMonthRange` и `dayRangeToInstants` строят границы по **поясу браузера** (`new Date(y,m,d,23,59,59)` в `endOfDay`). Админский экран `briefings-screen.tsx:88,104,154` берёт период отсюда | Период журнала инструктажей по умолчанию и его края — по часам зрителя: записи последнего дня месяца у ночного зрителя из другого пояса выпадают. **Повтор R114 №9.** Модуль **заморожен** (`AGENTS.md §1`) — правка вне scope этой задачи; отмечаю как известное | Не править здесь; при разморозке — считать края через `zonedDayStartUtc(day, tenant.timezone)` |
| 10 | мелочь | `src/modules/readiness/application/scheduler.ts:257` | `tenantProductionDate(now, null)` — пояс тенанта **сознательно не передан**, `settings.timezone` игнорируется. Рядом, `:104`, пояс уже передаётся | Сегодня совпадает с МСК. При тенанте в другом поясе суточный пересчёт готовности пошлёт событие с чужим `productionDate` (ключ дедупликации по суткам). **Повтор R37 №14** — несогласованность внутри одного файла | Читать настройки и передавать `timezone`, как в `:104` |
| 11 | мелочь | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:28,378-383` | `FLEET_TZ = 'Europe/Moscow'` — константа вместо пояса тенанта; `ymd()` форматирует момент через `toLocaleDateString('sv-SE', {timeZone: FLEET_TZ})` | Для МСК «today/active/expected/idle» на парке верны; при ином поясе карточки и `totals.pilesToday` съедут на день. **Повтор R37 №13.** Правило «до второго тенанта» | Прокинуть `tenant.timezone` (в опциях `FleetSnapshotOptions` уже есть `tenantId`) |
| 12 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:121-133,235-254` | Быстрые фильтры используют `todayYmd()/shiftYmd()` (умолчание Москва) и вычисляются внутри `useMemo`, чьи зависимости — `[filterEquipmentId, quickFilter, reports, search]` (без «часов») | Для тенантa `orion` верно. При тенанте в другом поясе «Сегодня/Вчера/7 дней» и пересечение с периодом выгрузки считаются по московскому дню. Экран, открытый через полночь, держит вчерашнюю границу до перерисовки — мелочь. **Тот же корень, что №4** | Брать день тенанта из `bootstrap`/настроек; при желании — пересчитывать границу по таймеру |

## Сверка с прошлыми аудитами

Закрытые пункты (переоткрытию не подлежат; проверены открытием файлов, не по памяти):

- **F-R141-TODAY** (это же R141 №7) — **закрыт**: счётчик «Работы сегодня» считает день пояса тенанта
  через `tenantDay` (`maintenance-screen.tsx:40-41,74-76`), а не `.slice(0,10)` момента. В таблицу не выношу.
- **F-R141-SHIFT-WEEK** (R141 №17 / R114 №10) — **закрыт**: фильтр «Неделя» сравнивает
  `productionDate.slice(0,10)` с днём тенанта (`shifts-screen.tsx:49-58`); регрессионный тест
  `to/__tests__/to-module-shell.test.tsx:315-321`. В таблицу не выношу.
- **R114 №8** («сегодня/вчера» инструктажей по дню браузера) — **закрыт**: `dayKey(date, timezone)`
  (`briefings-screen.tsx:56-59,174-195`); тест `screens/__tests__/briefings-screen.test.tsx:80-96`.
- **R37 №2** (`meterKnownToday` от локальной полуночи процесса) — **закрыт**: `startOfTenantDay`
  (`operator-shift-query.ts:135-136,229`).
- **R37 №3** (окно KPI `/api/maintenance/kpi` наивной строкой) — **закрыт**: `windowBound` через
  `zonedDayStartUtc(addDays(...))` (`maintenance/kpi/route.ts:33-38`); тест `kpi/__tests__/route.test.ts`.

Продуктовое решение (не баг): производственный день по умолчанию берётся московским (`getTodayInTimezone`
без аргумента) — это согласовано с единственным тенантом `orion`. Находка №4 — не «сломанный код», а
класс «до второго тенанта» (AGENTS.md §3); помечаю это прямо, чтобы не выдавать за регрессию.

## Не проверено

- **Живой рендер и данные.** Приложение не поднималось, БД не читалась; все примеры — из формул кода и
  проверки `node` (`TZ=Europe/Moscow`), а не из реальных записей. Конкретные значения
  `Settings.timezone` тенанта `orion` и `UserDocumentType.defaultValidMonths` в БД не смотрел (только
  код-путь через `props`/`defaultValidMonths`).
- **Пояс браузера админов** предполагается московским; для находок №2, 5, 7–12 фактическое поведение при
  поясе браузера ≠ пояса тенанта не замерялось.
- **Достижимость находки №1:** `defaultValidMonths` приходит из справочника видов документов; какие
  именно значения заведены у `orion` (1, 6, 60 мес), не проверял. Логика ошибки подтверждена на входе
  «31.01 + 1 мес» независимо от значения справочника.
- **Замороженные зоны** (`operator-mobile/**`, `src/app/operator/**`, `src/app/(app)/operator/**`,
  `src/components/piling/operator*`, ORION) — не аудировались; `briefing-journal-view.ts` (№9) прочитан
  только как источник границ периода для **админского** экрана.
- **Таймзоны западнее UTC и переход на летнее время** — оценки даны для российских поясов (UTC+3…+12),
  где перехода нет; поведение на DST не проверял (в `zonedDayStartUtc` два прохода есть, но не замерялись).
- **GitNexus `impact`/`detect-changes`** и проверки §6 AGENTS.md (`tsc`, `lint`, `test:unit`,
  `playwright --list`, `build`) **не запускались** — код не менялся, отчёт — единственная запись.
  Существующие тесты читались как контекст, не прогонялись.
