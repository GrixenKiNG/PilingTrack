# AU151-S2 — Вывод установки из эксплуатации (Equipment.isActive = false)

Версия кода: `git rev-parse HEAD` = `44aeac51137c7e32e518560dba721e1eeb6b75b8` (ветка `hermes/q4-0926`).
Только чтение: код приложения не менялся. Существующие отчёты в `docs/audits/` не читались.

## Итог

Что происходит при выводе установки из эксплуатации (`Equipment.isActive = false`), по коду.

- Списание — это один тумблер `isActive` в форме карточки (`src/components/piling/admin-equipment/equipment-form.tsx:230`), делает его только ADMIN (`equipment.manage = ['ADMIN']`, `src/services/auth/authorization-service.ts:104`). Аудит-след `equipment.retired` пишется (`src/app/api/equipment/[id]/route.ts:109-118`).
- Обратимо: тот же PUT с `isActive: true` возвращает установку в парк. Отдельного действия «вывести»/«вернуть» нет — `retireEquipment()` не вызывается ниоткуда (`src/modules/equipment/application/commands/equipment-command.service.ts:51`).
- Списанная установка перестаёт допускаться к НОВЫМ сменам, дефектам и нарядам-допускам (проверки `isActive: true` в репозиториях готовности) и скрывает вердикт на борде готовности.
- Но: (1) регламенты ТО списанной техники продолжают генерировать наряды и Telegram-алерты «просрочено ТО»; (2) любой пересчёт готовности по списанной машине падает с ошибкой `Authoritative equipment row is unavailable` (проекция/DLQ); (3) можно завести наряд ТО и закрепить бригаду на списанную машину.
- Существующие открытые бригады, смены, наряды-допуски и дефекты при списании НЕ закрываются автоматически.

Числа по итогу: **критично — 2, важно — 7, мелочь — 5, всего 14 находок** (плюс раздел «Пройдено»). Топ-5:
1. Планировщик ТО продолжает обслуживать списанные машины — наряды и алерты `src/modules/equipment/application/commands/pm-scheduler.ts:61-76`.
2. Пересчёт готовности по списанной машине бросает 500-ошибку — `src/modules/readiness/application/readiness-score.ts:32-35,95`.
3. Пуск смены на списанной установке даёт 500 вместо понятного отказа — `src/modules/readiness/application/shifts/commands.ts:151-207`.
4. Наряд ТО на списанную машину создаётся без запрета — `src/modules/equipment/application/commands/equipment-maintenance.ts:63-67`.
5. Бригаду можно закрепить за списанной установкой (и она видна в списке) — `src/modules/crews/application/commands/crew-command.service.ts:141-159`.

## Методика

- `git rev-parse HEAD`, `git status --short`; чтение `AGENTS.md` (trust model, frozen areas, «looks dead but must stay»).
- Схема: `prisma/schema.prisma` — модель `Equipment` (стр. 440-521), поля/связи.
- Точки списания: `rg -n "retireEquipment|equipment\.retired" src`; `src/app/api/equipment/[id]/route.ts`; `src/modules/equipment/**`.
- Кто может: `rg -n "equipment\.manage" src/services/auth` → `authorization-service.ts:103-104`.
- Сущности, зависящие от установки: `rg -n "equipmentId" src/modules/{crews,reports,readiness}`; `rg -n "isActive: true" src/modules/readiness/infrastructure`; `rg -n "\.requireEquipment\(" src` (4 вызова).
- Инфраструктура «что сломается»: `src/modules/readiness/application/readiness-score.ts`, `project-event.ts`, `worker/unified-worker/pm-scheduler.ts`.
- Существующие тесты: `rg -n "equipment\.retired|EquipmentRetired" src e2e` (7 файлов); `e2e/` — 26 spec-файлов, отдельного e2e про списание нет.

## Таблица: сущность → последствие

Статус: ПРОЙДЕНО (проверено по коду), ГИПОТЕЗА (вывод, но не подтверждён запуском).

| Сущность | Последствие при isActive=false | Файл:строка | Статус | Тест |
|---|---|---|---|---|
| Смены (Shift) | Открыть новую смену нельзя — `requireEquipment` ищет `isActive: true`, иначе 404 «Запись не найдена» | src/modules/readiness/infrastructure/shifts/shift-repository.ts:21-24; src/modules/readiness/application/shifts/commands.ts:105 | ПРОЙДЕНО | src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts |
| Смены — пуск уже заведённой | Пуск пересчитывает готовность; при неактивной установке — бросок Error → 500, а не бизнес-отказ | src/modules/readiness/application/shifts/commands.ts:151-207; src/modules/readiness/application/shifts/start-decision.ts:15-18; src/modules/readiness/application/readiness-score.ts:95; src/app/api/readiness/_shared/route-adapter.ts:23-28 | ГИПОТЕЗА | нет |
| Смены — существующая открытая | Автоматически не закрывается; закрытие смены/сдача отчёта `isActive` не проверяют — работу можно завершить | src/modules/operator-mobile/application/commands/shift-close.ts:18-26,50-79 | ПРОЙДЕНО | src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts |
| Бригады (Crew) | Создание/правка не проверяют `equipment.isActive` — бригаду можно закрепить за списанной машиной; активная бригада не расформировывается | src/modules/crews/application/commands/crew-command.service.ts:141-159,227-259 | ПРОЙДЕНО | src/modules/crews/__tests__/crew-command.rules.test.ts |
| Наряды-допуски (WorkPermit) | Создание/правка требуют `isActive` → 404; существующие открытые не отзываются | src/modules/readiness/infrastructure/permits/work-permit-repository.ts:54-59; src/modules/readiness/application/permits/commands.ts:122,166 | ПРОЙДЕНО | нет спец-теста |
| Дефекты (EquipmentDefect) | Создание требует `isActive` → 404; открытые дефекты остаются и учитываются в готовности | src/modules/readiness/infrastructure/defects/defect-repository.ts:27-32; src/modules/readiness/application/defects/commands.ts:126 | ПРОЙДЕНО | нет спец-теста |
| ТО — наряд (MaintenanceRecord) | Ручное создание проверяет лишь существование, не `isActive` → наряд на списанную машину заводится | src/modules/equipment/application/commands/equipment-maintenance.ts:63-67; src/app/api/equipment/[id]/maintenance/route.ts:76 | ПРОЙДЕНО | src/app/api/equipment/[id]/maintenance/__tests__/route.test.ts |
| ТО — регламент (MaintenancePlan) | Планировщик берёт планы по `isActive` плана, а не техники → списанная машина продолжает получать PLANNED-наряды и алерты | src/modules/equipment/application/commands/pm-scheduler.ts:61-76,121-144; src/workers/unified-worker/pm-scheduler.ts:78-84 | ПРОЙДЕНО | src/modules/equipment/application/commands/__tests__/pm-scheduler.test.ts |
| Готовность (Readiness) | Борд скрывает вердикт/балл (`mode: 'inactive'`); при списании пересчёт не запрашивается, а при любом триггере падает | src/components/piling/to/readiness/authoritative-presentation.ts:211; src/modules/readiness/application/readiness-score.ts:32-35,95 | ПРОЙДЕНО | src/components/piling/to/readiness/authoritative-presentation.test.ts |
| Отчёты (Report) | `equipmentId` не валидируется на `isActive` → отчёт по списанной машине сохраняется | src/app/api/reports/upsert/route.ts:81,99-122 (в `src/modules/reports` проверок equipment — 0) | ПРОЙДЕНО | нет |
| Удаление установки | Жёсткое удаление запрещено при любой истории (предлагает списание) | src/modules/equipment/application/commands/equipment-command.service.ts:94-121 | ПРОЙДЕНО | src/app/api/equipment/[id]/__tests__/route.test.ts |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Suggested fix |
|---|---|---|---|---|---|
| 1 | критично | src/modules/equipment/application/commands/pm-scheduler.ts:61-76 | Запрос планов ТО не учитывает `equipment.isActive` (только `MaintenancePlan.isActive`). Планировщик генерирует для списанной машины PLANNED-наряды и «просрочено» | Админ списывает копёр, но регламент ТО на нём остаётся активным. Ежедневно `runPmScheduler` создаёт новый наряд ТО, а `notifyOverdue` шлёт в Telegram «Просрочено регламентов ТО» — вечное уведомление про списанную технику, ложная работа для механика | В `pm-scheduler` (и `runPmSchedulerScoped`) добавить `equipment: { isActive: true }` в условие плана либо приостанавливать планы при списании установки |
| 2 | критично | src/modules/readiness/application/readiness-score.ts:32-35,95 | `evaluateAuthoritativeReadiness` берёт установку с `isActive: true` и бросает `Error('Authoritative equipment row is unavailable')`, если её нет | Любой заказ снимка готовности по списанной машине (авто-наряд ТО из №1, ручной наряд ТО из №4, осмотр/чек-лист при ещё открытой смене) роняет проекцию outbox-события; событие уходит в retry/DLQ. Это же всплывает при пуске смены (№3) как 500 | Вернуть бизнес-вердикт вместо исключения: отдельный факт `equipmentActive=false` → blocker/`UNCONFIRMED`, а не throw; либо не заказывать снимок для неактивной техники |
| 3 | важно | src/modules/readiness/application/shifts/commands.ts:151-207 | `startShiftCommand` не вызывает `repo.requireEquipment`, а считает готовность; на списанной — `readiness-score.ts:95` бросает не-`ReadinessCommandError` | Смену завели на активной машине, затем машину списали. Диспетчер жмёт «Пуск» → 500 («authoritative equipment row unavailable» из route-adapter.ts:23-28), сырая ошибка вместо «установка выведена из эксплуатации» | Перед расчётом готовности вызвать `requireEquipment` и вернуть понятный 409/422, либо не допускать расчёта по неактивной технике |
| 4 | важно | src/modules/equipment/application/commands/equipment-maintenance.ts:63-67 | `createMaintenance` проверяет только существование установки (`id + tenantId`), не `isActive` | Механик/админ заводит наряд ТО на списанную машину: запись создаётся и сразу заказывает снимок готовности → падает в №2. Регламент ТО сдвигается по списанной технике | Добавить `isActive: true` в выборку или явно запрещать создание нарядов на выведенной технике |
| 5 | важно | src/modules/crews/application/commands/crew-command.service.ts:141-159 | `createCrew`/`updateCrew` проверяют, что установка существует и принадлежит тенанту, но не `isActive` | Админ закрепляет бригаду за списанной установкой (в выпадающем списке `crew-form-dialog.tsx:294` списанные не отфильтрованы — `/api/equipment` отдаёт все). Бригада формально «активна», но смену по ней открыть нельзя (№1 таблицы) | Запретить закрепление на `isActive:false`; в списке установок формы бригады пометить/скрыть списанные |
| 6 | важно | src/modules/equipment/application/commands/equipment-command.service.ts:21-49 | Списание меняет только `isActive`; активные бригады, открытые смены, наряды-допуски, дефекты и планы ТО не трогаются | Админ списывает машину посреди смены: смена остаётся STARTED, бригада — активной, регламенты — включёнными. Ничего не сообщает «за этой машиной остались живые сущности» | Перед списанием предупреждать о связанных активных сущностях; опционально — приостанавливать планы ТО и предлагать расформировать бригаду |
| 7 | важно | src/modules/equipment/application/commands/maintenance-plan.ts:44-48 | `createMaintenancePlan` проверяет существование установки, не `isActive` | На списанную машину можно завести новый регламент ТО — который затем оживёт в №1 и будет слать алерты | Запретить создание регламента на неактивной установке |
| 8 | важно | src/modules/readiness/application/operator-shift-query.ts:178 vs src/modules/operator-mobile/application/mobile-shift-query.ts:167 | Два операторских экрана по-разному фильтруют: `operator-shift-query` требует `equipment.isActive: true`, `mobile-shift-query` — нет | Оператор на одном экране не видит списанную машину, на другом она в списке. Поведение непредсказуемо, «мерцание» доступности машины | Привести оба запроса к одному условию (`equipment: { tenantId, isActive: true }`) |
| 9 | важно | src/app/api/reports/upsert/route.ts:81 (и src/app/api/reports/admin-upsert/route.ts:58) | `equipmentId` отчёта из тела запроса не проверяется на `isActive`; в `src/modules/reports` таких проверок 0 | Оператор (бригада которого осталась на списанной машине, №5/#6) сохраняет отчёт с `equipmentId` списанной установки — отчёт и его аналитика ложатся на выведенную технику | Проверять `isActive` при записи отчёта либо отказывать с понятной причиной |
| 10 | мелочь | src/modules/readiness/infrastructure/shifts/shift-repository.ts:22-24 (и defect/work-permit репозитории) | Отказ по неактивной установке — общий текст `'Запись не найдена'` (404) | Диспетчер/оператор при попытке открыть смену на списанной машине видит «Запись не найдена» вместо «установка выведена из эксплуатации» — ищет причину не там | Отдельная ветка сообщения: «Установка выведена из эксплуатации» |
| 11 | мелочь | src/components/piling/admin-equipment/equipment-form.tsx:230,346-349 | Тумблер «Активна» без подтверждения и без предупреждения о последствиях; бейдж на карточке — «Списана», а аудит/контур называют это «выведена из эксплуатации» | Админ случайно снимает галочку и теряет машину из работы без единого объяснения; терминология на экране и в ленте расходится | Подтверждение с перечислением последствий; единый термин с аудитом |
| 12 | мелочь | src/modules/equipment/application/commands/equipment-command.service.ts:51-57; src/modules/equipment/index.ts:6 | `retireEquipment()`/`EquipmentAggregate.retire()` не вызываются ни из API, ни из UI — мёртвый экспорт | Функциональность «списать» есть только как тумблер; доменный путь списания (с событием `EquipmentRetired`) не подключён и не создаёт соответствующего аудита `equipment.retired` | Либо подключить `retireEquipment` к отдельному действию, либо убрать мёртвый экспорт (с проверкой ссылок) |
| 13 | мелочь | src/app/api/equipment/[id]/route.ts:59-123 | Списание не заказывает пересчёт готовности (`requestReadinessSnapshot` в PUT нет) | Снимок/балл на борде остаются прежними до следующего триггера; вердикт скрыт через `equipmentActive`, но история снимков не отражает списание | Заказывать снимок (или явно фиксировать «списана» в текущем состоянии готовности) при смене `isActive` |

## Пройдено (проверено, проблем нет)

- Списать может только ADMIN: `equipment.manage = ['ADMIN']` — `src/services/auth/authorization-service.ts:104`; оба обработчика PUT/DELETE вызывают `assertCan` — `src/app/api/equipment/[id]/route.ts:65,131`.
- Аудит списания пишется отдельным действием `equipment.retired` с before/after — `src/app/api/equipment/[id]/route.ts:109-118`, текст — `src/services/audit/audit-service.ts:763-767`; тест — `src/app/api/equipment/[id]/__tests__/route.test.ts:114-132`.
- Обратимо: тот же PUT с `isActive: true` (`UpdateEquipmentCommand.isActive`) возвращает в парк — `src/modules/equipment/domain/equipment.aggregate.ts:33-41`.
- Списанная установка не допускается к новым сменам/дефектам/нарядам-допускам (`isActive: true` в трёх репозиториях, 4 вызова `requireEquipment`).
- Готовность скрывает вердикт/балл: `mode: 'inactive'` — `src/components/piling/to/readiness/authoritative-presentation.ts:211`; и `src/components/piling/to/readiness-model.ts:169-182` (BLOCKED, `canOperate:false`).
- Жёсткое удаление установки с историей запрещено, предлагает списание — `src/modules/equipment/application/commands/equipment-command.service.ts:94-121`.
- Флотские KPI считают только активные — `src/modules/equipment/application/queries/equipment-query.service.ts:350`.

## Не проверено

- Не запускал приложение/скрипты (только чтение по условию задачи): выводы о 500 при пуске смены (находка 3), о падении проекции outbox и о поведении DLQ (находка 2) — из чтения кода, не воспроизведены запуском. Помечены ГИПОТЕЗА.
- Не проверял, течёт ли `Authoritative equipment row is unavailable` в Sentry/алерт: путь `withMutation`→500 — по `src/app/api/readiness/_shared/route-adapter.ts:23-28`; фактический HTTP-код не измерял.
- Не проверял поведение `e2e/` и `vitest` (не запускал, счётчиков нет). Отдельного e2e-сценария на списание нет (26 spec-файлов в `e2e/`, ни один не про `isActive=false` установки).
- Не смотрел frozen-зоны глубоко (operator screen variants, ORION) — использовал только как ссылки; правки в них не входят в задачу. `buildWorkWarnings`/`production-permit` (EQUIPMENT_INACTIVE) живут в `src/modules/operator-mobile/**` — детально не проверял, как эти предупреждения доходят до конкретных экранов.
- Не проверял, отфильтрованы ли списанные установки в остальных выпадающих списках (наряд-допуск, осмотры, дашборды аналитики) — проверены только форма бригады и `/api/equipment`.
- Не проверял планировщик в проде (расписание/интервал `PM_SCHEDULER_INTERVAL_MS` — только чтением, `src/workers/unified-worker/pm-scheduler.ts:16-17`).
