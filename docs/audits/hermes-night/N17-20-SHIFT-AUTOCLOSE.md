# N17-20-SHIFT-AUTOCLOSE — Автозакрытие смен и «сдача старой смены»

Аудит только для чтения. Код приложения не менялся; создан и закоммичен только этот файл.

- Версия: `git rev-parse HEAD` = `655d23d3a9b2ce7d34afde5d1ef87a747f673824` (ветка `hermes/code-1011`).
- Рабочая папка: `D:/PillingR/wt-night-code` (папки `wt-night-code-code` не существует; работал в текущей, как предписано внешним заданием).
- Замороженные зоны (экраны оператора, сайт ORION) только читались; ни одна не менялась.
- Отчёты по той же теме (`AU59-S2-SHIFT-CLOSE-AUTOCLOSE.md`, `N17-11-REPORT-CONCURRENT-EDIT.md`) открыты **после** того, как выводы были сделаны по коду, — только для сверки. Все находки ниже заново подтверждены по файлам, указанным в колонке `путь:строка`.

## Итог

**Резюме для владельца (5 строк).**
1. Автозакрытие работает и границы верны: дневная смена закрывается с 00:00 МСК следующих суток, ночная — с 12:00, тик раз в час «догоняет» всё просроченное; повтор тика безопасен.
2. Но автозакрытый отчёт **неполный**: без времени смены, моточасов, топлива и без строки «Отправлен» в истории — диспетчер видит «—», разбор «кто и когда сдал» не закрыть.
3. Правило «простой не длиннее смены» (коммит `48e27110`) применяют **не все пути**: сдача из контура готовности, автозакрытие и поправка простоя его обходят.
4. Главный тупик: смена в `HANDOVER_PENDING` (после «Завершить работу») не закрывается ничем, не отменяется и не имеет передачи — установка заперта для всех, кроме того же машиниста.
5. Автозакрытие живёт **только** в контейнере `workers`; если он не задеплоен — не идёт молча, и вчерашние смены висят «в работе».

- Находок: **16** — критично **1**, важно **6**, мелочь **9**.
- **Топ-5:** (1) тупик `HANDOVER_PENDING`; (2) автозакрытый отчёт без полей и без `ReportAudit 'submitted'`; (3) сдача отчёта не увеличивает `Report.version` → форма админа перезаписывает сданный отчёт; (4) правило «простой ≤ смена» обходят три пути; (5) записи офлайн-очереди после автозакрытия навсегда теряются как `FAILED`.
- **Проверено и в порядке:** границы «+5 часов» (в т. ч. смена через полночь), идемпотентность повторного тика, изоляция организаций, аудит-след `shift.auto-closed`, блокировка строки против гонки «оператор ↔ автозакрытие», 409 для старой смены на «Получении установки».

## Методика

Что искал и как повторить:

```bash
git rev-parse HEAD                 # 655d23d3a9b2ce7d34afde5d1ef87a747f673824
git log --oneline -1 48e27110 e6482fcb 298f76aa 881bbf90
rg -n "runReadinessScheduler|AUTO_CLOSE|SHIFT_END_HOUR|UNFINISHED_SHIFT_STATES" src
rg -n "autoClosedAt|shift.auto-closed|autoClosed" src prisma
rg -n "close-shift|finish-work|submit-report|correct-production" src/app src/components/piling/operator-mobile
rg -n "requireDowntimeFitsShift|downtimeExceedsShift|shiftHoursFromClock|validateDowntimeWithinShift" src
rg -n "HANDOVER_PENDING|assertShiftTransition|SHIFT_ALLOWED" src/modules/readiness src/modules/operator-mobile
rg -n "kind: 'BREAK'|kind:'BREAK'|'BREAK'" src prisma
rg -n "classifyFailure|markAttempt|FAILED" src/components/piling/operator-mobile/offline-queue.ts
rg -n "startEmbeddedWorkers|READINESS_SCHEDULER_ENABLED" src
```

Прочитаны (полностью или в указанных пределах): `src/modules/readiness/application/scheduler.ts`,
`src/workers/unified-worker/readiness-scheduler.ts`, `src/workers/unified-worker.ts`, `src/workers/embedded-workers.ts`,
`src/instrumentation.ts`, `src/modules/readiness/domain/shifts/transitions.ts`,
`src/modules/readiness/application/shifts/commands.ts`, `src/modules/operator-mobile/application/commands/{shift-close,production,production-corrections,equipment,shared}.ts`,
`src/modules/operator-mobile/application/mobile-shift-query.ts`, `src/modules/reports/domain/report.aggregate.ts`,
`src/modules/reports/application/commands/{report-command.service,report-validation.service}.ts`,
`src/modules/reports/infrastructure/report.repository.ts`, `src/services/reports/{report-history-service,event-handlers}.ts`,
`src/lib/downtime-hours.ts`, `src/app/api/operator/mobile/command/route.ts`,
`src/components/piling/operator-mobile/offline-queue.ts`, `prisma/schema.prisma` (модели `Shift`, `ReportDowntime`),
`src/modules/readiness/application/__tests__/scheduler.test.ts`. Тесты/спеки читались для понимания замысла:
`e2e/qa-ac/operator-walk.spec.ts`.

Статусы: **ФАКТ** — проверено по коду/тесту, указанному рядом; **ГИПОТЕЗА** — по коду условия выполнимы, но
на реальных данных/прогоне не подтверждено; **НЕ ПРОВЕРЕНО** — см. одноимённый раздел.

## Ответы на вопросы задания (1–6)

**Вопрос 1. Условия автозакрытия и граница «+5 часов».**
Автозакрывается только смена в состоянии `STARTED` (`scheduler.ts:66`). Смена претендует на закрытие, если
сегодняшние производственные сутки смены **строго позже** суток после её `productionDate`, либо, если это
ровно `D+1`, час в **поясе смены** уже дошёл до порога (`scheduler.ts:100-113`, `isAutoCloseDue`).
Порог — конец смены плюс 5 часов, приведённый к суткам после `productionDate` (`scheduler.ts:77-98`,
`autoCloseHourNextDay`): дневная (конец 19:00) — `(19+5)%24 = 0` → с **00:00 МСК D+1**; ночная (конец 07:00) —
`(7+5)%24 = 12` → с **12:00 D+1**, потому что её 07:00 уже лежит в D+1. Пояс берётся из поля смены
`shift.timezone` (по умолчанию `Europe/Moscow`, `normalizeTenantTimezone` в `tenant-production-date.ts`).
Смена через полночь обрабатывается верно: тесты `scheduler.test.ts:234-248` (00:30 и 11:59 не закрывают, 12:00 закрывает)
и `:252-284` (день — 23:59 нет, 00:00 да). Тип из выборки обязателен (`select.type`, `scheduler.test.ts:256-258`);
`Shift.type` — non-null `ShiftType` (`prisma/schema.prisma:1091`), поэтому ветка «неизвестный тип → 12:00» мертва (см. находку 8).

**Вопрос 2. Что записывается в отчёт при автозакрытии.**
Сама смена: `state=CLOSED, closedAt, autoClosedAt, version+1` — `scheduler.ts:180-183`; `closedById` **не** проставляется.
Черновик отчёта, если он есть: `status='submitted', submittedAt=now` и **только это** (`scheduler.ts:224-228`) —
без `shiftStart/shiftEnd/closingComment/endingEngineHours/endingFuelPercent/lastEditedById`, без `Report.version+1`
и без строки `ReportAudit 'submitted'` (контраст — ручная сдача `shift-close.ts:214-257`).
Выработка и простой при этом не пересчитываются: в событие `ReportSubmitted` кладутся суммы строк отчёта,
прочитанных планировщиком (`totalPiles/totalDrilling/totalDowntime`, `scheduler.ts:230-250`) с `autoClosed:true`.
Автор: `closedById` пуст, в общем журнале действие идёт от системного актора
`{id:null, name:'Планировщик техготовности', role:'SYSTEM'}` (`scheduler.ts:39,195`), а событие автосдачи в
ленте имеет `actorId=null` и имя владельца в тексте (`event-handlers.ts:456-480`). Итог: «кто сдал» видно как
«система», но **в истории самого отчёта шага сдачи нет** (см. находку 2).

**Вопрос 3. Что будет, если оператор в этот момент вводит данные или отправляет очередь.**
`requireOpenShift` берёт блокировку строки смены `SELECT 1 FROM "Shift" … FOR UPDATE` (`shared.ts:60-63`),
а автозакрытие делает **условный** `updateMany` по `state IN ('STARTED')` (`scheduler.ts:180-183`). Поэтому
двойного закрытия нет: кто первый закоммитил — второй увидит уже `CLOSED` и не изменит строку. Если закрыл
планировщик, следующая команда оператора получает `409 «Смена уже закрыта»` (`shared.ts:73-75`). Для **офлайн-очереди**
это плохо: `classifyFailure(409)` = `permanent` (`offline-queue.ts:139-144`), запись помечается `FAILED`
(`offline-queue.ts:466-471`) и в отчёт уже не попадёт (находка 5). Плюс: сдача отчёта не двигает `Report.version`
(`shift-close.ts:214`, `scheduler.ts:225`), поэтому форма администратора, открытая до сдачи, после неё сохранится
и перезапишет отчёт (находка 3).

**Вопрос 4. Повторный запуск тика, пропущенные тики, остановка воркера на сутки.**
Тик — раз в час, стартовая задержка 90 с (`readiness-scheduler.ts:21-22`); в процессе стоит `passRunning`
(`readiness-scheduler.ts:24-28,27`), обход — по каждой организации через `forEachTenant`. Повторный прогон
идемпотентен: наряды — CAS по версии (`scheduler.ts:139-145`), смены — условный `updateMany` (`scheduler.ts:180-183`),
тест `scheduler.test.ts:318-321` проверяет, что берутся только `STARTED`. Пропущенные тики «догоняются»:
при `today > nextDay` проверка часа пропускается и все просроченные смены закрываются на ближайшем прогоне
(`scheduler.ts:108`). Остановка воркера на сутки (и больше) тоже догоняется. Но есть два нюанса: (а) планировщик
поднимается **только** в контейнере `unified-worker` (`unified-worker.ts:187-189`), встроенные воркеры приложения
(`embedded-workers.ts:295-323`) его не запускают — если контейнер `workers` не задеплоен, автозакрытие не идёт
молча (находка 6); (б) путь «черновики → события» не полностью идемпотентен при двух наложившихся прогонах
(находка 7).

**Вопрос 5. Сдача смены прошлых суток: допустимые состояния, ошибки, 409.**
«Получение установки» (`acceptEquipment`) ищет активную смену в `STARTED`/`HANDOVER_PENDING` и, если её
`productionDate` отличается от сегодняшней, отдаёт `409 «По этой установке не закрыта смена за <дата>. Сдайте её, прежде чем открывать новую.»`
(`equipment.ts:41-61`). Это и есть лечение `D-20260930-001` (коммиты `e6482fcb`, `298f76aa`, `881bbf90`).
Закрыть старую смену можно в состоянии `STARTED` или `HANDOVER_PENDING` — `requireOpenShift` отказывает только
для `CLOSED`/`CANCELLED` (`shared.ts:73-75`), а `closeShift`/`submitReport` его вызывают (`shift-close.ts:92,281`).
Дополнительные `409`: новые записи в сданный отчёт (`production.ts:223-229`), поправка в сданный отчёт
(`production-corrections.ts:86-91`), сдача отчёта по ещё идущей смене из формы админа (`report-command.service.ts:203-208`),
отчёт «за другую дату/объект» (`report-command.service.ts:169-174`). Особый случай: если старую смену запустил
**другой** `OPERATOR`, то `acceptEquipment` до полезного 409 сначала получает 403 из `requireOpenShift`
(`equipment.ts:54` → `shared.ts:77-83`) — см. находку 12. Смена `HANDOVER_PENDING` старой даты не закрывается
планировщиком никогда (находка 1).

**Вопрос 6. «Простой не длиннее смены» — одно правило для закрытия и правки (коммит `48e27110`): все ли пути его применяют.**
Нет, не все. Правило реализовано в двух местах и применяется на трёх путях из шести:
`requireDowntimeFitsShift` — только в `closeShift` (`shift-close.ts:36-54,112-115`);
`report.aggregate.addDowntime` → `getShiftDurationHours` — при правке отчёта (`report.aggregate.ts:232-237,376-378`);
`validateDowntimeWithinShift` — при сохранении отчёта (`report-validation.service.ts:11-33` из `report-command.service.ts:89`)
и в мобильной записи простоя, но по **номинальному** окну 12 ч (`production.ts:232-245,442`).
**Не применяют:** сдача из контура готовности `submitReport` (`shift-close.ts:271-338`), автозакрытие
(`scheduler.ts:224-229`) и поправка простоя `correctProduction` (`production-corrections.ts:175-214`). Находка 4.

## Находки

| # | серьёзность | статус | путь:строка | проблема | сценарий отказа | исправление |
|---|---|---|---|---|---|---|
| 1 | критично | ФАКТ | `src/modules/readiness/application/scheduler.ts:66` + `:56-64`; `src/modules/readiness/domain/shifts/transitions.ts:11,13-14`; `src/modules/operator-mobile/application/commands/shift-close.ts:57-70`; `src/modules/operator-mobile/application/commands/shared.ts:77-83`; `src/modules/operator-mobile/application/commands/equipment.ts:46-61`; `src/modules/readiness/application/shifts/commands.ts:303-316` | Смена в `HANDOVER_PENDING` не берётся автозакрытием (`UNFINISHED_SHIFT_STATES=['STARTED']`), не отменяется (`cancel` разрешён только из `PLANNED/PENDING_ACCEPTANCE/STARTED`), а `accept` требует передачу `SUBMITTED`, которой мобильный `finishWork` не создаёт (он только меняет состояние смены). | Оператор нажал «Завершить работу», но не вернулся/его перезакрепили. Смену не закроет никто: другой машинист на `acceptEquipment` получает 403 «Эту смену ведёт другой машинист» (`shared.ts:81-83`), а частичный уникальный индекс держит установку за этой сменой (`equipment.ts:41-45`) — машина заперта навсегда. Сценарий зафиксирован в e2e как дефект: `e2e/qa-ac/operator-walk.spec.ts:339,540` (`test.fail`, D-20260930-001). | Дать путь закрытия/отмены для `HANDOVER_PENDING` без живого оператора (диспетчерское закрытие с причиной) либо автозакрывать такие смены только при отсутствии живой передачи, не ломая приёмку. |
| 2 | важно | ФАКТ | `src/modules/readiness/application/scheduler.ts:224-229` против `src/modules/operator-mobile/application/commands/shift-close.ts:214-257`; `src/services/reports/report-history-service.ts:50-51,66-74` | Автозакрытый отчёт получает `status/submittedAt`, но не `shiftStart/shiftEnd/closingComment/endingEngineHours/endingFuelPercent/lastEditedById` и не строку `ReportAudit action='submitted'`; `Report.version` тоже не растёт. | В журнале диспетчера у автозакрытой смены пустое время, моточасы и топливо («—»); в истории отчёта нет шага «Отправлен» — нельзя отличить ручную сдачу от автозакрытия и восстановить, когда и кем отчёт сдан. Это регресс уже исправленного `F-R34-4` на автопути. | Пропускать автозакрытые черновики через тот же `submitShiftReport` (или дозаполнять поля и писать `ReportAudit 'submitted'` с пометкой `autoClosed`) в той же транзакции. |
| 3 | важно | ФАКТ | `src/modules/operator-mobile/application/commands/shift-close.ts:214-226`; `src/modules/readiness/application/scheduler.ts:225-228`; контраст — `src/modules/reports/infrastructure/report.repository.ts:138-154` | Сдача отчёта (`draft → submitted`) **не увеличивает `Report.version`** ни при ручном закрытии, ни при автозакрытии, тогда как правка отчёта версией управляет через CAS. | Форма администратора, открытая до сдачи смены, после неё проходит проверку `expectedVersion` (версия не изменилась) и сохраняется поверх сданного отчёта: guard «смена ещё идёт» не срабатывает, смена уже `CLOSED` (`report-command.service.ts:203-208`). Итог — сданный отчёт тихо перезаписан. | Добавить `version: {increment: 1}` в оба `updateMany`, переводящих отчёт в `submitted`. |
| 4 | важно | ФАКТ | `src/modules/operator-mobile/application/commands/shift-close.ts:271-338`; `src/modules/readiness/application/scheduler.ts:224-229`; `src/modules/operator-mobile/application/commands/production-corrections.ts:175-214`; реализовано только в `shift-close.ts:36-54,112-115` и `src/modules/reports/domain/report.aggregate.ts:232-237` | Правило «простой не длиннее смены» (коммит `48e27110`) применяется не везде: сдача из контура готовности (`submitReport`), автозакрытие и поправка простоя (`correctProduction` → `DOWNTIME`) его не применяют. | Машинист записывает/поправляет простой больше фактической смены и сдаёт отчёт через контур готовности или дожидается автозакрытия. Отчёт уходит с простоем > смены, а администратор потом не может его сохранить — правило отклоняет отчёт целиком (тот самый дефект «аудит 11–13.10.2026, п.5», ради которого правило и вводили). | Вынести проверку в один общий шаг и вызывать её в `submitReport`, на пути автозакрытия и в поправке `DOWNTIME` (с учётом того, что для смены ≥ суток проверка осознанно пропускается). |
| 5 | важно | ФАКТ | `src/components/piling/operator-mobile/offline-queue.ts:139-144,466-471`; `src/modules/operator-mobile/application/commands/shared.ts:73-75`; `src/modules/readiness/application/scheduler.ts:180-183` | Записи выработки/простоя, ещё лежащие в очереди телефона, после автозакрытия смены отвергаются `409 «Смена уже закрыта»`, а `409` классифицируется как `permanent` → запись помечается `FAILED` и больше не отправляется. | У оператора пропала связь перед автозакрытием: смена на сервере закрыта, а `log-production`/`correct-production` на телефоне при первом сливе получают 409 и остаются `FAILED` — работа за смену в отчёт не входит. Мастер может внести её позже, но автоматически она теряется. | Либо не считать 409 «смена закрыта» постоянным отказом и буферизовать запись в отчёт производственных суток, либо явно предупреждать машиниста, что после закрытия запись уходит только через мастера. |
| 6 | важно | ФАКТ | `src/workers/unified-worker.ts:187-189`; `src/workers/embedded-workers.ts:295-323`; `src/instrumentation.ts:63-64` | Планировщик техготовности (автозакрытие смен, истечение нарядов) поднимается **только** в контейнере `unified-worker`; встроенные воркеры приложения запускают лишь `outbox` и `projection`. | Если в проде развёрнут только Next.js-процесс (`app`) и контейнер `workers` не задеплоен или упал, автозакрытие не выполняется вовсе — вчерашние смены висят «в работе», истёкшие наряды числятся согласованными, и ошибки нет. | Задокументировать обязательность контейнера `workers` (ранбук) и добавить наблюдаемость «планировщик не поднимался» (проверка пульса на `/api/health/deep`). |
| 7 | важно | ГИПОТЕЗА | `src/modules/readiness/application/scheduler.ts:215-250` | Автозакрытие читает черновики (`report.findMany`), затем переводит их в `submitted` через `updateMany`, но **не проверяет `count`** результата, а события `ReportSubmitted` создаёт циклом по всему **прочитанному** списку; `dedupeKey` у событий нет. | При двух наложившихся прогонах планировщика (две реплики контейнера `workers` — выбора лидера нет) один прогон захватывает черновики, второй их `updateMany` не изменяет, но всё равно пишет по каждому `outboxEvent` → дубли «отчёт сдан» и дубли PDF в Telegram. В штатном режиме (одна реплика, `passRunning`) не воспроизводится. | Создавать события только по фактически захваченным строкам (сверить/перечитать по `status='submitted', submittedAt=now`) и делать их `createMany({skipDuplicates:true})` с `dedupeKey`. |
| 8 | мелочь | ФАКТ | `src/modules/readiness/application/scheduler.ts:85,94-98` против `prisma/schema.prisma:1091` | Ветка «смена неизвестного (пустого) типа → 12:00» недостижима: `Shift.type` — обязательное поле `ShiftType` (nullable нет). | Мёртвый код: `autoCloseHourNextDay(type: string \| null)` и `AUTO_CLOSE_UNKNOWN_TYPE_HOUR` никогда не срабатывают для `null`. Не ломает, но вводит в заблуждение при чтении. | Убрать ветку `null` либо оставить с явным комментарием «на случай расширения типа смен». |
| 9 | мелочь | ФАКТ | `src/lib/downtime-hours.ts:141-164` против `src/modules/reports/application/commands/report-validation.service.ts:11-33`; `src/modules/reports/domain/report.aggregate.ts:376-378` | Правило «простой ≤ смена» живёт в **трёх** реализациях: общий `lib/downtime-hours.ts`, дубль в `report-validation.service.ts` и метод агрегата. Арифметика пока совпадает, но владельцев трое. | Комментарий `lib/downtime-hours.ts:134` («одно правило на два пути») уже неверен; следующая правка в одном месте разойдёт закрытие и правку — ровно то, что чинили коммитом `48e27110`. | Оставить одну функцию сравнения и вызывать её из всех трёх мест. |
| 10 | мелочь | ФАКТ | `src/modules/operator-mobile/application/commands/production.ts:232-245` | При незакрытой смене `checkDowntimeTotal` берёт окно из `SHIFT_WINDOW[shift.type]` (12 ч), а не из фактических `shiftStart/shiftEnd`. | До закрытия смены правило проверяется по номинальной смене 12 ч; фактическая (поздний старт) может быть короче — расхождение с проверкой при закрытии. Источник находки 4 для мобильного пути. | Проверять по фактическому `startedAt→now`, как это делает `requireDowntimeFitsShift` при закрытии. |
| 11 | мелочь | ФАКТ (латентный) | `src/modules/operator-mobile/application/mobile-shift-query.ts:49,702`; `src/modules/readiness/application/scheduler.ts:245`; `src/modules/operator-mobile/application/commands/shift-close.ts:379`; `prisma/schema.prisma:2413,2442-2444` | `ReportDowntime.kind='BREAK'` (перерыв) фильтруется на экране машиниста, но не в суммах простоя (`totalDowntime` в событии и анализах). Писателей `kind='BREAK'` в `src/` нет (0), интервальный контур v3 их когда-то писал. | Если в базе остались строки `BREAK`, экран машиниста и аналитика/выгрузки/PDF покажут разный простой. Совпадает с известной находкой `AU14` №2 и `AU247` — здесь подтверждено повторно. | Единый хелпер суммирования простоя с фильтром `kind !== 'BREAK'`; проверить наличие строк `BREAK` в проде. |
| 12 | мелочь | ФАКТ | `src/modules/operator-mobile/application/commands/equipment.ts:54-61`; `src/modules/operator-mobile/application/commands/shared.ts:77-83` | `requireOpenShift` вызывается **до** дружелюбного `409` о незакрытой старой смене. | Если старую смену на установке запустил другой `OPERATOR`, новый машинист получает `403 «Эту смену ведёт другой машинист»` вместо `409 «…не закрыта смена за <дата>. Сдайте её…»` — неверный совет: сдавать её он не может, чужую смену не закрыть (`shared.ts:81-83`). | Сначала сообщать о незакрытой смене прошлых суток, а проверку «чужой машинист» делать только для смены текущих суток. |
| 13 | мелочь | ФАКТ | `src/modules/readiness/application/scheduler.ts:215-229`; `src/modules/operator-mobile/application/commands/shift-close.ts:177-188` | Автозакрытие сдаёт только **существующий** черновик; если у отработавшей смены отчёта нет, `Report` не создаётся. | Смена, где машинист только принял установку и ничего не записал, закрывается планировщиком без отчёта — в журнале отчётов её нет вовсе (видна лишь как смена с `autoClosedAt`). Информация вроде не теряется, но картина дня по отчётам неполна. | Либо создавать пустой отчёт при автозакрытии (как `ensureReport` при сдаче), либо явно задокументировать, что смена без черновика отчёта не порождает. |
| 14 | мелочь | ФАКТ | `src/modules/readiness/application/scheduler.ts:75-85`; `src/workers/unified-worker/readiness-scheduler.ts:21-22` | Час конца смены (19/07), запас (`+5`) и порог неизвестного типа (12:00) зашиты в код; настраивается только интервал тика через `READINESS_SCHEDULER_INTERVAL_MS`. | Операционно значимое поведение (момент закрытия незакрытых смен) меняет только разработчик; владелец не может подстроить порог. | Либо вынести в `TenantSettings`, либо письменно зафиксировать как неизменяемую политику. |
| 15 | мелочь | ГИПОТЕЗА | `src/modules/readiness/application/scheduler.ts:180-204`; контраст — `src/modules/operator-mobile/application/commands/equipment.ts` (заказ снимка готовности) | Автозакрытие не заказывает пересчёт готовности по смене (нет запроса снимка), пересчёт техники идёт лишь раз в сутки (`scheduler.ts:300-315`). | Если состояние смены влияет на расчёт готовности, снимок останется устаревшим до суточного пересчёта. Зависимость расчёта от состояния смены по коду не прослежена. | Проверить, участвует ли состояние смены в `computeReadinessScore`; если да — заказывать снимок и при автозакрытии. |
| 16 | мелочь | ФАКТ | `src/modules/readiness/application/scheduler.ts:300` против `:106-112` | Ключ суточного пересчёта строится как `tenantProductionDate(now, null)` → Europe/Moscow, тогда как автозакрытие считает по поясу смены. | Для организации в поясе, отличном от МСК, сутки дедупликации пересчёта и сутки автозакрытия разойдутся — тихая ошибка дедупа. На проде один тенант (МСК), последствий нет. | Передавать пояс организации в `tenantProductionDate` и на строке 300. |

## Таблица сценариев «условие | результат | файл:строка | риск»

| Условие | Результат | файл:строка | Риск |
|---|---|---|---|
| Смена `DAY` в `STARTED`, наступило 00:00 МСК D+1 | Смена `CLOSED`, `autoClosedAt`; черновик → `submitted` | `scheduler.ts:94-113,180-183` | низкий |
| Смена `NIGHT` в `STARTED`, 11:59 МСК D+1 | Не закрывается (ночь ещё может идти) | `scheduler.ts:100-113`; тест `scheduler.test.ts:234-248` | низкий |
| Смена `NIGHT` в `STARTED`, 12:00 МСК D+1 | Закрывается | `scheduler.ts:113`; тест `scheduler.test.ts:271-284` | низкий |
| Воркер поднялся через 3 суток | Все просроченные закрываются на первом тике (`today > nextDay`) | `scheduler.ts:108` | низкий |
| Повторный тик в тот же час | Ничего не меняет (смены уже `CLOSED`, наряды не переотбираются) | `scheduler.ts:130-133,172-183` | низкий |
| Оператор закрывает смену, одновременно тик | Блокировка строки + условный `updateMany`: двойного закрытия нет | `shared.ts:60-63` + `scheduler.ts:180-183` | низкий |
| Сдача отчёта из контура готовности при простое > смены | Проверка не применяется, отчёт уходит | `shift-close.ts:271-338` | средний |
| Поправка простоя вверх (например, до 12 ч) | Проверка простой ≤ смена не вызывается | `production-corrections.ts:175-214` | средний |
| Форма админа открыта до сдачи, сдача произошла | Форма сохраняется поверх сданного отчёта (версия не изменилась) | `shift-close.ts:214-226`, `report.repository.ts:138-154` | средний |
| Очередь телефона с `log-production` после автозакрытия | `409` → запись `FAILED` навсегда, в отчёт не входит | `offline-queue.ts:139-144`; `shared.ts:73-75` | средний |
| Старая смена `STARTED` (тот же машинист) на «Получении установки» | `409 «По этой установке не закрыта смена за <дата>»` | `equipment.ts:55-61` | низкий (лечение есть) |
| Старая смена `STARTED` запущена **другим** машинистом | `403 «Эту смену ведёт другой машинист»` вместо `409` | `equipment.ts:54`; `shared.ts:77-83` | средний |
| Смена `HANDOVER_PENDING` после «Завершить работу» | Не закрывается и не отменяется; установка заперта | `scheduler.ts:66`; `transitions.ts:11,13-14`; `shift-close.ts:57-70` | высокий |
| Контейнер `workers` не задеплоен (только `app`) | Автозакрытие не идёт вовсе, молча | `unified-worker.ts:187-189`; `embedded-workers.ts:295-323` | высокий |
| Две реплики `workers`, наложившиеся прогоны | Возможны дубли `ReportSubmitted` по одному отчёту | `scheduler.ts:215-250` (ГИПОТЕЗА) | низкий (повышается при масштабировании) |

## ПРОЙДЕНО (проверено и в порядке)

- Границы автозакрытия и смена через полночь: `scheduler.ts:94-113`, тесты `scheduler.test.ts:234-284`.
- Идемпотентность повторного тика по сменам: условный `updateMany` по `state` (`scheduler.ts:180-183`), тест `scheduler.test.ts:318-321`.
- Изоляция организаций: обход через `forEachTenant`, работа в `withReadinessTenantTransaction` (`readiness-scheduler.ts:34-44`; `scheduler.ts:125`); сырого SQL без параметров нет.
- Аудит-след автозакрытия: `AuditLog shift.auto-closed` с системным актором `{id:null, role:'SYSTEM'}` (`scheduler.ts:39,188-204`), тест `scheduler.test.ts:207-230`.
- Гонка «оператор ↔ автозакрытие»: блокировка строки `FOR UPDATE` (`shared.ts:60-63`) + условный `updateMany` — потерянного обновления нет.
- «Сдача старой смены»: `409` на «Получении установки» о незакрытой смене прошлых суток (`equipment.ts:55-61`) — лечение `D-20260930-001`.
- Отказы формы админа: другой объект/дата — `409` (`report-command.service.ts:169-174`); отчёт по идущей смене — `409` (`:203-208`).
- `ReportDowntime_reason_present`: простой обязан иметь причину, перерыв — нет (`prisma/schema.prisma:2442-2444`).

## Не проверено

- **Поведение на реальной БД.** Строки `Shift`/`Report`/`ReportDowntime` не читались — доступа к БД нет (AGENTS.md запрещает `.env*` и прод). В том числе не выяснено, есть ли в проде строки `ReportDowntime.kind='BREAK'` (находка 11) и смены в поясах, отличных от МСК (находка 16).
- **Фактический состав контейнеров в проде.** Есть ли работающий `workers` (находка 6) — по репозиторию не определить.
- **Достижимость находки 7.** Дубли событий требуют двух одновременно наложившихся прогонов; на стенде не воспроизводил, поведение выведено из кода. Статус — ГИПОТЕЗА.
- **Зависимость расчёта готовности от состояния смены** (находка 15) — по коду не прослежена; находка остаётся ГИПОТЕЗОЙ.
- **Пульс планировщика.** Семантика `recordSchedulerHeartbeat`/TTL и моменты «зелёного» `/api/health/deep` при неподнятом воркере подробно не разбирались (вопрос 4, часть «остановка воркера»).
- **Экраны оператора (v2/v3/v5/v7/v10) и ORION** не аудировались как UI — только их вызовы команд (`sendCommand`) в объёме, необходимом для вопросов 3 и 5.
- **Тесты/сборку не запускал.** Задание READ-ONLY, изменён только markdown; `tsc`/`lint`/`test`/`build`/`playwright --list` не выполнялись (не требуются для отчёта). Числа тестов в отчёте — из кода тестов, а не из прогона.
