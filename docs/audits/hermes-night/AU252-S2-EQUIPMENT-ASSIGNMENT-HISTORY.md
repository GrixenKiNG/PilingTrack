# AU252-S2-EQUIPMENT-ASSIGNMENT-HISTORY: История закрепления техники

**Git revision:** `fd8d59bb6d0b66222431ef6147cffeb585284d6f`

---

## Итог

- **Критично:** 2 — история закрепления техники за объектом/бригадой **не сохраняется** в-queryable виде; при переносе задним числом в карточке установки **нет следа** предыдущих закреплений.
- **Важно:** 3 — события `CrewEquipmentAssigned` пишутся в OutboxEvent, но нет проекции/хендлера для сборки истории; audit-лента пишет `crew.updated` с before/after, но не фильтруется по equipmentId.
- **Мелочь:** 1 — вкладка «Закрепление» показывает только текущую бригаду, якоря `#history` ведут на историю отчётов, а не на историю закреплений.
- **Всего находок:** 6 (2 критичных, 3 важных, 1 мелочь).
- **Главное:** при смене установки на другую бригаду/объект пользователь видит только текущее состояние; как, когда и кем была изменена привязка — узнать невозможно ни в UI, ни через API.

---

## Методика

1. **Схема БД** (`prisma/schema.prisma:1-2883`): поиск моделей `EquipmentAssignment`, `EquipmentAssignmentHistory`, `CrewHistory`, `TelematicsDeviceAssignment` (есть, но для телематики).
2. **Доменные агрегаты** (`src/modules/crews/domain/crew.aggregate.ts:98-105`, `crew.events.ts:5-13`): метод `assignEquipment` эмитит `CrewEquipmentAssigned`.
3. **Репозиторий** (`src/modules/crews/infrastructure/crew.repository.ts:44-61`): события уходят в `OutboxEvent` вместе с данными бригады.
4. **Командный сервис** (`src/modules/crews/application/commands/crew-command.service.ts:267-269`): `updateCrew` вызывает `assignEquipment` при смене `equipmentId`.
5. **Event handlers** (`src/services/reports/event-handlers.ts:678-682`): `registerAllEventHandlers()` регистрирует только отчётные события; crew-события **не обработаны**.
6. **Equipment Detail API** (`src/modules/equipment/application/queries/equipment-query.service.ts:69-213`): `getEquipmentDetails` возвращает только текущую активную бригаду (`equipment.crews[0]`) и таймлайн отчётов.
7. **UI карточки** (`src/components/piling/admin-equipment/detail/equipment-detail.tsx:302-320`, `336-344`): вкладка `assignment` — только текущее закрепление; вкладка `history` — история отчётов (работ), не закреплений.
8. **Audit service** (`src/services/audit/audit-service.ts:548-557`): `crew.updated` пишется с `before/after`, но scope=`crews`, фильтр по equipmentId не предусмотрен.

---

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|----------|-----------|----------|------------------------|--------------------------|
| 1 | критично | `prisma/schema.prisma:1858-1883` | Нет таблицы истории закреплений оборудования. Модель `Crew` хранит только **текущий** `equipmentId`, `siteId`, `operatorId`. Предыдущие значения перезаписываются. | Админ переносит установку с объекта А на Б задним числом (исправление ошибки диспетчера). В карточке установки и в аудите **нет следа**, что она была на объекте А. | Добавить модель `EquipmentAssignmentHistory` (append-only: equipmentId, crewId, siteId, operatorId, startedAt, endedAt, reason, changedById) или проекцию из OutboxEvent. |
| 2 | критично | `src/services/reports/event-handlers.ts:678-682` | `registerAllEventHandlers()` не регистрирует хендлеры для `CrewDomainEvent` (`CrewEquipmentAssigned`, `CrewAssigned`, `CrewOperatorAssigned`). События скапливаются в `OutboxEvent`, но **никто их не читает** для построения истории. | Даже если в OutboxEvent лежат все события смены закрепления, нет проекции, которую мог бы прочитать API карточки установки. | Написать `registerCrewEventHandler()`, который по `CrewEquipmentAssigned`/`CrewAssigned` апсертит строки в новой таблице истории или материализованном представлении. |
| 3 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:69-213` | `getEquipmentDetails` возвращает `crew: equipment.crews[0] ?? null` — только **текущую** активную бригаду. История закреплений не запрашивается. | В карточке установки («Текущая работа», вкладка «Закрепление») пользователь видит только «где сейчас», а не «где была». | Добавить запрос истории закреплений (новой таблицы или проекции) и вернуть в ответе `assignmentHistory: AssignmentHistoryRow[]`. |
| 4 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:302-320` | Вкладка `assignment` (`tab === 'assignment'`) рендерит только **текущее** закрепление. Пустое состояние: «Установка не закреплена за активной бригадой.» | Пользователь заходит в карточку, видит текущую бригаду, но не может узнать, была ли установка на другом объекте на прошлой неделе. | В вкладке `assignment` добавить раздел «История закреплений» (таблица: период, объект, бригада, оператор, кем изменено). |
| 5 | важно | `src/services/audit/audit-service.ts:548-557` | `crew.updated` пишется в feedback-ленту с `before/after` снапшотами (включая `equipmentId`), но scope=`crews`. В ленте администратора события фильтруются по `scope`/`targetId`, **не по equipmentId**. | Админ ищет в аудите «что было с установкой ЛРХ-100» — не найдёт, потому что цель события — crewId, а не equipmentId. | Добавить в `recordAuditEvent` при `scope='crews'` дублирующую запись с `targetId=equipmentId` (или расширить запрос ленты фильтром по equipmentId в metadata). |
| 6 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:336-344`, `399-415` | Вкладка `history` и секция «История работ» показывают `timeline` отчётов (работы/простои). Якорь `#history` ведёт туда. Нет якоря/вкладки для истории **закреплений**. | Пользователь жмёт «История» в надежде увидеть переезд установки — видит только сводку выработки. | Добавить отдельную вкладку/якорь `assignment-history` (после реализации №1–№4). |

---

## Не проверено

| Область | Причина |
|---------|---------|
| Есть ли в `OutboxEvent` накопленные события `CrewEquipmentAssigned` за прошлые месяцы | Нужен прямой SQL-запрос к прод/стейджинг БД; в кодовой базе подтверждено только то, что события эмитятся и записываются в outbox. |
| Работает ли soft-delete бригад (`isActive=false`) как маркер окончания закрепления | В коде (`crew.aggregate.ts:107-115`) деактивация brigades эмитит `CrewDeactivated`, но это не привязывает конец закрепления к equipmentId — бригада может быть деактивирована по другой причине. |
| Используется ли `TelematicsDeviceAssignment` как прокси для истории закреплений техники | Эта таблица (schema:1725-1740) хранит привязку **бокса телеметрии** к equipment, а не бригады/объекта. Не подходит. |
| Есть ли планы по введению смен (day/night crews на одной установке) | В комментарии `schema.prisma:1862-1865` сказано: «обратное ограничение сохраняется: установка остаётся за одной активной бригадой». Если появятся смены, модель истории станет обязательной. |
| Как ведётся история в `Report` (equipmentId nullable, onDelete: SetNull) | Отчёты хранят `equipmentId` на момент создания — это **косвенная** история работ, но не закреплений (бригада/объект могут меняться внутри отчёта). |

---

## Приложение: таблица действий → файл:строка → история → тест

| Действие | Файл:строка | История сохраняется? | Тест |
|----------|-------------|---------------------|------|
| Создание бригады с установкой | `crew-command.service.ts:161-166` | `CrewCreated` в OutboxEvent (есть equipmentId) | `crew-aggregate.test.ts:209-219` — проверяет эмит события |
| Смена установки у бригады | `crew-command.service.ts:267-269` | `CrewEquipmentAssigned` в OutboxEvent | Нет теста на чтение истории по equipmentId |
| Перенос бригады на другой объект | `crew-command.service.ts:271-273` | `CrewAssigned` в OutboxEvent (siteId) | Нет теста на чтение истории по equipmentId |
| Смена оператора у бригады | `crew-command.service.ts:263-265` | `CrewOperatorAssigned` в OutboxEvent | Нет теста на чтение истории по equipmentId |
| Деактивация бригады | `crew-command.service.ts:359-361` | `CrewDeactivated` в OutboxEvent | Нет теста на чтение истории по equipmentId |
| Чтение карточки установки | `equipment-query.service.ts:69-213` | Только текущая активная бригада | Нет теста на наличие истории закреплений |
| Аудит действий с бригадой | `audit-service.ts:548-557` | `crew.updated` с before/after в feedback | Нет теста на фильтрацию по equipmentId |

---

## Статусы проверки

| Проверка | Статус | Доказательство |
|----------|--------|----------------|
| Таблица истории закреплений в схеме | **НЕТ** | `prisma/schema.prisma` — нет модели `EquipmentAssignmentHistory` |
| Доменное событие эмитится | **ПРОЙДЕНО** | `crew.aggregate.ts:103` — `createCrewEvent('CrewEquipmentAssigned', ...)` |
| Событие пишется в OutboxEvent | **ПРОЙДЕНО** | `crew.repository.ts:44-61` — `tx.outboxEvent.createMany` |
| Есть хендлер, собирающий проекцию | **НЕТ** | `event-handlers.ts:678-682` — только репортные события |
| API возвращает историю закреплений | **НЕТ** | `equipment-query.service.ts:205-213` — возвращает только `crew` (текущая) |
| UI показывает историю закреплений | **НЕТ** | `equipment-detail.tsx:302-320` — только текущее закрепление |
| Аудит фильтруется по equipmentId | **НЕ ПРОВЕРЕНО** | `audit-service.ts:548-557` — scope=`crews`, targetId=`crewId` |

---

## Резюме для владельца (5 строк)

1. История закреплений техники **не хранится** в БД — только текущее состояние в таблице `Crew`.
2. События смены закрепления (`CrewEquipmentAssigned`) пишутся в `OutboxEvent`, но **никто их не читает** — нет проекции.
3. В карточке установки (`/admin/equipment/[id]`) видно только «где сейчас», переезды задним числом **не оставляют следа**.
4. Аудит-лента пишет `crew.updated` с before/after, но искать по установке нельзя — цель события `crewId`.
5. Нужен append-only журнал (таблица или проекция) + вкладка «История закреплений» в карточке + хендлер для OutboxEvent.