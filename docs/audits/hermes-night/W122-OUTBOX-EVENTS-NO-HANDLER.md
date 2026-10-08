# W122-OUTBOX-EVENTS-NO-HANDLER: события outbox без обработчика

Только чтение. Ветка `hermes/q4-0926`. Ни один существующий файл не изменён.

## Итог

Опись 23 типов событий, которые реально пишутся в таблицу `OutboxEvent`, и их
обработчиков. Критичных (деньги/права/отчёты) находок нет; главный дефект —
целый класс событий (crew/site/equipment, 14 типов), который пишется в outbox,
но нигде не обрабатывается и при этом НЕ порождает ошибку: `emitDomainEvent`
для не-отчётных типов молча логирует `warn` и возвращает управление, а
потребитель тут же помечает строку `published=true` (повтора и DLQ нет).

- Всего типов с записью в outbox: 23.
- Без обработчика: 14 (Crew* — 7, Site* — 4, Equipment* — 3), важность средняя.
- Объявлены и «подписаны», но никогда не пишутся: 6 типов (ReportUpdated,
  ReportVersionCreated, PileWorkRemoved, DrillingRemoved, DowntimeRemoved,
  CrewUnassigned) — мелочь.
- 4 находки важные, 3 мелочи.

Топ-5 по важности:
1. CrewCreated/Updated/Assigned/OperatorAssigned/EquipmentAssigned/Deactivated/
   Reactivated — нет обработчика (crew.repository.ts:60, crew.aggregate.ts).
2. SiteCreated/Updated/Activated/Deactivated — нет обработчика
   (site.repository.ts:29).
3. EquipmentCreated/Updated/Retired — нет обработчика
   (equipment.repository.ts:30, equipment-command.service.ts:41).
4. Механизм тихой потери: domain-events.ts:113-139 — не-отчётное событие без
   подписчика помечается published без ошибки, без ретрая и без DLQ.
5. ReportUpdated объявлен и на него подписаны analytics/сводка/аудит, но ни одна
   точка записи его не эмитит — обработчики мертвы.

## Методика

Проверял статически, по тексту, без запуска БД и без правок кода.

1. Поиск мест записи в outbox:
   `outboxEvent.create`, `outboxEvent.createMany`, `outboxEvent.upsert`
   (`grep -rn "outboxEvent\.\(create\|createMany\|upsert\)" src scripts e2e`).
   Найдено 7 не-тестовых путей записи (список ниже в таблице).
2. Типы событий — из мест записи: строковые литералы в
   `tx.outboxEvent.create*({ data: { type: ... } })` плюс типы, которые
   агрегаты кладут через `getPendingEvents()` и мапперы
   (`report.repository.ts:46 mapEventsToOutboxData`, `site.prisma.mapper.ts:48
   toOutboxData`, `crew.prisma.mapper.ts:39`, `equipment.prisma.mapper.ts:17`).
3. Обработчики — два независимых потребителя одной таблицы:
   - «шина отчётов»: `src/services/reports/domain-events.ts` (`on()` +
     `emitDomainEvent()`), подписчики регистрируются в
     `src/services/reports/event-handlers.ts` (`registerAllEventHandlers`) и
     `src/workers/register-readiness-projection.ts`;
   - «проекционный воркер»: `src/modules/reports/application/projections/
     projection-worker.ts` (`projectOutboxEvents` → `projectEvent`,
     `PROJECTABLE_EVENT_TYPES`), который зовёт `consumeReadinessProjectionEvent`
     (`src/modules/readiness/application/projection/consumer.ts:7`).
   Всё чтение таблицы — только в этих двух циклах
   (`outbox-publisher.ts:94`), плюс точечные чтения своей же строки
   (`event-handlers.ts:660`, `readiness/.../project-event.ts:27`).
4. Для каждого типа искал подписчика поиском строкового имени по всему
   `src/scripts/e2e` (не только grep по импортам) — так поймал, что
   Crew*/Site*/Equipment* встречаются только в определении типа агрегата,
   агрегате и тестах, но ни разу у подписчика.
5. Индекс GitNexus в этой задаче не использовал: предмет — текстовые имена
   типов в строковых литералах, которые граф символов не отражает. Опирался на
   текстовый поиск по правилу AGENTS.md §4.

## Находки

### Таблица 1. Опись «тип события | где пишется | где обрабатывается | риск»

Риск: высокий — если событие меняет деньги/права/отчёты; средний — остальное;
для неписаных (объявленных без записи) — мелочь.

| Тип события | Где пишется | Где обрабатывается | Риск |
|---|---|---|---|
| ReportCreated | report.aggregate.ts:154 → report.repository.ts:233 | шина: event-handlers.ts:30 (analytics), :450 (аудит); проекция: projection-worker.ts:131 | высокий |
| PileWorkAdded | report.aggregate.ts:186 → report.repository.ts:233 | шины-подписчика нет намеренно (domain-events.ts:56); проекция: projection-worker.ts:131 | высокий |
| DrillingAdded | report.aggregate.ts:208 → report.repository.ts:233 | шины-подписчика нет намеренно (domain-events.ts:56); проекция: projection-worker.ts:131 | высокий |
| DowntimeAdded | report.aggregate.ts:242 → report.repository.ts:233 | шина: event-handlers.ts:288 (алерт); проекция НЕ трогает (projection-worker.ts:125 — только Report/Pile/Drilling) | высокий |
| ReportSubmitted | report.aggregate.ts:272 → report.repository.ts:233; operator-mobile/.../shift-close.ts:321; readiness/.../scheduler.ts:220 | шина: event-handlers.ts:31,45,50,452,521 (analytics, сводка дня, кэш, аудит, Telegram); проекция: projection-worker.ts:131 | высокий |
| ReportDeleted | app/api/reports/delete/route.ts:116 | шина: event-handlers.ts:52 (только сброс кэша); проекция: projection-worker.ts:131 | высокий |
| ReadinessSnapshotRequested | readiness/.../request-snapshot.ts:40; readiness/.../shifts/commands.ts:88; permits/commands.ts:83; defects/commands.ts:82; readiness-rules-service.ts:201; scheduler.ts:263; inspections/.../inspection-commands.ts:472,492; equipment meter-reading.ts:228,279; equipment-maintenance.ts:117; pm-scheduler.ts:133; operator-mobile checklist.ts:278, equipment.ts:146, incidents.ts:108 | шина: register-readiness-projection.ts:29; проекция: projection-worker.ts:106 → consumer.ts:7 → project-event.ts:26 | высокий |
| NotificationDeliveryRequested | core/notifications/durable-alert.ts:13; app/api/alerts/webhook/route.ts:142,151 | emitDomainEvent спец-ветка domain-events.ts:98 → durable-alert-delivery.ts | средний |
| ReportPdfDeliveryRequested | services/reports/event-handlers.ts:573 | emitDomainEvent спец-ветка domain-events.ts:103 → event-handlers.ts:599 | средний |
| CrewCreated | crew.aggregate.ts:53 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| CrewUpdated | crew.aggregate.ts:76 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| CrewAssigned | crew.aggregate.ts:85 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| CrewOperatorAssigned | crew.aggregate.ts:94 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| CrewEquipmentAssigned | crew.aggregate.ts:103 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| CrewDeactivated | crew.aggregate.ts:113 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| CrewReactivated | crew.aggregate.ts:123 → crew.repository.ts:60 | НЕТ ОБРАБОТЧИКА | средний |
| SiteCreated | site.aggregate.ts:71 → site.repository.ts:29 | НЕТ ОБРАБОТЧИКА | средний |
| SiteUpdated | site.aggregate.ts:115 → site.repository.ts:29 | НЕТ ОБРАБОТЧИКА | средний |
| SiteActivated | site.aggregate.ts:129 → site.repository.ts:29 | НЕТ ОБРАБОТЧИКА | средний |
| SiteDeactivated | site.aggregate.ts:144 → site.repository.ts:29 | НЕТ ОБРАБОТЧИКА | средний |
| EquipmentCreated | equipment.aggregate.ts:27 → equipment.repository.ts:30 | НЕТ ОБРАБОТЧИКА | средний |
| EquipmentUpdated | equipment.aggregate.ts:40 → equipment.repository.ts:30 и equipment-command.service.ts:41 | НЕТ ОБРАБОТЧИКА | средний |
| EquipmentRetired | equipment.aggregate.ts:46 → equipment.repository.ts:30 | НЕТ ОБРАБОТЧИКА | средний |

### Список типов БЕЗ обработчика (14)

CrewCreated, CrewUpdated, CrewAssigned, CrewOperatorAssigned,
CrewEquipmentAssigned, CrewDeactivated, CrewReactivated,
SiteCreated, SiteUpdated, SiteActivated, SiteDeactivated,
EquipmentCreated, EquipmentUpdated, EquipmentRetired.

Все 14 пишутся в `OutboxEvent` (в одной транзакции с доменными данными), оба
потребителя строку видят:
- цикл «published» зовёт `emitDomainEvent(event)` (embedded-workers.ts:142,
  outbox-worker.ts:32, unified-worker/outbox.ts:49). Для этих типов
  `normalizeReportDomainEventType` возвращает `null`, ветка «нет обработчика»
  (domain-events.ts:113-139) их НЕ находит в `EVENT_TYPES_WITHOUT_SUBSCRIBERS`,
  логирует `warn` и делает `return` — БЕЗ `throw`. Внешний `consumeOutboxEvents`
  (outbox-publisher.ts:147-168) считает вызов успешным и проставляет
  `published=true`.
- цикл «projected» (`projectEvent`, projection-worker.ts:105-115) для них
  возвращает `null` из `normalizeProjectionEvent` и выходит; строка получает
  `projected=true`.

Итог: события crew/site/equipment бесследно исчезают — ни проекции, ни аудита,
ни ошибки, ни записи в DLQ. Это ровно тот сценарий, ради которого заведён W122:
«событие без обработчика никуда не доходит, и ни одна ошибка не появляется».

### Таблица 2. Находки (severity | path:line | проблема | сценарий | фикс)

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемый фикс |
|---|---|---|---|---|---|
| 1 | важно | crew.repository.ts:60, crew.aggregate.ts:53-123 | Crew*-события пишутся, обработчика нет ни на шине, ни в проекциях | Правка бригады (создание, назначение на объект, смена оператора/техники, деактивация) не порождает никакой реакции — и не оставляет даже следа ошибки. События копятся в таблице как мёртвый журнал | Либо реализовать подписчика (например, аудит изменений бригады), либо документировать crew-outbox как «журнал без потребителя» и не считать его транспортом |
| 2 | важно | site.repository.ts:29, site.aggregate.ts:71-145 | Site*-события пишутся, обработчика нет | Активация/деактивация объекта (её видит планировщик смен и отчёты) никого не уведомляет и не пересчитывает — событие исчезает молча | Аналогично: аудит/уведомление либо явная пометка «журнал» |
| 3 | важно | equipment.repository.ts:30, equipment-command.service.ts:41, equipment.aggregate.ts:27-46 | Equipment*-события пишутся, обработчика нет | Создание/правка/вывод установки из эксплуатации через карточку события есть, реакции нет. Пересчёт готовности заказывается ОТДЕЛЬНЫМ событием ReadinessSnapshotRequested (которое карточка установки не пишет) | Определиться: нужен ли обработчик; при отказе — пометить как журнал и/или перестать писать эти строки в outbox |
| 4 | важно | domain-events.ts:113-139, outbox-publisher.ts:147-168 | Не-отчётное событие без подписчика помечается `published=true` молча (warn + return, без throw) | Любое событие из п.1-3 «доставлено успешно» с точки зрения outbox: attempts не растёт, DLQ пуст, метрика unpublished=0. Тихая потеря не обнаруживается ни одним монитором | Если событие обязано иметь обработчика — бросать (как для отчётных типов), иначе явно вести список «события-журнал» и не считать warn нормой |
| 5 | мелочь | report-event-types.ts:3, event-handlers.ts:37,46,451 | ReportUpdated объявлен, на него подписаны analytics/сводка дня/кэш/аудит, но НИ ОДНА точка записи его не эмитит | Обработчики ReportUpdated мертвы. Правка отчёта на деле идёт через ReportSubmitted (upsertReport пересобирает черновик и сдаёт — report-command.service.ts:222-284), поэтому функция работает, но не тем путём, который задуман подписками. При рефакторинге легко удалить «лишние» подписки ReportSubmitted, ошибочно полагаясь на ReportUpdated | Удалить мёртвые подписки либо начать эмитить ReportUpdated при правке и убрать дублирующую логику |
| 6 | мелочь | report-event-types.ts:6,8,10,12, event-handlers.ts:453; crew.events.ts:9 | ReportVersionCreated, PileWorkRemoved, DrillingRemoved, DowntimeRemoved, CrewUnassigned объявлены и часть подписана/в словаре DLQ, но никогда не пишутся | Мёртвые имена: вводят в заблуждение при чтении (кажется, что эти события ходят), наполняют `EVENT_TYPES_WITHOUT_SUBSCRIBERS` (domain-events.ts:56) и словарь подписей admin-dlq.tsx:64 без носителя | Оставить как задел — норм; но пометить комментарием «объявлено, не эмитится», либо удалить |
| 7 | мелочь | core/event-bus/schema-registry/index.ts, registry.ts:76 | Реестр схем зарегистрирован (registerAllEventSchemas), но `validate()` в рантайме не вызывается нигде: в `src` вызовы только в тестах | События в outbox пишутся вообще без проверки по контракту; схемы под документированные dot-имена (`report.created`), а фактические события идут на PascalCase (`ReportCreated`) — реестр и события живут в разных словарях | Либо подключить валидацию в точку записи/чтения outbox, либо признать реестр неиспользуемым и удалить |

## Не проверено

- «Не проверено»: фактическое содержимое таблицы `OutboxEvent` живой БД — какие
  из типов реально присутствуют и в каких объёмах. Нет доступа к БД (правила
  задачи и AGENTS.md), поэтому опись построена по коду, а не по данным.
- «Не проверено»: динамика в проде (растут ли crew/site/equipment строки,
  сколько их, уходят ли они в DLQ). Комментарий в domain-events.ts:52-54
  утверждает сверку «с содержимым OutboxEvent локальной БД», но сам факт я не
  воспроизводил.
- «Не проверено»: поведение при реестре `EVENT_TYPES_WITHOUT_SUBSCRIBERS` —
  корректность списка из пяти отчётных типов сверена с точками записи
  (PileWorkAdded/DrillingAdded/DowntimeAdded пишутся; PileWorkRemoved/
  DrillingRemoved/DowntimeRemoved — нет), но реальное намерение автора по
  DowntimeAdded (он и в списке «без подписчика на шине», и имеет подписчика-
  алерт) не подтверждено запуском.
- «Не проверено»: способ подписки readiness-события дублируется двумя путями
  (шина register-readiness-projection.ts:29 и проекция
  projection-worker.ts:106). Оба ведут к `consumeReadinessProjectionEvent`, и
  дедуп есть (`project-event.ts:42,48`, `createDeduplicatedSnapshot`), но
  двойной вызов в рантайме на живых данных я не наблюдал.
- «Не проверено»: скрипты `scripts/backfill-projections.ts` и
  `backfill-tech-readiness.ts` — читают ли они outbox-события по типу или
  пересобирают проекции прямо из таблиц Report/… (grep по `outbox`/`eventType`
  в них совпадений по типам событий не дал, но содержимое до конца не
  разбирал).
- Frozen-зоны (operator screen variants, ORION) — не касался. Записи в outbox
  из `src/modules/operator-mobile/**` (shift-close.ts:321 — ReportSubmitted;
  checklist.ts:278, equipment.ts:146, incidents.ts:108 — ReadinessSnapshotRequested)
  только учтены в таблице как факт, код не менялся.
