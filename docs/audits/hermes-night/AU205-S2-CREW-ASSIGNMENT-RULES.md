# AU205-S2-CREW-ASSIGNMENT-RULES — Назначение бригад на установки

Версия (git rev-parse HEAD): `514d7f352da5a74981a90c7c5d00abaf26784215`
Ветка: `hermes/q4-0926` (worktree D:\PillingR\wt-night). Только чтение; ни один файл кода не менялся.

Область аудита: `src/modules/crews/**` и контур смен `src/modules/readiness/**` (смена живёт в модуле readiness, отдельного `modules/shifts` нет).
Замороженные зоны (`src/modules/operator-mobile/**`, экранные варианты оператора, ORION) — не разбирались (см. «Не проверено»).

## Итог

- Найдено 8 находок: **0 критично**, **2 важно**, **6 мелочь**. Плюс 1 наблюдение «по замыслу».
- Резюме для владельца (5 строк):
  1. Правило «одна активная бригада на установку» работает и подкреплено жёстким индексом БД — не только проверкой в коде (`Crew_equipmentId_active_unique`).
  2. Конфликт двух смен на одну установку закрыт частичным индексом БД (`Shift_one_active_per_equipment_key`); из 20 параллельных пусков проходит ровно один (интеграционный тест).
  3. **Важно:** смену состава бригады в середине смены система не отслеживает. Расформирование/переназначение бригады во время идущей смены не блокируется и рвёт связь оператора со сменой — он перестаёт её видеть и не может сдать.
  4. **Важно:** если у установки в этот момент нет активной бригады, проверка допуска оператора по документам при следующем пуске молча пропускается (`crewOperatorId` возвращает `null`).
  5. Мелочи: вводящее в заблуждение сообщение об ошибке при занятой установке и «мёртвый» тест под снятый индекс.

## Методика

Что и как искалось (воспроизводимо):

- `rg` по `src/modules/crews`, `src/modules/readiness` (shifts), `src/modules/reports`, `src/app/api/crews`, `src/app/api/readiness/shifts`, `prisma/schema.prisma`, `prisma/migrations/*.sql`, `tests/`, `e2e/`.
- Ключевые запросы: `assertEquipmentNotDoubleBooked`, `crewOperatorId`, `requireOperatorAssignment`, `Crew_equipmentId_active_unique`, `Shift_one_active_per_equipment_key`, `P2002`, `crewId`, `operatorId`.
- Чтение файлов целиком там, где правило спрятано: `crew-command.service.ts`, `crew.aggregate.ts`, `crew.repository.ts`, `readiness/application/shifts/commands.ts`, `start-decision.ts`, `shift-repository.ts`, `transitions.ts`, `operator-shift-query.ts`.
- Проверка инвариантов БД — по фактическим SQL-миграциям (Prisma частичные индексы не описывает):
  - `prisma/migrations/20260624000000_crew_equipment_active_unique/migration.sql:5`
  - `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41`
  - `prisma/migrations/20260820150000_crew_operator_many_rigs/migration.sql:15`
  - `prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:161-174`
- Прогон тестов (числа из команды): `node node_modules/vitest/vitest.mjs run src/modules/crews src/modules/readiness/application/shifts` → **Test Files 6 passed (6), Tests 69 passed (69)**.

## Правила назначения бригады на смену (таблица «правило | файл:строка | проверка | тест»)

| # | Правило | Файл:строка | Проверка | Тест | Статус |
|---|---------|-------------|----------|------|--------|
| P1 | Одна активная бригада на установку (создание, перенос установки, реактивация) | `src/modules/crews/application/commands/crew-command.service.ts:38-46`, вызовы `:159`, `:258`, `:284` | `findFirst({equipmentId, isActive:true, id:{not:crewId}})`; занятая установка → 409 с именем бригады | `src/modules/crews/__tests__/crew-command.rules.test.ts:118-133,140-167,169-187`; `src/modules/crews/application/commands/__tests__/crew-command-service.test.ts:523-533` | ПРОЙДЕНО |
| P2 | То же на уровне БД (жёсткий инвариант, race-safe) | `prisma/migrations/20260624000000_crew_equipment_active_unique/migration.sql:5` | `CREATE UNIQUE INDEX ... ON "Crew"("equipmentId") WHERE "isActive" = true` | не покрыто отдельным тестом (индекс БД) | ПРОЙДЕНО (по миграции) |
| P3 | Оператор открывает смену только на закреплённой за ним установке | `src/modules/readiness/infrastructure/shifts/shift-repository.ts:35-39`; вызов `src/modules/readiness/application/shifts/commands.ts:108-110` | при `role/actingAs === 'OPERATOR'` ищется активная бригада `{operatorId,equipmentId}`; нет — 403 | теста нет (см. AU205-13) | НЕ ПРОВЕРЕНО (нет теста) |
| P4 | Диспетчер/админ заводят смену на любой установке, бригада для заведения смены не обязательна | `src/modules/readiness/application/shifts/commands.ts:106-117` | проверка `requireOperatorAssignment` только для OPERATOR | — | ПРОЙДЕНО (чтение) |
| P5 | Допуск оператора по документам берётся у оператора активной бригады установки | `src/modules/readiness/application/shifts/commands.ts:179-191`; `shift-repository.ts:47-53` | `crewOperatorId(equipmentId)` → `getOperatorClearance`; нет бригады → проверка пропускается | теста нет | ПРОЙДЕНО (чтение) / риск в Н1 |
| P6 | Одна активная смена на установку (STARTED/HANDOVER_PENDING) | `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41`; обработка P2002 `shift-repository.ts:107-117` | частичный уникальный индекс `(tenantId,equipmentId) WHERE state IN ('STARTED','HANDOVER_PENDING')`; второй пуск → 409 «По этой установке уже открыта смена» | `tests/integration/tech-readiness-shifts.spec.ts:154-175` (из 20 параллельных пусков — ровно 1) | ПРОЙДЕНО |
| P7 | Несколько смен в ожидании допуска (PLANNED/PENDING_ACCEPTANCE) на одну установку разрешены | `src/modules/readiness/infrastructure/shifts/shift-repository.ts:107-117` | индекс не покрывает PENDING_ACCEPTANCE; конфликт решается только в момент `start` | тот же тест (`:159` сеет 20×PENDING_ACCEPTANCE) | ПРОЙДЕНО (по замыслу) |
| P8 | Отмена смены возможна из PLANNED/PENDING_ACCEPTANCE/STARTED | `src/modules/readiness/infrastructure/shifts/shift-repository.ts:128-134`; переходы `src/modules/readiness/domain/shifts/transitions.ts:11,60-64` | `updateMany({state:{in:[...]}})` | `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts` | ПРОЙДЕНО |
| P9 | Смена свободна от привязки к бригаде/оператору (только equipmentId) | `prisma/schema.prisma:1081-1133` | в модели `Shift` нет `crewId`/`operatorId`; `startedById` — только актор пуска | — | ПРОЙДЕНО (чтение) — причина Н1/Н2 |
| P10 | Отчёт фиксирует бригаду на момент создания (point-in-time `crewId`) | `src/modules/reports/application/commands/report-command.service.ts:229-267` | бригада выбирается по идущей смене среди активных бригад оператора; иначе `null` | `src/modules/reports/application/commands/__tests__/report-command-service.test.ts:63` | ПРОЙДЕНО |

## Находки

Легенда статусов: ПРОЙДЕНО (подтверждено кодом/командой), ГИПОТЕЗА (вывод из чтения кода без исполнения), НЕ ПРОВЕРЕНО.

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление | Статус |
|---|----------|-----------|----------|--------------------------|--------------------------|--------|
| Н1 | важно | `src/modules/crews/application/commands/crew-command.service.ts:340-373` (deleteCrew) и `:211-289` (updateCrew) — нет ни одной проверки состояния смен; `prisma/schema.prisma:1081-1133` (Shift без crewId/operatorId) | Расформирование или переназначение бригады во время идущей смены не блокируется и никак не связано со сменой. После этого `crewOperatorId(equipmentId)` (`shift-repository.ts:47-53`) вернёт `null`, и проверка допуска оператора по документам при следующем пуске на этой установке молча пропустится (`commands.ts:179-191`: `if (operatorId) {...}`). | Диспетчер вечером расформировал бригаду, смена на установке ещё `STARTED`. Утром следующая смена на той же установке заводится диспетчером «под свою ответственность» и пускается без проверки удостоверения/медсправки машиниста — законное требование обходится не решением, а отсутствием владельца у установки. | Запретить деактивацию/переназначение бригады, пока на её установке есть смена в `STARTED`/`HANDOVER_PENDING` (или явно писать в аудит «бригада снята при идущей смене»). | ГИПОТЕЗА (по чтению; не исполнялось) |
| Н2 | важно | `src/modules/readiness/application/operator-shift-query.ts:177-190` и `:202-213`, `:217-220` | Экран оператора выводит его смену из списка его активных бригад (`crews`). Если бригада расформирована или у неё сменена установка в середине смены, `crews.length === 0` → функция возвращает `empty` и смена исчезает. | Оператор работает (смена `STARTED`), администратор меняет установку в бригаде. Экран оператора показывает «нет смены»: он не может открыть смену, сдать передачу и отчёт по факту выполненной работы. Данные о работе при этом в БД есть. | Дополнительно искать активную смену оператора напрямую (по `startedById`/`createdById` и установкам), а не только через активные бригады; либо запретить правку бригады при идущей смене. | ГИПОТЕЗА (по чтению; не исполнялось) |
| Н3 | мелочь | `src/modules/crews/application/commands/crew-command.service.ts:184-186` | Текст ошибки при `UNIQUE`-нарушении — «Бригада с этим машинистом уже существует». Но уникального индекса по `operatorId` больше нет (`prisma/migrations/20260820150000_crew_operator_many_rigs/migration.sql:15` `DROP INDEX "Crew_operatorId_key"`); единственный релевантный `UNIQUE` — `Crew_equipmentId_active_unique` по установке (`20260624000000_crew_equipment_active_unique/migration.sql:5`). | Гонка двух созданий на одну установку (оба прошли `assertEquipmentNotDoubleBooked`) вернёт 409 с текстом про машиниста, хотя занята установка. Диспетчер ищет несуществующую проблему у машиниста. | Различать нарушенный индекс по `meta.target`/имени констрейнта и писать «Установка уже закреплена за активной бригадой». | ПРОЙДЕНО |
| Н4 | мелочь | `src/modules/crews/application/commands/__tests__/crew-command-service.test.ts:556-565` | Тест «should convert UNIQUE constraint error to 409» мокает ошибку `UNIQUE constraint failed: Crew.operatorId` — констрейнт, снятый миграцией `20260820150000`. Тест зелёный, но проверяет невозможный в БД сценарий и закрепляет неверный текст (см. Н3). | Даёт ложную уверенность, что путь обработан; при реальной гонке текст другой. | Переписать тест на `Crew_equipmentId_active_unique` и ожидаемый корректный текст. | ПРОЙДЕНО |
| Н5 | мелочь | `src/modules/readiness/infrastructure/shifts/shift-repository.ts:47-53` | `crewOperatorId` фильтрует только `{equipmentId, isActive}`, без `tenantId`; соседний `requireEquipment` (`:21-25`) `tenantId` фильтрует. | Утечки сейчас нет: `equipmentId` — cuid (глобально уникален) и таблица `Crew` под RLS (`20260903000000_rls_remaining_tables/migration.sql:161-166`, политика `tenant_isolation_crew`). Но асимметрия опасна: если RLS когда-нибудь ослабят, запрос вернёт бригаду другого тенанта. | Добавить `tenantId` в `where` (передать его в метод). | ПРОЙДЕНО (чтение) |
| Н6 | мелочь | `src/modules/crews/application/queries/crew-query.service.ts:18-30` | `getAccessibleCrews` (GET `/api/crews`) не фильтрует `isActive` — расформированные бригады остаются в списке. | Список бригад показывает и расформированные; если экран/распределение не отсеивают их отдельно, пользователь может попытаться назначить несуществующую бригаду. | Вернуть параметр `includeInactive` (по умолчанию false) или фильтровать на вызывающей стороне осознанно. | ПРОЙДЕНО (чтение) |
| Н7 | мелочь | `src/modules/crews/domain/crew.aggregate.ts:80-105` | `assignToSite/assignOperator/assignEquipment` перезаписывают поля без проверки, что смена на прежней установке уже идёт (домен не знает про смены). | Дополняет Н1 на уровне агрегата: агрегат «молчит» о последствиях переноса установки. Домен и не должен знать про смены — но тогда границу (Н1) обязан держать сервис команды. | Оставить домен чистым; проверку вынести в `crew-command.service.ts` (Н1). | ПРОЙДЕНО (чтение) |
| Н8 | мелочь | `src/modules/crews/application/commands/crew-command.service.ts:65-75` | `assertSameTenant` сверяет только `tenantId` установки/оператора/объекта. Объект и установка между собой не связаны: у `Equipment` нет `siteId` (`prisma/schema.prisma:440-...`, grep `siteId` в диапазоне 440-543 — пусто). | Бригаду можно завести на любую установку с любым объектом — «объект» в бригаде это метка, а не привязка. Если владелец ждёт, что установка «на объекте», правило не выполняется. | Уточнить у владельца: объект бригады — метка или реальная привязка. Если привязка — заводить `Equipment.siteId` (отдельная задача). | ГИПОТЕЗА |

## Не проверено

- **Не исполнялись сценарии Н1/Н2/Н8** на живой БД (правила «только чтение»; поднять disposable-Postgres и проиграть «расформировать бригаду при идущей смене» — отдельная задача). Выводы Н1/Н2 сделаны чтением кода и отсутствием проверок, статус — ГИПОТЕЗА.
- **Нет теста** на `requireOperatorAssignment` и `crewOperatorId` (P3, P5): `rg` по `src tests e2e` не нашёл ни одного упоминания в `*.test.ts`/`*.spec.ts`. Покрытие этих правил — НЕ ПРОВЕРЕНО.
- **Замороженные зоны** (`src/modules/operator-mobile/**`, экранные варианты оператора, ORION) не разбирались по требованию AGENTS.md. Там есть своя логика смены (`src/modules/operator-mobile/application/mobile-shift-query.ts`, упоминание `Shift_one_active_per_equipment_key` около `:357`) — это НЕ ПРОВЕРЕНО и в отчёт не включено.
- **Поведение под многопользовательской нагрузкой** для правил бригад (P1/P2) на уровне кода не исполнялось; race-safe гарантирует индекс БД, но параллельного теста именно для `Crew` нет.
- **Полнота списка бригад по объекту/тенанту** (`/api/crews/all`, кэш `crews:all`): инвалидация `invalidateCrews` вызывается (`crew-command.service.ts:207,336,371`), но поведение кэша под нагрузкой не проверялось — НЕ ПРОВЕРЕНО.
- **Прочие отчёты этого аудита** (в т.ч. AU156, AU39, R124, R145) намеренно не читались по условию задачи; пересечения возможны.

## Числа (только из команд)

- `git rev-parse HEAD` → `514d7f352da5a74981a90c7c5d00abaf26784215`.
- `node node_modules/vitest/vitest.mjs run src/modules/crews src/modules/readiness/application/shifts` → Test Files **6 passed (6)**, Tests **69 passed (69)**.
- Находок: **критично 0, важно 2, мелочь 6** (итого 8) + 1 наблюдение «по замыслу» (P7).
