# AU224-S2 — Передача смены: кто может передать и принять, что видит каждая роль

Версия репозитория: `git rev-parse HEAD` = **586d1458ea6bd15a8310faf973f9221b1763de41**
(branch `hermes/q4-0926`, worktree `D:/PillingR/wt-night`).
Только чтение: код приложения не изменялся; создан один файл — этот отчёт.
Пути указаны от корня репозитория. Замороженные области (`src/app/operator/**`,
`src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) **читались**
(тема задачи прямо их называет), но не менялись.

## Итог

- Найдено 13 расхождений: **критично — 0**, **важно — 8**, **мелочь — 5**.
  Критичных нет: ни одна находка не выходит за границы организации (prod — один
  тенант, `orion`), и прав доступа мимо матрицы не найдено.
- Самое важное (№1): **приёмка и возврат передачи не проверяют, что принимающий
  закреплён за этой установкой.** Право `readiness.handover.decide` есть у
  OPERATOR, поэтому любой машинист организации может принять (и тем самым
  закрыть) передачу чужой бригады — проверка `requireOperatorAssignment`
  вызывается только при создании смены.
- №2: **оператору, чью передачу вернули на доработку, причина возврата не видна
  нигде.** `getOperatorShiftFacts` отдаёт только передачи в состоянии
  `SUBMITTED`; поля с причиной нет ни в типе фактов, ни на экранах оператора.
  Причина живёт только в журнале диспетчера.
- №3: состояние `HANDOVER_PENDING` означает в двух контурах разное, и мобильный
  контур переводит в него смену **без записи `ShiftHandover`**: диспетчер видит
  карточку «ждёт приёмки» с отключёнными кнопками, а принять нечего.
- №4: такую же смену нельзя ни автозакрыть (планировщик намеренно обходит
  `HANDOVER_PENDING`), ни отменить — она блокирует открытие новой на этой машине.
- №5: кнопки «Допустить/Отказать» на экране «Смены» проверяют право
  `decideHandover`, а сервер требует `shift.authorize`; в контракте `bootstrap`
  права `shift.authorize` вообще нет.
- Проверено командой: 11 файлов / **75 тестов пройдено, 0 пропущено**
  (`node node_modules/vitest/vitest.mjs run …`, exit 0, см. «Методика»).
  RBAC-контракт передачи смены при этом **отключён** (`describe.skip`).

## Методика

Что искалось и чем — чтобы проверку можно было повторить.

1. `rg -n -i "handover|shift|смен" src` + `find src -iname '*shift*' -o -iname '*handover*'`
   — карта файлов темы. Ядро: `src/modules/readiness/**` (домен и команды смен),
   `src/app/api/readiness/**` (маршруты), `src/modules/operator-mobile/**`
   (второй, мобильный контур смены), UI `src/components/piling/to/readiness/**`.
2. Права: `src/modules/readiness/domain/capability-defaults.ts` (значения по
   умолчанию роль → право), `domain/access-matrix.ts` (публикуемая матрица),
   `application/capabilities.ts` (расчёт с учётом «Действую как»),
   `_shared/request-context.ts` (что попадает в команды).
3. Команды и состояния: `application/shifts/{commands,schemas}.ts`,
   `domain/shifts/{handover,shift,transitions,types}.ts`,
   `infrastructure/shifts/{shift,handover}-repository.ts`.
4. Чтение: `application/shifts/queries.ts`, `application/operator-shift-query.ts`,
   `infrastructure/shifts/shift-repository.ts` (`list`).
5. Второй контур: `src/modules/operator-mobile/application/commands/shift-close.ts`,
   `application/mobile-shift-query.ts`, `domain/shift-phases.ts`,
   `src/app/api/operator/mobile/{state,command}/route.ts`.
6. Индексы и ограничения БД:
   `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql`,
   `prisma/migrations/20260809120000_shift_pre_start_acceptance/migration.sql`,
   `prisma/schema.prisma` (проверялось, что частичные индексы в схеме отсутствуют).
7. Тесты: `rg -ln "handover|accept|rework" -g '*.test.*' -g '*.spec.*'`;
   прочитаны `domain/shifts/__tests__/shifts.test.ts`,
   `application/shifts/__tests__/commands-contract.test.ts`,
   `app/api/readiness/_shared/__tests__/routes-read-capability.test.ts`,
   `app/api/readiness/shifts/__tests__/route.test.ts`,
   `app/api/readiness/shifts/[id]/request-acceptance/__tests__/route.test.ts`,
   `application/__tests__/scheduler.test.ts`, `tests/contract/tech-readiness-api.spec.ts`,
   `tests/integration/tech-readiness-shifts.spec.ts`,
   `tests/integration/disposable-idor.spec.ts`.
8. Команда прогона (числа ниже — её вывод, не пересказ):
   `node node_modules/vitest/vitest.mjs run src/modules/readiness/domain/shifts src/modules/readiness/application/shifts src/modules/readiness/application/__tests__/operator-shift-query.test.ts src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts src/modules/operator-mobile/application/mobile-shift-query.test.ts src/app/api/readiness`
   → `Test Files 11 passed (11)`, `Tests 75 passed (75)`, start 04:36:20, exit 0.
   (`.env` vitest не читает — интеграционные спеки с БД в этот прогон не входят.)
9. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не
   открывались.

Легенда статусов: **ПРОЙДЕНО** — проверено исполняемым тестом; **НЕ ПРОВЕРЕНО** —
кода/теста нет; **ГИПОТЕЗА** — вывод из чтения кода, исполнением не подтверждён.

## Кто что может: шаг | файл:строка | роль | тест

Роли по матрице по умолчанию (`src/modules/readiness/domain/capability-defaults.ts`;
её можно изменить публикацией — `src/modules/readiness/domain/access-matrix.ts:47`).
`Мастер` и `Инженер ОТ` пользователей не имеют (решение владельца, AGENTS §4),
но права в матрице есть.

| Шаг | Файл:строка | Роль, которой разрешено | Тест / статус |
|---|---|---|---|
| Создать смену | `src/modules/readiness/application/shifts/commands.ts:98-110` | `readiness.shift.manage`: OPERATOR, ADMIN (MECHANIC/DISPATCHER/FOREMAN/SAFETY_ENGINEER — нет). Оператор — только на свою машину, `requireOperatorAssignment` | НЕ ПРОВЕРЕНО (теста на закрепление при создании нет) |
| Запросить допуск | `src/modules/readiness/application/shifts/commands.ts:209-219` | `readiness.shift.manage`: OPERATOR, ADMIN | ПРОЙДЕНО только валидация тела — `src/app/api/readiness/shifts/[id]/request-acceptance/__tests__/route.test.ts:68-84` |
| Допустить к пуску (start) | `src/modules/readiness/application/shifts/commands.ts:151-207` | `readiness.shift.authorize`: OPERATOR, DISPATCHER, ADMIN | ПРОЙДЕНО — `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts:13-16` (MECHANIC → 403), `:26-33` (ETag) |
| Отказать в допуске (decline) | `src/modules/readiness/application/shifts/commands.ts:281-292` | `readiness.shift.authorize`: OPERATOR, DISPATCHER, ADMIN | НЕ ПРОВЕРЕНО |
| Письменное разрешение заблокированного пуска (waive) | `src/modules/readiness/application/shifts/commands.ts:238-240` | `readiness.shift.waive`: DISPATCHER, ADMIN (оператору намеренно не выдано) | ПРОЙДЕНО — `commands-contract.test.ts:20-24` (OPERATOR → 403) |
| **Передать смену** (submit handover) | `src/modules/readiness/application/shifts/commands.ts:318-360` | `readiness.handover.prepare`: OPERATOR, MECHANIC, ADMIN | НЕ ПРОВЕРЕНО — контракт отключён: `tests/contract/tech-readiness-api.spec.ts:49` (`describe.skip`) |
| **Принять передачу** (accept) | `src/modules/readiness/application/shifts/commands.ts:390-431` | `readiness.handover.decide`: OPERATOR, DISPATCHER, ADMIN | НЕ ПРОВЕРЕНО в обычном прогоне — единственный тест требует БД (`tests/integration/tech-readiness-shifts.spec.ts:177`, `describe.runIf(Boolean(connectionString))`) |
| **Вернуть на доработку** (rework) | `src/modules/readiness/application/shifts/commands.ts:432` → `:390-428` | `readiness.handover.decide`: OPERATOR, DISPATCHER, ADMIN | ПРОЙДЕНО только домен причины — `src/modules/readiness/domain/shifts/__tests__/shifts.test.ts:84` |
| Самоприёмка (тот же человек сдал и принял) | `src/modules/readiness/domain/shifts/handover.ts:47-49` | разрешена всем, у кого `handover.decide` (решение владельца 27.08.2026) | ПРОЙДЕНО — `shifts.test.ts:50-53` |
| Требование сданного сменного отчёта перед передачей | `src/modules/readiness/domain/shifts/handover.ts:59-67` | адресно OPERATOR; MECHANIC/ADMIN — не требуется | ПРОЙДЕНО — `shifts.test.ts:57-62` |
| Передача у механика (возврат техники после ремонта) | `src/modules/readiness/domain/capability-defaults.ts:107-118` | MECHANIC: `readiness.handover.prepare`, без `handover.decide` — принять не может | НЕ ПРОВЕРЕНО |
| Приёмка техники машинистом (мобильный контур, `accept-equipment`) | `src/modules/operator-mobile/application/commands/equipment.ts:22-34` | только `user.role === 'OPERATOR'` и своя бригада (`requireCrew`) | НЕ ПРОВЕРЕНО |
| «Работа завершена» (мобильный, `finish-work`) | `src/modules/operator-mobile/application/commands/shift-close.ts:16-29` | OPERATOR — требует бригаду, но **не создаёт передачу** | НЕ ПРОВЕРЕНО |
| Закрытие смены (мобильный, `close-shift`) | `src/modules/operator-mobile/application/commands/shift-close.ts:41-96` | OPERATOR — требует ЕО после работы | НЕ ПРОВЕРЕНО |
| Автозакрытие забытой смены | `src/modules/readiness/application/scheduler.ts:113-193` | SYSTEM (актор `{id:null, role:'SYSTEM'}`, `:39`) | ПРОЙДЕНО — `src/modules/readiness/application/__tests__/scheduler.test.ts:118-243`, в т.ч. `:229` «трогает только идущие смены — ни план, ни ждущую приёмки» |

## Находки

Легенда severity: критично / важно / мелочь. Все находки — внутри одной
организации (prod: один тенант), поэтому «насколько важно» — оценка риска
для данных и хода работ, а не утечки между организациями.

| # | Severity | path:line | Проблема | Сценарий / почему это важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/readiness/application/shifts/commands.ts:390-392` | `decideHandover` (приёмка и возврат) проверяет только право `readiness.handover.decide`; проверки, что принимающий закреплён за этой установкой, нет. Та же дыра у передачи — `commands.ts:318-320` | OPERATOR имеет `handover.decide` (`capability-defaults.ts:87`), видит все смены (находка 6) и знает `handover.id`. Он может принять — то есть **закрыть** — передачу чужой бригады и подписать её своим именем. Механизм защиты существует, но вызывается только при создании смены: `requireOperatorAssignment` (`infrastructure/shifts/shift-repository.ts:35-39`) из `commands.ts:108-110` | Вызвать `requireOperatorAssignment(actorId, shift.equipmentId)` в `decideHandover` и `submitHandoverCommand` для исполняемой роли OPERATOR (по образцу `createShiftCommand`) |
| 2 | важно | `src/modules/readiness/application/operator-shift-query.ts:241-253` (и тип `:18-123`) | Оператор видит только передачу в состоянии `SUBMITTED`. Передача, возвращённая на доработку, исчезает с его экрана вместе с причиной: поля `reworkReason` в `OperatorShiftFacts` нет вовсе | Диспетчер жмёт «На доработку» (`commands.ts:415-416`), смена откатывается в `STARTED` (`:419`), а оператор не узнаёт ни что передачу вернули, ни что исправить. Причина есть только в журнале диспетчера (`src/components/piling/to/readiness/handover-journal.ts:86`) — то есть у того, кто её и написал. Итог: возврат на доработку превращается в молчаливый откат | Добавить в факты оператора «живую» передачу в состоянии `REWORK_REQUIRED` (`findLive` уже это умеет — `infrastructure/shifts/handover-repository.ts:35-38`) вместе с `reworkReason` и показать её на экране |
| 3 | важно | `src/modules/operator-mobile/application/commands/shift-close.ts:16-29` против `src/modules/readiness/domain/shifts/transitions.ts:31` | Одно состояние `HANDOVER_PENDING` в двух контурах означает разное. В контуре готовности это «передана диспетчеру, ждёт приёмки» (`transitions.ts:31`, текст «передана диспетчеру» — `:50`). Мобильная команда `finishWork` ставит его же **без создания `ShiftHandover`** | На экране «Смены» такая смена попадает в блок «Передача смены» со счётчиком «N действий» (`src/components/piling/to/readiness/screens/shifts-screen.tsx:60,237`), но `handover` не находится, и обе кнопки отключены (`shifts-screen.tsx:243,248`). Диспетчер получает «действие», которого нельзя выполнить; экран центра готовности считает машину ожидающей приёмки тем же признаком (`src/components/piling/to/readiness/screens/readiness-centre.tsx:645-647`) | Либо в мобильном контуре не занимать `HANDOVER_PENDING` до закрытия, либо развести смыслы разными состояниями/признаком «есть ли строка передачи», и считать «ждёт приёмки» по наличию `ShiftHandover.state='SUBMITTED'`, а не по состоянию смены |
| 4 | важно | `src/modules/readiness/application/scheduler.ts:64` (+ `:161-193`), `src/modules/readiness/domain/shifts/transitions.ts:11`, `src/modules/readiness/infrastructure/shifts/shift-repository.ts:128-134` | Смену в `HANDOVER_PENDING` нельзя закрыть автоматически и нельзя отменить: планировщик намеренно обходит это состояние (`UNFINISHED_SHIFT_STATES = ['STARTED']`), а `cancel` разрешён только из `PLANNED/PENDING_ACCEPTANCE/STARTED` | Мобильный оператор нажал «Работа завершена», но ЕО после работы не сдал — смена висит в `HANDOVER_PENDING`. Такую смену закрыть может только этот же оператор (`closeShift`, `shift-close.ts:41-96`); если бригаду переназначили, `requireCrew` (`application/commands/shared.ts:31-41`) отдаёт 403 — смену не закроет никто. Частичный уникальный индекс `Shift_one_active_per_equipment_key` включает `HANDOVER_PENDING` (`prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41`), поэтому машина заперта для новой смены. Исключение состояния из автозакрытия закреплено тестом `application/__tests__/scheduler.test.ts:229` как осознанное | Оставить в планировщике узкое исключение: автозакрывать `HANDOVER_PENDING` только если живой передачи нет (или старше N часов), либо добавить путь принудительного закрытия/отмены для диспетчера |
| 5 | важно | `src/components/piling/to/readiness/screens/shifts-screen.tsx:213` и `:234` против `src/modules/readiness/application/shifts/commands.ts:161` и `:284`; `src/components/piling/to/readiness/api/contracts.ts:77-81` | Кнопки «Допустить»/«Отказать» показываются по праву `entities.shift.decideHandover`, а команды на сервере требуют `readiness.shift.authorize`. В контракте `bootstrap` права `shift.authorize`/`shift.waive` нет вообще | Права отделены намеренно 20.08.2026 (`capability-defaults.ts:16-20`), и матрицу публикуют на ходу (`access-matrix.ts:47-53`). Организация, выдавшая роли `decideHandover` без `shift.authorize`, получит кнопку, которая гарантированно отвечает 403 — ровно тот разрыв «экран разрешает, сервер отказывает», который в этом модуле уже ловили (`application/capabilities.ts:44-52`) | Прокинуть `shift.authorize` в `capabilities.entities.shift` (сервер `bootstrap-query.ts:262-266`, клиент `contracts.ts:77-81`) и гейтить кнопки пуска/отказа им, а `decideHandover` — только приёмкой передачи |
| 6 | важно | `src/app/api/readiness/shifts/route.ts:21-22`, `src/modules/readiness/infrastructure/shifts/shift-repository.ts:72-85`, `src/app/api/readiness/handovers/[id]/route.ts:11-14` | Чтение смен и передач защищено единственным правом `readiness.read` и не фильтруется ни по роли, ни по бригаде: `list` отбирает по `tenantId` + фильтрам запроса. `readiness.read` есть у OPERATOR, MECHANIC, FOREMAN, SAFETY_ENGINEER, DISPATCHER, ADMIN | Любой машинист (и мастер, и инженер ОТ) получает список всех смен организации вместе с телом передач — `serializeShift` отдаёт `handovers` целиком, включая `evidence` (`application/shifts/commands.ts:39-46`, `:34-38`), а по `GET /api/readiness/handovers/:id` — любую передачу по идентификатору. Внутри одного тенанта это доступ к сведениям чужих бригад, а не к своим | Ограничить выборку для неплатформенных ролей закреплением (`crew.operatorId = actorId` / бригада), как это уже сделано для экрана оператора в `application/operator-shift-query.ts:177-189` |
| 7 | важно | `src/modules/readiness/application/shifts/commands.ts:108-110` против `:128` (update), `:161` (start), `:211` (request-acceptance), `:305` (cancel) | Граница «оператор — только своя установка» стоит лишь в `createShiftCommand`. Остальные команды над сменой проверяют только `readiness.shift.manage`/`shift.authorize` | OPERATOR имеет и `shift.manage`, и `shift.authorize` (`capability-defaults.ts:77,82`), поэтому по идентификатору смены может перевести чужую смену из `PLANNED` в `PENDING_ACCEPTANCE`, запустить чужую смену из `PENDING_ACCEPTANCE` или отменить чужую (вплоть до `STARTED`) — `shift-repository.ts:120-134`, `:107-117` | Вынести проверку закрепления из команды создания в общий страж команд над сменой для исполняемой роли OPERATOR |
| 8 | важно | `tests/contract/tech-readiness-api.spec.ts:49` (и ожидания `:122-127`) | Контракт-тест RBAC передачи смены **отключён** (`describe.skip`, а `api.request` вообще заглушка, `:32-42`). Его ожидания при этом противоречат коду: там `POST /api/readiness/shifts/:id/handover` даёт MECHANIC 200 и OPERATOR 403, тогда как по матрице `readiness.handover.prepare` есть у обоих (`capability-defaults.ts:83,111`) | «Кто может передать смену» не закреплено ни одним исполняемым тестом: единственная проверка прав на этот маршрут — отключённая. Правку матрицы или случайное снятие права ничто не поймает (`pilingtrack-testing-and-evidence`, §3.2/§4) | Либо оживить спеку на живом стенде, либо перенести матрицу «маршрут → право» в исполняемый unit-тест уровня команд (как `commands-contract.test.ts`) |
| 9 | мелочь | `src/components/piling/to/readiness/api/contracts.ts:102`, `src/components/piling/to/readiness/readiness-labels.ts:36` против `src/modules/readiness/domain/shifts/types.ts:17` | DTO клиента объявляет состояние `REWORK_REQUESTED`; сервер такое состояние не отдаёт никогда — домен и БД знают `REWORK_REQUIRED` (`types.ts:17`, `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:3`) | Ответ смены не валидируется, а просто кастится (`api/client.ts:168-172`), поэтому расхождение молчит: подпись/подсветка для возвращённой передачи никогда не совпадёт. `HANDOVER_STATE_LABEL` (`readiness-labels.ts:32-37`) не используется ни в одном компоненте — то есть ошибка ждёт первого потребителя | Привести DTO и подписи к `REWORK_REQUIRED` (или удалить неиспользуемый словарь) |
| 10 | мелочь | `src/components/piling/to/readiness/screens/shifts-screen.tsx:300` против `src/modules/readiness/infrastructure/shifts/handover-repository.ts:45-54` | Диалог возврата обещает диспетчеру: «Прежняя передача останется в журнале без изменений». Фактически повторная передача перезаписывает **ту же** строку (`resubmit` меняет `summary`, `evidence`, `submittedById`, `submittedAt`), номер версии растёт | Прежний текст передачи теряется безвозвратно, а `reworkedAt`/`reworkReason` не очищаются — журнал после повторной отправки показывает и `SUBMITTED` (уже с новым текстом), и `REWORKED` (со старым), не различая циклов (`handover-journal.ts:85-88`) | Сказать в диалоге правду либо писать повторную передачу отдельной строкой с сохранением прежней |
| 11 | мелочь | `src/modules/readiness/application/shifts/commands.ts:391-392`; маршруты `src/app/api/readiness/handovers/[id]/accept/route.ts:1-21` и `.../rework/route.ts:1-14` | Принять и вернуть на доработку — одно право `readiness.handover.decide` | Нельзя выдать роли только приёмку или только возврат: диспетчер, которому хотят оставить лишь «принять», автоматически получает и право отклонить чужую работу | Разделить `handover.accept` и `handover.rework`, если владелец захочет разграничить |
| 12 | мелочь | `src/modules/readiness/application/shifts/commands.ts:404-405` и `:420-426` | Признак самоприёмки `selfAccepted` пишется **только в аудит**; тело ответа команды (`:426`) его не содержит | UI узнаёт о самоприёмке лишь перечитав журнал (`readiness-centre.tsx:588-592` собирает флаг заново сравнением `submittedById === acceptedById` в `handover-journal.ts:87-88`); клиент приёмки по ответу отличить самоприёмку не может | Отдавать признак в теле ответа (это и дешевле, и надёжнее повторного вывода в UI) |
| 13 | мелочь | `src/app/api/operator/mobile/command/route.ts:192-194` и `src/app/api/operator/mobile/state/route.ts:22-24` | Мобильные команды и мобильный экран требуют ровно `user.role === 'OPERATOR'`; матрица готовности на них не влияет | Второй набор правил рядом с `effectiveReadinessCapabilities` (о двух системах прав предупреждает и память проекта). Администратор в режиме «Действую как оператор» мобильными командами пользоваться не может, а снять/выдать их через публикуемую матрицу — нельзя | Явно записать в отчёте как осознанное разделение контуров либо начать считать права мобильного места через ту же функцию |

## Не проверено

- **Кросс-тенантная изоляция передачи смены не проверялась исполнением.** Все
  запросы идут с `tenantId` из сессии и строгим равенством
  (`shift-repository.ts:66-70`, `handover-repository.ts:13-17`), `IS NULL OR` в
  коде смен не встречается; прогон на двух тенантах без БД невозможен —
  `tests/integration/disposable-idor.spec.ts:64` и
  `tests/integration/tech-readiness-shifts.spec.ts:37` требуют
  `INTEGRATION_DATABASE_URL_OWNER`, которого в этом окружении нет. Статус: ГИПОТЕЗА
  (по коду — изоляция держится).
- **RBAC передачи смены на живом сервере** — контракт-спека `describe.skip`
  (`tests/contract/tech-readiness-api.spec.ts:49`); стенда нет. НЕ ПРОВЕРЕНО.
- **Поведение под конкурентной приёмкой двух диспетчеров** — тест существует
  (`tests/integration/tech-readiness-shifts.spec.ts:177-202`), но пропускается без
  БД. По коду гонка закрыта условным `updateMany` по версии и состоянию
  (`handover-repository.ts:56-62`). НЕ ПРОВЕРЕНО.
- **Экраны замороженных вариантов оператора** (`src/app/operator/**`,
  `src/components/piling/operator/**`, `operator-v2`, `operator-dashboard.tsx`) —
  прочитаны только точки приёмки передачи (`operator-dashboard.tsx:333`,
  `operator-v2/operator-shift-v2.tsx:629,911-937`), логика фаз не разбиралась:
  область заморожена (AGENTS §1). НЕ ПРОВЕРЕНО.
- **Есть ли в проде смены, застрявшие в `HANDOVER_PENDING` из мобильного контура**
  и блокирующие открытие новых — по коду такой путь возможен (находки 3 и 4), но
  данные прод-базы не читались. НЕ ПРОВЕРЕНО.
- **Полный прогон проверок из AGENTS §6** (`tsc`, `lint`, `test:unit`,
  `playwright test --list`, `build`) не выполнялся: задача — аудит только чтением,
  код не менялся. Прогонялись лишь целевые unit-тесты (11 файлов / 75 тестов,
  exit 0). Пропущенных тестов в этом прогоне: 0.
