# W117 — Изменения данных без записи в журнал аудита

## Итог

- Проверено 86 файлов маршрутов `src/app/api/**/route.ts` с обработчиками `POST/PUT/PATCH/DELETE`, плюс все сервисы и модули с записью в БД (`src/services`, `src/modules`).
- В проекте два журнала: **основной** (`recordAuditEvent` → `FeedbackEvent`, лента видна владельцу в `/admin`) и **цепочечный** контура готовности (`recordChainedReadinessAudit` → таблица `AuditLog`, отдельный реестр).
- Найдено **26 изменений данных без записи в журнал аудита**: **14 — важно** (сначала высокий риск), **12 — мелочь**.
- Всё, что делает контур готовности (`readiness/**`), настройки, пользователи, роли, бригады, объекты, справочники, допуски к технике, Telegram-каналы, отчёты — **пишется в журнал** (через `recordAuditEvent`, цепочку `AuditLog` или outbox-события отчётов). Это не находки, но проверено.
- **Самое важное:** выдача и отзыв ключей устройств телеметрии (`/api/equipment/[id]/device-keys`) не оставляет следа в журнале — выданный/отозванный доступ к записи телеметрии неотличим от «никто не трогал» (`src/services/telemetry/device-key-service.ts:72` и `:155`).
- Ещё заметно: **разбор происшествия** (`POST /api/admin/incidents`) меняет `SafetyIncident` прямым `db` в маршруте без аудита (route.ts:118), а шаблоны осмотров, создание/правка осмотров, инструктажи и часть создания карточек техники/топлива/регламентов ТО — без записи в ленту.
- Все удаления, найденные в коде, кроме «мелочи» (DLQ, layout, media, личные подсказки), **аудируются**. Изменение **прав** (роли пользователей, допуски к технике) аудируется; исключение — ключи устройств.

## Методика

Что искал и как (воспроизводимо):

1. `search_files`/скрипты по `src/app/api`: все `route.ts` с `export (async function|const) (POST|PUT|PATCH|DELETE)` — 86 файлов.
2. Для каждого маршрута: есть ли в файле маркеры журнала (`recordAuditEvent`, `audit`, `appendAuditEvent`, `recordChainedReadinessAudit`, `AUDIT_`).
3. Скрипт-обход `src/services` и `src/modules` (без `__tests__`): поиск записей БД (`.create|update|delete|upsert|updateMany|deleteMany|createMany(`) и маркеров журнала в том же файле → список кандидатов без аудита, затем ручное чтение каждого.
4. Ручная проверка транзитивных цепочек «маршрут → сервис/модуль → запись» (например, `equipment/[id]/fuel` → `addFuelEntry` → `fuel-log.ts`).
5. Отдельно подтверждено, что аудит есть: readiness (`recordChainedReadinessAudit` в `shifts/commands.ts`, `permits/commands.ts`, `defects/commands.ts`, `scheduler.ts`, `access-matrix-service.ts`, `readiness-rules-service.ts`), sites (`site-admin-command.service.ts:128…340`), crews (`crew-command.service.ts:199…364`), users (`user-service.ts:177…369`, `user-documents.ts:233`, `user-document-types.ts:83…152`), допуски к технике (`app/api/safety/equipment-permits/*:90`), настройки, Telegram-каналы, проекции.
6. Отчёты: аудит идёт **косвенно** — `upsertReport` пишет outbox-события в той же транзакции (`report.repository.ts:234`), а `handleAuditEvent` (`event-handlers.ts:449`) регистрируется на `REPORT_CREATED/UPDATED/SUBMITTED/VERSION_CREATED` и вызывает `recordAuditEvent`. Поэтому `/api/reports/upsert` и `/api/reports/admin-upsert` считаются покрытыми (в т.ч. админский путь, который сам `recordFeedbackEvent` не зовёт).
7. Проверено, что нет других поверхностей изменений: `grep "use server"` — серверных экшенов нет; прямых записей в `db` вне `api/` в `src/app` нет.

## Находки

Формат: `# | severity | path:line | проблем | сценарий/почему важно | что делать`.

### Высокий/средний риск (важно)

| # | severity | path:line | проблема | почему важно | предлагаемое исправление |
|--|--|--|--|--|--|
| 1 | важно | `src/app/api/admin/incidents/route.ts:118` | `POST` разбора происшествия делает `db.safetyIncident.updateMany` (reviewedAt/reviewedById/reviewNote) — прямого `recordAuditEvent` нет | Разбор происшествия по безопасности меняет запись без следа в ленте: кто и когда признал происшествие разобранным — не видно владельцу | Вызывать `recordAuditEvent` после успешного `updateMany` (action `incident.reviewed`, targetId — id) |
| 2 | важно | `src/services/telemetry/device-key-service.ts:72` | `provisionDeviceKey` создаёт `DeviceKey` (ключ записи телеметрии) без аудита; маршрут `/api/equipment/[id]/device-keys` POST тоже без аудита | Выдача ключа = выдача доступа на запись телеметрии по установке; в ленте не видно, кто и когда выдал | `recordAuditEvent` в сервисе или в маршруте (action `deviceKey.provisioned`, targetId — equipmentId/keyId) |
| 3 | важно | `src/services/telemetry/device-key-service.ts:155` | `revokeDeviceKey` меняет `DeviceKey.revoked` без аудита; `/api/equipment/[id]/device-keys` DELETE без аудита | Отзыв доступа неотличим от «никто не трогал»; при разборе инцидента с телеметрией это ключевой факт | `recordAuditEvent` (action `deviceKey.revoked`) |
| 4 | важно | `src/modules/inspections/application/commands/template-commands.ts:27` | `createTemplate` создаёт `ChecklistTemplate` (со секциями/пунктами) без аудита; `POST /api/checklist-templates` без аудита | Шаблон осмотра задаёт, что и как проверяют; правку состава проверок в ленте не видно | Добавить `recordAuditEvent` (напр. `inspection.template.created`) |
| 5 | важно | `src/modules/inspections/application/commands/template-commands.ts:74` | `deleteTemplate` деактивирует шаблон (`update … isActive:false`); используется и в `PUT`, и в `DELETE /api/checklist-templates/[id]` | Деактивация шаблона меняет доступные проверки, следа нет | `recordAuditEvent` (`…template.deactivated`) при деактивации смены/удалении |
| 6 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:200` | `startInspection` создаёт `Inspection`; `:146`/`:156` `startToInspection` создаёт `MaintenanceRecord`+`Inspection`; `POST /api/inspections` без аудита | Заведение осмотра — начало допускового акта (блочный старт) | `recordAuditEvent` при старте осмотра |
| 7 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:283,294,296` | `saveAnswers` переписывает ответы осмотра (`inspection.updateMany`, `inspectionAnswer.deleteMany`/`createMany`); `PUT /api/inspections/[id]` без аудита | Содержимое осмотра переписывается целиком; без строки в ленте не видно, кто менял ответы до завершения | `recordAuditEvent` при сохранении ответов (action `inspection.answers_saved`) |
| 8 | важно | `src/modules/safety/application/briefing-commands.ts:83` | `conductBriefing` создаёт `BriefingRecord` (журнал инструктажей) без аудита; `POST /api/briefings` без аудита | Учёт инструктажей — область ОТ; запись сама хранит автора, но событие в ленту не попадает | `recordAuditEvent` (`briefing.conducted`) |
| 9 | важно | `src/modules/safety/application/briefing-commands.ts:139` | `signBriefingRecord` меняет `employeeSignedAt`/`instructorSignedAt` без аудита; `POST /api/briefings/[id]/sign` без аудита | Подпись под инструктажем — момент подтверждения; в ленте его нет | `recordAuditEvent` (`briefing.signed`) |
| 10 | важно | `src/modules/equipment/application/commands/equipment-document.ts:41` | `createEquipmentDocument` создаёт `EquipmentDocument` без аудита; `POST /api/equipment/[id]/documents` без аудита (при этом `PUT`/`DELETE` того же документа аудируются) | Асимметрия: правку и удаление документа видно, а заведение — нет | Добавить аудит на создание (`equipment.document.created`) |
| 11 | важно | `src/modules/equipment/application/commands/fuel-log.ts:117` | `addFuelEntry` создаёт `FuelLog` без аудита; `POST /api/equipment/[id]/fuel` без аудита (а `DELETE /fuel/[entryId]` аудируется) | По топливу считают расход/приписки; заведение записи не видно, а удаление — видно | Добавить аудит на создание записи о топливе |
| 12 | важно | `src/modules/equipment/application/commands/maintenance-plan.ts:56` | `createMaintenancePlan` создаёт `MaintenancePlan` без аудита; `POST /api/maintenance-plans` без аудита (`PATCH`/`DELETE` `[id]` аудируются) | Заведение регламента ТО определяет сроки обслуживания; следа нет | Добавить аудит на создание регламента |
| 13 | важно | `src/modules/equipment/application/commands/pm-scheduler.ts:119` | `runPmScheduler` создаёт `MaintenanceRecord` (наряды ТО) по расписанию; `POST /api/maintenance-plans/run` без аудита | Автозаведение нарядов ТО не оставляет актора в ленте (ручные наряды аудируются) | `recordAuditEvent` c пометкой «авто», как для автосдачи отчётов |
| 14 | важно | `src/app/api/admin/incidents/route.ts:25` (`GET`) | — см. п.1; маршрут ведёт учёт происшествий, `POST` — единственная мутация и без аудита | Разбор происшествий — учёт ОТ на уровне конторы | См. п.1 |

### Мелочь (UI, служебные очереди, машинные данные)

| # | severity | path:line | проблема | почему важно | предлагаемое исправление |
|--|--|--|--|--|--|
| 15 | мелочь | `src/core/outbox/dead-letter-queue.ts:119,130,154` | `POST /api/admin/dlq` (retry/discard) меняет `DeadLetterQueue`/создаёт `OutboxEvent` без аудита (`app/api/admin/dlq/route.ts:124,131`) | Операторская работа с очередью не видна в ленте | `recordAuditEvent` (`dlq.retried`/`dlq.discarded`) |
| 16 | мелочь | `src/modules/layout/application/layout-service.ts:85` | `saveLayout` (`PUT /api/layout/[surfaceId]`) делает `moduleLayoutTemplate.upsert` без аудита | Изменение макета рабочего места — только UI, влияния на данные нет | Опционально: аудит `layout.saved` |
| 17 | мелочь | `src/modules/layout/application/layout-service.ts:106` | `deleteLayout` (`DELETE /api/layout/[surfaceId]`) `deleteMany` без аудита | То же — UI-макет | Опционально |
| 18 | мелочь | `src/modules/monitoring/application/template-service.ts:21` | `PUT /api/monitoring/template` → `saveLayout` (тот же `layout-service`) без аудита | Плитка мониторинга — UI | Опционально |
| 19 | мелочь | `src/core/media/media-service.ts:139` | `POST /api/media` создаёт `Media` (presigned upload) без аудита | Загрузка файла; может быть доказательством, но вложения аудируются косвенно | Опционально |
| 20 | мелочь | `src/core/media/media-service.ts:306` | `POST /api/media/[id]/confirm` подтверждает загрузку (`media.update`) без аудита | То же | Опционально |
| 21 | мелочь | `src/core/media/media-service.ts:409` | `DELETE /api/media/[id]` удаляет `Media` без аудита | Удаление файла-доказательства не оставляет следа | Аудит удаления вложения |
| 22 | мелочь | `src/app/api/readiness/place-presets/route.ts:42` | `POST` сохраняет личную подсказку `UserPlacePreset.upsert` без аудита | Список личный, не влияет на данные организации | Не требуется |
| 23 | мелочь | `src/app/api/readiness/place-presets/route.ts:77` | `DELETE` `UserPlacePreset.deleteMany` без аудита | То же | Не требуется |
| 24 | мелочь | `src/app/api/telemetry/ingest/route.ts:332` | `POST`/`PATCH` пишут `TelemetryRecord.createMany` без аудита (машинный путь по ключу устройства) | Данные датчиков, не действие человека; аудит тут обычно не ведут | Пометить как «по замыслу» либо логировать факт партии |
| 25 | мелочь | `src/app/api/telemetry/batch/route.ts:138` | `POST` → `ingestTelemetryBatch` пишет телеметрию без аудита | То же | Опционально |
| 26 | мелочь | `src/app/api/alerts/webhook/route.ts:142,151` | `POST` (Alertmanager) upsert/создаёт `OutboxEvent` без аудита | Технический вебхук мониторинга, не пользовательское изменение данных | Не требуется |

## Что проверено и НЕ является находкой

- `readiness/**` (смены, допуски-наряды, дефекты, правила, матрица доступа, планировщик) — аудит через `recordChainedReadinessAudit` в отдельный цепочечный реестр `AuditLog` (`shifts/commands.ts:71`, `permits/commands.ts:74`, `defects/commands.ts:71`, `scheduler.ts:140,178`, `access-matrix-service.ts:135`, `readiness-rules-service.ts:132,162,259`). **Важно:** этот реестр — не та лента, что видит владелец в `/admin` (там только `FeedbackEvent`). События контура готовности в основной ленте не появляются.
- Пользователи/роли (`user-service.ts:177,306,368`), документы работников (`user-documents.ts:233`), виды документов (`user-document-types.ts:83,124,151`), допуски к технике (`api/safety/equipment-permits/route.ts:90`, `[id]/route.ts:29`).
- Объекты (создание/правка/удаление/схема/закрепление — `site-admin-command.service.ts:128,228,270,297,325,340`), бригады (`crew-command.service.ts:199,322,363`), справочники (`dictionary-service.ts`), настройки, Telegram-каналы, проекции.
- Техника: создание/правка/удаление/метрология/ТО/топливо (удаление) — аудит на уровне маршрутов (`api/equipment/**`).
- Отчёты — аудит через outbox-события (`report.repository.ts:234` → `event-handlers.ts:449`), покрывает и операторский `/reports/upsert`, и `/reports/admin-upsert`.
- Удаления: `reports/delete` (аудит), документы/топливо/моточасы/наряды ТО/допуски — аудируются на уровне маршрутов.

## Не проверено

- **OSV/`git`-история**: не сверял, не удалён ли аудит из этих мест намеренно ранее (проверял только текущее состояние кода).
- **Полнота outbox-пути отчётов в рантайме**: подтверждено по коду (транзакция + регистрация обработчика), но фактический прогон воркера outbox в этой сессии не запускался — «аудит отчётов работает» проверено статически, не по факту записи строки.
- **Воркеры и планировщики** (`src/workers/**`): их записи в БД смотрел выборочно; сплошной описи «воркер → аудит» нет.
- **`src/modules/operator-mobile/**`, `src/app/api/operator/**`, `src/app/api/assistant/command`, ORION** — замороженные области, по правилам не проверял (там есть записи в БД без видимого аудита, но это вне рамок).
- **Прямые записи в БД в `src/core/**`** (кроме перечисленных) сплошняком не разбирал — только те, что достижимы из найденных маршрутов.
- Классификация «важно/мелочь» — по характеру данных и по правилу задачи (удаления и права = выше), а не по оценке рисков безопасности.
