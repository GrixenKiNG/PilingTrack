# AU179-S6-FUEL-CONSUMABLES-UNITS — Топливо и расходники: единицы

Версия (git rev-parse HEAD): `2711046b60be196f2b2a8608979312df190b49bc`
Ветка: `hermes/q4-0926`. Аудит только на чтение; код приложения не менялся.
Статусы выводов: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА. Числа — только из кода/команд.

## Итог

Топливо в PilingTrack живёт в ТРЁХ независимых хранилищах с разными единицами, и они не сводятся:
`Report.endingFuelPercent` (%, вводит оператор при закрытии смены), `FuelLog.litersAdded/tankPercent`
(л и %, ручной журнал на карточке ТС) и `TelemetryRecord.type='fuel_total'` (литры-счётчик из бокса,
которого сейчас нет). Всего 14 находок: 0 критично, 4 важно, 10 мелочь.
Самое важное: аналитика парка показывает «Топливо/расход за период» из телеметрии `fuel_total`
(`equipment-analytics-service.ts:150–168,188,208`), а НЕ из ручного журнала `FuelLog`, который
объявлен источником истины (`prisma/schema.prisma:754–761`). Пока бокс не подключён — колонка
«Топливо» всегда «—»/0, хотя данные в `FuelLog` вводятся руками; и наоборот, если бокс появится,
два «расхода» разойдутся. Дополнительно: литры в журнале хранятся целыми и молча усекаются
(`fuel-log.ts:41`), единица телеметрии не валидируется (`telemetry/ingest/route.ts:320`), а долив
масла/ОЖ/гидромасла (л) пишется в свидетельства смены, но нигде не читается и не суммируется.

## Методика

Что искал и чем (всё воспроизводимо из корня репозитория):
- Точка входа: `git rev-parse HEAD`; затем `AGENTS.md` (trust model, замороженные зоны, «looks dead»).
- Поиск по содержимому: `search_files(pattern='fuel|Fuel|топлив|FuelConsumption|consumable|Consumable|масло|oil')` по `src/`.
- Точечное чтение файлов (через `read_file`, полные пути): `prisma/schema.prisma` (модели Equipment,
  MeterReading, FuelLog, Report, TelemetryRecord, PileWork, LeaderDrilling, ReportDowntime, PileGrade);
  `src/modules/equipment/application/commands/fuel-log.ts`; `.../queries/equipment-query.service.ts`;
  `src/services/analytics/equipment-analytics-service.ts`; `src/app/api/equipment/[id]/fuel/route.ts` и
  `.../[entryId]/route.ts`; `src/app/api/telemetry/ingest/route.ts`; `src/components/piling/to/fuel-panel.tsx`;
  `src/components/piling/equipment-analytics.tsx`; `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx`;
  `src/modules/inspections/domain/consumables.ts`; `src/modules/inspections/domain/lubrication-maps.ts`;
  `src/modules/operator-mobile/application/commands/{checklist.ts,shift-close.ts}`;
  `src/modules/operator-mobile/application/mobile-shift-query.ts`; `src/modules/operator-mobile/domain/checklist-catalog.ts`;
  `src/modules/reports/application/queries/report-export.service.ts`; `src/lib/pile-length.ts`; `src/lib/format.ts`.
- Обратный поиск потребителей (чтобы отличить «суммируется» от «только пишется»): `search_files` по
  `fuelLiters`, `endingFuelPercent`, `FuelLog/fuelLog`, `getFuelSummary`, `computeFuelConsumption`,
  `engineOilL|coolantL|hydraulicOilL|FLUID_READING`, `getConsumables`.
- Изменения кода не вносились, проверки §6 AGENTS.md (tsc/lint/test/build) не запускались — задача read-only;
  они для этого аудита нерелевантны и отражены в «Не проверено».

## Единицы: сводная таблица поле | единица | где хранится/считается | где суммируется | риск

| Поле | Файл:строка | Единица | Где суммируется | Риск |
| --- | --- | --- | --- | --- |
| `FuelLog.litersAdded` | `prisma/schema.prisma:767` | л, целое (Int?) | `equipment-query.service.ts:288` (reduce) | десятичные усекаются, см. №6 |
| `FuelLog.tankPercent` | `prisma/schema.prisma:768` | % (0–100), целое | не суммируется (берётся крайнее значение `:291–292`) | десятичные усекаются |
| `Equipment.fuelTankLiters` | `prisma/schema.prisma:490` | л, целое | не суммируется | — |
| `computeFuelConsumption.consumedLiters` | `fuel-log.ts:79` | л, целое (`Math.round`) | не суммируется (на машину) | отрицательный расход показывается как есть, №7 |
| `computeFuelConsumption.perEngineHour` | `fuel-log.ts:84` | л/моточас, 1 знак | не суммируется | — |
| `Report.endingFuelPercent` | `prisma/schema.prisma:1956` | %, целое | НЕ суммируется (точечный замер) | третий источник топлива, не связан с FuelLog, №1 |
| `TelemetryRecord.value` (`type='fuel_total'`) | `prisma/schema.prisma:2040` | Float, единица не задана | `equipment-analytics-service.ts:166` (max−min), `:208` (по парку) | единица не валидируется, №2 |
| `TelemetryRecord.value` (`type='fuel_level'`) | `prisma/schema.prisma:2040` | Float, `unit` свободный | не суммируется | пороги 15/5 предполагают %, №4 |
| `consumables[].qty` | `consumables.ts:26–27` | свободный текст («8 л», «2 шт», «1 компл.») | НЕ суммируется (справочник заказа) | смешанные единицы, нельзя сложить, №10 |
| `engineOilL / coolantL / hydraulicOilL` | `checklist-catalog.ts:98,104,130` | л | нигде (пишется в evidence, не читается) | данные собираются, но не показываются, №5 |
| `LeaderDrilling.meters` | `prisma/schema.prisma:2365` | м (Float) | `equipment-analytics-service.ts:112` | — |
| `ReportDowntime.duration` | `prisma/schema.prisma:2399` | ч (Float) | `equipment-analytics-service.ts:117` | — |
| `PileGrade.lengthMm` | `prisma/schema.prisma:2452` | мм (Int) | `equipment-analytics-service.ts:105` (×/1000 → м) | дублирует `pile-length.ts`, №11 |

## Находки

# | severity | path:line | problem | scenario / why it matters | suggested fix
---|---|---|---|---|---
1 | важно | `src/services/analytics/equipment-analytics-service.ts:150-168,188,208` | «Топливо» в аналитике парка берётся из телеметрии `fuel_total` (max−min за период), а не из журнала `FuelLog`, который в схеме и коде объявлен источником истины (`prisma/schema.prisma:754-761`, `fuel-log.ts:4-8`). | Пока бокса нет (телеметрия спящая), колонка «Топливо» (`equipment-analytics.tsx:195,340`) всегда «—»/0, хотя администратор вводит литры в журнал на карточке ТС. Два разных числа называются «расход за период»: в аналитике — из счётчика, в панели топлива — из долива (`fuel-panel.tsx:155-163`). Когда бокс появится, числа разойдутся. | Для отчётности по расходу использовать агрегат по `FuelLog` (литры) как источник; телеметрию — как отдельный «расход по датчику». Либо явно подписать источник числа в UI. |
2 | важно | `src/app/api/telemetry/ingest/route.ts:319-320` | Единица телеметрии (`unit`) пишется строкой без валидации и без сверки с типом; `value` — свободный Float. | Аналитика вычитает значения `fuel_total` и подписывает результат как «л» (`equipment-analytics-service.ts:166,188`; `equipment-analytics.tsx:195`). Если бокс пришлёт галлоны или литры×10 (а type='fuel_total' разрешён `route.ts:246`), «расход в литрах» будет неверным при полном отсутствии сигнала об ошибке. ГИПОТЕЗА до подключения железа, но код уже принимает такие данные. | Ввести whitelist единиц на тип (например `fuel_total`→`L`) и отклонять/нормализовать чужие единицы на входе. |
3 | важно | `src/modules/operator-mobile/application/commands/checklist.ts:264-278` | Долив масла/ОЖ/гидромасла (л) пишется в `operatorShiftEvidence` (`kind='FLUID_READING'`, `payload.fluids`), но обратного чтения нет: `shift-close.ts:150-160` читает FLUID_READING и берёт только `fuelPercent`; `mobile-shift-query.ts:462-466` читает только `STARTUP_READING`. Потребителей `payload.fluids` в `src/` не найдено. | Комментарий `checklist.ts:231-233` обещает «механик узнает, что масло доливают третью смену подряд», но нигде это не отображается и не суммируется — данные собираются «в никуда». | Либо вывести долив в карточку ТС/журнал ТО (агрегат по evidence), либо снять сбор, чтобы не копить мёртвые данные. |
4 | важно | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:47` | Пороги `fuel_level` (`warn {min:15}`, `alarm {min:5}`) заданы как проценты, но код их не проверяет против единицы записи (`renderValue` `:324-327` показывает сырое значение + `unit` из записи, без преобразования). | Если бокс шлёт `fuel_level` в литрах (бак 300–600 л), предупреждение при 15 и авария при 5 л практически не сработают (пустой бак обнаружит лишь аварийный индикатор), либо сработают неверно. ГИПОТЕЗА (зависит от прошивки бокса), но защита от неверной единицы отсутствует. | Нормализовать `fuel_level` к % на входе (или задать пороги в той же единице, что приходит) и валидировать по `unit`. |
5 | мелочь | `src/lib/pile-length.ts:23-26` vs `src/services/analytics/equipment-analytics-service.ts:105` | Метры свай в аналитике считаются в SQL как `COALESCE(pg."lengthMm",0)::float/1000`, тогда как правило «единственный источник длины — `pileLengthMeters`» (`pile-length.ts:11-12`) требует вызова хелпера. | Логика эквивалентна для положительных значений, но это второе место расчёта м.п.; при будущем правиле (например округление/невалидные значения) числа аналитики и карточки разойдутся, как это уже было с парсингом имени марки. | Оставить в SQL как есть или вынести длину в общий SQL-вид/функцию; главное — не порождать третье правило. |
6 | мелочь | `src/modules/equipment/application/commands/fuel-log.ts:40-41,97` vs `src/app/api/equipment/[id]/fuel/route.ts:34` | Несогласованное округление литров: команда усекает `litersAdded` через `Math.trunc`, а схема API требует целое (`z.coerce.number().int()`), т.е. `200.5` из формы (`fuel-panel.tsx:112` шлёт `Number(liters)`) отклонится с 400 «Некорректные данные». | Пользователь, вписавший дробный литраж, получит непонятную ошибку вместо сохранения; а если значение дойдёт до команды минуя API — оно молча усечётся (200.5→200). | Единое правило: либо разрешить дробь (Float) везде, либо явно отклонять/округлёно приводить в одном месте и показать понятное сообщение. |
7 | мелочь | `src/modules/equipment/application/commands/fuel-log.ts:79` (тест `fuel-log.test.ts:44-53`) | `consumedLiters` может быть отрицательным (долив больше изменения уровня), `fuel-panel.tsx:158` покажет «−20 л» без пояснения. | Отрицательный «расход» — признак осчётчика/неучтённой заправки; как цифра расхода он бессмысленен и вводит в заблуждение. | Для отрицательного значения показывать прочерк + пометку «проверьте замеры» (как уже делается для `null` при отсутствии бака/замеров). |
8 | мелочь | `src/services/analytics/equipment-analytics-service.ts:188,208` | Двойное округление топлива: сначала `round1` на машину (`:188`), затем снова `round1` суммы этих уже округлённых значений (`:208`). | Погрешность ≤0.05 л на машину, при 20 машинах — до ~1 л расхождения суммы с суммой неокруглённых значений. Копеечно сейчас, но правило округления «сумма из источника, округление на выводе» соблюдается не везде. | Округлять один раз — на самом внешнем слое (fleet), из сырых значений. |
9 | мелочь | `src/modules/operator-mobile/domain/checklist-catalog.ts:98,104,130` | У мер `engineOilL/coolantL/hydraulicOilL` нет `min/max`, поэтому серверная проверка границ (`checklist-run.ts:61-77`) для них пропускается. | Опечатка «1000 л масла» пройдёт валидацию (у `fuelPercent` границы есть — `checklist-catalog.ts:530`). Данные всё равно нигде не читаются (см. №3), но при их выводе появятся абсурдные значения. | Добавить разумные `max` для доливов (или общий предел на литровые меры). |
10 | мелочь | `src/modules/inspections/domain/consumables.ts:26-27,36-39` | `qty` — свободный текст со смешанными единицами («8 л», «2 шт», «1 компл.», «баллон», «0,004–0,02 л/точку»); суммирование/сравнение объёмов заказа невозможно. | По замыслу это справочник для заказа (`getConsumables`, применяется в `start-inspection-form.tsx:139-146` как текст), а не учёт. Итог по расходникам нельзя посчитать. | Оставить по назначению; если когда-нибудь понадобится итог заказа — ввести числовое поле объёма+единицу, не парсить строку. |
11 | мелочь | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:46` vs `src/app/api/telemetry/ingest/route.ts:236-257` | Плитка «Расход топлива» описана для `type='fuel_rate'` (`PARAM_SPECS`), но `fuel_rate` отсутствует в списке допустимых типов приёма телеметрии. | Бокс, приславший `fuel_rate`, получит отказ «Неизвестный тип» (`route.ts:259-260`); плитка «Расход топлива» останется пустой при любых данных. Пока телеметрия спящая — латентно. | Согласовать whitelist типов приёма и `PARAM_SPECS` (добавить `fuel_rate` или убрать плитку). |
12 | мелочь | `src/services/analytics/equipment-analytics-service.ts:166` | Расход топлива по счётчику = `max − min`, при этом значение попадает в карту только при `used > 0`; сброс/переполнение счётчика (новый бокс, обнуление) даст отрицательное или аномально большое `used`. | При замене бокса `min` нового счётчика мал → «расход» скакнёт (или, наоборот, отрицательный отбросится) без индикации. ГИПОТЕЗА, проявится только с железом. | Учесть сброс счётчика (по `metadata`/`equipmentId` + разрыву серии), иначе отчёт по топливу исказится. |
13 | мелочь | `src/modules/operator-mobile/application/commands/shift-close.ts:157-160` | Остаток топлива на закрытии смены округляется до целого (`Math.round`) и пишется в `Report.endingFuelPercent`; отдельного допуска/дробей нет. | Согласовано с Int-полем (`schema.prisma:1956`) и границами 0–100% в чек-листе. По сути ПРОЙДЕНО: единица — %, границы проверяются (`checklist-run.ts:61-77`). Отмечено для полноты таблицы единиц. | — |
14 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:366` | В экспорт отчётов идёт `Report.endingFuelPercent` («Остаток топлива, %»), т.е. третья топливная величина, не связанная ни с `FuelLog`, ни с телеметрией. | В одном файле соседствуют «Простой, ч», «Остаток топлива, %» из отчёта и (в аналитике) «Топливо, л» из телеметрии — читателю негде увидеть, что это разные факты. | При выгрузке/аналитике указывать источник топливного показателя; по возможности свести к одному источнику (см. №1). |

## ПРОЙДЕНО (что проверено и расхождений не найдено)

- Суммирование топлива по `FuelLog` (долив) — только `equipment-query.service.ts:288`; в остальных
  местах аналитики `FuelLog` не читается (поиск по `fuelLog|FuelLog` — вызовы только в модуле
  equipment и роутах fuel). Значит «двойного учёта долива» нет — топливные числа различаются по источнику, а не по ошибке сложения. ПРОЙДЕНО.
- `Report.endingFuelPercent` НЕ суммируется нигде (точечный %, сумма была бы бессмысленна): используется
  точечно в `mobile-shift-query.ts:344` (последнее non-null) и построчно в экспорте. ПРОЙДЕНО.
- Границы меры топлива: `fuelPercent` ограничен 0–100 (`checklist-catalog.ts:530`, проверка на сервере
  `checklist-run.ts:61-77`), на закрытии округляется. ПРОЙДЕНО.
- `consumables[].qty` не парсится и не суммируется (текст для заказа). ПРОЙДЕНО (by design).
- Метры свай: и аналитика (`equipment-analytics-service.ts:105`), и карточка ТС
  (`equipment-query.service.ts:151` через `pileLengthMeters`) используют `lengthMm/1000` — численно эквивалентны. ПРОЙДЕНО по значению (дублирование — №5).

## Не проверено

- Не запускались проверки §6 AGENTS.md (`tsc`, `lint`, `test:unit`, `playwright --list`, `build`) — задача
  read-only, изменения кода не вносятся; заявлять их результат было бы нечестно.
- Телеметрия `fuel_total/fuel_level/fuel_rate`: реальные единицы и поведение счётчика зависят от прошивки
  бокса (Teltonika/Galileosky), которого в проекте ещё нет. Находки №2, №4, №11, №12 — ГИПОТЕЗА до подключения железа; в рантайме не воспроизводились (нет устройства, нет телеметрии в БД).
- Есть ли в базе (`orion`) записи с дробными/аномальными значениями и реально ли расходятся числа
  «расход из FuelLog» и «расход из телеметрии» на данных — НЕ ПРОВЕРЕНО (не подключался к БД, доступ к
  продакшену запрещён AGENTS.md §1).
- Замороженные зоны (`operator*`, `operator-mobile/**`, ORION) не аудировались по существу; упоминания
  `operator-mobile` в отчёте — только точки записи/чтения топлива, нужные для сквозной трассировки.
- Отчёт не читал существующие материалы `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` (запрет задачи).
