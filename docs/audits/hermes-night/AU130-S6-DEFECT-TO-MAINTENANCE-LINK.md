# AU130 — Дефект (EquipmentDefect) и наряд ТО (MaintenanceRecord): связь и расхождения

HEAD на момент аудита: `6775bef8682c93f5f43e77769ffe49c54a5c79cb`
Ветка: `hermes/q4-0926`. Только чтение: файлы приложения не менялись.

## Итог

Связь «дефект → наряд» существует ровно в одном виде: необязательное поле
`EquipmentDefect.maintenanceRecordId` (строка), которое может заполнить ТОЛЬКО
команда разбора (`triage`). Ни создание дефекта из осмотра, ни создание дефекта
из чек-листа оператора наряд не проставляют. Подсчёт: критично — 2, важно — 5,
мелочь — 2 (всего 9).

Топ-5:

1. `EquipmentDefect.maintenanceRecordId` — просто строка БЕЗ внешнего ключа
   (`prisma/schema.prisma:688`, миграция `20260808120000_equipment_defects`
   строки 43–44 создают только индекс). Удаление наряда не трогает дефект —
   получается «висячая» ссылка и битая ссылка в интерфейсе.
2. Интерфейс НИКОГДА не передаёт `maintenanceRecordId` при разборе
   (`src/components/piling/to/readiness/screens/defects-panel.tsx:117-129`):
   тело разбора — только `{expectedVersion, comment}`. Значит через приложение
   связать дефект с нарядом нельзя вообще; поле заполняемо лишь сторонним
   API-клиентом. Экран «Связанная запись ТО» (`fleet-evidence-panel.tsx:225`)
   поэтому в проде не может появиться.
3. Закрытие наряда (DONE / CANCELLED / приёмка) не меняет статус связанного
   дефекта — дефект остаётся `IN_WORK` и продолжает висеть в открытых
   (`src/modules/equipment/application/commands/equipment-maintenance.ts:191-325`).
4. Закрытие дефекта (`resolve`) не закрывает наряд — наряд остаётся открытым и
   продолжает штрафовать готовность по критерию «Обслуживание»
   (`src/modules/readiness/application/defects/commands.ts:198-214`).
5. Разбор без наряда переводит дефект в `IN_WORK` (наряд необязателен), а
   обратно в `TRIAGE` переход уже запрещён — привязать наряд позже нечем
   (`schemas.ts:24`, `commands.ts:187-194`, `domain/defects/defect.ts:59-64`).

## Методика

Поиск по репозиторию (rg-эквивалент через `search_files`):

- `EquipmentDefect|MaintenanceRecord` в `prisma/schema.prisma` → модели и enum'ы.
- `maintenanceRecordId` по всему репо (src, prisma/migrations, tests, e2e) —
  17 файлов, разобраны все, где пишется/читается поле.
- `equipmentDefect.(create|update|delete|updateMany)` в `src` — все точки записи
  журнала дефектов (их три: `defect-repository.ts:57,113`,
  `inspection-commands.ts:472`, `operator-mobile/.../checklist.ts:214`).
- Прочитаны целиком: `modules/readiness/application/defects/commands.ts`,
  `schemas.ts`, `queries.ts`, `infrastructure/defects/defect-repository.ts`,
  `domain/defects/defect.ts`, `domain/defects/types.ts`,
  `modules/equipment/application/commands/equipment-maintenance.ts`,
  `pm-scheduler.ts`, `modules/inspections/application/commands/inspection-commands.ts`
  (фрагменты), роуты `app/api/readiness/defects/**`, роут
  `app/api/equipment/[id]/maintenance/[recordId]/route.ts`,
  `components/piling/to/readiness/screens/defects-panel.tsx`,
  `fleet-evidence-panel.tsx`, `api/contracts.ts`.
- Проверено отсутствие FK на `EquipmentDefect.maintenanceRecordId`: миграция
  `prisma/migrations/20260808120000_equipment_defects/migration.sql` (только
  индекс, ADD CONSTRAINT есть лишь для `equipmentId`); повторный поиск
  `FOREIGN KEY … EquipmentDefect … maintenanceRecordId` по `prisma/migrations`
  дал 0 совпадений.
- Поиск вызовов `maintenanceRecordId` из UI: `grep` по `src/components` нашёл
  только чтение в `fleet-evidence-panel.tsx:225` и типы в тестах/контрактах —
  ни одной отправки поля на сервер.

Проверки не запускались (задача — только чтение кода); тесты перечислены по
факту наличия/отсутствия файлов.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|----------|-----------|----------|--------------------------|-------------------|
| 1 | критично | `prisma/schema.prisma:688` + `prisma/migrations/20260808120000_equipment_defects/migration.sql:43-44` | `EquipmentDefect.maintenanceRecordId` — строка без FK (есть только индекс) | Наряд удалили (механик/диспетчер), дефект ссылается на несуществующую запись: «висячая» ссылка | Добавить relation/FK `ON DELETE SET NULL` (как у `Inspection.maintenanceRecordId`, миграция `20260606130000`…:39) в отдельной миграции |
| 2 | критично | `src/components/piling/to/readiness/screens/defects-panel.tsx:117-129` | Разбор из UI шлёт только `expectedVersion`+`comment`, поле `maintenanceRecordId` не отправляется никогда | Владелец/диспетчер не могут связать дефект с нарядом через приложение — связь недостижима; экран дефектов никак не показывает наряд | Либо дать в диалоге разбора выбор открытого наряда установки и слать `maintenanceRecordId`, либо считать поле мёртвым и удалить (с проверкой ссылок) |
| 3 | важно | `src/modules/equipment/application/commands/equipment-maintenance.ts:191-325` | DONE/CANCELLED/приёмка наряда не меняют связанный дефект | Наряд закрыт, дефект остаётся `IN_WORK` и в открытых: счётчик открытых дефектов и допуск (для CRITICAL) держатся после ремонта | При переходе наряда в DONE/CANCELLED — не закрывать дефект молча, а показать/уведомить «есть связанный открытый дефект», либо предложить закрыть |
| 4 | важно | `src/modules/readiness/application/defects/commands.ts:198-214` | `resolve` закрывает дефект, наряд не трогает | Дефект «устранён», а наряд `REPAIR/FAULT` открыт → критерий «Обслуживание» в готовности считает работу незакрытой; расхождение журналов | При закрытии дефекта закрывать/помечать связанный наряд или требовать его закрытия перед сбором |
| 5 | важно | `src/modules/readiness/application/defects/schemas.ts:24` + `src/modules/readiness/application/defects/commands.ts:187-194` + `src/modules/readiness/domain/defects/defect.ts:59-64` | Разбор без наряда → `IN_WORK`; переход `TRIAGE` только из `OPEN` | Дефект «в работе», хотя работы/наряда нет; привязать наряд позже нельзя — останется либо ждать `resolve` без наряда, либо новый дефект | Либо требовать наряд для `IN_WORK`, либо разрешить повторный `TRIAGE`/привязку наряда в `IN_WORK` |
| 6 | важно | `src/modules/readiness/infrastructure/defects/defect-repository.ts:42-50` | `requireMaintenanceRecord` проверяет только tenant+equipmentId | Можно связать дефект с уже закрытым (`DONE`/`CANCELLED`) или отменённым нарядом — «устранение» ссылается на неработу | Проверять статус наряда (открытый) и при необходимости тип |
| 7 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:472-483` (создание) против `:433-438` (закрытие наряда) | Дефект из осмотра не связывается с нарядом этого же осмотра | Осмотр «→ дефект» и осмотр «→ наряд ТО» — два несвязанных факта: дефект есть, а каким нарядом устранять, в записи нет | При создании дефекта из осмотра проставлять `maintenanceRecordId = ins.maintenanceRecordId` |
| 8 | мелочь | `src/modules/readiness/domain/defects/__tests__/defect.test.ts` (весь) | Тестов на связь дефект↔наряд нет | `defect.test.ts` покрывает только переходы статусов; файла тестов команд дефектов (`triage/resolve`) нет; e2e-спеки дефектов отсутствуют | Добавить тест: разбор с нарядом, разбор без наряда, поведение при закрытии/удалении наряда |
| 9 | мелочь | `src/modules/equipment/application/queries/operational-state.ts:42-49` | Запрос `maintenanceRecord.findMany` без `tenantId` (только `equipmentId`) | Косвенно к дефектам: определяет «в ремонте» по открытым `REPAIR/FAULT`. Изоляция держится только на глобальной уникальности `equipmentId`, а не на тенанте | Добавить `tenantId` в `where` (соглашение проекта: тенант всегда) |

### Таблица сценариев (дефект ↔ наряд)

| Сценарий | файл:строка | Результат | Тест | Риск рассинхронизации |
|----------|-------------|-----------|------|------------------------|
| Создание дефекта оператором из чек-листа | `src/modules/operator-mobile/application/commands/checklist.ts:214-228` | `status=OPEN`, `maintenanceRecordId` не задаётся | `src/modules/operator-mobile/application/commands/__tests__/checklist.test.ts` (создание) | Низкий: наряд не предполагается |
| Создание дефекта из осмотра ЕО/ТО | `src/modules/inspections/application/commands/inspection-commands.ts:472-483` | `status=OPEN`, `inspectionId` есть, `maintenanceRecordId` НЕТ | `src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts` | Средний: наряд осмотра закрывается (`:433-438`), а дефект с ним не связан — находка #7 |
| Создание дефекта вручную (API) | `src/app/api/readiness/defects/route.ts:67-81` → `commands.ts:116-146` | `status=OPEN` | нет отдельного теста команд | Низкий |
| Разбор с нарядом | `src/modules/readiness/application/defects/commands.ts:176-196` | `OPEN → IN_WORK`, `maintenanceRecordId` = наряд (если передан) | нет теста | Высокий при удалении/закрытии наряда — #1,#3,#4,#6 |
| Разбор без наряда | `commands.ts:187-194` + `schemas.ts:24` | `OPEN → IN_WORK`, связи нет | нет теста | Средний: наряд позже не привязать — #5 |
| Закрытие наряда (DONE/CANCELLED/приёмка) | `equipment-maintenance.ts:233-243,257-272` (DONE), `:280-325` (приёмка) | Дефект не меняется | `equipment-maintenance.test.ts` (наряды, без дефектов) | Высокий: дефект «в работе» после ремонта — #3 |
| Удаление наряда | `equipment-maintenance.ts:327-364` | Дефект сохраняет `maintenanceRecordId` (наряд удалён) | нет теста | Критичный: висячая ссылка, 404 на `/admin/maintenance/[id]` — #1 |
| Закрытие дефекта (`resolve` / `reject`) | `commands.ts:198-231` | Дефект `CLOSED`/`REJECTED`, наряд не меняется | `defect.test.ts` (только переходы) | Высокий: наряд остаётся открытым в готовности — #4 |
| Отображение связи в UI | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:225` | Ссылка «Связанная запись ТО» → `/admin/maintenance/{id}` | `fleet-screen.test.tsx`/`readiness-centre.test.tsx` (поле всегда `null`) | Проявляется только через API; при удалённом наряде ведёт на 404 |

## Не проверено

- Поведение PostgreSQL при удалении наряда с уже «висячей» ссылкой не
  воспроизводилось (нет доступа к БД / не запускались миграции): вывод о
  висячей ссылке сделан из отсутствия FK в `schema.prisma` и миграции, а не из
  эксперимента. Статус: ГИПОТЕЗА (обоснованная схемой).
- Не запускались `tsc`, `lint`, `test:unit`, `playwright` — задача только на
  чтение, поведение подтверждается текстом кода.
- Не проверено, шлёт ли `maintenanceRecordId` в разборе какой-либо сторонний
  клиент (мобильное приложение вне этого репозитория). В `src`, `e2e`, `tests`
  таких вызовов нет; внешние клиенты вне зоны проверки.
- Не проверялось наличие/состояние строк `EquipmentDefect` в реальной БД
  (сколько ссылок уже «висячие») — нет доступа к данным.
- Замороженные области (`operator/**`, ORION) не открывались, кроме чтения
  `operator-mobile` (не входит в заморозку для этой задачи).
