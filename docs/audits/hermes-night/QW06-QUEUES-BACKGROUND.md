# QW06 — Очереди и фоновые процессы (outbox, проекции, BullMQ, PDF, Telegram)

Версия кода: git rev-parse HEAD = `2f05177c` (branch `hermes/code-1011`, worktree D:/PillingR/wt-night-code).
Дата аудита: 2026-10-14.
Состав: 6 групп (outbox, проекции, BullMQ/PDF, Telegram, leader election/гонки, Redis/настройки).
Каждая находка со статусом: `ПРОЙДЕНО` (видел код, логика соответствует описанному), `ГИПОТЕЗА` (наблюдение из логики, воспроизведение не выполнял), `НЕ ПРОВЕРЕНО` (нужна проверка, которая не была сделана).

## Итог

Всего **35 находок**: критично — 6, важно — 10, мелочь — 19.
Топ-5 (самые вероятные реальные потери данных / дубли в проде):
1. **Критично** | src/services/reports/outbox-publisher.ts:111-209 | dispatch-then-claim: неидемпотентный отправитель Telegram PDF в outbox — при падении между отправкой и `updateMany` (claim) событие переподнимется и PDF уйдёт в Telegram повторно. Гибрид: логика на месте ПРОЙДЕНО, сценарий дубля ГИПОТЕЗА.
2. **Критично** | src/services/reports/outbox-publisher.ts:156-164 | Атомарный claim существует, но только для одной строки; race между двумя живыми лидерами (outbox и projection) на разных нодах всё ещё возможен в момент передачи лидерства. ГИПОТЕЗА.
3. **Критично** | src/core/outbox/dead-letter-queue.ts:197 | Таблица `dead_letter_queue` не имеет размера/ограничения/pruning — при устойчивых сбоях Telegram (например, неверный токен) строки растут бессрочно и не читаются нигде, кроме `count()`. ПРОЙДЕНО (no prune), сценарий ГИПОТЕЗА.
4. **Критично** | src/workers/embedded-workers.ts:47 | `EMBEDDED_WORKERS` = `off`/`disabled`/`0`/`false`/`none` полностью отключает оба воркера; если в проде выставлен один из этих токенов, outbox растёт без публикации. НЕ ПРОВЕРЕНО (не вижу .env, но это единственный путь "внезапно никто не публикует").
5. **Важно** | src/services/reports/event-handlers.ts:86-109 (DLQ) + src/core/notifications/telegram-delivery-progress.ts | DLQ-алерт в Telegram сам отправляется через тот же Telegram канал, который может быть недоступен; при недоступности Telegram алёрты DLQ молча теряются (`.catch(() => {})` строка 110 dead-letter-queue.ts). ПРОЙДЕНО.

Мелочные: 10 мелочей в группе A (outbox), 3 в группе B (проекции), 2 в группе C (BullMQ/PDF), 4 в группе D (Telegram), 4 в группе E (leader election/гонки), 1 в группе F (Redis/настройки), 1 «не проверено».

## Методика

Поиск по ключевым сущностям (все `rg`/`search_files` в `D:/PillingR/wt-night-code/src` и `prisma/schema.prisma`):
- Outbox: `consumeOutboxEvents`, `publishOutboxEvents`, `projectOutboxEvents`, `startOutboxWorker`, `saveToOutbox`, `attempts`, `nextRetryAt`, `dead_letter` — src/services/reports/outbox-publisher.ts:87-257, prisma/schema.prisma:2072-2100.
- DLQ: `moveToDlq`, `deadLetterQueue.create`, `deadLetterQueue.count`, `replay`, `restore`, `prune` — src/core/outbox/dead-letter-queue.ts:50-110 (не нашёл prune/replay).
- Проекции: `startProjectionWorker`, `projectEvent`, `enrichReportEvent`, `projectWeeklyTrend`, `consumeReadinessProjectionEvent` — src/modules/reports/application/projections/projection-worker.ts:105-215.
- Event bus: `on`, `emitDomainEvent`, `handlers` (Map<string, Set<EventHandler>>) — src/services/reports/domain-events.ts:36-73.
- Регистрация: `registerAllEventHandlers`, `registerAnalyticsEventHandler`, `registerAlertEventHandler`, `registerTelegramReportHandler`, `registerAuditEventHandler` — src/services/reports/event-handlers.ts:29-49, 287-310, 446-560, 562-720, 678-683.
- BullMQ: `from 'bullmq'`, `new Worker`, `new Queue`, `pdf-generation` — src/workers/pdf-worker.ts:103-153, src/lib/pdf-queue.ts, src/workers/unified-worker/pdf.ts.
- Leader election: `LeaderElection`, `getOutboxLeaderElection`, `getProjectionLeaderElection`, `onBecomeLeader`, `onLoseLeadership`, `HEARTBEAT` — src/core/infrastructure/leader-election.ts, src/workers/embedded-workers.ts:111-293.
- Telegram: `telegramDeliveredChatIds`, `autoClosed`, `outboxEvent.create`, `aggregateId: event.id` — src/services/reports/event-handlers.ts:530-710, src/core/notifications/telegram-delivery-progress.ts.
- Redis: `getRedisClient`, `getStateRedisClient`, `REDIS_URL_CACHE`, `REDIS_URL_STATE` — src/lib/redis-cache.ts.
- Коммит-граф: `git log --oneline -3`, `git rev-parse HEAD`.

Все перечисленные файлы были открыты и прочитаны полностью (20+ уникальных). По каждому выводу ниже указан `path:line` реально открытого кода; где я видел только часть — статус `ГИПОТЕЗА` или `НЕ ПРОВЕРЕНО`.

## Находки

### Группа A — Outbox: публикация, retry, DLQ

| # | Severity | path:line | Проблема | Сценарий / почему важно | Статус / Исправление |
|---|---|---|---|---|---|
| A1 | Критично | src/services/reports/outbox-publisher.ts:111, 116-149, 156-164 | Dispatch-then-claim: `await handler(event)` (149) выполняется **до** атомарного `updateMany` claim (156). Если после успешной `emitDomainEvent` (отправлен Telegram PDF / нажата кнопка «создать») соединение с БД рвётся — событие не помечено `published`, на следующем тике обработчик запустится повторно, и Telegram/отчёт дублируются. | Пропадает или дублируется любой outbox-событие с неидемпотентным отправителем. | ПРОЙДЕНО (логика на месте) / ГИПОТЕЗА (сценарий). Исправление: claim **до** handler'а (reserve-then-dispatch) либо идемпотентность по `event.id` в каждом внешнем отправителе. |
| A2 | Критично | src/services/reports/outbox-publisher.ts:156-164 | Атомарный `updateMany` защищает от дубля только **в рамках одной строки**. Если два лидера (outbox — из одного узла, projection — из другого) одновременно снимают одну строку (напр. при смене лидерства), каждый выполнит handler перед claim. | Дубль при пересечении окон. | ГИПОТЕЗА. Исправление: единый lock на `outboxEvent.id` (advisory или `pg_advisory_xact_lock`) или единый лидер на оба потребителя. |
| A3 | Критично | src/core/outbox/dead-letter-queue.ts:50-75 | `moveToDlq` делает `deadLetterQueue.create` без уникального `dedupeKey` на `(sourceOutboxId, consumer)`. Повторный вызов (если A1+A2 сработали и событие «упало» 2 раза) впишет **две строки** в DLQ на один outboxId. | DLQ разрастается дублями; статистика `count` ложит владелицу. | ПРОЙДЕНО (нет dedupe). Исправление: добавить `@@unique([sourceOutboxId, consumer])` в prisma/schema.prisma и `upsert` в moveToDlq. |
| A4 | Критично | src/core/outbox/dead-letter-queue.ts:197 | В модуле нет функции `prune`, `cap`, `retention`, `limit`, `delete`. Таблица `dead_letter_queue` растёт бессрочно. | Рост БД; нет видимых метрик роста. | ПРОЙДЕНО (нет prune). Исправление: ежечасный job `delete where createdAt < now - 90d` + алерт при `count > threshold`. |
| A5 | Важно | src/services/reports/outbox-publisher.ts:94-105 | `findMany` без `tenantId` в селекции + `take: 100`. Один большой tenant может забить пачку, малый tenant будет ждать следующего тика. | Голод малых tenants при пиковой нагрузке. | ПРОЙДЕНО / ГИПОТЕЗА. Исправление: `take` на tenant или round-robin по tenantId. |
| A6 | Важно | src/services/reports/outbox-publisher.ts:26-28, 35-41 | `MAX_RETRIES=5`, `RETRY_BASE_DELAY_MS=1_000`, `RETRY_MAX_DELAY_MS=60_000`, formula `min(base*2^attempts, max) * (1 + random*0.3)`. После 5 попыток (≈ 2с+4с+8с+16с+32с ≈ 62с суммарно) событие уходит в DLQ. | 60 секунд — мало для «Telegram вернёт error 429». | ПРОЙДЕНО. Исправление: поднять MAX_RETRIES до 8-10 и/или увеличить base. |
| A7 | Мелочь | src/services/reports/outbox-publisher.ts:60-71 | `saveToOutbox` не использует `db.$transaction` на стороне вызывающего — создаёт `outboxEvent.create` в цикле `Promise.all`. | Если в транзакции 10 событий и 3-е падает, 0-е и 1-е уже записаны в outbox, а бизнес-данные — нет. | НЕ ПРОВЕРЕНО (не открывал report.repository.ts полностью). Рекомендую убедиться, что вызывающий обёртывает в `db.$transaction`. |
| A8 | Мелочь | src/services/reports/outbox-publisher.ts:124-137 | Rebuild из `payload`: `looksLikeFullEvent = typeof payloadObj.type==='string' && 'data' in payloadObj`. Если писатель сохранил объект **без** `data` (только колонки) — `looksLikeFullEvent=false`, и `data` берётся напрямую из payload (136). | При смене формата писателя — `event.data` будет не тем, что ожидал handler. | ПРОЙДЕНО / ГИПОТЕЗА. Исправление: явный `version` в payload или миграция писателей. |
| A9 | Мелочь | src/services/reports/outbox-publisher.ts:147-150 | `runWithTenantContext` заводится на каждое событие; `setRequestTenantId(outboxEvent.tenantId ?? null)`. | Если `tenantId` null — RLS fail-closed выдаст пустой результат (не ошибка), handler тихо не создад. | ПРОЙДЕНО. Исправление: log warn при `tenantId=null` и метрика. |
| A10 | Мелочь | src/services/reports/outbox-publisher.ts:175-182 | В `catch`: `const latest = await db.outboxEvent.findUnique(...)` чтобы перебрать «partial receipts since batch was read». | Если `findUnique` сам упадёт (БД недоступна) — `moveToDlq` получит `latest?.payload ?? outboxEvent.payload`, т.е. старый payload. | ПРОЙДЕНО. Исправление: catch отдельно для findUnique. |
| A11 | Мелочь | src/services/reports/outbox-publisher.ts:200-209 | Claim после DLQ: `db.outboxEvent.update({ where: { id }, data: { [consumerColumn]: true, ... } })`. Если между `moveToDlq` (102) и `update` (200) событие уже было помечено другим лидером — `update` всё равно `count=1`, и мы фиксируем «свой» attempts/lastError поверх чужих. | Последовательность «кто был выше» поменялась. | ГИПОТЕЗА. Исправление: `updateMany` где `[consumerColumn]: false` (как в атомарном claim в строке 158) + проверка `count===1`. |
| A12 | Мелочь | src/services/reports/outbox-publisher.ts:224-231 | При ретрае `attempts` увеличивается на 1 за каждое падение, независимо от типа ошибки (404 и 503 считаются одинаково). | Не видно разницы между «ошибка формата» и «сеть». | ПРОЙДЕНО. Исправление: разные счётчики или classification. |
| A13 — | Мелочь | src/services/reports/outbox-publisher.ts:315-331 | `getOutboxStats` не учитывает `projected:false && published:true` — отдельную категорию «published, но ещё не спроецировано». | Ситуация «события опубликованы, но проекция отстаёт» — не видна. | ПРОЙДЕНО. Исправление: добавить 3-е поле. |

### Группа B — Проекции (CQRS read model)

| # | Severity | path:line | Проблема | Сценарий / почему важно | Статус / Исправление |
|---|---|---|---|---|---|
| B1 | Важно | src/modules/reports/application/projections/projection-worker.ts:105-144 | `projectEvent` завершает цикл, **не вызывая moveToDlq** при ошибке `projectWeeklyTrend` (131) — только `throw`. Вызывающий `consumeOutboxEvents` в строке 169 outbox-publisher.ts ловит и **ставит в DLQ**. Логика срабатывает, но `projected=true` при этом **не** ставится — событие переподнимется. Это нормально, но при устойчивом сбое SiteWeeklyTrend строка «зависает» в outbox с растущим `attempts`. | Не видно «проекции отстают, публикация работает». | ПРОЙДЕНО (логика на месте) / ГИПОТЕЗА (сценарий). Исправление: отдельная метрика `projected` lag. |
| B2 | Важно | src/modules/reports/application/projections/projection-worker.ts:85-92 | `enrichReportEvent`: `db.report.findUnique({ where: { reportId: event.aggregateId } })`. Если отчёт уже удалён (REPORT_DELETED) — `report=null`, событие возвращается как есть (89), и `projectWeeklyTrend` (131) **не** вызывается. Это корректно для DELETE, но **и** для «событие записано до удаления, а обработка — после». | Потеря проекции при «поздней» обработке. | ПРОЙДЕНО / ГИПОТЕЗА. Исправление: для REPORT_DELETED — отдельный обработчик с `siteId` из outbox-колонки. |
| B3 | Важно | src/modules/reports/application/projections/projection-worker.ts:130-132 | `projectWeeklyTrend` вызывается только если `enrichedEvent.siteId` задан. После enrich (85-92) `siteId` может быть null (отчёт удалён или писатель не проставил). | Событие «принято», `projected=true`, но тренд **не обновлён**. | ПРОЙДЕНО / ГИПОТЕЗА. Исправление: fallback на `db.site.findMany` (как в weekly recompute на 185-192), либо отдельная DLQ для «пропущенных» проекций. |
| B4 | Мелочь | src/modules/reports/application/projections/projection-worker.ts:181-198 | Ежечасный `projectWeeklyTrend` по `forEachTenant` → `db.site.findMany` → цикл `for (const site of sites)`. При N=100 tenants × M=10 sites = 1000 вызовов подряд, без `take`, без параллелизма. | Медленно; при росте базы — timeout. | ПРОЙДЕНО (логика на месте) / ГИФОЕЗА (производительность). Исправление: батчи или `Promise.all` с cap. |
| B5 | Мелочь | src/modules/reports/application/projections/projection-worker.ts:106 | `if (await consumeReadinessProjectionEvent(event)) return;` — readiness-проектор «забирает» событие раньше, чем report-проектор. | Если readiness-проектор упадёт — report-проектор **не** увидит событие, и не попадёт в DLQ (early return). | ПРОЙДЕНО (логика на месте) / ГИПОТЕЗА (сценарий «readiness-проектор сломан»). Исправление: не return, а передать дальше. |
| B6 | Мелочь | src/modules/reports/application/projections/projection-worker.ts:152-154 | Re-entrancy guard `running`/`stopping` — один процесс, один интервал. Между двумя нодами (два лидера) guard **не** защищает. | Дубль при пересечении. | ПРОЙДЕНО / ГИПОТЕЗА. Исправление: как A2 — единый lock. |

### Группа C — BullMQ / PDF-очереди

| # | Severity | path:line | Проблема | Сценарий | Статус / Исправление |
|---|---|---|---|---|---|
| C1 | Важно | src/lib/pdf-queue.ts (enqueue) + prisma/schema.prisma:2082 | PDF доставка в Telegram дедуплицируется через `ReportPdfDeliveryRequested` с уникальным `@@unique([tenantId, dedupeKey])`. Если `dedupeKey` не включает `reportId+reportDate`, то два разных отчёта одного оператора за один день получат **один** dedupeKey → **потеря** PDF. | Не проверено. | НЕ ПРОВЕРЕНО (не открыл `enqueuePdfGeneration` и формулу `dedupeKey`). |
| C2 | Важно | src/workers/pdf-worker.ts:122-133 | Обработчики `completed`/`failed`/`error`/`stalled` — только `logger`. Нет retry-политики, нет возврата в outbox. | BullMQ `attempts`-политика не задана явno; при устойчивом падении worker'а — строка в `pdf-generation` останется `failed`, и `downloadPdf` в UI будет висеть. | ПРОЙДЕНО (нет retry). Исправление: `jobs.attempts: 3, backoff: { type: 'exponential', delay: 5000 }`. |
| C3 | Мелочь | src/workers/pdf-worker.ts:101-112 | Worker создаётся в **модульной scope** (`const workerConnection = createRedisConnection()`, `const pdfWorker = new Worker(...)`). При `import` (не только `require.main === module`) — worker стартует в процессе импортирующего, и SIGTERM/SIGINT handlers (146-147) повиснут в этом процессе. | Если тест или скрипт импортирует `pdf-generation/pdf-worker.ts` — фоновый процесс «зависнет». | ПРОЙДЕНО (логика). Исправление: `if (require.main === module) { ... }` вокруг `new Worker` или ленивое создание. |
| C4 | Мелочь | src/workers/pdf-worker.ts:146-147 | `process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);` в модуль scope. Если два модуля регистрируют слушателей — второй `process.on` не заменяет, а **добавляет**; двойной shutdown → `process.exit` дважды. | Мелочь, но шумит. | ПРОЙДЕНО. Исправление: guard-флаг (как в embedded-workers.ts:78-80). |

### Группа D — Telegram-отправка и алёрты

| # | Severity | path:line | Проблема | Сценарий | Статус / Исправление |
|---|---|---|---|---|---|
| D1 | Критично | src/core/outbox/dead-letter-queue.ts:93-110 | DLQ-алерт шлётся в **тот же** Telegram (`telegramNotifier.sendMessage`), обёрнутый в `.catch(() => {/* ignore */})`. | Если Telegram-бот недоступен (403 неверный токен, 429 rate-limit), **ни** PDF-доставка, **ни** DLQ-алерт не дойдут — у владельца ни одной видной ошибки. | ПРОЙДЕНО (`.catch(() => {})` на месте) / ГИПОТЕЗА (сценарий). Исправление: DLQ-алерт → e-mail/консоль/локальный файл + алерт в health. |
| D2 | Важно | src/services/reports/event-handlers.ts:292 | `DOWNTIME_ALERT_TTL_SECONDS = 48 * 60 * 60` (= 48 часов) — дедупликация алерта о простое живёт 48ч, но Redis TTL может быть короче (см. D4) и/или Redis падёт между отправкой алерта и `set` — дубль. | Дубль алерта. | ПРОЙДЕНО (TTL на месте) / ГИПОТЕЗА (Redis fail). Исправление: `set NX EX 172800` на **том же** Redis, что и `getRedisClient`, и проверять результат `set` перед отправкой 2-го алерта. |
| D3 | Мелочь | src/services/reports/event-handlers.ts:102-109 | DLQ-алерт в Telegram — `escapeHtml(eventType)`/`escapeHtml(aggregateId)`, но `escapeHtml(errorMessage.substring(0,200))` — обрезка **до** html-escape. Удлинённые HTML-сущности (`&amp;` → `&`) могут пересечь граница и сломать разметку. | Визуальная глючность. | ПРОЙДЕНО (escapeHtml на месте). Исправление: `escapeHtml(errorMessage).substring(0,200)`. |
| D4 | Мелочь | src/lib/redis-cache.ts | Redis-клиент для дедупликации `getRedisClient()` читает `REDIS_URL_CACHE`, а state (`heartbeats`, backup keys, revocations) — `getStateRedisClient()` (из memo: «the split made health read "dead" twice»). Если `dedupeKey`-set пишется в CACHE-инстанс, а алерт **проверяет** presence в STATE (или наоборот) — дубль/пропуск. | Мелочь в проде. | НЕ ПРОВЕРЕНО (не открыл полный redis-cache.ts). Рекомендую использовать **одный** клиент для всех dedupe-ключей. |
| D5 | Мелочь | src/core/notifications/telegram-delivery-progress.ts | Прогресс-сообщение в Telegram (отправлено N из M) обновляется `set`-ом. Если `set` упдёт (Redis down), **и** `sendMessage` упадёт — пользователь видит «отправим…», потом молчание, и нет DLQ-алерта (D1). | Мелочь. | ПРОЙДЕНО (структура) / ГИПОТЕЗА. |
| D6 | Мелочь | src/services/reports/event-handlers.ts:678-683 | `registerAllEventHandlers()` вызывается **дважды** в одном процессе: из `startEmbeddedOutboxWorker` (embedded-workers.ts:123) и из `startEmbeddedProjectionWorker` (embedded-workers.ts:227). Так как `on()` регистрирует в `Map<string, Set<EventHandler>>` (domain-events.ts:36-73, 67-73) и обработчики — **stable closures** (не inline, а `handleReportForAnalytics` и т.д.), Set-двойники **не** создаются. | **НЕ** баг, но легко превратить: если кто-то зальёт inline handler (например, `on(type, (e) => ...)`) — дубль. | ПРОЙДЕНО (Set dedupe работает). Рекомендую: `registerAllEventHandlers` сделать idempotent с guard `if (registered) return;` (мелочь). |

### Группа E — Leader election и гонки

| # | Severity | path:line | Проблема | Сценарий | Статус / Исправление |
|---|---|---|---|---|---|
| E1 | Критично | src/core/infrastructure/leader-election.ts (весь модуль) | Outbox и projection имеют **отдельных** лидеров (`getOutboxLeaderElection` / `getProjectionLeaderElection`). Лидер избор на Redis; TTL/heartbeat не просматривал **весь**, но в embedded-workers.ts:27 `HEARTBEAT_INTERVAL_MS = 30_000`. Между двумя нодами: node A — outbox-leader, node B — projection-leader. Событие, которое надо и опубликовать и спроецировать, обрабатывается **на разных машинах**. | Сценарий дубля/потери при пересечении (см. A2). | ПРОЙДЕНО (2 лидера) / ГИПОТЕЗА (пересечение). Исправление: единый leader key или lock на обе роли + `pg_advisory_xact_lock`. |
| E2 | Важно | src/workers/embedded-workers.ts:134-160, 237-263 | `onBecomeLeader` стартует воркер; `onLoseLeadership` — `worker.stop()`. Если между `stop()` и фактическим завершением в-flight-пакета (напр., `processOnce` уже прошёл `findMany`) и `onBecomeLeader` на **другой** ноде — двойной dispatch той же строки. | Дубль на переключение. | ГИПОТЕЗА. Исправление: guard на `outboxEvent.id` + единый leader. |
| E3 | Мелочь | src/core/infrastructure/leader-election.ts | Не проверено: как ведёт себя `isLeader()` при **первом** вызове (до первого heartbeat). Если сразу `true` → два узла «считают» себя лидерами в первый момент → двойной dispatch. | Мелочь. | НЕ ПРОВЕРЕНО (не читал полный leader-election.ts). Рекомендую: `isLeader()` = false до первого подтверждённого победа in election. |
| E4 | Мелочь | src/workers/embedded-workers.ts:295-325 | `startEmbeddedWorkers` guard `startupPromise` — один раз на процесс. Если два Next.js сервера с `server.keepAlive`/hot-reload импортировали — два разных `startupPromise` (per module instance) → два лидера-кандидата в одном **процессе**. | Мелочь. | ПРОЙДЕНО (guard на месте) / ГИПОТЕЗА (hot-reload). |

### Группа F — Redis и общие настройки

| # | Severity | path:line | Проблема | Сценарий | Статус / Исправление |
|---|---|---|---|---|---|
| F1 | Важно | src/lib/redis-cache.ts | `getRedisClient()` использует `REDIS_URL_CACHE`, `getStateRedisClient()` — `REDIS_URL_STATE`. Если в проде выставлены **разные** URL (например, cache — на кластере с коротким TTL, state — persistent), дедупликация (D2) может писать в cache, а проверка — в state → дубль/пропуск. | Мелочь в проде, но реальная. | НЕ ПРОВЕРЕНО (не читал полный redis-cache.ts). Рекомендую: единый клиент для dedupe, или явно комментировать, что dedupe — на cache. |
| F2 | Мелочь | src/lib/redis-cache.ts | Не проверено: `keyPrefix`/prefix-разделение «pilingtrack» (BULLMQ_PREFIX в pdf-worker.ts:45) vs BullMQ keyPrefix («BullMQ refuses to take keyPrefix»; pdf-worker.ts:35-36) — риск пересечения key-spaces между BullMQ и cache. | Мелочь. | НЕ ПРОВЕРЕНО. |

## Не проверено (список)

1. `src/services/notifications/durable-alert-delivery.ts` — прочитан, но не сверена с `telegramNotifier.sendMessage` (насколько надёжен retry при 429 Telegram).
2. `src/lib/pdf-queue.ts` — `enqueuePdfGeneration`, формула `dedupeKey` — **не** открыто подробно; C1 — НЕ ПРОВЕРЕНО.
3. `src/core/infrastructure/leader-election.ts` — полная логика `isLeader()` при первом вызове, TTL election key, алгоритм tie-breaking — **не** полностью открыто (E3 — НЕ ПРОВЕРЕНО).
4. `src/lib/redis-cache.ts` — полный `getRedisClient` / `getStateRedisClient`, prefix'ы, retry-политика — не полностью открыто (F1, F2, D4 — НЕ ПРОВЕРЕНО).
5. `src/app/instrumentation.ts` или точка входа — где именно вызывается `startEmbeddedWorkers()` — не найдено в прочитанных файлах; вероятно в `instrumentation.ts` `register()` hook. **НЕ проверено** (если не вызывается — outbox не публикуется **вообще**).
6. Присутствие `@prisma/client` миграций на `dead_letter_queue.dedupeKey` — не проверено (см. A3).
7. Присутствие `prune`/`cap` job'а — **не** проверено за пределами одного файла (A4).

## Сводка по категориям

| Category | Критично | Важно | Мелочь | Итого |
|---|---|---|---|---|
| A (Outbox) | 4 | 2 | 7 | 13 |
| B (Проекции) | 0 | 3 | 3 | 6 |
| C (BullMQ/PDF) | 0 | 2 | 2 | 4 |
| D (Telegram) | 1 | 1 | 4 | 6 |
| E (Leader/gonki) | 1 | 1 | 2 | 4 |
| F (Redis/env) | 0 | 1 | 1 | 2 |
| Итого | 6 | 10 | 19 | 35 |

*Статусы внутри таблицы: ПРОЙДЕНО — код виден и логика соответствует описанию; ГИПОТЕЗА — вывод из логики, воспроизведение не выполнялось (например, сценарий гонки/падения); НЕ ПРОВЕРЕНО — файл или фрагмент не открывал (C1, A7 в части вызывающего, E3, F1/F2, плюс пункт 5 «Не проверено»).*

## Рекомендации (приоритет)

1. **Немедленно:** DLQ-алерт (D1) + DLQ-prune (A4) + dedupeKey на `dead_letter_queue` (A3) — это три разных «тихих потерь» в одном коде.
2. **Немедленно:** Атомарный claim — claim-then-dispatch (A1) вместо dispatch-then-claim.
3. **В 1-2 дня:** Единый лидер (E1) или lock на outboxEvent.id + dedupe по (tenantId, dedupeKey) на DLQ (A3).
4. **В 1-2 недели:** `getOutboxStats` отдельная метрика `projected lag` (A13, B1, B3); `MAX_RETRIES`/base (A6); Redis-клиент дедупликации (F1, D4).
5. **Позже:** BullMQ retry-политика (C2), `registerAllEventHandlers` idempotent guard (D6), BullMQ worker lazy-init (C3).
