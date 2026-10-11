# AU201-S2 — Перевод техники между объектами

Версия кода: `git rev-parse HEAD` = `6c11a801250c56eb4c4832fe544f095213d7d9db` (ветка `hermes/q4-0926`).
Только чтение: файлы приложения не менялись. Единственный созданный файл — этот отчёт.

## Итог

Перевод техники между объектами в коде НЕ является отдельной операцией: техника
(Equipment) не имеет поля «объект», объект машины — это объект её единственной
активной бригады (`Crew.siteId`). «Перевести» = отредактировать бригаду и сменить
у неё «Объект». Значит объём находок: 1 критичная, 3 важных, 3 мелочи (7 всего,
0 из них покрыто тестами). Топ:

1. `updateCrew` не знает про смены (в модуле `crews` слово «shift» встречается
   один раз — в комментарии). Правка бригады при открытой смене не запрещена и не
   предупреждает. Если при переводе сменить и машиниста (или установку) — открытую
   смену не сможет закрыть НИ старый машинист (его бригада уже не та), НИ новый
   (`requireOpenShift` → 403). Машина заперта до автозакрытия планировщиком или
   отмены диспетчером.
2. Отчёт смены берёт объект из `crew.siteId` в момент создания записи и больше
   никогда не обновляется (`ensureReport`, `update: {}`). Перевод среди смены
   молча решает, на какой объект попадёт отчёт, — по времени первой записи.
3. Наряд-допуск не привязан к объекту: держит машину и свободный текст «объект»;
   при переводе остаётся согласованным на новой площадке.
4. Перевод на неактивный объект разрешён; бригада и техника «исчезают» из
   карточки объекта (та фильтрует `isActive`), оставаясь в работе.

## Методика

Поиск и чтение (полные пути от корня репозитория `D:\PillingR\wt-night`):

- Модель: `prisma/schema.prisma` — модели Equipment (стр. 440), Crew (1858), Shift
  (1081), Report (1927), WorkPermit (1442), Site (1746), MaintenanceRecord (580).
- `rg -n "siteId|equipmentId|operatorId" prisma/schema.prisma` — связь «техника ↔ объект».
- `rg -n "assignToSite|assignEquipment" src` — точку перевода; `rg -n "перев|transfer|reassign" src`.
- Чтение целиком: `src/modules/crews/application/commands/crew-command.service.ts`,
  `src/modules/operator-mobile/application/commands/shift-close.ts`,
  `.../commands/shared.ts`, `.../commands/production.ts`, `.../commands/equipment.ts`.
- Готовность: `src/modules/readiness/application/{readiness-facts.ts,shifts/start-decision.ts,scheduler.ts}`,
  `src/modules/readiness/domain/shifts/transitions.ts`.
- Чтение объекта: `src/modules/sites/application/queries/site-query.service.ts`,
  `src/modules/equipment/application/queries/equipment-query.service.ts`.
- Тесты: `rg -n "shift" src/modules/crews -i` (1 совпадение — комментарий);
  `crew-command-service.test.ts`, `src/app/api/crews/[id]/__tests__/route.test.ts`.
- Уникальность: `prisma/migrations/20260624000000_crew_equipment_active_unique/migration.sql`.
- Числа: `rg -c "updateCrew" src -l | wc -l` = 7; `rg -n "shift" src/modules/crews -i | wc -l` = 1.

## Шаги перевода (что происходит по коду)

| шаг | файл:строка | эффект | тест |
|---|---|---|---|
| Открыть форму бригады, сменить «Объект» | src/components/piling/admin-crews/crew-form-dialog.tsx:306 | селект объекта; при сохранении уходит весь состав бригады (operator/equipment/site) | src/components/piling/admin-crews/__tests__/admin-crews.test.tsx (форма), смены не проверяются |
| `PUT /api/crews/[id]` | src/app/api/crews/[id]/route.ts:34 | `assertCan('crews.manage')`, `requireTenantId`, `updateCrewSchema` | src/app/api/crews/[id]/__tests__/route.test.ts:110 (проброс tenantId) |
| `updateCrew`: проверка тенанта | src/modules/crews/application/commands/crew-command.service.ts:212 | `requireTenantCrew` (fail-closed) | crew-command-service.test.ts:392 |
| `updateCrew`: валидация связей + тенант | src/modules/crews/application/commands/crew-command.service.ts:226 | объект ищется без фильтра `isActive` (:230,:238); `assertSameTenant` (:250) | нет теста на неактивный объект |
| `updateCrew`: одна бригада на установку | src/modules/crews/application/commands/crew-command.service.ts:257 | только если меняется `equipmentId`; DB-инвариант есть (миграция) | crew-command-service.test.ts:523 |
| `updateCrew`: запись | src/modules/crews/application/commands/crew-command.service.ts:271 | `assignToSite` → `save` (upsert + outbox `CrewAssigned`), аудит `crew.updated`, сброс кэша | нет теста на смену объекта |
| Проверка открытых смен | — | ОТСУТСТВУЕТ: `rg -n "shift" src/modules/crews` = 1 (комментарий :34) | — |
| Смена: к какому объекту относится | prisma/schema.prisma:1081 | у смены НЕТ `siteId`; объект смены = текущий `Crew.siteId` | — |
| Отчёт смены: объект | src/modules/operator-mobile/application/commands/shift-close.ts:77,285 | `siteId: crew.siteId` в момент закрытия/сдачи | shift-close.test.ts (объект не менялся) |
| Отчёт: первая запись выработки | src/modules/operator-mobile/application/commands/shared.ts:398 | `ensureReport` create с `siteId`, `update: {}` — объект замораживается первым касанием | production.test.ts (объект не менялся) |
| Отчёт: пикет чужого объекта | src/modules/operator-mobile/application/commands/production.ts:312 | после перевода пикеты старого объекта отвергаются 400 | production.test.ts |
| Наряд-допуск | prisma/schema.prisma:1442 | держит `equipmentId`/`shiftId`; «объект» — свободный текст `objectName` (:1469) | нет |
| Наряд ТО | prisma/schema.prisma:580 | только `equipmentId`, объект не участвует | нет |
| Готовность | src/modules/readiness/application/readiness-facts.ts:62 | `permitValid` считается по машине; объект в расчёт не входит | readiness-rules-service.test.ts |
| Автозакрытие брошенной смены | src/modules/readiness/application/scheduler.ts:161 | DAY закрывается после 00:00 след. суток (19+5), NIGHT — после 12:00 (7+5) | scheduler.test.ts |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | src/modules/crews/application/commands/crew-command.service.ts:211-338 (нет проверки смены); src/modules/operator-mobile/application/commands/shared.ts:31-41 и :70 | `updateCrew` меняет `operatorId`/`equipmentId`/`siteId` при открытой смене без проверки. Открытая смена цепляется за `equipmentId`, а закрыть её может только машинист с активной бригадой на этой машине (`requireCrew` по `operatorId+equipmentId`). | Диспетчер переводит копёр на новый объект и закрепляет за ним другого машиниста. Старый машинист `closeShift` → `requireCrew` не находит его бригаду → 403 (`shift-close.ts:52`). Новый машинист `acceptEquipment` → смена открыта → `requireOpenShift` видит чужого стартера (`shared.ts:70`) → 403 «Эту смену ведёт другой машинист». Машину нельзя ни принять, ни закрыть. Тот же класс — если у бригады сменили `equipmentId` (копёр остался без бригады). Выход только внешний: автозакрытие планировщиком (`scheduler.ts:73,76` — DAY после 00:00, NIGHT после 12:00 след. суток) или отмена смены диспетчером (`readiness/domain/shifts/transitions.ts:11` разрешает `cancel` из `STARTED`) — но не отчёт оператора. Тест: отсутствует. | Перед сменой бригадных полей: если у машины есть смена в `STARTED`/`HANDOVER_PENDING` — запрещать смену оператора/установки (409 с текстом). Смену объекта разрешать только после закрытия/отмены смены. |
| 2 | важно | src/modules/operator-mobile/application/commands/shared.ts:398-422 (`ensureReport`, `update: {}` :417); shift-close.ts:77,285; production.ts:209 | Объект отчёта берётся из `crew.siteId` при СОЗДАНИИ отчёта и не обновляется (`update: {}`). | Перевод среди смены до первой записи выработки → отчёт уходит на НОВЫЙ объект; если запись уже была → остаётся на СТАРОМ, даже когда машина уже на новом. Итог: объект одного отчёта зависит от секунды, когда оператор внёс первую сваю. Диспетчер видит смену на объекте, где машины нет (или наоборот). Тест: нет. | Либо запрещать перевод при открытой смене (см. №1), либо хранить объект смены в самой смене (`Shift.siteId`) и оттуда брать `siteId` отчёта. |
| 3 | важно | src/modules/readiness/application/readiness-facts.ts:62; prisma/schema.prisma:1469 | Наряд-допуск (`WorkPermit`) не связан с объектом: держит машину и свободный текст `objectName`. Готовность считает `permitValid` по машине. | Наряд, выписанный на «Объект А», после перевода машины на «Объект Б» остаётся согласованным и учитывается как валидный для машины; в наряде по-прежнему «Объект А». Никакого переоформления/аннулирования перевод не инициирует. Риск: машина выпускается на новой площадке под наряд старой. | При переводе показывать открытые наряды машины и требовать подтверждения/переоформления; или добавить проверку «наряд и объект смены совпадают» в пусковой гейт. |
| 4 | важно | src/modules/crews/application/commands/crew-command.service.ts:144,151 (create), :230,238 (update) | Объект ищется без фильтра `isActive`. | Перевод/заведение бригады на деактивированный объект проходит. Карточка объекта фильтрует `isActive: true` (src/modules/sites/application/queries/site-query.service.ts:64) → бригада и её техника пропадают с площадки, но машина работает и сдаёт отчёты на «неактивный» объект. | Требовать `site.isActive === true` при закреплении бригады (как минимум предупреждать). |
| 5 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:304 (save без try/catch) vs :184 (create ловит UNIQUE→409); prisma/migrations/20260624000000_crew_equipment_active_unique/migration.sql:5 | DB-инвариант «одна активная бригада на установку» есть (частичный уникальный индекс), но `updateCrew` не переводит `P2002` в понятный 409. | При гонке двух правок (перевод той же машины одновременно) проигравший получит 500 вместо «Установка уже закреплена за активной бригадой». | Обернуть `repo.save` в `updateCrew` тем же перехватом UNIQUE, что в `createCrew`. |
| 6 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:507-533 | `listAllEquipment` применяет `siteId` ТОЛЬКО внутри ветки `operatorUserId`; для ADMIN/DISPATCHER (`operatorUserId=null`) фильтр по объекту молча игнорируется и возвращается вся техника тенанта. | `GET /api/equipment?siteId=X` под привилегированной ролью вернёт машины всех объектов. Сегодня потребителей `?siteId=` в UI не найдено (search_files: только `/api/equipment`, `/api/equipment/{id}`), поэтому это ловушка на будущее, а не утечка между объектами сегодня. | Вынести `siteId` в общий `where` (фильтр по активной бригаде-объекту), вне зависимости от `operatorUserId`. |
| 7 | мелочь | src/modules/crews/domain/crew.aggregate.ts:80-87; src/modules/crews/infrastructure/crew.repository.ts:44-61 | Перевод фиксируется в аудите (`crew.updated`, before/after с `siteId`, crew-command.service.ts:322) и порождает outbox `CrewAssigned` (tenantId берётся из НОВОГО объекта, crew.repository.ts:46). Отдельного «исторического» следа объект↔машина со временем нет. | Восстановить «на каком объекте машина была 5-го числа» можно только по цепочке аудита `crew.updated`; прямого журнала переводов нет. На сегодня достаточно, но при разборе споров о выработке это единственный источник. | Информационно; при необходимости — отдельная таблица/проекция истории переводов. |

## Что не проверено

- Реальные данные продакшена: сколько переводов уже сделано и были ли среди них
  переводы при открытой смене (нет доступа к БД — read-only, прод запрещён).
- Сценарий №1 (запертая смена) не воспроизводился на живой БД: вывод получен
  чтением кода (`requireCrew`, `requireOpenShift`, `acceptEquipment`). Статус —
  ГИПОТЕЗА, требующая интеграционного теста с базой.
- Автозакрытие (scheduler) в проде не наблюдалось; логика выведена из
  `scheduler.ts:73,76,161` и `isAutoCloseDue`. Статус — ГИПОТЕЗА.
- Права на маршрут отмены смены `POST /api/readiness/shifts/:id/cancel` не
  разбирались (достаточно было факта, что переход из `STARTED` разрешён,
  `transitions.ts:11`) — не проверено, какая роль им пользуется и сохраняется ли
  при отмене уже внесённая выработка.
- Влияние перевода на аналитику (`SiteDailySummary`, `SiteWeeklyTrend`,
  `equipment-analytics-service`) не проверялось: агрегаты строятся по
  `report.siteId` (снимок на момент отчёта), но пересчёт «задним числом» при
  переводе не проверялся. Статус — НЕ ПРОВЕРЕНО.
- e2e (`e2e/*`) на перевод техники не читались построчно; поиск сценария перевода
  бригады/объекта не дал отдельных spec-файлов.
