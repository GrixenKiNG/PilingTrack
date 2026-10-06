# W28-CODEX-J-TESTPLAN: план тестов для Codex по потоку J1–J6

READ-ONLY, кроме этого файла. Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `9d4603a6`.
Источник: `D:/PillingR/codex-night/CODEX-THREAD-10.md` (пункты J1–J8) и документы, на которые он ссылается
(`docs/audits/hermes-night/W5-ANALYTICS-STATUS.md`, `W12-ANALYTICS-ORPHANS.md`, `W3-EQUIP-CARD-ZERO.md`).
Задача: по каждому из J1–J6 дать точный план теста, который воспроизводит дефект ДО правки, с файлом теста,
способом поднять данные, вызовом, текущим (ломающимся) и целевым результатом, и ловушками. J7/J8 в задании нет.

## Итог

- 6 пунктов: **критично — 0, важно — 5, мелочь — 1**. Все шесть — один класс: проекция статуса/итогов
  отстаёт от источника `Report`, и отставание молчит (`ReportAnalytics`, outbox).
- Топ-5:
  1. **J1 (важно)** `event-handlers.ts:79-84` при неразрешённом `siteId/userId/tenantId` делает `return` без
     исключения, а `outbox-publisher.ts:156-164` всё равно клеймит строку `published=true` → нет ретрая, нет DLQ.
     Тест-«клей» уже стоит на стороне отчёта (`daily-summary.test.ts:199-214` закрепляет молчаливый пропуск) —
     его нужно переписать на `rejects.toThrow`.
  2. **J6 (важно)** `equipment-query.service.ts:120-124` — `analyticsByReport.get(reportId) ?? источник`:
     при наличии проекции её нули берутся как есть. Существующий тест `:208-216` («preserves an existing
     projection…») прямо закрепляет баг и подлежит переписыванию.
  3. **J4 (важно)** `event-handlers.ts:29-47` — на `ReportUpdated` аналитика не подписана (только
     `handleReportForDailySummary` и сброс кэша), поэтому `status` проекции меняют лишь `ReportCreated`/
     `ReportSubmitted`; `RM-3190cede` держался `draft` навсегда.
  4. **J2 (важно)** `emitDomainEvent` (`domain-events.ts:86-95`) при пустом реестре пишет `warn` и `return`;
     `unified-worker/outbox.ts:26-40` уже регистрирует обработчики до цикла, но контракт «нет обработчиков ≠
     доставлено» не выражен — outbox всё равно клеймит `published`.
  5. **J3 (важно)** `shared.ts:388-412` (`ensureReport`) создаёт отчёт `tx.report.upsert` **без** строк outbox
     (в отличие от `report.repository.ts:46-72`); проекция у таких отчётов появляется лишь на сдаче/перестройке.
- J5 (мелочь) — метрики расхождения `Report.status`↔`ReportAnalytics.status` нет вовсе; тест фиксирует её отсутствие.
- Ни один тест ниже **не запускался** (нет БД/стенда в этой сессии) — это план, а не отчёт о прогоне. См. «Не проверено».

## Методика

1. Прочитан `AGENTS.md` (модель доверия, заморозка оператора/ORION, «выглядит мёртвым, но живо»). Замороженные
   экраны не читались: J3 касается `src/modules/operator-mobile/**`, а это домен-логика машиниста, не «вариант
   экрана оператора» из списка заморозки (заморожены `src/app/operator/**`, `src/app/(app)/operator/**`,
   `src/components/piling/operator*/**`, `src/modules/operator-mobile/**` — читал только `application/commands`,
   правка там разрешена владельцем 03.10 «только с тестами», см. J3).
2. Прочитан `D:/PillingR/codex-night/CODEX-THREAD-10.md` (J1–J8) и три документа-источника (W5, W12, W3).
3. Прослежен путь события: `domain-events.ts` (шина и реестр) → `outbox-publisher.ts` (`consumeOutboxEvents`,
   dispatch-then-claim) → `event-handlers.ts` (`handleReportForAnalytics`, `handleReportForDailySummary`,
   `recomputeSiteDailySummary`) → `rebuild.ts` (`rebuildReportAnalyticsForTenant`) → `projection-rebuild-scheduler.ts`.
4. Прослежены обе точки записи отчёта: `report.repository.ts:96-277` (пишет outbox in-tx, `mapEventsToOutboxData`
   :46-72) и `operator-mobile/.../shared.ts:388-412` + `shift-close.ts:117-217,309-339` (outbox только на сдаче).
5. Прослежена карточка установки: `equipment-query.service.ts:63-193` (`totalsForReport` :120-124) и её тест
   `equipment-query.service.test.ts:150-253`.
6. Найдены существующие тесты, рядом с которыми лягут новые кейсы: `src/services/reports/__tests__/daily-summary.test.ts`,
   `src/workers/__tests__/outbox-worker.test.ts`, `src/modules/reports/application/projections/__tests__/rebuild.test.ts`,
   `src/modules/operator-mobile/application/commands/__tests__/{shared,shift-close}.test.ts`,
   `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts`.
7. Интеграционный стенд `codex-pg` (как в D2) прочитан по `tests/integration/helpers/disposable-db.ts`,
   `tests/integration/disposable-rls.spec.ts`, `vitest.integration.config.ts`, `CODEX-REPORT-T2.md`.
8. §6-команды (`tsc/lint/test/playwright/build`) **не запускались**: правок кода нет, единственная запись — этот `.md`.

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|----------|-----------|----------|--------------------------|-------------------|
| 1 | важно | `src/services/reports/event-handlers.ts:79-84` против `src/services/reports/outbox-publisher.ts:156-164` | Неразрешённый `siteId/userId/tenantId` → `return` без исключения; outbox клеймит `published=true` независимо от результата (dispatch-then-claim). | Событие «успешно» обработано: `attempts=0`, `lastError=null`, DLQ пуст, строки `ReportAnalytics` нет. Дрейф витрин молчит и не само-лечится. | В ветке `:79-84` бросать ошибку (как в `catch` `:113-119`), чтобы сработал ретрай/DLQ outbox. |
| 2 | важно | `src/services/reports/domain-events.ts:86-95`; `src/workers/unified-worker/outbox.ts:26-40` | Нет подписчиков → `logger.warn` и `return` (успех). Воркер уже регистрирует обработчики до цикла, но контракт не выражен: пустой реестр приравнен к доставке. | После рестарта первые события могли пройти «в пустоту», но outbox всё равно ставит `published` — ретрая нет; ровно один `ReportSubmitted` мог не дойти до аналитики (1 из 268 в W5). | `emitDomainEvent` при пустом реестре бросает (или возвращает сигнал «не обработано»), outbox это учитывает и не клеймит `published`. |
| 3 | важно | `src/modules/operator-mobile/application/commands/shared.ts:388-412` | `ensureReport` заводит отчёт `tx.report.upsert` **без** строк outbox; контраст — `report.repository.ts:46-72`. | Отчёты, созданные на экране смены, до сдачи не имеют события создания; проекция появляется только на `ReportSubmitted`/перестройке. Класс дефекта статуса/итогов. | Решить: писать `ReportCreated` в той же tx, ЛИБО в обработчике сдачи всегда сверяться с `Report.status` (см. J4). Правка — только с тестами (владелец 03.10). |
| 4 | важно | `src/services/reports/event-handlers.ts:29-47,86-112` | `status` проекции меняют только `ReportCreated`→`draft` и `ReportSubmitted`→`submitted`; `ReportUpdated` подписан на сброс кэша (`:44-46`), но не на проекцию. | Любой путь, где `ReportSubmitted` не дошёл, фиксирует `draft` навсегда — наблюдаемый `Report=submitted / ReportAnalytics=draft`. | Брать `status` из строки `Report` (источник истины), либо добавить `on(REPORT_UPDATED, handleReportForAnalytics)`. |
| 5 | мелочь | (метрики нет) — запрос из `W5-ANALYTICS-STATUS.md:32-35` | Нет мониторинговой сверки числа отчётов, у которых `Report.status <> ReportAnalytics.status`. | Наблюдаемое расхождение не видно ни в UI, ни в алертах; само-лечение зависит от `worker:all` (в `npm run dev` планировщика нет). | Добавить tenant-функцию подсчёта расхождений (метрика + `logger.warn`/алерт). |
| 6 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:120-124` | `totalsForReport = analyticsByReport.get(reportId) ?? источник`: при наличии строки проекции её итоги берутся как есть, даже устаревшие/нулевые. | Если `ReportSubmitted` потерян (см. J1/J2) или проекция построена без итогов, `totalPiles` остаётся `0` при живых `PileWork` — карточка и KPI покажут «0 свай». Тест `:208-216` закрепляет именно это. | Для сданного отчёта при `analytics.totalPiles===0 && источник>0` (или при недостоверности) брать источник, расхождение логировать. Решать вместе с J4. |

## План тестов J1–J6

Общее для всех: правка должна прийти после RED-теста. Ниже — «СЕЙЧАС» = фактическое поведение кода по чтению
(тест на целевое поведение обязан быть красным до правки), «ПОСЛЕ» = зелёный.

### J1. Тихий отказ обработчика не должен считаться доставкой

- Файл теста (основной, unit): **существующий** `src/services/reports/__tests__/daily-summary.test.ts` —
  кейс `'пропускает проекцию, когда организацию определить нечем'` (`:199-214`). Сейчас он ожидает
  `analyticsUpsertMock` НЕ вызванным и `emitDomainEvent` разрешается — это и есть закрепление бага. Переписать:
  `await expect(emitDomainEvent({... tenantId отсутствует ..., findUniqueMock → {siteId,userId,tenantId:null}}))
  .rejects.toThrow()`.
- Файл теста (контракт outbox, новый): `src/services/reports/__tests__/outbox-handler-void.test.ts` ЛИБО
  дополнить `src/workers/__tests__/outbox-worker.test.ts`. Мок `@/lib/db` как в `outbox-worker.test.ts:15-35`
  (`outboxEvent.findMany/findUnique/update/updateMany/count`).
- Данные и вызов:
  - unit: `findMany → [{id:'e1', type:'ReportSubmitted', aggregateId:'RM-x', tenantId:null, payload:{},
    attempts:0, published:false, occurredAt:new Date()}]`; `handler = emitDomainEvent` (или мок, бросающий).
  - `await publishOutboxEvents(handler)`.
- СЕЙЧАС: обработчик `return`-ит → `updateMany({published:true})` вызван, `count===1`, `attempts=0`,
  `lastError=null`, `moveToDlq` не вызван. Целевой тест (ожидает НЕ published) — **красный**.
- ПОСЛЕ правки: обработчик бросает → ветка `catch` `outbox-publisher.ts:169-232` инкрементит `attempts`,
  пишет `lastError` и `nextRetryAt`; после `MAX_RETRIES=5` (`:26`) — `moveToDlq`. Строка `published` не ставится.
- Ловушки: (а) `event-handlers.ts:53` берёт `db` динамическим `import('@/lib/db')` — в unit это не всегда
  подменяется; рабочий приём уже применён в `daily-summary.test.ts:59-67` (`globalThis.prisma = dbClient`).
  (б) `emitDomainEvent` при пустом реестре (J2) тоже `return`-ит — не перепутать два разных `return`.

### J2. Событие до регистрации обработчиков не должно клеймиться доставленным

- Файл теста (новый): `src/services/reports/__tests__/domain-events.test.ts` (файла нет — проверить поиском
  `domain-events*.test.ts`). Тест шины в изоляции.
- Данные и вызов: НЕ импортировать `@/services/reports/event-handlers` (иначе реестр заполнен). Взять тип без
  подписчиков: `getHandlerCount('ReportSubmitted')===0`; затем
  `await emitDomainEvent({id:'e', type:'ReportSubmitted', aggregateId:'RM-x', aggregateType:'Report',
  occurredAt:new Date().toISOString(), data:{}})`.
- СЕЙЧАС: `domain-events.ts:86-95` пишет `logger.warn('No handlers for domain event', …)` и `return` →
  промис разрешается. Целевой тест `await expect(...).rejects.toThrow(/No handlers/)` — **красный**.
- ПОСЛЕ: `emitDomainEvent` бросает → `consumeOutboxEvents` не клеймит `published`, ставит ретрай; повтор после
  регистрации обработчиков доставит событие. Дополнительно — контракт-тест `unified-worker/outbox.ts:33-40`:
  `registerAllEventHandlers()` вызывается ДО `startOutboxWorker` (порядок вызовов), можно проверить мок-порядком.
- Ловушки: реестр `handlers` — модуль-синглтон (`domain-events.ts:36`), состояние общее для тестов одного файла;
  `on()` нормализует тип (`normalizeReportDomainEventType`, `:42`) — использовать канонический тип.
  Регистрация идемпотентна (`registerAllEventHandlers` защищена ре-энтри, `event-handlers.ts:639`).

### J3. Отчёт смены (`ensureReport`) не пишет событие создания

- Файл теста: **существующий** `src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts`
  (мок-`tx` уже содержит `outboxEvent: {create: vi.fn()}` — `:38`). Дополнить, ЛИБО добавить кейс в
  `src/modules/operator-mobile/application/commands/__tests__/shared.test.ts`.
- Данные и вызов: `tx.report.findFirst → null` (отчёт ещё не заведён), `tx.report.upsert → {id:'report-pk-1'}`,
  смена открыта, ЕО после работы пройден (см. `beforeEach` `shift-close.test.ts:41-71`); вызвать `closeShift(input)`
  / `submitReport(input)` и посмотреть на `tx.outboxEvent.create`.
- СЕЙЧАС: `submitShiftReport` (`shift-close.ts:117-217`) пишет через `ensureReport` отчёт без outbox, а затем
  `publishReportSubmitted` (`:309-339`) кладёт РОВНО одно событие — `ReportSubmitted`. Тест, ожидающий
  `ReportCreated` (или два `create`), — **красный**.
- ПОСЛЕ (при выборе «писать событие создания»): `closeShift` даёт два `tx.outboxEvent.create`: `ReportCreated`
  (в tx `ensureReport`) и `ReportSubmitted`. При выборе «не писать, а сверяться со `Report.status`» (см. J4) —
  тест проверяет согласованность проекции на стороне обработчика (см. J4), а не второй outbox-строки.
- Что решить (прямо в задаче): откуда у отчётов из `ensureReport` берутся строки `ReportAnalytics`. По коду —
  только из позднего `ReportSubmitted` (`event-handlers.ts:29-31`) или перестройки (`rebuild.ts:210-226`).
- Ловушки: (а) ключ `upsert` — `tenantId_shiftId` (`shared.ts:393`), не `reportId`; (б) строки должны лежать в
  **той же** tx, что и отчёт (контраст — `report.repository.ts:227-235`), иначе смена закрыта без события;
  (в) `writeReportAuditRow` мокается отдельно (`shift-close.test.ts:16-17`).

### J4. `ReportUpdated` не обновляет статус проекции

- Файл теста: **существующий** `src/services/reports/__tests__/daily-summary.test.ts`, `describe
  'handleReportForAnalytics'` (`:165-215`). Добавить кейс.
- Данные и вызов: `registerAnalyticsEventHandler()`; `findUniqueMock` (по `reportId`) отдаёт
  `{siteId,userId,tenantId,status:'submitted'}`; затем
  `await emitDomainEvent({id:'e', type: REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED, aggregateId:'report-uuid-1',
  aggregateType:'Report', occurredAt:new Date().toISOString(), siteId:'site_A', userId:'user-1', tenantId:'tenant-a',
  data:{}})`.
- СЕЙЧАС: на `REPORT_UPDATED` подписан только `handleReportForDailySummary` (`:40`) и сброс кэша (`:45`);
  `handleReportForAnalytics` не вызывается → `analyticsUpsertMock` НЕ вызван, `status` в проекции не меняется.
  Тест, ожидающий `upsert.update.status==='submitted'`, — **красный**.
- ПОСЛЕ (один из вариантов): либо `on(REPORT_UPDATED, handleReportForAnalytics)`, либо `status` берётся из
  строки `Report` (`upsert.update.status = report.status`), тогда целевое поведение — проекция зеркалит `Report`.
- Что решить (из задачи): нужен ли `ReportUpdated` и почему ежедневная перестройка не вылечила
  `RM-3190cede-2026-09-28` за 5 суток. По коду: `projection-rebuild-scheduler.ts:46-53` стартует только в
  `worker:all` (`unified-worker.ts`), в `npm run dev` embedded-worker поднимает лишь `['outbox','projection']`
  (`embedded-workers.ts:26,316-322`) — планировщика нет. Проверить, что `rebuildReportAnalyticsForTenant`
  действительно выставляет `status` из `Report.status` (закреплено `rebuild.test.ts:23`, `:26`).
- Ловушки: RLS — в интеграционной версии `Report` под RLS, нужен `SET app.current_tenant` (см. ниже); на
  `REPORT_UPDATED` параллельно срабатывает `handleReportForDailySummary`, который дёргает `db.report.findMany` —
  замокать (`findManyMock.mockResolvedValue([])`, как `:173`).

### J5. Метрика расхождения `Report.status` ↔ `ReportAnalytics.status`

- Файл теста (новый): рядом с выбранным местом метрики, например
  `src/core/observability/__tests__/analytics-consistency.test.ts` (если функцию кладут в мониторинг) или
  `src/modules/reports/application/queries/__tests__/analytics-consistency.test.ts`.
- Данные и вызов (вариант A, unit): мок `@/lib/db` с `$queryRaw` → `[{count: 1}]`; вызвать
  `countAnalyticsStatusMismatches('orion')`; ожидать `1`. Вариант B (интеграция, `codex-pg`): поднять в тенанте
  `Report{status:'submitted}` + `ReportAnalytics{status:'draft'}` с тем же `reportId` → функция возвращает `1`.
- СЕЙЧАС: функции нет → тест не компилируется (RED по определению). Ожидаемый SQL — из `W5:32-35`:
  `SELECT count(*) FROM "Report" r JOIN "ReportAnalytics" a ON a."reportId"=r."reportId" WHERE r.status<>a.status;`
- ПОСЛЕ: функция возвращает число расхождений тенанта; вызывающий код пишет `logger.warn`/метрику; при `>0` — алерт.
- Ловушки: (а) **RLS** — без `SET app.current_tenant='orion'` (или
  `SELECT set_config('app.current_tenant',$1,true)` внутри tx) запрос вернёт `0` — ложные «нули», это не «пустая
  база»; (б) `$queryRaw` (возвращает строки), НЕ `$queryRawUnsafe` и не `$executeRaw` (для `COUNT` нужен результат);
  (в) запрос обязан быть tenant-скоупным, иначе в многоарендной БД посчитает чужие строки.

### J6. Карточка установки доверяет проекции больше, чем источнику

- Файл теста: **существующий** `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts`.
  Кейс `'preserves an existing projection even if its totals differ from current source'` (`:208-216`) —
  переписать: он закрепляет возврат `0`.
- Данные и вызов: `reports = [detailReport(7)]` (сданный, `piles:[{count:2}]`), а
  `analyticsFindManyMock.mockResolvedValue([{reportId:'uuid-7', totalPiles:0, totalDrilling:0, totalDowntime:0}])`;
  `const d = await getEquipmentDetails('equipment-1','orion')`.
- СЕЙЧАС: `totalsForReport` (`equipment-query.service.ts:120-124`) берёт проекцию → `d.stats30d.piles===0`,
  `d.timeline[0].piles===0`. Тест, ожидающий `piles===2`, — **красный**.
- ПОСЛЕ: для сданного отчёта с нулевой проекцией при живом источнике — источник (`piles===2`,
  `pileMeters===24`), расхождение логируется. Решать вместе с J4 (общий корень — отставание проекции).
- Ловушки: (а) `Date.now` мокается (`:164`) — иначе окно 30 дней сдвинет отчёт; (б) правка меняет «законный»
  тест `:208-216` — не оставлять его зелёным при новой семантике; (в) `pileMeters` считается из источника
  всегда (`:129-132`), поэтому «0 свай, 24 м.п.» в старом ожидании — прямое доказательство рассинхрона.

## Ловушки методов (общие для всех стендов)

1. **RLS / `SET app.current_tenant`.** На таблицах `FORCE ROW LEVEL SECURITY` с политикой
   `"tenantId" = current_setting('app.current_tenant', true)`. Без контекста запросы возвращают 0 строк — это не
   «пустая база». В интеграции используй `inTenant()` из `tests/integration/helpers/disposable-db.ts:7-15`
   (`BEGIN` → `SELECT set_config('app.current_tenant',$1,true)` → работа → `ROLLBACK`). `OutboxEvent` под RLS НЕ
   находится (миграция `prisma/migrations/20260702000000_drop_stray_rls_tenant_outbox`), поэтому его строки видны
   и без контекста — не путать с `Report`/`ReportAnalytics`, которые под RLS.
2. **Vitest не читает `.env`; интеграционные спеки молча пропускаются.** `disposable-rls.spec.ts:4,7`:
   `describe.skipIf(!enabled)`, где `enabled` — наличие `INTEGRATION_DATABASE_URL_OWNER`/`_APP`. Зелёный прогон со
   `skip` ничего не доказывает. Стенд поднимается `scripts/test-db-up.sh` (контейнер с меткой
   `pilingtrack.codex.test-db=1`, БД `codex_test`, роли `piling`/`pilingtrack_app` — см. `disposable-db.ts:17-25`).
3. **Новый интеграционный файл нужно ВНЕСТИ в `include`.** `vitest.integration.config.ts:9` перечисляет только
   `tests/integration/disposable-*.spec.ts` и `tests/integration/tech-readiness-write-pipeline.spec.ts` — новый
   `*.spec.ts` с другим именем молча не будет собран. Либо называть `tests/integration/disposable-*-j*.spec.ts`.
4. **`$queryRaw` vs `$executeRaw`.** Для `SELECT`/`COUNT` — `$queryRaw` с шаблонными параметрами (не
   `$queryRawUnsafe`); `$executeRaw` — только для операторов без результата (advisory-локи и т.п.).
5. **Транзакции.** Запись outbox обязана быть в ТОЙ ЖЕ tx, что и бизнес-данные (`report.repository.ts:227-235`).
   Сбой сериализации приходит как `P2010` с кодом `40001`, а не только `P2034` — повтор должен ловить оба.
6. **Реестр обработчиков — модуль-синглтон** (`domain-events.ts:36`), состояние общее внутри файла теста;
   порядок тестов влияет на «пустой реестр» (J2). `registerAllEventHandlers` идемпотентна (`event-handlers.ts:639`).
7. **`emitDomainEvent` бросает при падении обработчиков** (`domain-events.ts:122-128`) — это контракт для
   ретрая outbox; не «чинить» тестом, глотая исключение.
8. **Известные падения unit-набора** (из `CODEX-REPORT-T2.md:134-135`): 7 тестов
   `src/services/reports/__tests__/daily-summary.test.ts` падали и в исходном состоянии, т.к. моки не изолируют
   DB в динамическом импорте обработчика (нужен `DATABASE_URL` или `globalThis.prisma`, `:59-67`). При прогоне
   `npm run test:unit` сверять passed/skipped, а не только «зелено».

## Не проверено

- **Ни один тест не запускался, БД/стенд не поднимались.** Все «СЕЙЧАС» выведены из чтения кода, а не из прогона;
  RED-состояние каждого теста не наблюдалось. Прогон — на стороне Codex.
- **Стенд `codex-pg` в этой сессии отсутствует** (`docker ps` не запускался). Что `scripts/test-db-up.sh` рабочий
  на текущем хосте — не перепроверялось (взято из `CODEX-REPORT-T2.md`).
- **Точная причина строки `RM-3190cede-2026-09-28`** по-прежнему не доказана (см. `W5`, «Не проверено»); тест J4
  воспроизводит КЛАСС дефекта, а не конкретную строку.
- **`src/workers/unified-worker.ts:180-182`** (старт планировщика только в `worker:all`) прочитан только по
  цитате в `W12`; сам файл целиком в этой сессии не открывался — порядок старта стоит подтвердить при реализации J4.
- **J7/J8** (сироты аналитики, индекс `PileWork`) в задании не значатся и не планировались; тесты под них здесь нет.
- §6-команды (`rm -rf .next/dev/types; tsc; lint; test:unit; playwright --list; build`) **не запускались**:
  правок кода нет, единственная запись — этот документ.
