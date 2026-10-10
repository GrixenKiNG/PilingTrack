# AU6-S2: Переходы смены и готовности по коду

Версия рабочей папки: `git rev-parse HEAD` = `76e90b5c05468a116814bdd2b91ef67e1707183b` (ветка `hermes/q4-0926`).
Только чтение кода. Источник — `src/modules/readiness/**`, `src/app/api/readiness/**`. Отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

## Итог

Аудит независимым проходом по коду дал **0 критично, 5 важно, 6 мелочь** (одна из «важно» — гипотеза о семантике).
Верхние пункты:

1. **важно** — фронтовый DTO передачи объявляет состояние `REWORK_REQUESTED`, сервер шлёт `REWORK_REQUIRED` (`contracts.ts:102` против `types.ts:17`); карта подписей `HANDOVER_STATE_LABEL` построена по DTO, поэтому для реально возвращённой передачи подпись не найдётся.
2. **важно** — выдача разрешения на пуск делает `upsert` единственной строки на смену и не пишет `before` в журнал (`commands.ts:264-271`): повторная выдача молча затирает прежнее основание и автора.
3. **важно** — у `startShiftCommand` нет границы «своя установка» (она есть только у создания смены, `commands.ts:108-110`): оператор с правом `shift.authorize` может запустить чужую смену (гипотеза по влиянию).
4. **важно** — формальный контракт API техготовности (RBAC передачи, `SHIFT_START_BLOCKED`, ETag, идемпотентность) целиком отключён `describe.skip` с заглушкой-харнессом (`tests/contract/tech-readiness-api.spec.ts:49`).
5. **важно/гипотеза** — критерий «Приёмка» (13 баллов) считается как «смена уже запущена» (`readiness-score.ts:81-84`), поэтому не награждает тот предсменный допуск, ради которого назван.

Ключевые таблицы переходов смены и готовности — ниже; отдельным разделом — переходы, разрешённые кодом, но не покрытые выполняемым тестом.

## Методика

- `git rev-parse HEAD`, `git status`.
- Сплошное чтение домена и приложения готовности: `domain/shifts/{transitions,types,handover,waiver,shift}.ts`, `domain/{readiness-score,readiness-rules,access-matrix,capability-defaults}.ts`, `domain/permits/transitions.ts`, `domain/defects/defect.ts`, `application/shifts/{commands,schemas,start-decision}.ts`, `application/{readiness-score,readiness-facts,readiness-rules-service,access-matrix-service,scheduler,capabilities}.ts`, `infrastructure/shifts/{shift-repository,handover-repository}.ts`, `infrastructure/snapshots/snapshot-repository.ts`, `application/projection/{project-event,current-read-model}.ts`.
- Все маршруты `src/app/api/readiness/**` (shifts: create/list/detail/start/request-acceptance/decline/cancel/handover/waiver; handovers: accept/rework; current; _shared/request-context, route-adapter).
- Поиск использования символов перехода: `search_files` по `transitionShift|transitionHandover|assertShiftTransition|assertHandoverTransition|transitionPermit|transitionDefect|requireOperatorAssignment`.
- Покрытие тестами: `search_files` по каталогам `src`, `tests`, `e2e` (команды смен, `PENDING_ACCEPTANCE`, `describe.skip`, `runIf/skipIf`, `OPERATOR_NOT_CLEARED`, `ShiftStartWaiver`), чтение `shifts.test.ts`, `commands-contract.test.ts`, `scheduler.test.ts`, `work-permit.test.ts`, `tests/integration/tech-readiness-shifts.spec.ts`, `tests/contract/tech-readiness-api.spec.ts`, `production-contracts.todo.test.ts`.
- Прогон целевых юнит-тестов (реальные числа):
  `node node_modules/vitest/vitest.mjs run src/modules/readiness/domain/shifts src/modules/readiness/application/shifts src/modules/readiness/application/__tests__/scheduler.test.ts` → **3 файла, 34 теста пройдено, exit 0** (shifts.test.ts, commands-contract.test.ts, scheduler.test.ts).
- Статусы: **ПРОЙДЕНО** — проверено чтением кода в этой сессии; **ГИПОТЕЗА** — логический вывод без прогона; **НЕ ПРОВЕРЕНО** — не подтверждено.

## Таблица A. Состояния и переходы смены (Shift)

Набор допустимых переходов задан в `src/modules/readiness/domain/shifts/transitions.ts:4-15` (`SHIFT_ALLOWED`), проверка — `assertShiftTransition` (`:60-64`). Права — `requireAbility` (`application/shifts/commands.ts:48-52`) по матрице доступа (`domain/capability-defaults.ts:52-135`, значения по умолчанию). Фактическая смена состояния строки выполняется в репозитории (`infrastructure/shifts/shift-repository.ts`), а не значением из `transitionShift`.

| # | Исходное | Действие | Кто может (по умолчанию) | Условия | Новое | Записи/события | Отказы | Тест |
|---|---|---|---|---|---|---|---|---|
| A1 | — (нет) | создать | `readiness.shift.manage`: ADMIN/DISPATCHER/OPERATOR | актор активен; установка активна; OPERATOR — только своя по бригаде (`commands.ts:108-110`); окно валидно (`domain/shifts/shift.ts:3-10`) | PLANNED | строка Shift; аудит `shift.created`; outbox `ReadinessSnapshotRequested` | 403/404/422 | НЕ ПОКРЫТО |
| A2 | PLANNED | изменить | `shift.manage` | state=PLANNED; версия (If-Match/expectedVersion); окно | PLANNED | аудит `shift.updated`; outbox | 409/422 | НЕ ПОКРЫТО (в доменном тесте нет и строки `edit`) |
| A3 | PLANNED | запросить допуск | `shift.manage` | state=PLANNED; версия | PENDING_ACCEPTANCE | аудит `shift.acceptance-requested`; outbox | 409 | только доменный `transitionShift` (`shifts.test.ts:10`) |
| A4 | PENDING_ACCEPTANCE | допустить к работе | `shift.authorize`: ADMIN/DISPATCHER/OPERATOR | state PENDING_ACCEPTANCE; версия; допуск машиниста по документам (`commands.ts:179-190`); `decision.allowed` либо покрывающий waiver (`start-decision.ts:29-39`) | STARTED | аудит `shift.started` / `shift.start-blocked`; снимок `SHIFT_START_DECISION`; `startSnapshotId`; outbox | 409 / 422 `OPERATOR_NOT_CLEARED`, `SHIFT_START_BLOCKED` | ДА — `tests/integration/tech-readiness-shifts.spec.ts:154-175, 205-259` |
| A5 | PENDING_ACCEPTANCE | отказать в допуске | `shift.authorize` | state PENDING_ACCEPTANCE; причина 3..1000; версия | PLANNED | аудит `shift.acceptance-declined`; outbox | 409/422 | НЕ ПОКРЫТО (только доменный `transitionShift`) |
| A6 | PLANNED / PENDING_ACCEPTANCE / STARTED | отменить | `shift.manage` | причина 3..1000; версия | CANCELLED | аудит `shift.cancelled`; outbox | 409/422 | НЕ ПОКРЫТО (только доменный) |
| A7 | STARTED | передать смену | `handover.prepare`: ADMIN/DISPATCHER/OPERATOR/MECHANIC | state STARTED; если OPERATOR — уже сданный Report (`domain/shifts/handover.ts:59-67`); summary 3..4000 | HANDOVER_PENDING | `ShiftHandover=SUBMITTED`; аудит `handover.submitted`/`handover.resubmitted`; outbox | 409/422 | НЕ ПОКРЫТО |
| A8 | HANDOVER_PENDING | принять передачу | `handover.decide`: ADMIN/DISPATCHER/OPERATOR | передача SUBMITTED; версия передачи | CLOSED | `ShiftHandover=ACCEPTED`; аудит `handover.accepted` (+`selfAccepted`); outbox | 409 | ДА — `tests/integration/tech-readiness-shifts.spec.ts:177-203` |
| A9 | HANDOVER_PENDING | вернуть на доработку | `handover.decide` | передача SUBMITTED; причина 3..1000 | STARTED | `ShiftHandover=REWORK_REQUIRED`; аудит `handover.rework-requested` | 409/422 | НЕ ПОКРЫТО |
| A10 | STARTED | авто-закрытие (планировщик) | SYSTEM | конец смены +5 ч прошедших производственных суток (`scheduler.ts:64,92-111`) | CLOSED | `autoClosedAt`; аудит `shift.auto-closed`; Report draft→submitted + `ReportSubmitted{autoClosed:true}` | — | ДА — `application/__tests__/scheduler.test.ts:109-195` |
| A11 | смена не меняется | выдать разрешение на пуск | `shift.waive`: ADMIN/DISPATCHER (оператору не выдаётся) | есть снимок с препятствиями; причина ≥10 (`domain/shifts/waiver.ts:40-47`) | — | `ShiftStartWaiver` upsert; аудит `shift.start-waived` | 409/422 | только отказ (`commands-contract.test.ts:20-24`) |

Под-машина передачи (`ShiftHandover`, `HANDOVER_ALLOWED` — `transitions.ts:17-21`):

| # | Исходное | Действие | Новое | Где | Тест |
|---|---|---|---|---|---|
| H1 | — | создать передачу (внутри `handover`) | SUBMITTED | `handover-repository.ts:19-29` | НЕ ПОКРЫТО |
| H2 | SUBMITTED | принять | ACCEPTED | `handover-repository.ts:56-62` | ДА (integration) |
| H3 | SUBMITTED | вернуть | REWORK_REQUIRED | `handover-repository.ts:64-70` | НЕ ПОКРЫТО |
| H4 | REWORK_REQUIRED | передать повторно | SUBMITTED | `handover-repository.ts:45-54` | НЕ ПОКРЫТО |
| H5 | DRAFT | передать | SUBMITTED | разрешено таблицей, но строку DRAFT никто не создаёт | недостижимо |

## Таблица B. Состояния и переходы контура готовности

1. Вердикт снимка готовности. `ReadinessVerdict` = ALLOWED / CONFIRMATION_REQUIRED / RETURN_TO_OPERATOR / DENIED (`domain/readiness-score.ts:48-52`); считается как наихудший из сработавших активных правил (`:215-218`), `canStart = verdict === 'ALLOWED'` (`:228`). Итог для экрана `ReadinessOutcome` = READY / READY_WITH_WARNING / ATTENTION / BLOCKED (`:82-100`). Нет опубликованных правил → DENIED/BLOCKED с блокером `READINESS_RULES_NOT_PUBLISHED` (`domain/evaluation/evaluator.ts:43-60`). Текущее состояние машины — `CurrentReadiness`, обновляется вверх по времени снимка (`application/projection/current-read-model.ts:13-29`).
2. Набор правил готовности: DRAFT ↔ PUBLISHED → ARCHIVED. Сохранение правит/создаёт DRAFT (`readiness-rules-service.ts:93-143`); публикация переводит DRAFT→PUBLISHED и прежнюю PUBLISHED→ARCHIVED (`:247-250`), а если базы нет — фиксирует baseline из кода (`:231-244`); заказывает пересчёт парка (`:190-210`). Читаются только PUBLISHED/DRAFT (`:77-80`).
3. Матрица доступов: тот же жизненный цикл DRAFT → PUBLISHED → ARCHIVED (`access-matrix-service.ts:194-247`, `domain/access-matrix.ts:26`); действует для проверки прав только PUBLISHED (`:83-97`).
4. Наряд-допуск (`domain/permits/transitions.ts:4-10`): DRAFT →(submit) PENDING_APPROVAL →(approve, полный набор подписей) APPROVED →(revoke) REVOKED / →(expire планировщиком, `scheduler.ts:131-155`) EXPIRED; редактирование из DRAFT/PENDING_APPROVAL/APPROVED возвращает DRAFT (`work-permit-repository.ts:184`). Фактический переход в APPROVED делает репозиторий, не `transitionPermit`.
5. Дефект (`domain/defects/defect.ts:59-68`): OPEN →(TRIAGE) IN_WORK →(RESOLVE) CLOSED; OPEN →(REJECT) REJECTED; CLOSED и REJECTED конечные. Применяется в `application/defects/commands.ts:183,205,223`.

Общий контур записи при любом переходе смены: `effects()` (`application/shifts/commands.ts:68-96`) пишет звено цепочки аудита и outbox `ReadinessSnapshotRequested` (dedupe по `equipmentId+triggerType+triggerId`) в одной транзакции с изменением состояния; идемпотентность — `executeIdempotentCommand` (`command-pipeline/execute-command.ts:55-112`), версия — strong ETag (`command-pipeline/etag.ts:5-24`).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать | Статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/to/readiness/api/contracts.ts:102` против `src/modules/readiness/domain/shifts/types.ts:17` | DTO передачи enum-ом объявляет `REWORK_REQUESTED`, сервер сериализует `REWORK_REQUIRED` (`handover-repository.ts:66`); карта подписей построена по DTO (`readiness-labels.ts:32-37`) | Передача, возвращённая на доработку, приходит со состоянием `REWORK_REQUIRED`, которого нет ни в типе, ни в карте подписей → пустой/неверный статус; типы фронта не отражают реальный ответ API | Привести DTO и карту к `REWORK_REQUIRED` (или явно транслировать) | ПРОЙДЕНО |
| 2 | важно | `src/modules/readiness/application/shifts/commands.ts:264-271` (+ `:272-275`) | Разрешение на пуск сохраняется `upsert`-ом единственной строки на смену (индекс `ShiftStartWaiver_tenantId_shiftId_key`), и событие `shift.start-waived` пишется без `before` | Повторная выдача (новое препятствие/другой диспетчер) молча затирает прежнее основание и автора; в журнале не остаётся, что было выдано раньше — разбор «кто за что отвечал» невозможен | Писать новую запись + событие отзыва; либо передавать `before` в аудит | ПРОЙДЕНО |
| 3 | важно | `src/modules/readiness/application/shifts/commands.ts:151-207` | `startShiftCommand` не проверяет, что смена/установка закреплена за актором: `requireOperatorAssignment` вызывается только при создании (`:108-110`) | Оператор с `readiness.shift.authorize` может запустить смену на чужой установке (смена в PENDING_ACCEPTANCE), уведя её из-под другого экипажа | Добавить проверку закрепления/бригады на пуске либо явно зафиксировать как замысел | ПРОЙДЕНО (влияние — ГИПОТЕЗА) |
| 4 | важно | `tests/contract/tech-readiness-api.spec.ts:49` | Весь контрактный набор `/api/readiness/*` — `describe.skip`, харнесс `api.request/seed/reset` бросает исключение | RBAC передачи, `SHIFT_START_BLOCKED`, ETag/428, идемпотентность-реплей числятся контрактом, но ни разу не выполняются; регресс в переходах пройдёт незамеченным | Точечно включить кейсы (переходы смен/передач) с реальным харнессом | ПРОЙДЕНО |
| 5 | важно | `src/modules/readiness/application/readiness-score.ts:81-84` | Критерий «Приёмка» (`ACCEPTANCE`, вес 13) вычисляется из `shift.startedById != null` | Для смены, ждущей старта, признак всегда `false` → критерий не награждает предсменный допуск; после старта всегда `true`. Балл зависит от того, началась ли смена, а не от решения диспетчера, ради которого критерий назван | Пересмотреть источник признака приёмки или его роль в расчёте | ГИПОТЕЗА |
| 6 | мелочь | `src/modules/readiness/domain/capability-defaults.ts:84-87` | Комментарий у роли OPERATOR утверждает «свою передачу принять нельзя», что противоречит `domain/shifts/handover.ts:47` и `commands.ts:404-405` (самоприёмка разрешена с 27.08.2026) | Разработчик/аудитор читает устаревшее правило и ошибается о поведении приёмки | Обновить комментарий | ПРОЙДЕНО |
| 7 | мелочь | `src/modules/readiness/domain/permits/transitions.ts:40` | `transitionPermit('approve')` возвращает входное состояние, а не `APPROVED`; противоречит контракту в `domain/__tests__/production-contracts.todo.test.ts:108` | Функция в проде не вызывается (grep: только тесты), но при подключении «согласование» не сменит состояние | Вернуть `'APPROVED'` или удалить мёртвую функцию | ПРОЙДЕНО |
| 8 | мелочь | `src/modules/readiness/domain/shifts/transitions.ts:4-15` против `src/modules/readiness/infrastructure/shifts/shift-repository.ts:107-155` | Таблица допустимых состояний и целевое состояние дублированы: доменные `transitionShift`/`transitionHandover` упомянуты только в тестах, реальные строки состояний задаёт SQL репозитория | Две копии машины состояний могут разъехаться; ни один выполняемый тест не связывает их | Оставить один источник цели перехода | ПРОЙДЕНО |
| 9 | мелочь | `src/modules/readiness/domain/shifts/transitions.ts:18` | `HANDOVER_ALLOWED.submit` включает `DRAFT`, но строка `ShiftHandover` в состоянии DRAFT никем не создаётся (единственный `shiftHandover.create` — `handover-repository.ts:19-29`, сразу SUBMITTED) | Недостижимая ветка вводит в заблуждение о жизненном цикле передачи | Убрать DRAFT либо завести черновик явно | ПРОЙДЕНО |
| 10 | мелочь | `src/modules/readiness/application/shifts/commands.ts:406-410` | В `decideHandover` `assertHandoverTransition` вызывается после жёсткой проверки `state !== 'SUBMITTED'`, поэтому для accept/rework она не может сработать | Защита перехода accept/rework фактически держится только на `where`-условии репозитория; проверка создаёт ложное чувство двойной защиты | Убрать избыточную проверку или перенести её раньше | ПРОЙДЕНО |
| 11 | мелочь | `src/modules/readiness/application/shifts/commands.ts:238-271` | Выдача разрешения не проверяет состояние смены (только наличие снимка с препятствиями) | Можно выдать разрешение на CLOSED/CANCELLED смену — «висячая» запись в журнале, к которой не будет применён ни один пуск | Ограничить выдачу состояниями PLANNED/PENDING_ACCEPTANCE | ПРОЙДЕНО |

## Переходы, разрешённые кодом, но не покрытые выполняемым тестом

Проверено поиском по `src`, `tests`, `e2e` и прогоном целевых тестов (34 пройдено). Ни один выполняемый тест не запускает команду перехода целиком (кроме отмеченных). Отдельно: `tests/contract/tech-readiness-api.spec.ts:49` и `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` — `describe.skip`; харнессы-заглушки бросают исключение, то есть эти наборы не выполняют ни одного перехода.

| Переход | Команда | Где | Ближайшее покрытие | Чего не хватает |
|---|---|---|---|---|
| A1 создать PLANNED | `createShiftCommand` | `commands.ts:98-124` | нет | любое исполнение |
| A2 изменить (PLANNED) | `updateShiftCommand` | `commands.ts:126-149` | нет | нет и строки `edit` в доменном тесте |
| A3 PLANNED→PENDING_ACCEPTANCE | `requestShiftAcceptanceCommand` | `commands.ts:209-226` | `request-acceptance/route.ts` (мок команды) | поведение + БД |
| A5 PENDING_ACCEPTANCE→PLANNED | `declineShiftCommand` | `commands.ts:281-301` | нет | любое исполнение |
| A6 →CANCELLED | `cancelShiftCommand` | `commands.ts:303-316` | нет | любое исполнение |
| A7 STARTED→HANDOVER_PENDING | `submitHandoverCommand` | `commands.ts:318-360` | нет | поведение + проверка отчёта OPERATOR |
| A9 HANDOVER_PENDING→STARTED (rework) | `reworkHandoverCommand` | `commands.ts:390-433` | нет | любое исполнение |
| H4 REWORK_REQUIRED→SUBMITTED (resubmit) | там же | `handover-repository.ts:45-54` | нет | любое исполнение |
| A11 разрешение на пуск (успех) | `waiveShiftStartCommand` | `commands.ts:238-279` | `commands-contract.test.ts:20-24` (только отказ) | путь успеха и его влияние на пуск |
| A4 блок по документам машиниста | `OPERATOR_NOT_CLEARED` | `commands.ts:179-190` | нет (строки в тестах нет) | любое исполнение |
| A4 пуск по покрывающему waiver | `evaluateAuthoritativeShiftStart` | `start-decision.ts:29-39` | нет | любое исполнение |
| Публикация правил «baseline» и ARCHIVED | `publishReadinessRules` | `readiness-rules-service.ts:231-250` | `readiness-rules-service.test.ts` (draft→published) | ветки baseline/архива |

Примечание: доменные переходы смены (`transitionShift`, `transitionHandover`) покрыты `domain/shifts/__tests__/shifts.test.ts:9-38`, но это чистая функция без прав, версий, аудита и БД — сам контур перехода (A2-A7, A9) не исполняется.

## Не проверено

- **Поведение на живой БД** для переходов A1, A2, A3, A5, A6, A7, A9, H3, H4 и waiver-пути: интеграционные наборы гейтятся `describe.runIf(Boolean(connectionString))` (`tests/integration/tech-readiness-shifts.spec.ts:37`) и в этой сессии не запускались (БД не поднималась).
- **`e2e/tech-readiness-production.spec.ts`** (сценарий смены/передачи через UI) в этом worktree отсутствует — поиск файла дал 0 (`search_files` по `e2e`); есть ли он на другой ветке — не проверял.
- **Мобильный пуск смены** (`src/modules/operator-mobile/**`, `src/components/piling/operator*/**`) не разбирался: это замороженные области по AGENTS.md; путь пуска вне контура `src/app/api/readiness/**` (и, следовательно, охват `OPERATOR_NOT_CLEARED` / `ShiftStartWaiver`) не сверял.
- **Сколько строк/снимков реально порождает путь A4** и как часто срабатывают отказы в бою — логов и метрик в сессии нет.
- **Пункт 3 (граница «своя установка» на пуске)** — вывод из отсутствия вызова `requireOperatorAssignment` в `startShiftCommand`; намеренность не подтверждена (в коде комментария нет). Помечено ГИПОТЕЗОЙ.
- **Пункт 5 (критерий «Приёмка»)** — семантика выведена из кода; ожидания владельца не проверял.
