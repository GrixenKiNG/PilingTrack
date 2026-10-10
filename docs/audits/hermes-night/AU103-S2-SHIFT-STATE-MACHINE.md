# AU103-S2-SHIFT-STATE-MACHINE: смена и допуск — таблица переходов по коду

Версия репозитория: `git rev-parse HEAD` = `7f45fd3b5865761f1b9fbcb14735347d43f0404b`
(ветка `hermes/q4-0926`). Аудит только чтением; изменённых файлов приложения нет.
Все пути в отчёте — от корня репозитория, полные. Каждый вывод сопровождается
`файл:строка`, строки открыты инструментом чтения. Оценки воздействия, выведенные
из отсутствия проверки, а не из прямого наблюдения, помечены ГИПОТЕЗА.

## Итог

Резюме для владельца (5 строк):

1. В продукте ДВЕ несогласованные двери в одну таблицу `Shift`: контур
   техготовности (допуск → работа → передача → приёмка) и мобильное место
   машиниста, которое теми же полями `state` переводит смену мимо допуска.
2. Мобильное место (`acceptEquipment`) поднимает смену в `STARTED` напрямую, не
   спрашивая ни документов машиниста, ни правил готовности — с телефона пуск
   обходит весь контур допуска (`equipment.ts:76-107`).
3. `closeShift` с телефона закрывает смену в `CLOSED` напрямую, мимо состояния
   `HANDOVER_PENDING` и приёмки передачи (`shift-close.ts:86-92`).
4. `finishWork` переводит смену в `HANDOVER_PENDING`, но НЕ создаёт запись
   `ShiftHandover` — принять такую передачу нечем (`shift-close.ts:23-26`).
5. Две команды контура готовности недостижимы из веб-интерфейса: `waiver`
   (разрешение пуска при блокировке) и `cancel` (`shifts-screen.tsx:41` знает
   только `request-acceptance | start | handover | decline`). Единственный
   законный выход из заблокированного пуска в UI отсутствует.

Счёт по важности: **критично — 2**, **важно — 9**, **мелочь — 6**. Итого 17
находок (плюс 5 пунктов «не проверено»).

Топ-5:

1. [критично] Прямой API пуска смены в обход допуска — `acceptEquipment`.
2. [критично] Прямой API закрытия смены в обход приёмки — `closeShift`.
3. [важно] `finishWork` оставляет смену в `HANDOVER_PENDING` без передачи →
   смена «залипает» (автозакрытие такой не трогает).
4. [важно] Маршрут `waiver` не вызывается из UI → из блокировки нет выхода из
   веб-интерфейса.
5. [важно] `startShiftCommand`/`declineShiftCommand` не проверяют закрепление
   установки за актором (только `create`), а `OPERATOR` имеет
   `readiness.shift.authorize` (ГИПОТЕЗА по воздействию).

## Методика

Что и как искалось (чтобы повторить):

1. Карта домена: `find src/modules/readiness -type f`,
   `find src/app/api/readiness -type f`, `find src/modules/operator-mobile -type f`.
2. Модель и перечисления: `prisma/schema.prisma` — модели `Shift` (:1081-1133),
   `ShiftHandover` (:1160-1186), `ShiftStartWaiver` (:1144-1158), перечисления
   `ShiftState` (:1065-1072), `ShiftHandoverState` (:1074-1079).
3. Машина состояний: `src/modules/readiness/domain/shifts/transitions.ts` (таблица
   допустимых переходов и тексты отказов), `.../types.ts`, `.../shift.ts`,
   `.../handover.ts`, `.../waiver.ts`.
4. Команды: `src/modules/readiness/application/shifts/commands.ts`,
   `.../start-decision.ts`; репозитории `infrastructure/shifts/*-repository.ts`.
5. Роли и права: `domain/capability-defaults.ts`, `domain/access-matrix.ts`,
   `application/capabilities.ts`, `_shared/request-context.ts`.
6. Маршруты: все `route.ts` под `src/app/api/readiness/shifts/**`,
   `.../handovers/**`, `.../waiver`, `.../cancel`; адаптер `_shared/route-adapter.ts`.
7. Планировщик: `application/scheduler.ts`.
8. Вторая дверь (мобильное место): `src/modules/operator-mobile/application/commands/{equipment,shift-close,shared,admission}.ts`,
   маршрут `src/app/api/operator/mobile/command/route.ts`. Это замороженная зона
   (AGENTS.md §1) — файлы только читались, не менялись; привожу их потому, что
   они пишут в ту же таблицу `Shift.state`.
9. Интерфейс: `src/components/piling/to/readiness/screens/shifts-screen.tsx`;
   поиск вызовов `waiver`/`cancel` по `src` (`/waiver`, `/cancel` в клиенте — нет).
10. Тесты: `src/modules/readiness/domain/shifts/__tests__/shifts.test.ts`,
    `.../application/shifts/__tests__/commands-contract.test.ts`,
    `.../application/__tests__/scheduler.test.ts`,
    `src/app/api/readiness/shifts/__tests__/route.test.ts`,
    `.../shifts/[id]/request-acceptance/__tests__/route.test.ts`,
    `tests/integration/tech-readiness-shifts.spec.ts`,
    `src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts`,
    `.../domain/__tests__/operator-mobile-rules.test.ts`; `search_files` по `e2e/`.

Ограничения методики: существующие отчёты в `docs/audits/` не читались;
совпадения из них, случайно попавшие в вывод поиска, в отчёт не переносились —
все ссылки ниже сняты с открытых файлов кода. Индекс GitNexus не применялся
(задача не просит и не требует анализа вызывающих для правки).

## Таблица переходов смены (контур техготовности)

Обозначения: роль — по матрице полномочий (`capability-defaults.ts`); «право» —
требуемое полномочие в команде; отказ — `файл:строка` проверки, дающей отказ.

| # | Из | Действие | Роль (право) | Условия | В | События и записи | Отказ |
|---|----|----------|--------------|---------|---|------------------|-------|
| A1 | — | создать `createShiftCommand` | ADMIN/DISPATCHER/OPERATOR (`readiness.shift.manage`) | актор активен (`shift-repository.ts:15-19`); установка активна и своя (:21-25); если OPERATOR — закрепление бригады (:35-39); окно валидно (`shift.ts:3-10`) | PLANNED | аудит `shift.created`; outbox `ReadinessSnapshotRequested` | 403/404/422 `commands.ts:100-117` |
| A2 | PLANNED | изменить `updateShiftCommand` | те же (`shift.manage`) | `edit: ['PLANNED']` (`transitions.ts:5`); version; БД `state:'PLANNED'` (`shift-repository.ts:89-92`) | PLANNED | аудит `shift.updated` | 409 `commands.ts:134` |
| A3 | PLANNED | запросить допуск `requestShiftAcceptanceCommand` | `shift.manage` | `request: ['PLANNED']` (`transitions.ts:8`) | PENDING_ACCEPTANCE | аудит `shift.acceptance-requested`; ставит `requestedAt/ById` (`shift-repository.ts:98-104`) | 409 `commands.ts:218` |
| A4 | PENDING_ACCEPTANCE | допустить `startShiftCommand` | `readiness.shift.authorize` (`commands.ts:161`) | `start: ['PENDING_ACCEPTANCE']` (`transitions.ts:9`); version (`commands.ts:168`); документы оператора `getOperatorClearance` (:179-191); `evaluateAuthoritativeShiftStart` + waiver (:192-200) | STARTED | аудит `shift.started`/`shift.start-blocked`; `startSnapshotId` (`start-decision.ts:41-46`); outbox | 422 `OPERATOR_NOT_CLEARED` (`commands.ts:187`), 422 `SHIFT_START_BLOCKED` (:198), 409 (:168) |
| A5 | PENDING_ACCEPTANCE | отказать `declineShiftCommand` | `readiness.shift.authorize` (`commands.ts:284`) | `decline: ['PENDING_ACCEPTANCE']` (`transitions.ts:10`); причина 3..1000 (`shift.ts:12-17`) | PLANNED | аудит `shift.acceptance-declined`; `declinedAt/ById/Reason` (`shift-repository.ts:120-126`) | 409 `commands.ts:292`, 422 причина |
| A6 | PLANNED / PENDING_ACCEPTANCE / STARTED | отменить `cancelShiftCommand` | `readiness.shift.manage` (`commands.ts:305`) | `cancel: ['PLANNED','PENDING_ACCEPTANCE','STARTED']` (`transitions.ts:11`); БД тот же список (`shift-repository.ts:130`) | CANCELLED | аудит `shift.cancelled` | 409 `commands.ts:310` |
| A7 | STARTED | передать `submitHandoverCommand` | `readiness.handover.prepare` (`commands.ts:320`) | `handover: ['STARTED']` (`transitions.ts:12`); если исполняемая роль OPERATOR — сдан отчёт (`handover.ts:59-67`, вызов `commands.ts:330`) | HANDOVER_PENDING | `ShiftHandover=SUBMITTED` (или resubmit из REWORK_REQUIRED, `handover-repository.ts:45-54`); аудит `handover.submitted`/`resubmitted` | 409 `commands.ts:325`, 409 отчёта `handover.ts:65` |
| A8 | HANDOVER_PENDING | принять передачу `acceptHandoverCommand` | `readiness.handover.decide` (`commands.ts:392`) | передача `SUBMITTED` и version (`commands.ts:406-410`) | CLOSED | `ShiftHandover=ACCEPTED` (`handover-repository.ts:56-62`); смена `close` (`shift-repository.ts:143-148`); аудит `handover.accepted` (+`selfAccepted`, `commands.ts:404`) | 409 `commands.ts:407` |
| A9 | HANDOVER_PENDING | вернуть на доработку `reworkHandoverCommand` | `readiness.handover.decide` | передача `SUBMITTED`; причина 3..1000 (`handover.ts:18-24`) | STARTED | `ShiftHandover=REWORK_REQUIRED` (`handover-repository.ts:64-70`); `reopen` (`shift-repository.ts:150-155`); аудит `handover.rework-requested` | 409/422 |
| A10 | любое (состояние не меняется) | разрешить пуск `waiveShiftStartCommand` | `readiness.shift.waive` (`commands.ts:240`) | есть последний снимок с непустыми препятствиями (`commands.ts:252-262`); причина ≥10 (`waiver.ts:40-47`) | без изменения | upsert `ShiftStartWaiver` (`commands.ts:264-271`); аудит `shift.start-waived` | 409 нет снимка / нет препятствий (`commands.ts:252-262`) |
| A11 | STARTED | автозакрытие планировщиком | SYSTEM (`scheduler.ts:39`) | прошедшие производственные сутки + запас 5 ч (`scheduler.ts:76,92-111`); только `STARTED` (`scheduler.ts:64`) | CLOSED | `autoClosedAt`; черновик отчёта → `submitted` + outbox `ReportSubmitted` (`scheduler.ts:169-239`); аудит `shift.auto-closed` | — |

Машина передачи (`ShiftHandover`): `submit` из `DRAFT`/`REWORK_REQUIRED` → `SUBMITTED`;
`accept`/`rework` из `SUBMITTED` (`transitions.ts:17-21`).

## Вторая дверь: прямые API, минуя контур готовности

Мобильное место машиниста пишет те же поля `Shift.state`, но со своими правилами.
Все три команды доступны только роли `OPERATOR` (`route.ts:192-194`) через один
маршрут `POST /api/operator/mobile/command`.

| # | Из | Действие | Роль | Условия | В | События | Отказ |
|---|----|----------|------|---------|---|---------|-------|
| B1 | — / PLANNED / PENDING_ACCEPTANCE | `accept-equipment` (`equipment.ts:22-160`) | OPERATOR | только закрепление бригады (`requireCrew`, `commands/shared.ts:31-41`); активная смена по машине (`equipment.ts:46-61`) | STARTED (создаёт или переводит, `equipment.ts:76-107`) | `OperatorShiftEvidence`, outbox `SHIFT_STARTED` (`equipment.ts:135-156`) | 403 чужой экипаж (`shared.ts:39`); 409 незакрытая смена (`equipment.ts:56-60`) |
| B2 | STARTED / HANDOVER_PENDING | `finish-work` (`shift-close.ts:16-29`) | OPERATOR | `requireOpenShift` + `requireCrew` (`shift-close.ts:18-22`) | HANDOVER_PENDING (`shift-close.ts:23-26`) | — (передачи НЕ создаёт) | 403/409 (`shared.ts:66-76`) |
| B3 | STARTED / HANDOVER_PENDING | `close-shift` (`shift-close.ts:41-96`) | OPERATOR | `requireOpenShift` + `requireCrew`; выполнен ЕО после работы (`shift-close.ts:58-69`) | CLOSED (`shift-close.ts:86-92`) | отчёт `submitted` + `ReportAudit` + outbox `ReportSubmitted` (`shift-close.ts:172-215`) | 409 нет ЕО (`shift-close.ts:68`), 403/409 (`shared.ts:66-76`) |
| B4 | любое открытое | `submit-report` (`shift-close.ts:227-294`) | OPERATOR | есть осмотр после работы (чек-лист `EO_AFTER` ИЛИ осмотр `POST_SHIFT`, `shift-close.ts:255-277`) | состояние не меняется | отчёт `submitted` + событие | 409 нет осмотра (`shift-close.ts:276`) |

Ключевое: `acceptEquipment` и `closeShift` пишут `state` напрямую (`tx.shift.create`/
`tx.shift.update`), не вызывая ни `assertShiftTransition` (`transitions.ts:60-64`), ни
`getOperatorClearance`, ни `evaluateAuthoritativeShiftStart`. То есть контур допуска
(`PENDING_ACCEPTANCE`, waiver, блокировка готовности) на этом пути недостижим.

## Переходы, достижимые прямым API в обход интерфейса

Интерфейс контура готовности умеет только четыре действия смены и два по передаче:
`request-acceptance | start | handover | decline` (`shifts-screen.tsx:41,125`) и
`handovers/:id/accept|rework` (`shifts-screen.tsx:86,106`). Всё остальное —
достижимо только SQL/HTTP-запросом:

| Маршрут | Действие | Есть в UI | Статус |
|---------|----------|-----------|--------|
| `POST /api/readiness/shifts/:id/cancel` (`cancel/route.ts:11-15`) | A6 отмена | НЕТ | ПРОЙДЕНО (по поиску вызова в `src/components`) |
| `POST /api/readiness/shifts/:id/waiver` (`waiver/route.ts:15-26`) | A10 разрешение пуска | НЕТ | ПРОЙДЕНО |
| `POST /api/operator/mobile/command` `accept-equipment` (`route.ts:218-221`) | B1 пуск | НЕТ (мобильный экран — замороженная зона) | ПРОЙДЕНО |
| `POST /api/operator/mobile/command` `finish-work`/`close-shift` (`route.ts:245-250`) | B2/B3 | НЕТ (то же) | ПРОЙДЕНО |

## Переходы без теста

Тесты машины состояний:

- Покрыто (ПРОЙДЕНО): таблица чистых переходов `transitionShift`/`transitionHandover`
  — `shifts.test.ts:9-38`; автозакрытие `STARTED→CLOSED` — `scheduler.test.ts:109-232`;
  отказ `start` механику и `waive` оператору, ETag — `commands-contract.test.ts:13-33`;
  исполнительное поведение `start` и `acceptHandover` (гонка, блокировка, поправка) —
  `tests/integration/tech-readiness-shifts.spec.ts:154-259`.
- НЕ покрыто исполнительно (только домен или ничего):

| Переход | Тест | Комментарий |
|---------|------|-------------|
| A1 создать | нет | — |
| A2 изменить | нет | строки `edit` нет и в доменном тесте `shifts.test.ts` |
| A3 запросить допуск | `request-acceptance/__tests__/route.test.ts:57-84` | проверяет только валидацию тела; команда замокана, БД не проверяется |
| A4 старт (успех) | `tech-readiness-shifts.spec.ts:154-175,205-259` | только при наличии `DATABASE_URL_POSTGRES` (иначе `runIf` пропускает весь файл, `:37`) |
| A5 отказать | нет | — |
| A6 отменить | нет | — |
| A7 передать | нет | проверки отчёта покрыты только на доменном уровне (`shifts.test.ts:57-62`) |
| A8 принять | `tech-readiness-shifts.spec.ts:177-203` | тоже условно по БД |
| A9 доработать (reopen) | нет | — |
| A10 разрешение пуска (успех) | `commands-contract.test.ts:20-24` | только отказ; путь успеха и влияние на пуск не покрыты |
| B1 `accept-equipment` | `operator-mobile-rules.test.ts:588-624` | покрыто только «чужой экипаж»; проверок допуска/готовности в команде нет вовсе |
| B2 `finish-work` | `shift-close.test.ts:124-148` | — |
| B3 `close-shift` | `shift-close.test.ts:158-197` | — |

E2E: ни один spec не проходит цикл допуска контура готовности
(`request-acceptance`/`start`/`handover`/`accept`); `search_files` по `e2e/` находит
только чтения `/api/readiness/current|history|bootstrap`
(`e2e/inspection-to-flow.spec.ts:31,40`, `e2e/smoke-e2e.spec.ts:28`).

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемое |
|---|----------|-----------|----------|-------------------------|--------------|
| 1 | критично | `src/modules/operator-mobile/application/commands/equipment.ts:76-107`; маршрут `src/app/api/operator/mobile/command/route.ts:218-221` | `acceptEquipment` переводит смену в `STARTED` напрямую (`tx.shift.create`/`update`), не вызывая `getOperatorClearance`, `evaluateAuthoritativeShiftStart`, `assertShiftTransition` | Машинист с просроченным удостоверением/медосмотром или на машине с открытым CRITICAL-дефектом открывает смену с телефона: контур допуска (`commands.ts:179-200`) на этом пути недостижим. Единственная проверка — закрепление бригады (`equipment.ts:34`, `shared.ts:39`) | Вызвать общий допуск и решение о пуске в `acceptEquipment` либо явно зафиксировать, что мобильный пуск — отдельный контур с отдельными правилами |
| 2 | критично | `src/modules/operator-mobile/application/commands/shift-close.ts:86-92`; маршрут `src/app/api/operator/mobile/command/route.ts:249-250` | `closeShift` переводит смену в `CLOSED` напрямую, минуя `HANDOVER_PENDING` и приёмку передачи | Смену закрывает тот же машинист без диспетчера; состояния `HANDOVER_PENDING` и `ShiftHandover=ACCEPTED` в этом пути не появляются. Журнал приёмки неполон, `handover.accepted` не пишется | Оставить закрытие за контуром готовности или явно пометить мобильное закрытие отдельным признаком в аудите |
| 3 | важно | `src/modules/operator-mobile/application/commands/shift-close.ts:23-26`; `scheduler.ts:64` | `finishWork` ставит `HANDOVER_PENDING`, но запись `ShiftHandover` НЕ создаёт | Передача «принимается» только по `id` передачи (`handovers/[id]/accept/route.ts:12`), а передачи нет. Смена в `HANDOVER_PENDING` без передачи не закрывается ни приёмкой, ни автозакрытием (планировщик берёт только `STARTED`) — остаётся закрытие с телефона | Либо создавать передачу в `finishWork`, либо закрывать такие смены в планировщике |
| 4 | важно | `src/app/api/readiness/shifts/[id]/waiver/route.ts:15-26`; UI `src/components/piling/to/readiness/screens/shifts-screen.tsx:41` | Маршрут разрешения пуска не вызывается из интерфейса | При блокировке готовности (422 `SHIFT_START_BLOCKED`, `commands.ts:198`) UI не даёт выдать разрешение: единственный законный выход из отказа недостижим из веб-интерфейса. Блокировка либо стопорит работу, либо толкает на мобильный обход (находка 1) | Подключить кнопку/диалог waiver в панели смены |
| 5 | важно | `src/app/api/readiness/shifts/[id]/cancel/route.ts:11-15`; UI `shifts-screen.tsx:41` | Маршрут отмены смены не вызывается из интерфейса | A6 отмена (`cancelShiftCommand`) доступна только прямым HTTP. В UI «Отказать» — это `decline`, отдельной отмены нет | Подключить или задокументировать как осознанно API-only |
| 6 | важно | `src/modules/readiness/application/shifts/commands.ts:151-207`; `:108-110`; `src/modules/readiness/domain/capability-defaults.ts:82` | `startShiftCommand` не проверяет закрепление установки за актором: `requireOperatorAssignment` вызывается только при создании смены (`commands.ts:108-110`), а `OPERATOR` имеет `readiness.shift.authorize` (`capability-defaults.ts:82`) | ГИПОТЕЗА по воздействию: оператор с правом допуска может отправить `start` по смене на ЧУЖОЙ установке (в `PENDING_ACCEPTANCE`), уведя её из-под другого экипажа. Намеренность не подтверждена: комментария в коде нет | Добавить проверку бригады/закрепления на пуске либо явно зафиксировать замысел |
| 7 | важно | `src/modules/readiness/application/shifts/commands.ts:283-284`; `capability-defaults.ts:82` | `declineShiftCommand` требует `readiness.shift.authorize`, которым обладает OPERATOR | ГИПОТЕЗА: оператор может вернуть в `PLANNED` не свою смену. Комментарий `commands.ts:283` объявляет это «обратной стороной пуска», то есть возможный умысел | Решить, должен ли отказ в допуске быть операторским; иначе отделить право |
| 8 | важно | `src/modules/readiness/application/command-pipeline/execute-command.ts:101-110`; `commands.ts:187-199` | Результат заблокированного пуска (`status:422`) сохраняется идемпотентным конвейером как успешно завершённый | Повтор с тем же `idempotency-key` вернёт закэшированный `422` даже после устранения препятствия (`:93-98`). UI шлёт новый ключ на запрос (`shifts-screen.tsx:140`), поэтому риск низкий, но любой клиент с повторным ключом получит устаревший отказ | Не кэшировать «отрицательные» результаты пуска либо инвалидировать их при поправке |
| 9 | важно | `src/modules/readiness/domain/shifts/transitions.ts:11`; `shift-repository.ts:130` | `HANDOVER_PENDING` не отменяем (в списке `cancel` его нет) при том, что передачи может не быть (находка 3) | Смена в `HANDOVER_PENDING` без записи `ShiftHandover` не отменяется и не принимается — «мёртвая» для контура готовности | Согласовать со сменой 3: либо разрешить отмену из `HANDOVER_PENDING`, либо не допускать состояния без передачи |
| 10 | важно | `src/modules/readiness/application/shifts/commands.ts:281-316` (A5, A6), `:209-226` (A3), `:318-360` (A7), `:390-433` (A8/A9), `:238-279` (A10 успех) | Нет исполнительных тестов большинства переходов (см. раздел «Переходы без теста») | Регресс в правилах перехода (`request`/`decline`/`cancel`/`handover`/`rework`/waiver) не поймает ни один тест; `start`/`accept` покрыты лишь условно по БД (`tech-readiness-shifts.spec.ts:37`) | Добавить по одному тесту на переход в существующие `__tests__` (правило AGENTS §5) |
| 11 | мелочь | `src/modules/readiness/application/shifts/commands.ts:246-271` | `waiveShiftStartCommand` не проверяет состояние смены: разрешение можно выдать смене `CLOSED`/`CANCELLED` | Разрешение на закрытую смену бессмысленно, но не отвергается; мусорная запись `ShiftStartWaiver` | Добавить проверку состояния (например, только `PENDING_ACCEPTANCE`) |
| 12 | мелочь | `src/modules/readiness/application/shifts/start-decision.ts:29-39` | Действие разрешения проверяется по отпечатку условий блокировщиков (`waiver.ts:15-25`), а не по фактам | Разрешение, выданное при неизменном наборе условий, продолжает действовать, хотя факты (моточасы, сроки) могли ухудшиться. Это заявлено комментарием `waiver.ts:6-13` как осознанное | Оставить, но знать при разборе: отпечаток ≠ текущая исправность |
| 13 | мелочь | `src/modules/readiness/application/scheduler.ts:50-64` | Смены `PLANNED`/`PENDING_ACCEPTANCE` не автозакрываются | Комментарий `scheduler.ts:50-52` объявляет это умыслом; отмечаю как поведение, не дефект | Оставить; при желании — отдельное напоминание диспетчеру |
| 14 | мелочь | `src/app/api/readiness/shifts/[id]/request-acceptance/route.ts:12-16` | Тело без `safeParse` (типовое утверждение `expectedVersion`), в отличие от прочих маршрутов смен | Ошибка разбора не даёт внятного 422 по полям; при мусорном теле поведение зависит от `readJsonBody` | Привести к общему виду `schema.safeParse` |
| 15 | мелочь | `src/modules/readiness/application/shifts/commands.ts:404-405` | Самоприёмка передачи разрешена и лишь помечается `selfAccepted` | Умысел (комментарий `handover.ts:26-46`, решение владельца 27.08.2026); отмечаю, что актора-проверяющего в `HANDOVER_PENDING→CLOSED` может не быть вовсе | Оставить; это задокументированное решение |
| 16 | мелочь | `src/modules/readiness/domain/shifts/transitions.ts:66-75` | `transitionShift` переиспользует `rework` для перевода в `STARTED` (не отдельное имя команды смены) | В тесте домена `rework` для смены не значится (проверяется только через передачу), из-за чего переход `HANDOVER_PENDING→STARTED` не читается из таблицы смен | Переименовать/задокументировать команду смены для `reopen` |
| 17 | мелочь | `src/modules/readiness/application/scheduler.ts:39`; `shift-close.ts:200-213` | «Сдача отчёта» имеет два разных автора записи (планировщик от имени SYSTEM и телефон от имени оператора) | Механизм согласован (`autoClosed` в событии, `scheduler.ts:199,235`), но в журнале отчётов следы различаются писателем — важно при разборе | Оставить; отмечено для полноты |

Приложение (не вошло в основные 17, но зафиксировано как наблюдение):
`prisma/schema.prisma:1104` (`closeExceptionReason`) — колонка есть, писателя в коде
не найдено (`search_files` по `closeExceptionReason` в `src/` возвращает только сам
`schema.prisma`); то есть путь «закрыть смену мимо правил» не реализован.

## Что не проверено

1. Живое поведение маршрутов и БД не запускалось: тесты в этом заходе не
   прогонялись, интеграционные спеки требуют `DATABASE_URL_POSTGRES`
   (`tests/integration/tech-readiness-shifts.spec.ts:12,37`) — статус НЕ ПРОВЕРЕНО.
2. Не подтверждено, что `readiness.shift.waive` выдан хоть какой-то роли кроме
   `ADMIN`/`DISPATCHER` в ОПУБЛИКОВАННОЙ матрице организации (`access-matrix-service`):
   проверялась только встроенная матрица по умолчанию (`capability-defaults.ts:64-74`).
   Повлияет на находки 4 и 11 — статус НЕ ПРОВЕРЕНО.
3. Влияние находок 6 и 7 (чужой пуск/отказ) — ГИПОТЕЗА: выведено из отсутствия
   проверки закрепления в команде, не воспроизведено на данных.
4. Не проверялось, вызывает ли замороженный экран оператора (`operator-dashboard.tsx`,
   `operator-v2`) дополнительные команды смены, кроме найденных `request-acceptance`
   и `handovers/:id/accept` — это замороженная зона (AGENTS.md §1), глубоко не
   разбиралась. Итоговый перечень UI-действий может быть неполон для операторских
   экранов, но полон для контура готовности (`shifts-screen.tsx`).
5. Числа «17 находок / 2-9-6» — из моей таблицы выше; прогонов команд, дающих
   метрики покрытия (`npm run test:coverage`), не было — числа тестов не измерялись.
