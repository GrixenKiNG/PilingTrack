# W140-IND-CALC-UNITS — расчёты погонных метров, глубин, моточасов и единиц (независимый аудит)

Аудируемая версия: `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01a264ffae97e3eaa7fea7582d90bf657d`
(merge `codex/j9-j8-j7-1007`). Отчёт-хранилище: worktree `D:/PillingR/wt-night`, ветка `hermes/q4-0926`.
Режим: только чтение; код не менялся, миграции/деплой не запускались, файл отчёта — единственная запись.

## Итог

- Проверено ~22 функции расчёта в 18 файлах: погонные метры (м.п.), длина/глубина сваи, время и формат простоя, моточасы, расход топлива, сумма выработки, KPI надёжности.
- **Критично — 0, важно — 3, мелочь — 9** (всего 12 находок). Топ-5:
  1. **План и факт метража считаются из РАЗНЫХ источников длины**: факт — `PileGrade.lengthMm/1000`, план — `SitePilePlan.metersPerUnit` с фолбэком на `lengthMm` (`src/services/analytics/site-analytics-service.ts:100-106` против `:126`). Один и тот же «м.п.» на дашборде имеет два разных определения → неверный «% плана».
  2. **Поправка выработки делает отчёт нередактируемым** (или молча теряет поправку): поправка вниз кладёт строку `PileWork` с отрицательным `count` (`production-corrections.ts:119`), а форма/валидация требуют `count >= 1` (`validation-schemas.ts:260`, `report-validation.service.ts:61`); при этом reconcile при сохранении удаляет любую несопоставленную строку (`reconcile-report-entries.ts:48`). Итог по оплате/выработке может измениться.
  3. **Поправка простоя обходит шаг в четверть часа**: `correctProduction` пишет `duration` как есть (`production-corrections.ts:190-191`), тогда как запись с телефона проверяет `isWholeDowntimeStep` (`production.ts:421`) → в отчёт можно вписать 1,3 ч.
  4. `PileWork.depth` — дубликат глубины, который никто не читает; журнал берёт глубину из `PilePassport.drivenDepthM` (`pile-journal-list.ts:159`), а путь пересоздания строки `depth` не пишет вовсе (`report.repository.ts:194-201`).
  5. Двойное округление по объектам/установкам копится: сначала `toFixed(1)`/`round1` на строку, потом сумма округлённых (`site-analytics-service.ts:179-198`, `equipment-analytics-service.ts:179-203`).
- Явной путаницы метров и сантиметров либо часов и минут в основном производственном пути **не найдено**: длина везде берётся из единственного резолвера `pileLengthMeters` (`src/lib/pile-length.ts:23`), простой везде в часах. Это честный отрицательный вывод, а не «не смотрел».
- Тесты на расчёты есть почти везде (см. таблицу функций): 200+ проверок в 20+ файлах; без прямых тестов остались SQL-агрегаты периода/аналитики (покрыты только структурными тестами) и `PileWork.depth`.

## Методика

Поиск и чтение (grep + read_file, все пути — от корня `wt-audit-0f53`):

- Ключи поиска: `lengthMm|pile-length|м\.п|погонн`, `fuel|топлив|моточас|engineHours`, `depth|глубин`, `metersPerUnit|totalDrilling|totalMeters`, `pileMeters|drillingMeters|downtimeHours`, `engineHoursDelta|computeFuelConsumption`, `Sum|reduce` в `src/modules/equipment`, `src/services/analytics`, `src/modules/reports/{domain,infrastructure,application}`.
- Прочитаны целиком/по фрагментам: `src/lib/pile-length.ts`, `fleet-kpi.ts`, `pm-due.ts`, `maintenance-due.ts`, `format.ts`, `downtime-hours.ts`, `report-status.ts`, `pdf-data.ts`, `pdf-generator/{single-pdf,period-pdf,period-row,types}.ts`, `components/piling/admin-reports/report-totals.ts`, `components/piling/dashboard-kpis.ts`, `components/piling/to/to-stats.ts`, `core/infrastructure/raw-queries.ts`, `modules/reports/domain/period-summary.ts`, `modules/reports/application/queries/{report-query.service,pile-journal-list,pile-journal-totals,pile-journal-export}.ts`, `modules/reports/application/commands/{report-command.service,report-validation.service}.ts`, `modules/reports/infrastructure/{report.repository,reconcile-report-entries}.ts`, `services/reports/event-handlers.ts`, `services/analytics/{site-analytics-service,equipment-analytics-service}.ts`, `modules/equipment/application/{commands/fuel-log,queries/equipment-query.service}.ts`, `modules/operator-mobile/domain/pile-passport.ts`, `modules/operator-mobile/application/commands/{production,production-corrections}.ts`, `lib/validation-schemas.ts`.
- Числа ручных примеров проверены `node -e` (см. «Ручные примеры»).
- Тесты прочитаны и посчитаны `node` по `\b(it|test)\(` в 21 файле (см. таблицу).
- Сравнение с другими отчётами `docs/audits/` сделано **после** независимого прохода и вынесено в приложение.

## Таблица функций

| Функция (path:line) | Вход (единицы) | Выход (единицы) | Перевод единиц | Округление | Тесты (файл, число) |
|---|---|---|---|---|---|
| `pileLengthMeters` `src/lib/pile-length.ts:23` | `lengthMm` (мм) | метры | `lengthMm/1000`, null→0 | нет | pile-length.test.ts (5), pile-meters-invariant.test.ts (2) |
| `lengthMmFromGradeName` `pile-length.ts:37` | имя марки | мм / null | первый 3-значный фрагмент ×100 (дециметры) | нет | pile-length.test.ts (внутри 5) |
| `getReportTotals` `admin-reports/report-totals.ts:20` | строки отчёта | шт, м.п., шт, м, ч, шт | через `pileLengthMeters` | нет (округляет представление) | report-totals.test.ts (6) |
| `addTotals` `report-totals.ts:34` | массив отчётов | те же | — | нет | report-totals.test.ts |
| `shiftDurationHours` `report-totals.ts:48` | «HH:MM» ×2 | часы / null | минуты→часы; +24ч через полночь | нет | report-totals.test.ts |
| `computePeriodSummary` `domain/period-summary.ts:22` | `PeriodReportInput[]` | шт, м.п., шт, м, ч | `pileLengthMeters` | нет | period-summary.test.ts (5) |
| `sumSubmittedReports` `application/queries/report-query.service.ts:92` | Prisma where | шт, м.п., шт, м, ч | `pileLengthMeters` | нет | косвенно equipment-query.service.test.ts (24) |
| `summarizePeriodReports` `lib/pdf-data.ts:128` | строки периода | шт, м, ч | — | нет | pdf-generator.test.ts |
| `generateSinglePdf` итоги `pdf-generator/single-pdf.ts:30-37` | piles/drillings/downtimes | шт/м.п./ч | `pileLengthMeters` | `formatCountMeters` (1 знак) | pdf-generator.test.ts |
| `generatePeriodPdf` итоги `pdf-generator/period-pdf.ts:23-45` | то же | шт/м.п./ч | `pileLengthMeters` | `formatCountMeters` | pdf-generator.test.ts |
| `computeFuelConsumption` `equipment/.../fuel-log.ts:72` | л, %, % | л (int), л/моточас | `tankLiters*(Δ%)/100` | `Math.round` л; 1 знак л/моточас | fuel-log.test.ts (9) |
| `getFuelSummary` `equipment/.../equipment-query.service.ts:262` | период, `FuelLog`, `MeterReading` | л, л/ч, Δмоточасы | `endHours - startHours` | через `computeFuelConsumption` | equipment-query.service.test.ts (24) |
| `computeFleetKpi` `src/lib/fleet-kpi.ts:70` | `MaintenanceRecord[]` | часы, доли | мс→часы | нет | fleet-kpi.test.ts (9) |
| `evaluatePlanDue` `src/lib/pm-due.ts:44` | план + моточасы/дата | часы/дни | — | нет | pm-due.test.ts (8) |
| `checkMaintenanceDue` `src/lib/maintenance-due.ts:30` | дата/моточасы | дни/часы | — | `Math.floor` | косвенно to-stats.test.ts (15) |
| `actualRefusalMm` `operator-mobile/domain/pile-passport.ts:36` | погружение мм, удары | мм/удар / null | `penetrationMm/blows` | 2 знака | pile-passport.service.test.ts (26) |
| `journalRefusalMm` `pile-passport.ts:228` | залоги | мм/удар + число залогов | среднее по 3 последним | 2 знака | pile-passport.service.test.ts |
| `validatePassport` `pile-passport.ts:116` | глубина м, длина м | список проблем | сравнение м с м | — | pile-passport.service.test.ts |
| `downtimeHoursBetween` `src/lib/downtime-hours.ts:102` | Date ×2 | часы | мс→часы; +24ч через полночь | нет | downtime-hours.test.ts (13) |
| `validateDowntimeWithinShift` `application/commands/report-validation.service.ts:11` | «HH:MM», длительности | throw/ok | минуты→часы | нет | report-validation.test.ts |
| SQL метража объекта `services/analytics/site-analytics-service.ts:100-106,126` | `Site`/`PileWork`/план | м.п., шт | план: `metersPerUnit`→`lengthMm/1000`; факт: `lengthMm/1000` | `toFixed(1)` на строку | site-analytics-service.test.ts (8, структурные) |
| SQL метража установки `services/analytics/equipment-analytics-service.ts:102,179-203` | `Report`/`PileWork` | м.п., шт | `lengthMm/1000` | `round1` на строку | equipment-analytics-service.test.ts (8) |
| `computeDashboardKpis` `components/piling/dashboard-kpis.ts:95` | строки аналитики | суммы | — | нет | dashboard-kpis.test.ts (11) |

## Ручные примеры (5 расчётов, проверены `node`)

1. **м.п. отчёта.** Марка `СВ 120-35`, `lengthMm = 12000`, 7 свай.
   Ожидание: `12000/1000 = 12 м` на сваю, `12 × 7 = 84 м.п.`.
   `pileLengthMeters` → 12; `getReportTotals.pileMeters` → 84. Совпало.
2. **Итоги периода.** Сдача: марка A `lengthMm 6000` × 10 + марка B `lengthMm 4000` × 5.
   Ожидание: `10×6 + 5×4 = 80 м.п.`, шт = 15 → `totalPileMeters = 80`. Совпало (period-summary.test.ts:26).
3. **Расход топлива.** Бак 400 л, начало 80 %, конец 50 %, долив 100 л, Δмоточасы 5.
   Формула: `долив + бак·(нач−кон)/100 = 100 + 400·30/100 = 220 л`; `220/5 = 44 л/моточас`.
   `computeFuelConsumption` → `{consumedLiters: 220, perEngineHour: 44}`. Совпало.
4. **Отказ сваи.** Залоги (удары/погружение): (10, 20), (10, 30), (10, 25) мм.
   Отказ за залог: 2, 3, 2.5 мм/удар; среднее по трём последним = 2.5 мм/удар.
   `journalRefusalMm` → `{refusalMm: 2.5, setsUsed: 3}`. Совпало.
5. **Простой через полночь.** 22:30 → 00:15.
   Ожидание: `1 ч 45 мин = 1.75 ч` (конец < начала → +24 ч).
   `downtimeHoursBetween` → 1.75; `formatDowntimeHours(1.75)` → «1 ч 45 мин». Совпало.

Дополнительно проверено `node`: `formatCountMeters(2832, 40311)` → «2 832 шт. / 40 311 м.п.»
(ru-RU, разделитель разрядов — неразрывный пробел, как ожидают тесты).

## Расхождения (находки)

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/services/analytics/site-analytics-service.ts:100-106` против `:126`; тест фиксирует расхождение — `site-analytics-service.test.ts:44-65` | План метража (`plannedPileMeters`) считается из `SitePilePlan.metersPerUnit` с фолбэком на `lengthMm/1000`; факт — только из `lengthMm/1000`. Проект сам объявил `metersPerUnit` непригодным источником длины (`src/lib/pile-length.ts:10-12`) | Дашборд/карточка объекта: «План N м.п.» и «факт M м.п.» в одних единицах, но из разных определений длины. У марки с пустым `lengthMm` план не ноль, а факт 0 → «план 100 %, факт 0 %» | Считать план тем же `lengthMm/1000` (или явно пересчитать `metersPerUnit` из `lengthMm`), вынести в один помощник |
| 2 | важно | `production-corrections.ts:119`; `validation-schemas.ts:260`; `report-validation.service.ts:61`; `report-form-dialog.tsx:71,190`; `reconcile-report-entries.ts:48` | Поправка вниз кладёт `PileWork` с отрицательным `count`; форма грузит все строки и пересылает их, а схема/валидатор требуют `count ≥ 1` → сохранение отчёта с поправкой падает 400. Если строку не переслать — reconcile удалит её молча, и сумма выработки/метража изменится | Правка отчёта с поправкой («было 10 → стало 8») не сохраняется; при обходе — поправка исчезает из итога. Деньги бригады | Разрешать в валидации строки с `correctsId` (отдельная ветка), не удалять их в reconcile |
| 3 | важно | `production-corrections.ts:190-191` против `production.ts:415-423` | Поправка простоя берёт `actual` как есть (`Math.round((actual-current)*100)/100`), шаг в четверть часа (`isWholeDowntimeStep`) не проверяется, в отличие от записи с телефона | В отчёт можно вписать простой 1,3 ч — ломает инвариант «час с шагом 0,25», с которым простой сравнивают между экранами | Проверять `isWholeDowntimeStep(input.actual)` и в поправке |
| 4 | мелочь | `production.ts:338`; `pile-journal-list.ts:159`; `report.repository.ts:194-201` | `PileWork.depth` заполняется как копия `PilePassport.drivenDepthM`, но нигде не читается (grep `.depth` — только запись); журнал берёт глубину из паспорта. При пересоздании строки (create-путь) `depth` не пишется | Две копии одной величины (глубина). Реальная — в паспорте; `PileWork.depth` — денормализованный дубль, который расходится с паспортом | Убрать `depth` из `PileWork` (или явно комментировать как кэш и заполнять всегда) |
| 5 | мелочь | `equipment-analytics-service.ts:179-203` (round1 `:218`); `site-analytics-service.ts:177-198` | Двойное округление: сначала `round1`/`toFixed(1)` на строку, затем сумма уже округлённых строк | Сумма округлённых ≠ округлённая сумма; на N установках/объектах ошибка до ~0,05·N м.п. | Округлять один раз — на выходе агрегата |
| 6 | мелочь | `admin-reports/report-form-dialog.tsx:109-113` | Форма считает `getPileMeters = Number((len*count).toFixed(1))` на строку, затем суммирует; серверный итог — без поэлементного округления | «м.п.» в форме может разойтись с итогом в журнале/PDF на десятые | Суммировать точные значения, округлять только вывод |
| 7 | мелочь | `report-totals.ts:26`, `single-pdf.ts:35`, `period-pdf.ts:25` (`d.count \|\| 1`) против `period-summary.ts:40` (`d.count ?? 1`) | Число бурений: `\|\| 1` и `?? 1` — неодинаковая семантика при `count = 0` | Сегодня недостижимо (`LeaderDrilling.count` — `Int @default(1)`, валидация ≥1), но расхождение — потенциальный второй источник числа | Один помощник `countOfDrilling` |
| 8 | мелочь | `validation-schemas.ts:275-279`; `production-corrections.ts:186-189` против кода `:191` | Комментарии противоречат коду: «неполный округляется вверх» рядом с «Без округления»; «полные часы, неполный вверх» рядом с `Math.round(...,2)` | Комментарий читают как спецификацию единиц/округления простоя — и ошибаются | Привести комментарии к «часы, шаг 0,25, без округления» |
| 9 | мелочь | `lib/pdf-generator/types.ts:8-10`; `pdf-data.ts:191-193`; `workers/pdf-worker.ts:89-90` против `period-pdf.ts:19-46` | Поля `PeriodPdfData.totalPiles/totalDrilling/totalDowntime` заполняются, но `generatePeriodPdf` их не использует — считает итоги сам из `reports` | Мёртвые поля; их значение (в т.ч. потенциально с черновиками) не влияет на PDF, но сбивает при правке | Удалить неиспользуемые поля или использовать их в PDF |
| 10 | мелочь | `lib/fleet-kpi.ts:86` | Ремонт с `completedAt == startedAt` не даёт ни MTTR, ни простоя (`c > s`), но попадает в `failureCount` | Отказ с нулевой длительностью считается сбоем, но не временем простоя → availability завышена | Решить явно: `c >= s` либо фиксировать нулевую длительность |
| 11 | мелочь | `equipment/application/queries/equipment-query.service.ts:105-110,157-167` | История установки (`allReports`) без фильтра статуса — в timeline попадают черновики, тогда как 30-дневные KPI фильтруют `submitted` | В истории установки видна выработка черновика, которую нигде в итоги не берут; при сверке выглядит как расхождение | Помечать строки-черновики или фильтровать по статусу |
| 12 | мелочь | `equipment-analytics-service.ts:47-52` против `fleet-kpi.ts:74` | `daysInPeriod` парсит `YYYY-MM-DDT00:00:00` в локальной зоне сервера, `fleet-kpi` считает период в UTC-мс | Длина периода (знаменатель «дней») зависит от TZ сервера — расходится с UTC-базой остальных расчётов | Считать период в одной базе (UTC) |

## Не проверено

- **Реальные данные в БД**: есть ли в проде отчёты с отрицательными `PileWork.count`/`LeaderDrilling.meters` и сданные отчёты с поправками. Находка №2 «сегодня недостижима» без таких строк — в БД не смотрел (read-only, локальная база не поднималась).
- **Поведение SQL-плана на пустом `lengthMm` у всех марок объекта** (находка №1): эффект «план ≠ 0, факт = 0» выведен из SQL, но на живых данных не воспроизводился.
- **`fetch`/числовые типы Prisma `Float`**: не проверял, теряются ли знаки при сериализации `duration`/`meters` из БД (тип вроде `number`), — код читает их как `number`, но границу десериализации не инспектировал.
- **Телефонный ввод** (`operator-mobile/ui.test.tsx`, `api.test.ts`): сами экраны ввода часов/метров не читал, только серверные команды.
- **PDF-вёрстка** (не значение, а отображение) — вне рамок задачи.
- Заморозки (operator-экраны, ORION) не смотрел по правилу AGENTS.md, кроме чтения общего домена `operator-mobile/domain/pile-passport.ts` (используется рабочим журналом забивки).

## Приложение: сравнение

Сравнение выполнено **после** независимого прохода, по файлам `docs/audits/hermes-night/` (список, не полное чтение):

- №1 (план из `metersPerUnit`) — **совпадает** с уже известным: `47-analytics-numbers.md` №8, `35-kpi-consistency.md` №19, `52-plan-progress-period.md` №1/№2. Нового здесь нет; мой проход подтверждает, что расхождение источников длины плана и факта сохраняется на SHA `0f53cd01`.
- №5 (двойное округление) и №7 (`\|\| 1`/`?? 1`) — **совпадают**: `24-duplicate-helpers.md` №6 и №7.
- №2 частично **пересекается** с `39-destructive-ops.md` №15 (reconcile молча удаляет строки бурения/простоя при правке), но там речь о самом удалении, а не о том, что отчёт с поправкой вниз вообще не сохраняется (400) из-за `count ≥ 1`. Эту связку (поправка ↔ правка отчёта) в прочитанном фрагменте других отчётов не встретил.
- №3 (поправка простоя без шага) и №4 (`PileWork.depth`) в прочитанных фрагментах не встречаются — считаю новыми.
- Прочее (критичных расхождений с прошлыми отчётами) не обнаружено; расхождений, где прошлый отчёт опровергает меня, нет.
