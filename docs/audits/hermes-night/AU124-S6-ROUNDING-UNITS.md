# AU124-S6-ROUNDING-UNITS — Округление и единицы в расчётах выработки

Версия: `git rev-parse HEAD` → `73a6a9a791fbbebde940f15e1d61376c77256b80`
Ветка: `hermes/q4-0926`. Режим: только чтение кода приложения, изменён только этот отчёт.

## Итог

Проверено 37 мест расчёта (метры погонные, глубина/залоги, моточасы, топливо, простои).
Счёт по важности: **критично — 0, важно — 9, мелочь — 25, ПРОЙДЕНО как корректные — 3**.
Единица длины в продукте — одна (`PileGrade.lengthMm / 1000`, `src/lib/pile-length.ts:23`), это ПРОЙДЕНО.
Пять главных находок:

1. **Метры бурения округляются на клиенте до сохранения** — форма отчёта пишет `Number((count*metersPerUnit).toFixed(1))` и это же уходит в БД (`src/components/piling/report-form/use-report-form.ts:371,402`), а мобильный путь пишет точное произведение (`src/modules/operator-mobile/application/commands/production.ts:403`). Одна и та же скважина даёт разные «м.п.» в зависимости от экрана ввода.
2. **Итог «м.п.» в форме отчёта администратора — сумма уже округлённых строк** (`src/components/piling/admin-reports/report-form-dialog.tsx:109-113`), тогда как сервер/PDF/аналитика суммируют точно (`src/components/piling/admin-reports/report-totals.ts:20-31`). Один отчёт показывает две разные суммы м.п. — округление сделано ДО суммирования.
3. **План м.п. объекта и факт м.п. считаются из разных источников длины**: план — `SitePilePlan.metersPerUnit` (с откатом на `lengthMm`), факт — только `PileGrade.lengthMm` (`src/services/analytics/site-analytics-service.ts:100-105` против `:126-128`). Процент выполнения объекта может быть посчитан по несопоставимым величинам.
4. **Итоги парка суммируются по уже округлённым значениям установки** (`src/services/analytics/equipment-analytics-service.ts:184-208`) — двойное округление, итог парка ≠ сумме м.п. из отчётов.
5. **CSV и XLSX выгружают м.п. свай по-разному**: CSV округляет каждую строку до 0,1 (`src/modules/reports/application/queries/report-export.service.ts:74-76,191`), XLSX пишет сырое число (`:333`) — файлы одного и того же отчёта расходятся в дробной части.

## Методика

Поиск по рабочему дереву `D:\PillingR\wt-night` (репозиторий, кроме frozen-зон — операторских экранов-вариантов и ORION — тех я не касался за исключением чтения мобильного контура учёта, который не входит в frozen-список):

1. `search_files` с регулярками: `toFixed\(`, `Math\.round`, `Math\.trunc`, `formatFixed`, `formatNumber`, `lengthMm`, `pileLengthMeters`, `м\.п\.`, `motohours|моточас|engineHours`, `fuelLog|топлив|liters|tankPercent`, `endingFuelPercent`.
2. Адресное чтение `read_file` по найденным файлам (полный список — в таблице ниже, каждый вывод подкреплён `path:line`, которые открыты).
3. Ключевые «источники истины»: `src/lib/pile-length.ts`, `src/lib/format.ts`, `src/lib/downtime-hours.ts`, `src/lib/maintenance-due.ts`, `src/modules/reports/domain/period-summary.ts`.
4. Сверка путей записи (`use-report-form` → `/api/reports/upsert` → `report-command.service`) и путей чтения (analytics, PDF, CSV/XLSX) между собой.

Повтор: ключевые регулярки из п.1 по `src/`, затем глазами по каждой строке с `toFixed`/`Math.round` в модулях, отвечающих за выработку/технику.

## Находки

Формула и округление указаны по фактическому коду; статусы — ПРОЙДЕНО (проверено в коде), ГИПОТЕЗА (вывод о последствии, код не запускался).

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/report-form/use-report-form.ts:371` | метры бурения считаются как `Number((count * metersPerUnit).toFixed(1))` — округление ДО сохранения | 3 скв. × 16,7 м = 50,1; 7 скв. × 16,7 м = 116,9 — сервер хранит уже округлённый `meters` (`report-command.service.ts:388` пробрасывает значение без пересчёта) | хранить точное `count*metersPerUnit`, округлять только при показе |
| 2 | важно | `src/components/piling/report-form/use-report-form.ts:402` | то же для «отложенной» строки в `handleSubmit` | вторая точка того же дефекта (см. #1) | см. #1 |
| 3 | важно | `src/modules/operator-mobile/application/commands/production.ts:403` | мобильный путь пишет `meters: entry.count * entry.metersPerUnit` — БЕЗ округления | противоположное #1: одна и та же скважина даёт 50,1 м на форме отчёта и 50,1 (точное 50.1 у 16,7×3 ок, но 3×16,66=49,98 → форма 50,0, мобильный 49,98) — расхождение экран↔экран | свести оба пути к одной функции расчёта объёма бурения |
| 4 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:109-113` | `getPileMeters = Number((length*count).toFixed(1))`, затем `formTotalPileMeters = formPiles.reduce((s,p)=> s + getPileMeters(...))` — сумма округлённых строк | 3 строки по 12,34 м → 12,3+12,3+12,3=36,9, а сервер (`report-totals.ts:22-25`) даст 37,0 — итог формы расходится с итогом отчёта и аналитики | суммировать точно, округлять на выводе (`formatFixed(total,1)`) |
| 5 | важно | `src/components/piling/admin-reports/report-totals.ts:20-31` | серверный итог (`addTotals`/`getReportTotals`) суммирует точно — эталон, не совпадающий с #4 | «единый источник» итогов существует, но форма его не использует | переиспользовать `getReportTotals` в форме |
| 6 | важно | `src/services/analytics/equipment-analytics-service.ts:184-208` | `pileMeters: round1(row.pileMeters)` по установке, затем `fleet.pileMeters = round1(equipment.reduce((s,e)=> s + e.pileMeters, 0))` — суммируются округлённые | 40 установок по 12,05 м → по 12,1 → итог 484,0 вместо 482,0 — округление ДО суммирования | суммировать сырые, округлять итог |
| 7 | важно | `src/services/analytics/site-analytics-service.ts:100-105` | план м.п. = `SUM(count * COALESCE(NULLIF(metersPerUnit,0), lengthMm/1000, 0))` — сначала `metersPerUnit` | `metersPerUnit` — плановая величина (в шапке `pile-length.ts:10-12` признана ненадёжной, «123 м/сваю»), факт же считает только `lengthMm` | план считать из `lengthMm` (или явно помечать источник) |
| 8 | важно | `src/services/analytics/site-analytics-service.ts:126-128` | факт м.п. = `SUM(pw.count * COALESCE(pg.lengthMm,0)/1000)` | факт и план (#7) — из разных источников длины; `pileProgress` (`:191-196`) делит несопоставимое | см. #7 |
| 9 | важно | `src/modules/reports/application/queries/report-export.service.ts:191` | CSV: `pileMeters: csvMeters(meters)` = `meters.toFixed(1)` по каждой строке | CSV теряет дробь в каждой строке; XLSX (`:333`) пишет сырое — выгрузки одного отчёта расходятся | не округлять в ячейке-числе, полагаться на формат Excel |
| 10 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:85-87` | `csvDecimal = String(value).replace('.', ',')` — без фикс. точности | целое печатается «2», дробное «16.7»→«16,7»: разная точность в одной колонке | задать единую точность или оставить сырое число |
| 11 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:352-363` | итоги листа «Итоги» суммируют сырые значения (`s + pileRowMeters(p)`), в отличие от CSV #9 | XLSX-итог ≠ CSV-строки того же отчёта | см. #9 |
| 12 | мелочь | `src/lib/format.ts:1-6` | `formatNumber(value, maxFractionDigits=1)` — «до N знаков», целое печатает без дробей | «12 м.п.» vs «12,0 м.п.» рядом с `formatFixed` (разнобой форматов одной величины) | для метров всегда `formatFixed(_,1)` |
| 13 | мелочь | `src/lib/format.ts:18-20` | `formatFixed` — фикс. точность, ru-RU | эталон для метров; используется не везде (`formatNumber` в аналитике/PDF) | заменить показ м.п. на `formatFixed` |
| 14 | мелочь | `src/lib/format.ts:23-30` | `formatHours`: `mins = Math.round((hours - Math.floor(hours)) * 60)` | округление остатка после отбрасывания целой части — для 1,999 ч даст «1 ч 60 мин»? нет, 0,999*60=59,94→60 → «1 ч 60 мин» (ГИПОТЕЗА по коду) | нормализовать минуты после округления |
| 15 | мелочь | `src/lib/downtime-hours.ts:122` | `formatDowntimeHours`: `totalMinutes = Math.round(hours * 60)` | другой порядок округления, чем `formatHours` (#14) — простой и отработанное время могут показать минуты, отличающиеся на 1 | один помощник на «часы+минуты» |
| 16 | мелочь | `src/lib/downtime-hours.ts:88-92` | `formatDowntimeHoursOnly`: `Math.round(hours * 100)/100` | третья точность для той же сущности «простой» (целые часы без минут) | оставить намеренно (комментарий это объясняет) |
| 17 | ПРОЙДЕНО | `src/lib/downtime-hours.ts:102-107` | `downtimeHoursBetween` — интервал/3 600 000, БЕЗ округления | серверный путь простоя не округляет — соответствует решению владельца 19.09.2026 | — |
| 18 | мелочь | `src/modules/operator-mobile/application/commands/production.ts:434` | `durationSeconds: Math.round(hours * 3600)` | часы хранятся точные (`duration`), секунды — отдельное округление; при шаге 0,25 ч всегда целое, но два источника одного факта | писать `Math.round` из того же поля явно и покрыть тестом |
| 19 | мелочь | `src/modules/operator-mobile/application/commands/production.ts:522` | то же для интервального простоя | вторая точка #18 | см. #18 |
| 20 | мелочь | `src/modules/operator-mobile/application/commands/production.ts:419` | `Простой длиннее суток (${Math.round(hours)} ч)` в тексте ошибки | округление в сообщении пользователю (24,4 ч → «24 ч») | не критично, текст, не данные |
| 21 | мелочь | `src/modules/operator-mobile/application/mobile-shift-query.ts:102-103` | строка записи: `value = Math.round(total*100)/100`, `meters = Math.round(totalMeters*10)/10` | показ округляет до 0,1, сервер хранит сырое — расхождение показ↔хранение при пересчёте поправок | см. общий вывод о показе |
| 22 | мелочь | `src/modules/operator-mobile/application/mobile-shift-query.ts:691-702` | итоги выработки смены через `round1(...)` | 0,1 м на экране против точных м.п. в отчёте | округлять на выводе, не в домене |
| 23 | мелочь | `src/modules/operator-mobile/application/mobile-shift-query.ts:741` | `sitePileVolume` возвращает `meters: round1(meters)` | «забито на объекте» округлено в источнике; другие экраны этого объёма берут сырое | вернуть сырое, округлять в UI |
| 24 | мелочь | `src/services/analytics/site-analytics-service.ts:179-187` | `parseFloat(row.plannedPileMeters.toFixed(1))` и т.д. по каждому объекту | сервер отдаёт уже округлённые значения; если UI суммирует объекты — двойное округление (как #6) | отдавать сырое, округлять в UI |
| 25 | мелочь | `src/app/api/admin/analytics/overview/route.ts:135` | `meters: Math.round(meters*10)/10` после точного суммирования | здесь округление ПОСЛЕ суммы — правильно; эталон для #6/#24 | перенести этот порядок в другие агрегаты |
| 26 | ПРОЙДЕНО | `src/app/api/admin/analytics/overview/route.ts:84` | `meters: r.piles.reduce((s,p)=> s + p.count*pileLengthMeters(...), 0)` — точная формула | соответствует `pile-length.ts`, единица — метры | — |
| 27 | мелочь | `src/modules/reports/domain/period-summary.ts:37` | `totalPileMeters += (p.count||0) * pileLengthMeters(...)` — точная сумма | эталон сводки за период, округления нет | — |
| 28 | мелочь | `src/lib/pdf-generator/format.ts:15-22` | `formatNumber`: целое→0 знаков, дробное→1; `formatMeters`: `formatFixed(_,1)` | в одной таблице PDF «36» и «36,0» соседствуют | везде `formatMeters` для м.п. |
| 29 | мелочь | `src/lib/pdf-generator/components.ts:203-212` | колонка сводного PDF «Бурение, м.п.» печатает `formatNumber(sumDrilling(report))` | целые метры бурения выглядят «36», дробные «36,5» — разная точность; при этом колонка подписана «м.п.» | `formatMeters` и единая подпись |
| 30 | мелочь | `src/lib/pdf-generator/period-pdf.ts:43-44` | в сводном PDF есть м.п. свай и бурения в плитках, но в таблице (`components.ts:203`) м.п. свай нет — только «Сваи, шт.» | сводный PDF и XLSX показывают разные наборы колонок | привести состав колонок к одному |
| 31 | мелочь | `src/lib/pdf-data.ts:128-140` | `summarizePeriodReports` считает `totalDrilling` из сохранённых `drilling.meters` (уже округлённых формой, #1) | PDF суммирует округлённое на входе — наследует дефект #1 | устранить #1, тогда это само выправится |
| 32 | мелочь | `src/modules/equipment/application/commands/fuel-log.ts:40-41` | `asInt = Math.trunc(v)` для `litersAdded`/`tankPercent` | 12,7 л долива сохранится как 12; 42,5 % остатка → 42 | использовать `Math.round`/хранить дробь, если точность нужна |
| 33 | мелочь | `src/modules/equipment/application/commands/fuel-log.ts:78-85` | `consumedLiters = Math.round(litersAdded + tank*Δ%/100)` (целые литры), затем `perEngineHour = Math.round(consumed/Δh*10)/10` | расход сначала округляется до целых литров, потом делится на моточасы — округление ДО деления искажает л/моточас | хранить расход дробным, округлять л/моточас на выводе |
| 34 | мелочь | `src/modules/operator-mobile/application/commands/shift-close.ts:158-159` | `endingFuelPercent = Math.round(fuelPayload.fuelPercent)` | остаток топлива на конец смены хранится целым %; в XLSX (`report-export.service.ts:366`) и на экране машиниста показывается без дробей | согласовано с `tankPercent` (тоже целый), но уменьшает точность |
| 35 | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:621-624` | подпись Telegram: `totalPileMeters = d.piles.reduce((s,p)=> s + (p.count||0)*pileLengthMeters(...), 0)` — точная сумма | совпадает с PDF/аналитикой; м.п. свай считаются от `lengthMm` | — |
| 36 | мелочь | `src/services/reports/event-handlers.ts:626` | `totalDrilling = d.drillings.reduce((s,x)=> s + (x.meters||0), 0)` — из сохранённых метров | наследует округление формы ввода (#1) | устранить #1 |
| 37 | мелочь | `src/services/reports/event-handlers.ts:224-229` | `recomputeSiteDailySummary`: хранит `totalPiles`/`totalDrilling`/`totalDowntime`, но НЕ м.п. свай | у дневной сводки нет погонных метров свай, хотя Telegram их печатает — расхождение набора величин между хранилищем и подписью | добавить `totalPileMeters` или не печатать м.п. в подписи |

Дополнительно (ПРОЙДЕНО как «единица одна»): `src/lib/pile-length.ts:23-26` — `pileLengthMeters = gradeLengthMm/1000`, и это единственный источник длины сваи во всех проверенных путях (`report-totals.ts:23`, `report-export.service.ts:90-92`, `period-summary.ts:37`, `single-pdf.ts:28-29`, `period-pdf.ts:31`, `mobile-shift-query.ts:121`, `admin analytics overview:84`). Разбора длины из имени марки в живом коде не осталось (`lengthMmFromGradeName` — только сидирование, `pile-length.ts:37-40`).

Вторая сквозная проверка (ПРОЙДЕНО): единица простого — час (`ReportDowntime.duration`), интервал считается без округления (`downtime-hours.ts:102`), наличие `durationSeconds` — избыточная, но согласованная копия (#18/#19).

## Не проверено

- **Числовые значения на реальных данных**: отчёты не читал (нет доступа к БД, `AGENTS.md` §1) — расхождения в #4/#6/#24 показаны арифметикой на примерах, не воспроизведены на боевых числах. Статус: ГИПОТЕЗА.
- **Отображение денег/стоимости ТО** (`cost`) и КПИ парка (MTBF/MTTR) — вне заявленной темы (метры/глубины/залоги/моточасы/топливо), не открывал.
- **Залоги и глубина сваи**: формула валидации — `src/modules/operator-mobile/domain/pile-passport.ts` (открыт по упоминанию в `production.ts:15`, читал только факт вызова `validatePassport`), внутренние пороги и округление глубины/отказа построчно не разбирал. Кандидат на отдельный разбор.
- **Frozen-зоны** (операторские экраны-варианты, ORION) не проверялись по правилу задачи.
- **Скрипты `scripts/` и воркеры `src/workers/`** кроме `unified-worker/pdf.ts` — не искал там расчёты выработки.
- **Телеграм-сводка**: подпись и м.п. проверены в `src/services/reports/event-handlers.ts:620-648` (ПРОЙДЕНО, #35); остальная логика доставки/ретраев не разбиралась — вне темы.
- **Дневная сводка объекта** (`SiteDailySummary`): запись проверена (`event-handlers.ts:216-243`), но кто и как её читает/показывает — не искал.
