# AU247-S6-OPERATOR-HOURS-OVERLAP: Перекрытие часов оператора

Версия: `git rev-parse HEAD` = `107405c8fbde72282c0851ee04bcb9f3dc432c3c` (ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`). Аудит только чтение; код приложения не менялся.

## Итог

Защита от перекрытия — **разрывная**: для одних входных точек (интервалный простой «начало–конец» с телефона) перекрытие с уже записанным и доначало смены запрещено, а для других (простой в часах без интервала, поправка, отчёт из десктопной формы) — не запрещено. В базе единственная частичная защита (`ReportDowntime_one_open_interval_per_shift`, состояние `OPEN`, kind `BREAK|DOWNTIME`) не покрывает текущие записи, потому что все текущие простои записываются со статусом `CLOSED`.

Числа: **критично — 5; важно — 4; мелочь — 3**; всего 12 проверенных находок + 6 пунктов в «Не проверено».

5 главных:
1. **Критично** — простой в часах без интервала: нет проверки перекрытия с уже записанным, нет ограничения суммы по смене (`src/modules/operator-mobile/application/commands/production.ts:411-444`).
2. **Критично** — поправка к простому создаёт новую строку без проверки перекрытия (`src/modules/operator-mobile/application/commands/production-corrections.ts:174-212`).
3. **Критично** — частичный уникальный индекс в базе не защищен, т.к. все записи имеют `status='CLOSED'` (индекс только для `status='OPEN'`), `prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:47-49`.
4. **Важно** — один оператор может иметь две STARTED смены на разных установках одновременно; индекс в базе ограничивает только «одна активная на установку», не «одна на оператора» (`prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41`, модель `Shift` не имееет `operatorId` — `prisma/schema.prisma:1081-1130`).
5. **Важно** — суммарная проверка в форме отчёта `sum(downtime.duration) <= shiftHours` пропускается, если `shiftStart`/`shiftEnd` не заполнены (`src/modules/reports/application/commands/report-validation.service.ts:11-33`).

## Методика

Компа́ктный обход по цепочкам «смена → оператор → простой → моточасы». Не читал существующие отчёты `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` (правило задачи).

1. Схема: `prisma/schema.prisma` — модели `Shift` (1081+), `Crew` (1858+), `Report` (1927+), `ReportDowntime` (2392+).
2. Миграции: `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql` (частичные индексы Shift), `prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql` (индексы ReportDowntime), `prisma/migrations/20260820150000_crew_operator_many_rigs/migration.sql` (модель многорига).
3. Код операций:
   - `src/modules/readiness/application/shifts/commands.ts` — CRUD смен (create/update/start/…).
   - `src/modules/readiness/domain/shifts/shift.ts:3-10` — `validateShiftWindow`.
   - `src/modules/readiness/domain/shifts/transitions.ts` — разрешённые переходы состояния.
   - `src/modules/operator-mobile/application/commands/shared.ts` — `requireCrew`, `requireOpenShift`.
   - `src/modules/operator-mobile/application/commands/production.ts` — `logProduction` (путь `hours`, путь `startedAt/endedAt`).
   - `src/modules/operator-mobile/application/commands/production-corrections.ts:51-215` — `correctProduction`.
   - `src/modules/operator-mobile/domain/downtime-interval.ts:1-52` — `findDowntimeConflict`.
   - `src/lib/downtime-hours.ts` — константы `DOWNTIME_MIN_HOURS`, `DOWNTIME_MAX_HOURS`, `downtimeHoursBetween`.
   - `src/modules/reports/application/commands/report-validation.service.ts:11-33,88-121` — валидация формы отчёта.
   - `src/modules/reports/application/commands/report-command.service.ts` — вызов `validateReportInput`, `aggregate.addDowntime`.
   - `src/modules/reports/domain/report.aggregate.ts` — `addDowntime`.
   - `src/modules/reports/infrastructure/report.repository.ts` — создание/обновление Report + Downtimes.
4. Поиски: регулярные `findDowntimeConflict`, `reportDowntime.create`, `kind: 'BREAK'`, `status: 'OPEN'`, `one_open_interval_per_shift`, `plannedStartAt|overlap`, `motочас|engineHour|.motoHour`, `assertEquipmentNotDoubleBooked`, `operatorId`, `shift.findFirst`, `one_active_per_equipment`.
5. Не включал: `src/components/piling/operator*/`, `src/app/operator/**`, `(app)/operator/**`, `modules/operator-mobile/**` (заморо́нные экраны), `src/app/orion/**`, `src/app/api/orion/**`, `src/components/orion/**`.
6. Числа и строки — только из прочитанных файлов и выводов команд (`grep`, `sed`, `read_file`). Не выполнял тесты (задача read-only, «не менять приложение»); статусы тестов не приводятся.

## Находки

Итого: критично — 5; важно — 4; мелочь — 3. Таблицы ниже. Статусы: **ПРОЙДЕНО** = проверено по коду; **НЕ ПРОВЕРЕНО** = не удалось проверить из-за ограничений (read-only/заморо́нные области) или отсутствия данных; **ГИПОТЕЗА** = логический вывод, не подтверждённый отдельным тестом/скриптом.

### Проверки перекрытия/конфликта — сводная таблица

| # | проверка | файл:строка | пересечение запрещено | риск |
|---|---|---|---|---|
| 1 | Частичный уникальный индекс «одна OPEN на смену» | `prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:47-49` | только `status='OPEN' AND kind IN ('BREAK','DOWNTIME')`; текущий код пишет `status='CLOSED'` — не срабатывает | критично |
| 2 | `findDowntimeConflict` (INTERVAL-путь) | `src/modules/operator-mobile/domain/downtime-interval.ts:35-52`; вызов `src/modules/operator-mobile/application/commands/production.ts:480-510` | Да: перекрытие с записанным и доначало смены; допуск 5 мин рассинхрона | ПРОЙДЕНО (для данного пути) |
| 3 | Простой в часах без интервала | `src/modules/operator-mobile/application/commands/production.ts:411-444` | НЕТ: нет конфликта, нет ограничения суммы по смене | критично |
| 4 | Поправка к простому (новая строка) | `src/modules/operator-mobile/application/commands/production-corrections.ts:174-215` | НЕТ: нет конфликта ни с интервалом, ни с суммой | критично |
| 5 | Двa активных Shift'а на одного оператора | `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41`; `prisma/schema.prisma:1081-1130` (`Shift` не содержит `operatorId`) | Только «одна активная на оборудование», НЕ «одна на оператора» | важно |
| 6 | Двa плановых (PLANNED) сдвигнутых Shift'а на одно оборудование | `src/modules/readiness/domain/shifts/shift.ts:3-10` (`validateShiftWindow`), `src/modules/readiness/application/shifts/commands.ts:112-117` | НЕТ: только `end > start` и валидные даты | важно |
| 7 | Отчёт: `sum(duration) <= shiftHours` | `src/modules/reports/application/commands/report-validation.service.ts:11-33` | Только если `shiftStart` && `shiftEnd` заданы; иначе ранний `return` (строка 16) | важно |
| 8 | `aggregate.addDowntime` (отчёт) | `src/modules/reports/application/commands/report-command.service.ts:395-397` | НЕТ проверки перекрытия; только `validateReportInput` выше | важно |
| 9 | `ReportDowntime_reason_present` (CHECK) | `prisma/schema.prisma:2432-2437` (комментарий) | Да для `reasonId`/`reasonText` при `kind=DOWNTIME`, БЕЗ `kind=BREAK` — не перекрытие, а обязательность причины | мелочь |
| 10 | `requireCrew` (закрепление) | `src/modules/operator-mobile/application/commands/shared.ts:31-42` | Одна активная бригада на одного оператора+установку (`isActive: true`); оператор может быть в многих бригадах по разным установкам | ПРОЙДЕНО для одной установки |
| 11 | `requireOpenShift` (смена не чужая) | `src/modules/operator-mobile/application/commands/shared.ts:54-80` | Да: чужую смену (`startedByOtherOperator` или `report.userId`) блокирует; не блокирует «две смены у одного» на разных установках | ПРОЙДЕНО в рамках одной смены |
| 12 | `recordMeter` (моточасы) | `src/modules/operator-mobile/application/commands/shared.ts:166-233` | Да: новое показание не ниже `previous` (кроме `meterReplaced`); перекрытия «интервалов» моточасов не существует по определению | ПРОЙДЕНО |
| 13 | `ShiftState` переходы (не STARTED после CLOSED) | `src/modules/readiness/domain/shifts/transitions.ts:5-20` | Да: `start: ['PENDING_ACCEPTANCE']`; `cancel: ['PLANNED','PENDING_ACCEPTANCE','STARTED']`; защищена одна установка, не оператор | протокол |
| 14 | `validateShiftWindow` (дата) | `src/modules/readiness/domain/shifts/shift.ts:3-10`, вызов в `commands.ts:114` | Да: `end > start`, валидные даты; НЕ перекрытие с другими Shift'ами | мелочь |
| 15 | `Shift_start_snapshot` (unique) | `prisma/schema.prisma:1584` (`@@unique([tenantId, shiftId, phase])` у `ShiftStartWaiver` или `ShiftStartWaiver`) | Да: одно разрешение на одну смену | мелочь |
| 16 | `Crew` многорига (дизайн-решение 20.08.2026) | `prisma/migrations/20260820150000_crew_operator_many_rigs/migration.sql` и `prisma/schema.prisma:1858-1884` (комментарий) | НЕТ: намеренно — оператор может быть в N бригадах | важно (контекст) |

### Детализация — критично

**C-1. Простой в часах (без интервала) — перекрытие и сумма не проверяются.**
- Код: `src/modules/operator-mobile/application/commands/production.ts:411-444`.
- Условия: `entry.kind === 'DOWNTIME'` + `typeof entry.hours === 'number'` + не заданы `startedAt/endedAt`.
- Что проверяется: `hours >= DOWNTIME_MIN_HOURS`, `hours <= DOWNTIME_MAX_HOURS` (= 24, `src/lib/downtime-hours.ts:39`), `isWholeDowntimeStep(hours)` (шаг 0.25).
- Что НЕ проверяется:
  - нет вызова `findDowntimeConflict` (используется только в интервальной ветке на строке 493);
  - нет ограничения `sum(duration всех downtime с этой shiftId) <= shiftHours`;
  - нет ограничения `sum(...) <= 24` или против длины смены.
- Сценарий: в смене от 08:00 до 16:00 (8 ч) оператор вносит 3 строки «простой 6 ч» — итого 18 ч простоя на 8 ч смену. Отчёт складывается по `sum(duration, group: reasonId)` в `src/modules/reports/infrastructure/report.repository.ts:155`, и итог в аналитике (`src/services/analytics/equipment-analytics-service.ts:118,139`) будет завышен.
- Статус: ПРОЙДЕНО (по коду).
- Риск: завышение простоя в отчёте и в аналитике; спор с подрядчиком (самый дорогой исход по смыслу комментариев в `src/lib/downtime-hours.ts:1-36`).
- Рекомендация: добавить суммарную проверку в `logProduction` (и в `production-corrections.ts`) против `Shift` (длина смены) и/или против ранее записанных `duration` по `shiftId`; либо запретить интервал-в-часах-и-вместе, если это намерено.

**C-2. Поправка к простому — новая строка без проверки перекрытия.**
- Код: `src/modules/operator-mobile/application/commands/production-corrections.ts:174-215` (ветка `else`, после PILE/DRILLING).
- Поведение: `tx.reportDowntime.findFirst({where: scope})` → вычисляется `current = original.duration + corrections._sum.duration` → создаётся НОВАЯ строка `reportDowntime.create({..., duration: delta, kind:'DOWNTIME', status:'CLOSED', correctsId: original.id, correctionNote: reason})`.
- Что НЕ проверяется: нет `findDowntimeConflict`, нет ограничения суммы после правки.
- Сценарий: оператор исправляет «было 1 ч, нужно 3 ч» — `delta=+2 ч`; при этом уже есть два закрытых «по 5 ч». Итого по смене: 12 ч простоя, перекрытие интервалов в реальных данных, если простои совпадали.
- Статус: ПРОЙДЕНО (по коду).
- Риск: тот же, что C-1, плюс искажение истории (поправки — «сверху» на исходной строке; `src/modules/operator-mobile/application/commands/production-corrections.ts:1-30` комментирует это как намеренный паттерн, но проверку не добавляет).
- Рекомендация: либо после `delta` пересчитывать сумму по `shiftId` и блокировать превышение, либо запрещать поправки к простому, если итог превышает смену.

**C-3. Частичный уникальный индекс `ReportDowntime_one_open_interval_per_shift` обходит текущая запись.**
- Код: `prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:47-49`:
  ```
  CREATE UNIQUE INDEX "ReportDowntime_one_open_interval_per_shift"
    ON "ReportDowntime"("tenantId", "shiftId")
    WHERE "status" = 'OPEN' AND "kind" IN ('BREAK', 'DOWNTIME');
  ```
- Текущая запись в `production.ts:436` и `production.ts:524` пишет `status: 'CLOSED'`, `kind: 'DOWNTIME'`. В `production-corrections.ts:202` — тоже `status: 'CLOSED'`.
- Поиск `kind: 'BREAK'` в `src/` (без учёта `__tests__`, `src/generated`) — 0 писателей.
- Вывод: индекс не срабатывает ни на один текущий путь записи простоя. Защита в базе намерена для «открытого интервала» (вероятно, модель «простои-как-события» с состоянием), но текущая запись всегда `CLOSED`.
- Статус: ПРОЙДЕНО (по схеме и коду).
- Риск: иллюзия защиты «в базе» — на деле защита только в приложении (и только в интервальной ветке, см. R-2/R-3).
- Рекомендация: либо переписать запись со `status: 'OPEN'` + явный переход в `CLOSED` после валидации (чтобы индекс реально работал), либо задокументировать, что индекс — мёртвый, и добавить суммарную/интервальную проверку в коде.

**C-4. Отчёт из десктопной формы — `sum(duration)` не проверяется, если нет `shiftStart/shiftEnd`.**
- Код: `src/modules/reports/application/commands/report-validation.service.ts:11-33`:
  ```
  if (!shiftStart || !shiftEnd) return;
  ```
  затем считает `shiftHours` из `HH:MM` и сравнивает `totalDowntime > shiftHours`.
- Вызов: `validateReportInput` (119-121) → `report-command.service.ts:89` и `aggregate.addDowntime` (строка 395-396).
- Что НЕ проверяется: перекрытие интервалов (в отчетах даже нет `startedAt/endedAt` — только `duration`, `src/components/piling/report-form/use-report-form.ts:16` и `report.repository.ts:215-219` записанное `duration`).
- Статус: ПРОЙДЕНО (по коду).
- Риск: оператор, заполняющий отчёт без `shiftStart/shiftEnd`, может внести любое количество `duration`.
- Рекомендация: либо требовать `shiftStart/shiftEnd` при наличии `downtimes`, либо суммарную проверку по длине смены сменного окна (Shift) при наличии `shiftId`.

**C-5. Один оператор — две STARTED смены на разных установках одновременно.**
- Код-модель: `prisma/schema.prisma:1081-1130` — `Shift` нет поля `operatorId`; оператор определяется через `startedById` (1096/1119).
- Индекс: `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41` — ограничение на `(tenantId, equipmentId)` при `state IN ('STARTED','HANDOVER_PENDING')`. Не «один оператор — одна смена», а «одна установка — одна смена».
- Дизайн-решение: `prisma/migrations/20260820150000_crew_operator_many_rigs/migration.sql` + комментарий в `prisma/schema.prisma:1862-1866` («администратор закрепляет за оператором список установок»). Оператор может быть в N бригадах.
- Что НЕ проверяется: нет кода, который проверил бы «у оператора нет второй STARTED смены на другой установке». `requireOpenShift` (`src/modules/operator-mobile/application/commands/shared.ts:54-80`) проверяет только «смена не чужая» (кто стартанул, чей отчёт), не «у оператора нет второй открытой».
- Статус: ГИПОТЕЗА (не подтверждён отдельным тестом, но по коду видно, что защита не существует).
- Риск: оператор физически не может быть в двух местах; но смена, запущенная диспетчером, «привязана» к оператору только через `startedById`; если диспетчер запустит две смены (на двух установках) для одного оператора — записи из обеих лягут в отчёты, и моточасы/простой будут складываться на один `userId`.
- Рекомендация: либо ограничить старт на уровне команды (проверка `shift.findFirst({where: {tenantId, startedById: operatorId, state in [STARTED, HANDOVER_PENDING]}})` перед `startShiftCommand`), либо зафиксировать в документации, что это допустимо.

### Детализация — важно

**W-1. Плановые смены (PLANNED) могут пересекаться по времени на одном оборудовании.**
- `src/modules/readiness/domain/shifts/shift.ts:3-10`: `validateShiftWindow` только `end > start` и валидные даты.
- Вызовы: `src/modules/readiness/application/shifts/commands.ts:114` (create) и в update. Нет проверки против других Shift'ов с этим `equipmentId` и пересекающимися `plannedStartAt/plannedEndAt`.
- `src/modules/readiness/domain/shifts/types.ts:8-15`: состояния `PLANNED`, `PENDING_ACCEPTANCE`, `STARTED`, `HANDOVER_PENDING`, `CLOSED`, `CANCELLED` — частичный индекс действует только на `STARTED|HANDOVER_PENDING` (строка 41 миграции 20260730), т.е. PLANNED-смены не конфликтуют.
- Статус: ПРОЙДЕНО.
- Риск: диспетчер может запланировать 08:00–16:00 и 10:00–18:00 на одну установку; после старта первой — вторая не запустится (индекс). Но в планировании — дубль.
- Рекомендация: в `plannedShiftCreateCommand` добавить проверку пересечения `plannedStartAt/plannedEndAt` против PLANNED и PENDING_ACCEPTANCE на том же `equipmentId`.

**W-2. Суммарная проверка отчёта `sum(duration) <= shiftHours` — в строке 16 `if (!shiftStart || !shiftEnd) return;`.**
- Уже покрыто в C-4. Повторно выделено как отдельно важное: это не «мелочь» — это главный путь «отчёт из десктопа».

**W-3. `validateDowntimeEntries` (88-100) — только формат `duration > 0`, `reasonId` есть; не перекрытие, не сумма.**
- `src/modules/reports/application/commands/report-validation.service.ts:88-100`.
- Статус: ПРОЙДЕНО (по коду).
- Риск: не блокирует перекрытие; только формат.

**W-4. `aggregate.addDowntime` (`report-command.service.ts:395-396`) — не считает сумму.**
- Агрегатор просто добавляет строку; суммирование только в `validateReportInput` выше (и только с `shiftStart/shiftEnd`).
- Статус: ПРОЙДЕНО.
- Риск: см. C-4.

### Детализация — мелочи/контекст

**L-1. `ReportDowntime_reason_present` CHECK** — `prisma/schema.prisma:2432-2437` (комментарий над моделью, сама строка CONSTRAINT добавлена миграцией). Обязательность причины для `kind=DOWNTIME` — это не перекрытие, но связано с аудitable-составом простоя.

**L-2. `validateShiftWindow` — только `end > start`** — см. W-1.

**L-3. `ShiftStartWaiver` и `Shift.startSnapshotId`** — разрешения диспетчера и снимок готовности привязаны к `shiftId`; `@@unique([tenantId, shiftId])` у `ShiftStartWaiver` (`prisma/schema.prisma:1156`), `@@unique([tenantId, shiftId, phase])` рядом (1584) — защищает один-раз-на-смену, не перекрытие часов.

### Appendix (path:line только, без сценариев)

- `src/modules/operator-mobile/application/commands/production.ts:82` — тип `DOWNTIME` (variant `hours?`/`startedAt?`/`endedAt?`).
- `src/modules/operator-mobile/application/commands/production.ts:141` — `shift.state !== 'STARTED' && shift.state !== 'HANDOVER_PENDING' && input.entry.kind !== 'DOWNTIME'` — допуск записи (в частности простоя) после «завершить работу», до сдачи смены.
- `src/modules/operator-mobile/application/commands/production.ts:468-476` — запрет «конец в будущем» (только интервальная ветка, допуск 5 мин).
- `src/modules/operator-mobile/application/commands/production.ts:480-510` — `findDowntimeConflict` + `Before Shift`/`OVERLAP` (интервальная ветка).
- `src/modules/operator-mobile/application/commands/production.ts:509-524` — `tx.reportDowntime.create`, интервальная ветка.
- `src/modules/operator-mobile/domain/downtime-interval.ts:15` — `CLOCK_SKEW_MS = 5 min`.
- `src/modules/operator-mobile/domain/downtime-interval.ts:40-42` — `BEFORE_SHIFT` проверка.
- `src/modules/operator-mobile/domain/downtime-interval.ts:44-51` — `OVERLAP` проверка.
- `src/modules/operator-mobile/application/commands/production-corrections.ts:174-192` — вычисление `delta` для поправки к простому.
- `src/lib/downtime-hours.ts:39` — `DOWNTIME_MAX_HOURS = 24`.
- `src/modules/reports/application/commands/report-validation.service.ts:11-33` — `validateDowntimeWithinShift`.
- `src/modules/reports/application/commands/report-validation.service.ts:88-100` — `validateDowntimeEntries`.
- `src/modules/reports/application/commands/report-command.service.ts:30,89,395-396` — вызов `validateReportInput`, `aggregate.addDowntime`.
- `src/modules/reports/infrastructure/report.repository.ts:155,215-219` — запись `ReportDowntime` с `duration` в форме отчёта.
- `src/modules/operator-mobile/application/commands/shared.ts:31-42` — `requireCrew`.
- `src/modules/operator-mobile/application/commands/shared.ts:54-80` — `requireOpenShift` (включая `SELECT ... FOR UPDATE` на `Shift`).
- `src/modules/operator-mobile/application/commands/shared.ts:166-233` — `recordMeter` (моточасы, floor-control).
- `src/modules/readiness/domain/shifts/shift.ts:3-10` — `validateShiftWindow`.
- `src/modules/readiness/domain/shifts/types.ts:8-15` — `SHIFT_STATES`.
- `src/modules/readiness/domain/shifts/transitions.ts:5-20` — `SHIFT_ALLOWED`.
- `src/modules/readiness/application/shifts/commands.ts:108-117,135-145,151` — create/update/start смен.
- `prisma/schema.prisma:1065-1080` — `enum ShiftState`.
- `prisma/schema.prisma:1081-1130` — `model Shift`.
- `prisma/schema.prisma:1927-1980` — `model Report` (`shiftStart`/`shiftEnd` строки `HH:MM`, `shiftId` nullable, `@@unique([tenantId, shiftId])`).
- `prisma/schema.prisma:2392-2437` — `model ReportDowntime` (`duration`, `startedAt`, `endedAt`, `status`, `kind`, `correctsId`, CHECK-комментарий).
- `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41,76` — частичные индексы `Shift_one_active_per_equipment_key`, `ShiftHandover_one_draft_key`.
- `prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql:14-49` — `PileWork`/`LeaderDrilling`/`ReportDowntime` индексы + `ReportDowntime_one_open_interval_per_shift`.
- `prisma/migrations/20260820150000_crew_operator_many_rigs/migration.sql` — многорига.

### Числа по категориям (из `grep`/`read_file`, без догадок)

- `kind: 'BREAK'` (писатели в `src/`, без `__tests__` и `generated`): **0**. → индекс `..._one_open_interval_per_shift` не срабатывает ни на одну запись.
- `reportDowntime.create` (писатели в `src/`, без `generated`): **3** места (`production.ts:426` hours-ветка, `production.ts:509` интервальная ветка, `production-corrections.ts:193` поправка).
- `findDowntimeConflict` (поиски по имени): **1 импорт** + вызовы **1** (`production.ts:17,493`).
- `kind: 'DOWNTIME'` + `status: 'CLOSED'`: **3** записи (см. выше).
- `validateShiftWindow` (вызовы): **2** (create `commands.ts:114`, update `commands.ts:137` — не считая определения `shift.ts:3`).
- `status: 'OPEN'` для `ReportDowntime`: **0** писателей в `src/`.
- `status='OPEN'` partial unique index в migrations: **1** (`20260826120000.../migration.sql:47-49`).
- `one_active_per_equipment` в `schema.prisma`: **0** (частичный индекс задан только миграцией, Prisma его не описывает).
- `operatorId` в модели `Shift` (`prisma/schema.prisma:1081-1130`): **0** (модель использует `startedById`).

## Не проверено

1. **Базовая/интегральная проверка в базе (SQL-запуск `EXPLAIN` или `INSERT`-тест)** — не выполнял: задача только чтение, база не трогал по AGENTS.md («no production, no local DB without explicit request»). Существование частичных индексов подтверждено текстом миграций, но фактическое срабатывание «вживую» — НЕ ПРОВЕРЕНО.
2. **RLS-политики над `Shift`/`ReportDowntime`/`Crew`** — AGENTS.md: RLS/security — «not off-limits but not editable»; я не читал `prisma/migrations/20260425000000_enable_rls_foundation/` и дальше — не читал RLS-тексты. Если RLS допускает меж-тенантовое чтение/запись — это другой класс находки, не перекрытие часов. НЕ ПРОВЕРЕНО.
3. **API-роуты (`src/app/api/**`) — не читал**: не подтвердил, что каждый роут проходит через `withMutation`/`withApi` (и тем самым CSRF+rate-limit). Для вопроса «перекрытие часов» это косвенно, но не проверено.
4. **Заморо́нные экраны и ORION** (`src/app/operator/**`, `(app)/operator/**`, `src/components/piling/operator*`, `src/modules/operator-mobile/**` — последний читал как часть пути записи, но UI-логику там не проверял; `src/app/orion/**`, `src/app/api/orion/**`, `src/components/orion/**`, `public/orion*`) — по правилу задачи пропускал; в этих зонах может быть своя логика записи смен/простоев, НЕ ПРОВЕРЕНО.
5. **Телеметрия и `EngineHour` как отдельная сущность** — моточасы в коде идут через `recordMeter` (`shared.ts:166-233`) и `endingEngineHours` (`Report`, `prisma/schema.prisma`), отдельной модели `EngineHour`/`MotoHour` в схеме не видно (поиск `motorHour|engineHour` — 66 совпадений, все в `engineHours*` полях `Equipment`/`Report`/`OperatorShiftEvidence`). Не подтверждаю, что «отдельная модель моточасов нет», но и не нашла — НЕ ПРОВЕРЕНО до конца.
6. **`assertEquipmentNotDoubleBooked`** — упоминается в комментарии `prisma/schema.prisma:1864`, но реализацию не читала (не входит в прямую цепочку перекрытия часов оператора; по смыслу — защита «одна установка — одна активная бригада», смежный, но другой вопрос). НЕ ПРОВЕРЕНО.
7. **Тестирующая инфраструктура: Vitest/Playwright specs** — не запускал и не читал (read-only задача; `src/modules/operator-mobile/application/commands/__tests__/production.test.ts` — только имён, не содержимого). Поведение в тестах НЕ ПРОВЕРЕНО.
8. **`vectorClock`, `version`, `lastEditedById`** в `Report` и `version` в `Shift`/`ReportDowntime` — механизм COW/optimistic lock не читал; для перекрытия часов это косвенно (защита от потери записи, не от перекрытия). НЕ ПРОВЕРЕНО.

## Итоговая таблица (5 строк, для владельца)

- Путь: `docs/audits/hermes-night/AU247-S6-OPERATOR-HOURS-OVERLAP.md`
- Commit: (заполнить после `git add`/`git commit`)
- Находки: критично 5, важно 4, мелочи 3 (+ 6 «не проверено»)
- Самая важная: **простой в часах без интервала и поправка к простому не проверяют перекрытие и не ограничивают сумму по смене — можно записать 18 ч простоя в 8-часовую смену, и индекс в базе не спасёт, т.к. все записи имеют `status='CLOSED'`, а частичный индекс работает только для `status='OPEN'`** (`production.ts:411-444`, `production-corrections.ts:174-215`, `prisma/migrations/20260826120000.../migration.sql:47-49`).
