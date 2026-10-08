# W137-IND-SHIFT-STATE: переходы состояний смены и готовности (независимый аудит)

READ-ONLY. Существующие файлы не менялись; создан только этот документ.
Аудируемая версия — `D:/PillingR/wt-audit-0f53`, SHA **0f53cd01a264ffae97e3eaa7fea7582d90bf657d**
(`Merge codex/j9-j8-j7-1007: J9 готовность неактивной техники, J8 индексы журнала забивки, J7 репетиция очистки сирот`).
Отчёт лежит в рабочем дереве `D:/PillingR/wt-night` (ветка `hermes/q4-0926`). Замороженные зоны (варианты экрана
оператора, `src/modules/operator-mobile/**`, `src/app/operator/**`) читались только как источник фактов, не менялись.

## Итог

- Находок **16**: **критично — 2**, **важно — 8**, **мелочь — 6**.
- Главное: состояний смены пишут **два независимых контура** в одну таблицу `Shift` — контур готовности
  (`src/modules/readiness/...`, автомат `domain/shifts/transitions.ts`) и мобильный контур машиниста
  (`src/modules/operator-mobile/...`, прямые `tx.shift.update`), и мобильный пуск смены **не проходит ни одной
  проверки готовности и допуска**.
- Топ-5:
  1. `acceptEquipment` (`equipment.ts:74-107`) переводит смену в `STARTED` **без** `getOperatorClearance`
     и **без** `evaluateAuthoritativeShiftStart` — весь допуск контура готовности (`OPERATOR_NOT_CLEARED`,
     `SHIFT_START_BLOCKED`, `ShiftStartWaiver`) на реальном рабочем пути машиниста обходится (#1).
  2. Веб-форма отчёта `POST /api/reports/upsert` пишет выработку (сваи, бурение, простои) **без** проверки
     состояния смены и **без** `requireProductionPermit` — критический дефект и просроченный документ её не
     останавливают, хотя мобильный путь останавливают (#2).
  3. `finish-work` (`shift-close.ts:23-26`) ставит `HANDOVER_PENDING` **без** записи `ShiftHandover`, а планировщик
     это состояние не автозакрывает (`scheduler.ts:64`) → смена может зависнуть и 409-блокировать следующую (#3).
  4. Мобильные записи состояния **не инкрементируют `version`** и **не пишут цепочку аудита готовности** —
     оптимистичная блокировка диспетчера и доказательный журнал эти переходы не видят (#4).
  5. Мобильная смена стартует **без `startSnapshotId`** и заказывает снимок уже ПОСЛЕ старта — неизменяемого
     доказательства решения о пуске не остаётся (#5).

## Методика

Воспроизводимо чтением кода; Python нет — использованы `read_file` / `search_files` / `terminal` (git, grep).
Сервер не поднимался, БД не читалась, тесты/сборка/tsc/линт не запускались (задача — read-only аудит).

1. `AGENTS.md` (wt-audit-0f53 и wt-night) прочитан: модель доверия (ADMIN/DISPATCHER — платформенные,
   FOREMAN/SAFETY_ENGINEER без пользователей), заморозка вариантов оператора и ORION, список «выглядит мёртвым,
   но живёт».
2. Модель состояния: `prisma/schema.prisma` (`enum ShiftState` 1065-1072, `model Shift` 1081-1133,
   `ShiftStartWaiver` 1144-1158, `ShiftHandover` 1160-1186, `ReportDowntime` 2392-2429).
3. Контур готовности — полное чтение: `domain/shifts/{types,transitions,shift,handover,waiver}.ts`,
   `domain/evaluation/{evaluator,rules,facts}.ts`, `domain/readiness-rules.ts`, `domain/readiness-score.ts`,
   `domain/defects/{defect,types}.ts`, `domain/capability-defaults.ts`, `domain/access-matrix.ts`,
   `application/shifts/{commands,start-decision,schemas}.ts`, `application/readiness-score.ts`,
   `application/capabilities.ts`, `application/operator-shift-query.ts`, `application/scheduler.ts`,
   `application/projection/{project-event,current-read-model}.ts`, `infrastructure/shifts/shift-repository.ts`,
   `infrastructure/snapshots/snapshot-repository.ts`, `infrastructure/audit/audit-repository.ts`,
   `application/defects/{commands,schemas}.ts`, `application/readiness-rules-service.ts`.
   Маршруты: `find src/app/api/readiness -name route.ts | sort` (start/waiver/decline/cancel/request-acceptance/
   handover, handovers/[id]/{accept,rework}), плюс `_shared/{route-adapter,request-context}.ts`.
4. Мобильный контур: `src/app/api/operator/mobile/command/route.ts`, `src/app/api/operator/shift/route.ts`,
   `src/modules/operator-mobile/application/commands/{equipment,shift-close,shared,production,checklist,admission}.ts`,
   `application/mobile-shift-query.ts`, `domain/{shift-phases,production-permit}.ts`.
5. Веб-форма отчёта: `src/app/api/reports/upsert/route.ts`, `src/modules/reports/application/commands/report-command.service.ts`.
6. Кто вызывает какой путь: `grep -rn "api/readiness" src --include=*.ts --include=*.tsx` и
   `grep -rn "sendCommand|operator-mobile" src/components/piling/operator-v5 src/lib` — экран машиниста
   (`operator-v5-app.tsx`) шлёт команды `operator-mobile` (`accept-equipment`, `finish-work`, `log-production`,
   `close-shift`), а `POST /api/readiness/shifts/:id/start` вызывают диспетчерский экран готовности и
   `components/piling/operator-dashboard.tsx` (легаси-путь отхода, заморожен).
7. Писатели состояния: `grep -rn "state: 'STARTED'|state: 'HANDOVER_PENDING'|state: 'CLOSED'|..." src --include=*.ts`.
8. Независимость: первый проход сделан без открытия прошлых отчётов `docs/audits/**`; их читал только после
   того, как находки сформулированы, — для раздела «Приложение: сравнение».

## 1. Модель состояний (сводка)

**Контур готовности (А)** — `ShiftState` из 6 значений (`types.ts:8-16`):
`PLANNED → PENDING_ACCEPTANCE → STARTED → HANDOVER_PENDING → CLOSED`, плюс `CANCELLED`.
Подчинённый автомат передачи `ShiftHandoverState` (`types.ts:17`): `DRAFT → SUBMITTED → ACCEPTED | REWORK_REQUIRED`.
Единственный «вход» — план-переходы `SHIFT_ALLOWED`/`HANDOVER_ALLOWED` (`transitions.ts:4-21`) и серверный
`assertShiftTransition` (`transitions.ts:60-64`). Правом доступа управляет `readiness.*` (`capability-defaults.ts:52-135`).

**Мобильный контур (Б)** — те же строки `Shift`, но переходы пишутся прямыми `tx.shift.update`
(`equipment.ts:76-106`, `shift-close.ts:23-26,86-92`), минуя `transitions.ts`. Фазой для экрана служит не
`ShiftState`, а вычисляемая `OperatorPhase` (`operator-mobile/domain/shift-phases.ts:144-158`).

**Готовность техники**: `ReadinessScoreSnapshot` (evidence + facts + blockers + `ruleSetVersion`,
`snapshot-repository.ts:24-37`) и проекция `CurrentReadiness` (`current-read-model.ts`).
Вердикт — `ALLOWED | CONFIRMATION_REQUIRED | RETURN_TO_OPERATOR | DENIED` (`readiness-score.ts:48-52,206-231`); `canStart = verdict === 'ALLOWED'` (`:228`), т.е.
`RETURN_TO_OPERATOR` (нет осмотра сегодня, `readiness-rules.ts:200`) и `REQUIRE_CONFIRMATION` тоже блокируют пуск.
Связь с допуском к работе: контур А — `evaluateAuthoritativeShiftStart` (`start-decision.ts`) внутри
`startShiftCommand`; мобильный контур — независимый `requireProductionPermit` (`shared.ts:240-299`) в `logProduction`.
Системный (неотключаемый) блокер — `CRITICAL_DEFECT → DENY_START` (`readiness-rules.ts:96-104`,`271-274`).

## 2. Таблица переходов

### Контур А — готовность (`src/modules/readiness/...`), все через `assertShiftTransition` + аудит

| # | Было → Стало | Действие | Роль/право (по умолчанию) | Условия (сервер) | Записи/события | Отказ |
|---|---|---|---|---|---|---|
| A1 | — → `PLANNED` | `createShiftCommand` `shifts/commands.ts:98-124` | `readiness.shift.manage` (ADMIN/DISPATCHER/OPERATOR) | актор активен (`shift-repository.ts:15-19`); установка активна и своя (`:21-25`); если OPERATOR — закрепление бригады (`:35-39`); окно валидно (`shift.ts:3-10`) | аудит `shift.created`; outbox `ReadinessSnapshotRequested` | 403/404/422 |
| A2 | `PLANNED` → `PENDING_ACCEPTANCE` | `requestShiftAcceptanceCommand` `:209-226` | `readiness.shift.manage` | state=PLANNED (`transitions.ts:8`); version | аудит `shift.acceptance-requested` | 409 |
| A3 | `PENDING_ACCEPTANCE` → `STARTED` | `startShiftCommand` `:151-207` | `readiness.shift.authorize` (ADMIN/DISPATCHER/OPERATOR) | version; допуск по документам `getOperatorClearance` (`:179-190`, если есть бригада); `evaluateAuthoritativeShiftStart` + `waiver` (`:192-200`, `start-decision.ts:29-39`) | аудит `shift.started`/`start-blocked`; ставит `startSnapshotId` (`start-decision.ts:41-46`) | 422 `OPERATOR_NOT_CLEARED` / `SHIFT_START_BLOCKED`; 409 |
| A4 | `PENDING_ACCEPTANCE` → `PLANNED` | `declineShiftCommand` `:281-301` | `readiness.shift.authorize` | причина 3-1000 (`shift.ts:12-17`) | аудит `shift.acceptance-declined` | 409/422 |
| A5 | `PLANNED/PENDING_ACCEPTANCE/STARTED` → `CANCELLED` | `cancelShiftCommand` `:303-316` | `readiness.shift.manage` (= OPERATOR тоже) | причина 3-1000 | аудит `shift.cancelled` | 409 |
| A6 | `PLANNED` → (`type`/окно) | `updateShiftCommand` `:126-149` | `readiness.shift.manage` | `edit: ['PLANNED']` (`transitions.ts:5`) | аудит `shift.updated` | 409 |
| A7 | `STARTED` → `HANDOVER_PENDING` | `submitHandoverCommand` `:318-360` | `readiness.handover.prepare` (ADMIN/DISPATCHER/OPERATOR/MECHANIC) | version; state=STARTED; если OPERATOR — сданный отчёт (`handover.ts:59-67`) | `ShiftHandover=SUBMITTED`; аудит `handover.submitted/submitted→resubmitted` | 409/422 |
| A8 | `HANDOVER_PENDING` → `CLOSED` | `acceptHandoverCommand`→`decideHandover` `:390-428` | `readiness.handover.decide` (ADMIN/DISPATCHER/OPERATOR) | передача существует и state=SUBMITTED (`:406-410`) | `ShiftHandover=ACCEPTED`; аудит `handover.accepted` (+`selfAccepted`); `shifts.close` | 409 |
| A9 | `HANDOVER_PENDING` → `STARTED` | `reworkHandoverCommand` `:432`, `decideHandover` | `readiness.handover.decide` | state=SUBMITTED; причина 3-1000 | аудит `handover.rework-requested`; `shifts.reopen` | 409/422 |
| A10 | смена не меняется | `waiveShiftStartCommand` `:238-279` | `readiness.shift.waive` (ADMIN/DISPATCHER; OPERATOR — НЕТ) | есть снимок с препятствиями; причина ≥10 (`waiver.ts:40-47`) | upsert `ShiftStartWaiver`; аудит `shift.start-waived` | 409 |
| A11 | `STARTED` → `CLOSED` | планировщик `scheduler.ts:161-193` | SYSTEM (не человек) | прошёл конец смены + 5ч (`:73-96`); `UNFINISHED_SHIFT_STATES=['STARTED']` (`:64`) | аудит `shift.auto-closed`; досдача черновиков + `ReportSubmitted`; суточный пересчёт | — |

### Контур Б — мобильный рабочий путь машиниста (`src/modules/operator-mobile/...`), вход — `POST /api/operator/mobile/command`

| # | Было → Стало | Действие | Роль | Условия (сервер) | Записи/события | Отказ |
|---|---|---|---|---|---|---|
| B1 | —/`PLANNED`/`PENDING_ACCEPTANCE` → `STARTED` | `acceptEquipment` `equipment.ts:22-107` | только OPERATOR (`route.ts:192-194`) | закрепление бригады (`requireCrew`); активная смена другой даты → 409 (`:46-60`) | `tx.shift.update`/`create` `STARTED` (`:76-106`); evidence `STARTUP_READING`; outbox `SHIFT_STARTED` (`:134-155`) | 403/409 |
| B2 | `STARTED` → `HANDOVER_PENDING` | `finishWork` `shift-close.ts:16-29` | OPERATOR | `requireOpenShift` (не CLOSED/CANCELLED), бригада | `tx.shift.update` (`:23-26`); **без `ShiftHandover`, без version, без аудита** | 403/404/409 |
| B3 | `STARTED`/`HANDOVER_PENDING` → `CLOSED` | `closeShift` `shift-close.ts:41-96` | OPERATOR | `requireOpenShift`; выполнен `EO_AFTER` (`:58-69`) | отчёт `submitted` + `ReportAudit` + outbox (`:71-84,117-217`); `tx.shift.update CLOSED` (`:86-92`); **без readiness-аудита** | 409 |
| B4 | смена не меняется | `submitReport` `shift-close.ts:227-294` | OPERATOR | `requireOpenShift`; есть осмотр после работы | отчёт `submitted` + `ReportAudit` | 409 |
| B5 | выработка | `logProduction` `production.ts:96-579` | OPERATOR | `requireOpenShift`; state=STARTED/HANDOVER_PENDING (`:141`); период `TB_*` (`:178-203`); `requireProductionPermit` (`:245-254`) | `PileWork`/`LeaderDrilling`/`ReportDowntime`; `ReportAudit updated` | 409 «Работа запрещена» |
| B6 | простой | `logProduction` (DOWNTIME) | OPERATOR | `requireOpenShift`; state=**любое открытое** (DOWNTIME исключён из проверки «не начата», `:141`) | `ReportDowntime` | 400/403/404 |

### Дефекты (оба контура) — `readiness/application/defects/commands.ts`

| # | Было → Стало | Действие | Право | Условия | Записи | Отказ |
|---|---|---|---|---|---|---|
| D1 | — → `OPEN` | `createDefectCommand` `:116-146` | `readiness.defect.report` (OPERATOR/ASSISTANT/DISPATCHER/MECHANIC/FOREMAN/SAFETY/ADMIN) | актор активен; установка активна и своя; **состояние смены не проверяется** | `EquipmentDefect` + аудит `defect.reported` + outbox `DEFECT_CHANGED` + оповещение | 403/404/422 |
| D2 | `OPEN` → `IN_WORK`/`REJECTED`; `IN_WORK` → `CLOSED` | triage/resolve/reject `:176-231` | `readiness.defect.manage` | автомат `defect.ts:59-68` (`CLOSED`/`REJECTED` конечные) | аудит `defect.*` | 409 |

## 3. Переходы, защищённые только интерфейсом

1. **Пуск смены в мобильном контуре (B1)**. Прямой `POST /api/operator/mobile/command {command:'accept-equipment'}`
   переводит смену в `STARTED`, проверяя лишь закрепление бригады. Ни `getOperatorClearance`, ни
   `evaluateAuthoritativeShiftStart`, ни препятствия готовности, ни `ShiftStartWaiver` не участвуют
   (`equipment.ts:22-107`). Весь допуск контура готовности — **совет**, а не запрет, на реальном пути машиниста.
2. **Снятие моточасов перед пуском** (`meterKnownToday` в `shift-phase.ts:166-171`). Серверный `startShiftCommand`
   счётчик не проверяет: `ENGINE_HOURS` — только вес балла (`readiness-score.ts:135-139`), не блокер. Пуск без
   показаний счётчика сервер разрешает, прячет его экран.
3. **Предсменный осмотр до пуска**. В контуре А его закрывает правило `INSPECTION_BELOW_80` (`readiness-rules.ts:200`).
   В мобильном контуре пуск (B1) осмотра не требует вовсе; порядок чек-листов (`shift-phases.ts:74-81`) — это про
   порядок чек-листов, а не про пуск.
4. **Веб-форма отчёта** (`POST /api/reports/upsert`, `reports/upsert/route.ts:57-88` +
   `report-command.service.ts:229-273`). Новый отчёт создаётся без проверки состояния смены и без
   `requireProductionPermit`; состояние проверяется только для уже существующего отчёта и только чтобы не дать
   закрыть отчёт идущей смены (`:190-204`). То есть критический дефект и просроченный документ не мешают записать
   сваи через форму, хотя мешают через телефон (`production.ts:245-254`).
5. **«Завершить работу»/«Закрыть смену» до старта**. `requireOpenShift` (`shared.ts:52-79`) запрещает только
   `CLOSED`/`CANCELLED`. Прямым запросом можно провести `finish-work`/`close-shift` на смене `PLANNED`/
   `PENDING_ACCEPTANCE`, которую никто не начинал; экран такого не предлагает.

## 4. Блокирует ли критический дефект начало работы

- **До старта, контур А** — да: `CRITICAL_DEFECT → DENY_START`, правило системное и не отключается
  (`readiness-rules.ts:96-104`, `271-274`), факт `criticalDefect` берётся из открытого `EquipmentDefect` и
  критических нарядов (`application/readiness-score.ts:88-94,193-194`), вердикт `DENIED` → `canStart=false`
  (`readiness-score.ts:215-228`).
- **До старта, мобильный контур** — **нет**: `acceptEquipment` решения о готовности не считает (см. #1).
  Дефект «сработает» только когда машинист начнёт писать сваи (B5).
- **Во время работы** — да, но по другому механизму: `requireProductionPermit` на каждой записи выработки
  (`production.ts:245-254`) блокирует сваи/паспорт/бурение при открытом `CRITICAL`-дефекте
  (`production-permit.ts:103-113`). Простой, происшествие, дефект, осмотр, поправка, отчёт и закрытие смены
  намеренно **не** блокируются (`shared.ts:225-238`, `production-permit.ts:10-18`).
- **Веб-форма** — **нет** (см. §3.4). Итого: «критический дефект запрещает работу» выполняется на мобильном
  пути записи выработки и в контуре готовности, но не на пуске и не в веб-форме отчёта.

## 5. Простой/дефект при заблокированной работе

- **Дефект** — можно: `createDefectCommand` состояния смены не проверяет вообще (D1). «Требование не найдено»
  не нужно — правило «запись фактов остаётся открытой» здесь реализовано (нет гейта).
- **Простой** — можно: в `logProduction` DOWNTIME намеренно исключён из проверки допуска
  (`production.ts:141,245-254`) и из проверки «смена не начата». Простой принимается в любом открытом состоянии,
  включая `PLANNED`/`PENDING_ACCEPTANCE` (см. #8).

## 6. История при закрытии смены и при смене правил после старта

- **Закрытие в контуре А**: цепочка аудита `TenantAuditChain` + `AuditLog` пишет `shift.closed` и
  `handover.accepted` с `userName`/`userRole`/`actingAs` и `before`/`after` (сериализованные смена и передача)
  (`commands.ts:420-427`, `audit-repository.ts:44-75`). Плюс снимок старта (`startSnapshotId`,
  `start-decision.ts:41-46`) хранит `ruleSetId`/`ruleSetVersion` (`snapshot-repository.ts:24-37`) — видно, по каким
  правилам машину выпустили.
- **Закрытие в контуре Б** (`closeShift`): пишется только `ReportAudit` отчёта и outbox `ReportSubmitted`
  (`shift-close.ts:204-215`); в цепочке аудита готовности **нет** ни `shift.started`, ни `shift.closed`.
- **Смена правил после старта**: публикация правил (`readiness-rules-service.ts:247-273`) пишет аудит и заказывает
  пересчёт снимков по парку (`:190-211`), состояние идущей смены не меняет — работа не останавливается. Снимок
  старта хранит версию правил на момент пуска (контур А). Для мобильно запущенной смены снимка старта нет (#5),
  поэтому по ней нельзя сказать, какая редакция правил действовала на пуске.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/operator-mobile/application/commands/equipment.ts:22-107` (старт `:76-106`) | `acceptEquipment` = пуск смены, но не вызывает `getOperatorClearance` и `evaluateAuthoritativeShiftStart`; проверяется только закрепление бригады | Оператор с просроченным удостоверением или машина с открытым `CRITICAL`-дефектом открывают смену без запрета. Все проверки контура А (`commands.ts:179-200`), включая `ShiftStartWaiver`, на этом пути недостижимы. Состояния `PENDING_ACCEPTANCE` пуск не требует (`equipment.ts:62-70`) — допуск диспетчера обходится | Перед `STARTED` вызывать `getOperatorClearance` + `evaluateAuthoritativeShiftStart` (или провести мобильный пуск через `startShiftCommand`), отдавать блокеры/разрешение на экран |
| 2 | критично | `src/app/api/reports/upsert/route.ts:57-88`; `src/modules/reports/application/commands/report-command.service.ts:229-273` | новый отчёт пишется без проверки состояния смены и без `requireProductionPermit`; проверка смены есть только для существующего отчёта (`:190-204`) | Сваи/бурение/простой вносятся через форму при критическом дефекте, просроченном документе и вообще без начатой смены — мобильный путь такое запрещает (`production.ts:245-254`), форма нет | Гейтить `upsertReport` по состоянию смены и по тем же правилам допуска, что `requireProductionPermit` |
| 3 | важно | `src/modules/operator-mobile/application/commands/shift-close.ts:23-26`; `src/modules/readiness/application/scheduler.ts:64` | `finishWork` ставит `HANDOVER_PENDING` без записи `ShiftHandover`; автозакрытие это состояние исключает | Смена «сдаётся» без принимающего: принять/вернуть через контур нельзя, автозакрытие не сработает → статус может зависнуть и 409-блокировать смену следующего дня (`equipment.ts:54-60`). Совпадает с R71 | На `finishWork` заводить `ShiftHandover=SUBMITTED`; либо автозакрывать `HANDOVER_PENDING` только при отсутствии живой передачи |
| 4 | важно | `equipment.ts:76-106`; `shift-close.ts:86-92`; `infrastructure/audit/audit-repository.ts` | мобильные записи состояния не инкрементируют `Shift.version` и не пишут цепочку аудита готовности | Оптимистичная блокировка диспетчера (`if-match`, `resolveExpectedVersion`) версию не двигает; доказательный журнал не видит ни старта, ни закрытия мобильной смены — «кто закрыл и когда» по контуру не отвечается | Инкрементировать `version` и писать `recordChainedReadinessAudit` на каждом переходе; либо считать мобильные переходы отдельным потоком с явными событиями |
| 5 | важно | `equipment.ts:134-155`; ср. `src/modules/readiness/application/shifts/start-decision.ts:41-46` | мобильная смена стартует без `startSnapshotId`, снимок заказывается ПОСЛЕ старта | Нет неизменяемого доказательства решения о пуске и версии правил на момент пуска → «по какому регламенту выпустили машину» не восстанавливается | Ставить `startSnapshotId` при пуске (как `start-decision`), либо фиксировать снимок-решение до перевода в `STARTED` |
| 6 | важно | `start-decision.ts:29-38`; `capability-defaults.ts:65-74` | `ShiftStartWaiver` потребляется только в контуре А; мобильный пуск препятствия не считает | Письменное разрешение диспетчера (`readiness.shift.waive`) для оператора бесполезно: его не к чему применить — блокировка на пуске не возникает | См. #1: сначала вернуть на мобильный пуск расчёт препятствий, затем учитывать waiver |
| 7 | важно | `src/modules/operator-mobile/application/commands/shared.ts:52-79` | `requireOpenShift` запрещает только `CLOSED`/`CANCELLED` | Прямым запросом можно выполнить `finish-work`/`close-shift` на смене `PLANNED`/`PENDING_ACCEPTANCE`, которую никто не начинал — экран такого не предлагает | Для `finish-work` требовать `STARTED`; сообщение уже различает «не начата» (`production.ts:153-160`) |
| 8 | важно | `src/modules/operator-mobile/application/commands/production.ts:141` | DOWNTIME исключён из проверки «смена ещё не начата» | Простой можно записать на смене `PLANNED`/`PENDING_ACCEPTANCE`, которой не было в работе — запись в отчёте появится раньше начала смены | Оставить исключение только для «заблокированной работы», но требовать начатой смены для простоя |
| 9 | важно | `commands.ts:151-207` против `equipment.ts:62-107`; `domain/shifts/transitions.ts:9` | одна таблица `Shift`, два писателя с разными правилами: контур А требует `PENDING_ACCEPTANCE`, мобильный принимает `PLANNED`/`PENDING_ACCEPTANCE` и сразу пишет `STARTED` | Доменный автомат (`transitions.ts`) перестаёт быть единственным входом в состояние: инварианты и тексты ошибок контура А не применяются к мобильному пути | Свести пуск к одной серверной команде (контур А), оставив мобильный экран тонким клиентом |
| 10 | важно | `scheduler.ts:54-64` | `HANDOVER_PENDING` выведен из автозакрытия намеренно (ради живой передачи) | В сочетании с #3 мобильная сдача без передачи делает исключение капканом: у состояния нет автоматического выхода | Автозакрывать `HANDOVER_PENDING` только при отсутствии живой `ShiftHandover` (совпадает с R71 #2) |
| 11 | мелочь | `defects/commands.ts:116-146`; `domain/defects/types.ts:1-5`; `production-permit.ts:103` | при заведении дефекта `severity` принимается как есть; блокирует работу только `CRITICAL` | Критическую неисправность можно записать как `NORMAL` — она не остановит выработку. Полутон `HIGH` тоже не блокирует (решение владельца 2026-08-08 — возможно, намеренно) | Подтвердить у владельца; при необходимости — обязательное подтверждение `CRITICAL` по узлу/фото |
| 12 | мелочь | `capability-defaults.ts:75-94`; `commands.ts:281-316` | OPERATOR имеет `readiness.shift.manage` и `readiness.shift.authorize` | Оператор может отказать в допуске собственной смене (`decline`) и отменить смену из `STARTED` (`cancel`, причина 3-1000) без отчёта — выработка остаётся черновиком | Развести права: `decline`/`cancel` из `STARTED` — не оператору, либо требовать сданный отчёт |
| 13 | мелочь | `src/modules/readiness/application/operator-shift-query.ts:290-299` | экран берёт препятствия из `CurrentReadiness` (проекция), а не из живого расчёта | При отставании воркера проекций машинист видит устаревшие препятствия на экране пуска (класс родствен W40) | Помечать снимок временем и/или показывать свежесть; блокирующее решение всё равно пересчитывать при пуске |
| 14 | мелочь | `commands.ts:179-190` | допуск по документам проверяется, только если `crewOperatorId` не `null` | Установка без активной бригады открывает смену без проверки допуска (комментарий называет это ответственностью диспетчера — задокументировано, не баг) | Подтвердить у владельца, что это осознанное правило |
| 15 | мелочь | `shift-close.ts:86-92`; `scheduler.ts:169-172` | закрытие с телефона не пишет readiness-аудит и не ставит `closeExceptionReason`; от автозакрытия его отличает только отсутствие `autoClosedAt` в цепочке | В доказательном журнале готовности нет закрытий мобильного контура — сходимость аудита и состояния смены проверить нечем | Единая точка закрытия (см. #9), пишущая аудит и признак «кто закрыл» |
| 16 | мелочь | `report-command.service.ts:190-204` | защита «не закрывать отчёт идущей смены» работает только для существующего отчёта | Новый отчёт заводится без всякой привязки к состоянию смены (развитие #2) | Ввести проверку состояния при создании отчёта |

Сводка: критично 2 (#1, #2), важно 8 (#3-#10), мелочь 6 (#11-#16).

## Вопросы владельцу о правилах

1. **Два контура — так задумано?** Смену в одной таблице пишут контур готовности и мобильный контур машиниста.
   Какой из них источник истины для `ShiftState` и допустимо ли, что правила перехода у них разные (#9)?
2. **Нужен ли допуск готовности на реальном пуске машиниста?** Должен ли `accept-equipment` проходить те же
   проверки, что диспетчерское «Допустить» (#1, #6), или мобильный пуск намеренно свободен, а дисциплину держит
   только запрет записи выработки?
3. **Отчёт через форму:** должна ли веб-форма подчиняться тем же правилам допуска, что телефон (#2, #16)?
4. **`finish-work` без передачи:** заводить `ShiftHandover` или разрешить автозакрытие сдачи без передачи (#3, #10)?
5. **Отмена/отказ оператором своей смены** (#12) — это разрешённое действие или недоработка разграничения прав?
6. **Полутона дефектов:** `HIGH` не блокирует работу — оставляем (#11)?
7. **`closeExceptionReason`** (`prisma/schema.prisma:1104`) в коде никем не пишется — планируется ли закрытие
   смены «мимо правил» (см. R71 #7), и должен ли такой переход фиксироваться в аудите (#15)?
8. **`DOWNTIME` до старта смены** (#8) — допустимо записывать простой на ещё не начатой смене?

## Приложение: сравнение

Первый проход сделан без чтения прошлых отчётов; сверка ниже — после формулирования находок.

- **R71** (`docs/audits/hermes-night/R71-v2-handover-stuck.md`) уже описывает зависание `HANDOVER_PENDING`
  после `finish-work` без `ShiftHandover` и вывод этого состояния из автозакрытия. Мои #3 и #10 —
  **повтор** R71 #2/#3; отдельно отмечаю, что там разбор вёлся вокруг экрана v2, а здесь добавлена связка с
  тем, что `version` не инкрементируется (#4).
- **R148** (`R148-safety-validity-ui.md`) разбирает показ причины `OPERATOR_NOT_CLEARED` в контуре готовности.
  Пересечение частичное: мой #14 касается условия, при котором проверка допуска вообще не выполняется.
- **Новое (в прочитанных отчётах не встречал):** запуск мобильной смены без проверки готовности и допуска
  (#1), отсутствие `startSnapshotId` на мобильном пуске (#5), недостижимость `ShiftStartWaiver` для оператора
  (#6), отсутствие гейта допуска в веб-форме отчёта (#2, #16), `requireOpenShift` без требования `STARTED`
  (#7), `DOWNTIME` на неначатом смене (#8), неинкремент `version` и отсутствие readiness-аудита в мобильном
  контуре (#4, #15).
- Проверял только целевые отчёты (R71, R148) точечно, чтобы не потерять независимость; полный обзор прошлых
  аудитов не делал.

## Не проверено

- **На данных ничего не проверено.** БД не читалась, запросов не выполнял — частоты (напр. сколько смен реально
  «зависли» в `HANDOVER_PENDING`, сколько раз пуск проходил без проверки готовности) неизвестны.
- **Рантайм не воспроизводился.** Сервер не поднимался, запросы не отправлялись, тесты/Playwright/tsc/линт/build
  не запускались: задача read-only и не просит прогонов. Все выводы — из прочитанных строк кода.
- **`version` и optimistic-lock** (#4) не подтверждал экспериментом: вывод из того, что мобильные записи идут
  через `tx.shift.update` без `version: {increment: 1}`.
- **Заморозка.** `src/modules/operator-mobile/**`, варианты экрана оператора и ORION читались фрагментарно
  (только там, где нужно было сравнить пути перехода); их собственные дефекты не искал, правок в них не предлагаю.
- **Схема индексов.** Наличие частичного уникального индекса `Shift_one_active_per_equipment_key` взято из
  комментария `equipment.ts:41-45` и R71 (миграция `20260730105000`); в самой `prisma/schema.prisma` его нет
  (он в SQL миграции, которую я не открывал) — не проверено.
- **Историю изменений** (`git log -L`) по `equipment.ts`, `shift-close.ts`, `scheduler.ts` не смотрел: когда
  мобильный пуск лишился проверок (или их не имел) — не установлено.
- **Полный обзор прошлых аудитов** не делал (см. «Приложение: сравнение»).
