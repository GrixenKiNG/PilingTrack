# AU143-S2-HANDOVER-FLOW — Передача смены: цикл от передачи до приёмки

Версия: `git rev-parse HEAD` = **cbfff7baaf69e72496af570c35230ef94fb896a5** (ветка `hermes/q4-0926`).
Только чтение. Код приложения не менялся. Frozen-зоны (варианты операторских экранов, ORION) читались как контекст, но не аудировались как объект правки.

## Итог

Проверено 14 находок: **критично — 0, важно — 4, мелочь — 8, гипотеза — 2**. Полный цикл передачи смены реализован в модуле техготовности (`src/modules/readiness`) и состоит из 4 команд: создать передачу (submit), принять (accept), вернуть на доработку (rework), повторно передать (resubmit). Оптимистичная блокировка — версия записи (`version` + `If-Match`), идемпотентность — заголовок `idempotency-key`, всё в Serializable-транзакции с двумя сериализуемыми повторами (3 попытки).

Топ-5:
1. **важно.** Состояние `HANDOVER_PENDING` имеет ДВА несовместимых смысла, и один из них — тупик: мобильный контур (`finishWork`) переводит смену в `HANDOVER_PENDING` БЕЗ создания записи `ShiftHandover`, а контур готовности требует для передачи `STARTED`, отказ в приёмке/отмену для `HANDOVER_PENDING` не предусматривает, планировщик такое состояние не закрывает. Итог: смену нельзя ни передать, ни принять, ни отменить; установка блокируется (индекс «одна активная смена на установку»).
2. **важно.** Уведомлений о передаче нет ни одного (нет push/Telegram/email): единственное событие в outbox — `ReadinessSnapshotRequested` (пересчёт готовности). Диспетчер узнаёт о передаче, только открыв экран.
3. **важно.** Ни `submitHandoverCommand`, ни `decideHandover` не проверяют принадлежность смены действующему лицу: у роли `OPERATOR` есть `readiness.handover.decide`, то есть любой оператор тенанта может принять/вернуть передачу любой смены, в том числе на чужой установке.
4. **важно.** Комментарий в матрице прав утверждает, что «свою передачу принять нельзя — это проверяет команда», но команда этого НЕ запрещает (решение владельца 27.08.2026). Документация противоречит коду в чувствительном месте (кто проверил).
5. **мелочь.** Состояние `ShiftHandoverState.DRAFT` в коде недостижимо; маршрут `rework` без диагностики конфликта (у `accept` она есть); у `accept` нестандартный rate-limit; мёртвая ссылка на `revokeHandover`.

## Методика

Поиск и чтение (все пути от корня репозитория):
- `rg -l "handover" src` → 37 файлов; `rg "incomingHandover|revokeHandover|submitHandoverCommand|finishWork|closeShift"` по `src`.
- Прочитаны целиком: `src/modules/readiness/domain/shifts/{transitions,handover,types}.ts`, `src/modules/readiness/infrastructure/shifts/{handover-repository,shift-repository}.ts`, `src/modules/readiness/application/shifts/{commands,queries,schemas}.ts`, `src/modules/readiness/application/{operator-shift-query,scheduler,bootstrap-query}.ts`, `src/modules/readiness/domain/capability-defaults.ts`, `src/modules/readiness/infrastructure/tenant-transaction.ts`, `src/modules/readiness/application/command-pipeline/{etag,idempotency}.ts`, роуты `src/app/api/readiness/handovers/**`, `.../shifts/[id]/handover`, `.../shifts/route.ts`, `_shared/{route-adapter,request-context}.ts`, UI `src/components/piling/to/readiness/handover-journal.ts`, `.../screens/shifts-screen.tsx`, `src/components/piling/operator/handover-dialog.tsx`.
- Смежный контур (для описания конца смены): `src/modules/operator-mobile/application/commands/{shift-close,shared}.ts`.
- Схема и миграции: `prisma/schema.prisma` (модель `ShiftHandover`), `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql`.
- Тесты: `src/modules/readiness/domain/shifts/__tests__/shifts.test.ts`, `.../domain/__tests__/production-contracts.todo.test.ts`, `src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts`. `rg` по тестам на `submitHandoverCommand|acceptHandoverCommand|reworkHandoverCommand` — совпадений нет.
- Уведомления: `rg "notification|telegram|notify" src/modules/readiness` и чтение `src/core/notifications/**`, `src/workers/register-readiness-projection.ts`.
- Не читались (запрет задачи): `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy`.

Статусы ниже: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА.

## Цикл передачи смены по коду

Таблица шагов (статус теста в отдельной колонке):

| # | Шаг | Роль (право) | Файл:строка | Состояние до → после | Тест |
|---|-----|--------------|-------------|----------------------|------|
| 1 | Создание смены | OPERATOR/DISPATCHER/ADMIN (`readiness.shift.manage`) | src/modules/readiness/application/shifts/commands.ts:98-124 | (нет) → `Shift.PLANNED` | ПРОЙДЕНО (домен: shifts.test.ts:10) |
| 2 | Запрос допуска | владелец смены (`shift.manage`) | src/modules/readiness/application/shifts/commands.ts:209-226 | `PLANNED` → `PENDING_ACCEPTANCE` | ПРОЙДЕНО (shifts.test.ts:10) |
| 3 | Пуск смены | `readiness.shift.authorize` (+проверка допуска человека и правил готовности) | src/modules/readiness/application/shifts/commands.ts:151-207 | `PENDING_ACCEPTANCE` → `STARTED` | ПРОЙДЕНО (shifts.test.ts:11,36) |
| 4 | Проверка сменного отчёта перед передачей | эффективная роль = `OPERATOR` | src/modules/readiness/domain/shifts/handover.ts:59-67; вызов `commands.ts:326-330` | требует `Report.status='submitted'` по `shiftId` | ПРОЙДЕНО (shifts.test.ts:57-62) |
| 5 | **Передача (submit)** | `readiness.handover.prepare` (OPERATOR, MECHANIC) | src/modules/readiness/application/shifts/commands.ts:318-360 | `Shift: STARTED` → `HANDOVER_PENDING`; `ShiftHandover: (нет)` → `SUBMITTED` | ПРОЙДЕНО (домен: shifts.test.ts:24) |
| 5a | Повторная передача после возврата | `readiness.handover.prepare` | commands.ts:343-350; handover-repository.ts:45-54 | `ShiftHandover: REWORK_REQUIRED` → `SUBMITTED` (та же строка, version++) | ПРОЙДЕНО (домен: shifts.test.ts:25) |
| 6 | **Приёмка (accept)** | `readiness.handover.decide` (DISPATCHER, ADMIN, OPERATOR) | src/modules/readiness/application/shifts/commands.ts:390-428 | `ShiftHandover: SUBMITTED` → `ACCEPTED`; `Shift: HANDOVER_PENDING` → `CLOSED` | ПРОЙДЕНО (домен: shifts.test.ts:26) |
| 7 | **Возврат на доработку (rework)** | `readiness.handover.decide` | commands.ts:390-428; reason: handover.ts:18-24 | `ShiftHandover: SUBMITTED` → `REWORK_REQUIRED`; `Shift: HANDOVER_PENDING` → `STARTED` | ПРОЙДЕНО (домен: shifts.test.ts:27,33) |
| 8 | Просмотр передачи по id | `readiness.read` | src/app/api/readiness/handovers/[id]/route.ts:11-15; queries.ts:14 | чтение (ETag `handover-<id>-v<version>`) | ПРОЙДЕНО (routes-read-capability.test.ts:108-109) |
| 9 | Журнал передачи в UI | экран диспетчера | src/components/piling/to/readiness/handover-journal.ts:54-93 | строит события по `submittedAt/reworkedAt/acceptedAt` | ПРОЙДЕНО (гипотеза покрытия: только домен) |
| 10 | Автозакрытие брошенной смены | SYSTEM (планировщик) | src/modules/readiness/application/scheduler.ts:161-193 | `STARTED` → `CLOSED` (`autoClosedAt`); `HANDOVER_PENDING` НЕ закрывает | НЕ ПРОВЕРЕНО (интеграционного теста не найдено) |
| 11 | Конец смены мобильным контуром | OPERATOR (`operator-mobile`) | src/modules/operator-mobile/application/commands/shift-close.ts:16-29,41-96 | `finishWork`: `STARTED` → `HANDOVER_PENDING` (БЕЗ передачи); `closeShift`: → `CLOSED` | ПРОЙДЕНО (shift-close.test.ts:124-157) |

### Что в пакете передачи
`submitHandoverSchema` (src/modules/readiness/application/shifts/schemas.ts:21-25): `summary` (3…4000 символов) и опциональный `evidence` (свободный JSON). В `submitHandoverCommand` к `evidence` добавляются вычисленные `stateChanges` — ухудшения между предсменным и послесменным осмотрами (commands.ts:334-339, сбор — 362-388). Сохранение: `ShiftHandover.summary`, `.evidence`, `submittedById/submittedAt` (handover-repository.ts:19-29; схема prisma/schema.prisma:1160-1186, `evidence` по умолчанию `"{}"`).

### Кто видит
- Чтение любой передачи и списка смен — право `readiness.read` (GET handovers/[id]/route.ts:11; shifts/route.ts:21). Список смен включает все передачи смены (`include handovers`, shift-repository.ts:6,81), поэтому summary/evidence доступны любому с `readiness.read`.
- Приёмка/возврат — `readiness.handover.decide` (DISPATCHER/ADMIN/OPERATOR), src/modules/readiness/domain/capability-defaults.ts:65-94.
- Подготовка/передача — `readiness.handover.prepare` (OPERATOR/MECHANIC), capability-defaults.ts:83,111.

### Что при отказе (rework)
Причина обязательна (3…1000 символов, handover.ts:18-24); пишется в `ShiftHandover.reworkReason/reworkedById/reworkedAt` (handover-repository.ts:64-70) и видна оператору в журнале (handover-journal.ts:86, shifts-screen.tsx:300-311). Смена возвращается в `STARTED`, тот же человек передаёт заново той же строкой (handover-repository.ts:40-54).

### Уведомления
Единственное событие, порождаемое командами передачи, — `ReadinessSnapshotRequested` для пересчёта готовности (commands.ts:88-95, потребитель src/workers/register-readiness-projection.ts:29). Уведомлений о передаче/приёмке/возврате нет (см. находку №2).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка |
|---|----------|-----------|----------|-------------------------|---------------------|
| 1 | важно | src/modules/operator-mobile/application/commands/shift-close.ts:23-26 | `finishWork` переводит смену в `HANDOVER_PENDING` без записи `ShiftHandover` | Два смысла одного состояния. Контур готовности (`SHIFT_ALLOWED.handover` требует `STARTED`, src/modules/readiness/domain/shifts/transitions.ts:12) такую смену передать НЕ даст (409); принять нечего (нет строки `ShiftHandover` → кнопки в панели «Передача смены» disabled, src/components/piling/to/readiness/screens/shifts-screen.tsx:243,248); отменить нельзя — `cancel` исключает `HANDOVER_PENDING` (transitions.ts:11; shift-repository.ts:129-131); планировщик не автозакрывает (`UNFINISHED_SHIFT_STATES=['STARTED']`, scheduler.ts:64,161-163). Установка заблокирована индексом `Shift_one_active_per_equipment_key … IN ('STARTED','HANDOVER_PENDING')` (prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41). Достаточно оператору нажать «Завершить работу» и не закрыть смену | Развести состояния: либо отдельное `WORK_FINISHED` для мобильного `finishWork`, либо создавать полноценную `ShiftHandover(SUBMITTED)` в `finishWork`/`closeShift`; как минимум — разрешить диспетчеру `cancel` из `HANDOVER_PENDING` |
| 2 | важно | src/modules/readiness/application/shifts/commands.ts:88-95 | Нет уведомления о передаче/приёмке/возврате | В outbox уходит только `ReadinessSnapshotRequested` (пересчёт готовности). Уведомления о дефектах есть (`enqueueCriticalDefects`, src/modules/readiness/application/defects/commands.ts:1), для передачи — нет ни в readiness-модуле, ни в `src/services` (`rg "handover" src/services` — 0). Диспетчер видит передачу, только открыв экран «Смены» | Добавить `enqueueAlert`/`NotificationDeliveryRequested` на `handover.submitted` (диспетчеру) и `handover.rework-requested` (оператору) |
| 3 | важно | src/modules/readiness/application/shifts/commands.ts:318-320,390-392 | Нет проверки принадлежности смены действующему лицу | `submitHandoverCommand`/`decideHandover` проверяют только право, не закрепление/владение. У `OPERATOR` есть `readiness.handover.decide` (capability-defaults.ts:87), поэтому любой оператор тенанта может принять или вернуть передачу любой смены, в т.ч. на чужой установке. Для сравнения: команды мобильного контура проверяют бригаду (`requireCrew`, src/modules/operator-mobile/application/commands/shared.ts:31-41) | Для `decide`/`submit` добавить проверку: принимающий — оператор активного экипажа этой установки либо привилегированная роль; для одиночной смены — разрешить самоприёмку явно |
| 4 | важно | src/modules/readiness/domain/capability-defaults.ts:84-86 | Комментарий противоречит коду | Текст: «Свою собственную передачу принять нельзя — это проверяет команда, а не список прав», но команда самоприёмку РАЗРЕШАЕТ (решение владельца 27.08.2026, src/modules/readiness/domain/shifts/handover.ts:26-49; признак `selfAccepted` считается в commands.ts:404-405). Вводящий в заблуждение комментарий в вопросе «кто проверил» | Привести комментарий в соответствие (самоприёмка разрешена и помечается признаком) |
| 5 | мелочь | src/modules/readiness/infrastructure/shifts/handover-repository.ts:22-24 | Состояние `DRAFT` недостижимо | `createSubmitted` всегда создаёт `SUBMITTED`; `resubmit` — только из `REWORK_REQUIRED` (handover-repository.ts:45-54). Переход `submit` из `DRAFT` (transitions.ts:18) и текст «черновик» (transitions.ts:48) не вызываются нигде. Схема `@default(DRAFT)` (prisma/schema.prisma:1164) — мёртвая ветка | Либо удалить `DRAFT` из enum (миграция), либо завести черновик явной командой; сейчас — только пометить |
| 6 | мелочь | src/app/api/readiness/handovers/[id]/rework/route.ts:11-12 | У `rework` нет диагностики сериализационного конфликта | У `accept` передан `resolveConflictDetails` (src/app/api/readiness/handovers/[id]/accept/route.ts:14-18), у `rework` — нет. На исчерпании 3 попыток (tenant-transaction.ts:101-114) клиент не получит `current` для повторного `If-Match` | Добавить `resolveConflictDetails` и в маршрут `rework` |
| 7 | мелочь | src/app/api/readiness/handovers/[id]/accept/route.ts:21 | Нестандартный rate-limit | `accept` задан `{maxAttempts:20, windowMs:60000}`; `rework`/`submit` используют умолчание `withMutation` (100/мин) | Унифицировать лимиты приёмки/возврата |
| 8 | мелочь | src/modules/readiness/domain/shifts/handover.ts:12-14 | Мёртвая ссылка на `revokeHandover` | Комментарий ссылается на вызывающего `revokeHandover`, которого в коде нет (`rg "revokeHandover"` — только этот комментарий). Читатель ищет несуществующую функцию | Убрать/переформулировать ссылку |
| 9 | гипотеза | src/modules/readiness/infrastructure/shifts/handover-repository.ts:45-54 | При повторной передаче `evidence` перезаписывается | `resubmit` кладёт новый `evidence` (commands.ts:336-350 пересобирает его), прежний пакет доказательств теряется, сохраняется только `summary`. `reworkReason/reworkedAt/reworkedById` при этом НЕ очищаются и остаются на строке `SUBMITTED` | Если нужна история доказательств — хранить в отдельной таблице версий пакета; иначе подтвердить намеренность в комментарии |
| 10 | мелочь | src/modules/readiness/domain/shifts/__tests__/shifts.test.ts:23-31 | Команды передачи покрыты только на уровне домена | Тесты есть у чистых функций переходов/валидаторов, но `submitHandoverCommand`/`acceptHandoverCommand`/`reworkHandoverCommand` (`rg` по тестам — 0 совпадений) не покрыты. Риск регрессий в guard-порядке (проверка отчёта, самоприёмка, порядок «handover-запись ↔ смена») не поймать | Добавить точечный интеграционный тест на submit/accept/rework (репозитории + команда) |
| 11 | гипотеза | src/app/api/readiness/shifts/route.ts:35 | Любой с `readiness.read` читает все передачи тенанта | Список смен отдаёт `include handovers` (shift-repository.ts:6,81), включая `summary` и `evidence` всех смен. В однопользовательском тенанте — ожидаемо; для OPERATOR/ASSISTANT это доступ к чужим пакетам передачи | Ограничить выборку передач в списке смен ролью/закреплением |
| 12 | мелочь | src/modules/readiness/application/shifts/commands.ts:404-405 | Признак `selfAccepted` попадает только в аудит-«после» | `selfAccepted` добавляется к `after` события приёмки, но в журнал UI приходит через пересчёт `submittedById===acceptedById` (handover-journal.ts:87-88), а не из сохранённого поля. В строке `ShiftHandover` отдельного признака нет — при смене `acceptedById` история не переигрывается (данные не меняются, так что риск низкий) | Оставить; при желании — денормализовать признак в БД |
| 13 | мелочь | src/modules/readiness/domain/shifts/types.ts:17 | `ShiftHandoverState` включает 4 значения, живых 3 | Согласуется с находкой №5; отметить как часть той же темы | — |
| 14 | мелочь | src/modules/readiness/application/shifts/commands.ts:325 | Передача требует `STARTED`, но пользователь может уже быть в `HANDOVER_PENDING` (см. №1) | Сообщение об ошибке при этом корректное («Смена передана диспетчеру — действие «передать» сейчас недоступно»), но путь восстановления из UI отсутствует | См. №1 |

## Не проверено

- **Интеграционные тесты команд передачи** (`submitHandoverCommand`/`acceptHandoverCommand`/`reworkHandoverCommand`) — НЕ ПРОВЕРЕНО: файлов с их вызовом в `*.test.*` не найдено (`rg` пуст). Доменные переходы покрыты (`shifts.test.ts:23-38`).
- **e2e (Playwright)** — НЕ ПРОВЕРЕНО: `rg "handover|Переда|приёмк" e2e` дал 0 точных совпадений. Наличие сценария передачи в e2e не подтверждено.
- **Планировщик на реальных данных** — НЕ ПРОВЕРЕНО: автозакрытие читалось по коду (`scheduler.ts`), прогон `runReadinessScheduler` на БД не выполнялся (task read-only, БД не трогал).
- **Работоспособность `finishWork`+`closeShift` на живой установке** (находка №1) — ГИПОТЕЗА по коду: сценарий «finish-work без последующего close-shift» выведен из чтения команд, не воспроизводился.
- **RLS/права на уровне БД для `ShiftHandover`** — НЕ ПРОВЕРЕНО: политики FORCE RLS читались косвенно через `withReadiness…Transaction`; прямой список таблиц под RLS не сверял.
- **`getOperatorClearance` при пуске** — вне темы передачи, не аудировалось.
- Frozen-зоны (`src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, `src/components/piling/operator-v2/**`) читались как контекст (кто вызывает `finishWork`/`close-shift`), их правка не предлагается — решение по вариантам за владельцем.
- Существующие отчёты `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` не читались по условию задачи.
