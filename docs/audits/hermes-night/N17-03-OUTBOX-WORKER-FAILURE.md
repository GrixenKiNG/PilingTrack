# N17-03 — Outbox и воркер: поведение при отказе

Аудит PilingTrack. Ветка `hermes/code-1011`, коммит, от которого читался код:
**`31cd4bcf7494ed87db2654b9840d6af351aeef03`** (`git rev-parse HEAD`; в задании упомянут
main `1d24e24f` — он есть в истории как `6d0deea5 merge: main 1d24e24f в ветку исполнителя Hermes`).
Рабочая папка: `D:/PillingR/wt-night-code`. Только чтение: код приложения не менялся,
закоммичен только этот отчёт.

## Итог

Найдено **21** наблюдение: **1 критично**, **14 важно**, **6 мелочь**.
Конвейер outbox в целом сделан честно: transactional outbox, раздельные потребители
`published`/`projected`, экспоненциальный backoff, DLQ, честный leader election на Redis,
Prometheus-алерты на лаг/DLQ. Главные слабые места — на стыках аварий:

1. **критично:** если запись в DLQ падает, `moveToDlq` глотает ошибку, а строка outbox всё
   равно помечается доставленной — событие теряется молча, ни ретрая, ни следа в DLQ
   (`outbox-publisher.ts:171-206`, `dead-letter-queue.ts:61-115`).
2. **важно:** `attempts`/`nextRetryAt`/`lastError` общие на два независимых потребителя —
   провал проекции «съедает» попытки публикации и может отправить событие в DLQ не тем
   потребителем (`schema.prisma:2081,2088`; `outbox-publisher.ts:168-229`).
3. **важно:** SIGTERM не дожидается текущего прохода (`worker.stop()` только снимает
   интервал) → выход на середине обработки, дубль Telegram после повтора
   (`unified-worker.ts:51-137`, `outbox-publisher.ts:292-306`).
4. **важно:** `npm run worker:outbox` (`src/workers/outbox-worker.ts`) не регистрирует
   обработчики вовсе → все события отчётов уходят в ретрай и DLQ (`outbox-worker.ts:12-53`,
   `domain-events.ts:134-138`). В проде используется `unified-worker` — там всё в порядке.
5. **важно:** таблица `OutboxEvent` не чистится никогда — ни TTL, ни retention-задачи
   (поиск по `src/`/`scripts/` не нашёл удаления), а воркер, стоящий сутки, только копит строки.

## Методика

Прочитаны (полностью или диапазонами) файлы из задания и связанные с ними:
`src/workers/outbox-worker.ts`, `src/workers/projection-worker.ts`, `src/workers/unified-worker.ts`,
`src/workers/unified-worker/{outbox,projection,pdf,config,state,health-server,scheduler-heartbeat}.ts`,
`src/workers/embedded-workers.ts`, `src/services/reports/outbox-publisher.ts`,
`src/services/reports/domain-events.ts`, `src/services/reports/event-handlers.ts`,
`src/core/outbox/dead-letter-queue.ts`, `src/core/infrastructure/leader-election.ts`,
`src/modules/readiness/infrastructure/snapshots/outbox-repository.ts`,
`src/modules/readiness/application/projection/{consumer,project-event}.ts`,
`src/modules/reports/application/projections/projection-worker.ts`,
`src/modules/reports/infrastructure/report.repository.ts`,
`src/core/observability/health-tracker/**`, `src/core/observability/lag-monitor.ts`,
`src/core/observability/health-checks.ts`, `src/app/api/health/**`, `src/app/api/metrics/route.ts`,
`src/app/api/admin/dlq/route.ts`, `src/core/notifications/telegram-delivery-progress.ts`,
`src/services/notifications/durable-alert-delivery.ts`, `src/services/audit/audit-service.ts`,
`src/core/security/idempotency.ts`, `prisma/schema.prisma` (модели `OutboxEvent`, `DeadLetterQueue`,
`FeedbackEvent`), миграции RLS, `observability/prometheus/alerts.yml`, `observability/alertmanager/alertmanager.yml`,
`Dockerfile.workers`, `docker-compose.yml` (чтение), `package.json`, `docs/runbooks/004-outbox-backlog.md`.

Числа — из `rg`-выборок по константам (см. «Ответы»). Порядок доставки, повторы, DLQ,
идемпотентность, SIGTERM, двойной воркер и наблюдаемость проверены чтением кода; поведение
на живом стенде не воспроизводилось (нет БД/Redis в окружении — только рабочая папка).

Сверка с `docs/audits/hermes-night/09-workers-reliability.md` (2026-09-25): несколько находок
того отчёта уже закрыты — `retryDlqEntry` сохраняет `tenantId` и `consumer`
(`dead-letter-queue.ts:132-148`), DLQ получила колонки `tenantId`/`aggregateType`/`consumer`
(`schema.prisma:2848-2850`), leader election переведён на state-Redis
(`leader-election.ts:165`), Telegram-доставка стала осознанно «хотя бы раз» с блокировкой
строки и частичными квитанциями (`event-handlers.ts:658-671`). См. раздел «Что изменилось».

## Ответы по вопросам 1–6

Везде статус: **ПРОЙДЕНО** — вывод подтверждён чтением кода и `rg`; **НЕ ПРОВЕРЕНО** — на живом
стенде не воспроизведено (нет доступа к БД/Redis/прод-контейнерам); **ГИПОТЕЗА** — вывод из кода,
прямого сценария не наблюдал.

### (1) Воркер остановлен 1 час / 1 сутки

**Вывод.** События не теряются и не имеют предела: они просто копятся в `OutboxEvent`
(`published=false`, для проекций независимо `projected=false`). Ограничения по количеству, TTL
или автоочистки нет — `rg` по `src/` и `scripts/` не нашёл ни `deleteMany` по `outboxEvent`,
ни отдельной retention-задачи. Периодические задачи (PM/readiness/rebuild/idempotency) суточную
очередь outbox не чистят. Порядок при воркере без сбоев — `orderBy createdAt asc`
(`outbox-publisher.ts:103`), но он **best-effort**: два потребителя идут независимо, а строка,
попавшая в backoff (`nextRetryAt`), пропускается на время задержки (`outbox-publisher.ts:98-101`),
поэтому более новое событие уходит вперёд старого. Время догонки — от `ceil(N/BATCH_SIZE)`
интервалов (нижняя оценка) до суммы задержек обработчиков (верхняя): `BATCH_SIZE=100`
(`outbox-publisher.ts:30`), интервал 10 с у unified (`config.ts:7`) и 2 с у embedded
(`embedded-workers.ts:142`), но один проход может тянуться десятки секунд на
`ReportPdfDeliveryRequested` (рендер PDF + Telegram, транзакция до 60 с, `event-handlers.ts:658-670`).
Статус: ПРОЙДЕНО для механики, НЕ ПРОВЕРЕНО для фактических объёмов/времени на стенде
(числа объёма — только с живой БД).

**Как проверить (чтение, прод):** `dc exec postgres psql -U piling -d pilingtrack -c 'SELECT
count(*) FILTER (WHERE published=false) AS unpublished, count(*) FILTER (WHERE projected=false) AS unprojected,
coalesce(greatest(0, extract(epoch FROM (now()-min("createdAt") FILTER (WHERE published=false)))),0) AS age_s
FROM "OutboxEvent";'` — см. `docs/runbooks/004-outbox-backlog.md:109-134`.

### (2) Повторы, «ядовитое» событие, DLQ

**Вывод.** `MAX_RETRIES=5`, база задержки 1000 мс, потолок 60000 мс, джиттер 30 %
(`outbox-publisher.ts:27-42`). На каждом провале `attempts = attempts+1`; при `attempts>=5`
событие переносится в DLQ и **текущий** потребитель помечается `true`, чтобы строка не бралась
снова (`outbox-publisher.ts:171-206`). Итог: 5 попыток на событие (первый сбой → задержка
≈2 с, далее 4/8/16 с). «Ядовитое» событие попадает в `DeadLetterQueue` со статусом `pending`,
бьёт `logger.error` и шлёт Telegram best-effort (`dead-letter-queue.ts:85-110`). Repair вручную —
через `/api/admin/dlq` (`route.ts:124-139`). Статус: ПРОЙДЕНО. Особый случай: если запись в DLQ
не удалась, ошибка глушится внутри `moveToDlq`, а строка всё равно помечается доставленной —
см. находку №1.

**Как проверить:** `... -c 'SELECT id,type,attempts,"nextRetryAt",left("lastError",80) FROM
"OutboxEvent" WHERE attempts>=5 OR published=false ORDER BY "createdAt" LIMIT 10;'` и
`... -c 'SELECT status,count(*) FROM "DeadLetterQueue" GROUP BY status;'`.

### (3) Идемпотентность обработчиков

**Вывод.** На уровне outbox ключ `dedupeKey` есть, но **события отчётов его не пишут**
(`report.repository.ts:46-72`), поэтому дедупликация ложится на обработчики:
`handleReportForAnalytics` — `upsert` по `reportId` (`event-handlers.ts:125-151`, идемпотентно);
`recomputeSiteDailySummary` — полный пересчёт (`event-handlers.ts:212-244`, идемпотентно);
доставка PDF — `dedupeKey: report-pdf:${event.id}` + `SELECT ... FOR UPDATE` + частичные квитанции
по чатам (`event-handlers.ts:573-588,658-671`; `telegram-delivery-progress.ts:9-24`);
`handleAuditEvent` — **не идемпотентен и не дедуплицируется** (`event-handlers.ts:456-488`,
в `FeedbackEvent` нет уникального ключа по событию, `schema.prisma:2536-2561`);
алерт про простое — дедуп в Redis на 48 ч, best-effort (`event-handlers.ts:337-361,416-433`).
При «хотя бы раз» дважды: аналитика/сводка безопасны, Telegram-PDF безопасен (кроме окна
падения, см. №10), лента аудита получает дубли, алерт простоя — дубль только без Redis.
Статус: ПРОЙДЕНО.

### (4) Остановка посреди обработки (SIGTERM)

**Вывод.** Корректного «дожатия» текущего прохода нет. `worker.stop()` только снимает интервал
(`outbox-publisher.ts:292-298`, `projection-worker.ts:200-212`), `gracefulShutdown` вызывает
`stop()` для всех воркеров и сразу закрывает Redis/Prisma и `process.exit(0)`
(`unified-worker.ts:51-137`), не ожидая незавершённый `processOnce`. Дедлайн остановки — 8 с
(`WORKER_SHUTDOWN_TIMEOUT_MS`, `unified-worker.ts:49`), Docker ждёт 10 с. Итог: выход в середине
обработчика; открытая транзакция (в т.ч. `FOR UPDATE` в `deliverReportPdf`) откатывается, строка
остаётся `published=false` и после перезапуска пойдёт на повтор. Блокировка строки освобождается
при обрыве соединения (практически сразу), «зависших» строк не остаётся — остаётся риск дубля
доставки (at-least-once). `outbox-worker.ts:100-116` завершается тем же способом. Статус: ПРОЙДЕНО
(дубль — ГИПОТЕЗА на конкретном стенде, механика подтверждена кодом).

**Как проверить:** `dc logs workers --tail 80` вокруг `SIGTERM` — есть ли `Stopping worker` без
последующего `Unified worker shutdown complete`; спец. команд для эмуляции в этом аудите не
запускалось (нет прав на прод/БД).

### (5) Два воркера одновременно

**Вывод.** Защита есть: leader election на Redis, ключ `leader:outbox-worker` / `leader:projection-worker`,
TTL 30 с, renew каждые 10 с (`leader-election.ts:47-60,146-198`; `outbox-publisher.ts:13`). В проде
inbox-пути два: app-контейнер поднимает встроенные `outbox`/`projection` (`embedded-workers.ts:26,46-48`),
а контейнер `workers` — `ENABLED_WORKERS=outbox,projection,pdf` (`docker-compose.yml:178`,
`Dockerfile.workers:99`); лидером становится ровно один, второй простаивает (так и написано в
`docs/runbooks/004-outbox-backlog.md:53-56`). Слабые окна: (а) между истечением Redis-lease и
локальным обнаружением лидер может завершить текущий батч — проверки `isLeader()` перед каждым
событием нет (`outbox-publisher.ts:111-166`); (б) потеря лидера во время блока событийного цикла
(GC/пауза) — `leader-election.ts:114-119`. Двойная обработка не ломает идемпотентные обработчики,
но даёт дубли аудита и Telegram. Статус: ПРОЙДЕНО для механики, ГИПОТЕЗА для реального окна
двойного лидера (нужен отказ Redis/пауза на стенде).

### (6) Что видит оператор

**Вывод.** Три уровня:
- `/api/health` (публичный) outbox не проверяет вовсе (`health-checks.ts:164-186`);
- `/api/health/deep` — общий вердикт считается и по outbox (`aggregate.ts:19-48`), но в
  ответе описание outbox **не выводится** — только database/redis/schedulers/storage
  (`deep/route.ts:40-57`), поэтому `503 unhealthy` не показывает, что виноват именно outbox;
- `/api/system/status` (админ) отдаёт полный `SystemStatus` с `components.outbox` и
  `metrics.outboxPending` (`src/app/api/system/status/route.ts:36-41`);
- `/api/metrics` — `outbox_lag_seconds`, `outbox_pending_count`, `projection_lag_seconds`,
  `projection_pending_count`, `dlq_pending_count`, `outbox_leader`
  (`lag-monitor.ts:334-386`, `metrics/route.ts:97-103`).

Пороги: health — backlog>1000, stale>1 ч (`thresholds.ts:3-4`); lag-monitor — warn 60 с,
critical 300 с, pending 5000 (`lag-monitor.ts:83-85`); Prometheus-правила копируют их
(`alerts.yml:171-232,246`), плюс `WorkersDown`/`WorkerNotRunning` (`alerts.yml:272-294`).
Оповещение идёт Prometheus→Alertmanager→`/api/alerts/webhook`→Telegram
(`alertmanager.yml:17-26`). Своя, внутренняя `onAlert` в `tracker.ts:41-54` только пишет в лог —
реальную доставку обеспечивают правила Prometheus. Отдельно `checkOutbox` считает только
`published=false` и **не смотрит `projected`** (`checkers/outbox.ts:13-14`) — застой проекций
health не переключает (ловится только правилом `ProjectionLagHigh`). Статус: ПРОЙДЕНО.

**Как проверить:** `curl -s localhost:3000/api/system/status | jq '.components.outbox,.metrics'`;
`curl -s localhost:3000/api/metrics | grep -E 'outbox|projection|dlq'`.

## Находки

Статусы: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА. Severity — по реальному сценарию отказа.

# | severity | статус | path:line | проблема | сценарий / почему важно | как проверить на стенде / исправление
--- | --- | --- | --- | --- | --- | ---
1 | критично | ПРОЙДЕНО | `src/services/reports/outbox-publisher.ts:171-206` + `src/core/outbox/dead-letter-queue.ts:61-115` | `moveToDlq` ловит и глушит собственную ошибку записи (`dead-letter-queue.ts:111-114`), а `consumeOutboxEvents` **после** этого всё равно помечает строку `published=true`/`projected=true` (`outbox-publisher.ts:198-206`). Move в DLQ и claim не атомарны. | Исчерпавшее попытки событие + сбой БД на `deadLetterQueue.create` → строка помечена доставленной, в DLQ пусто, ретрая нет. Событие (напр. Telegram-уведомление отчёта) теряется молча. | Проверка: `... -c "SELECT count(*) FROM \"DeadLetterQueue\""` против числа событий с `attempts>=5 AND published=true AND \"lastError\" LIKE 'Moved to DLQ%'`. Исправление: move+claim в одну транзакцию; при сбое записи в DLQ НЕ помечать потребителя, оставить в ретрае и алертить.
2 | важно | ПРОЙДЕНО | `prisma/schema.prisma:2081,2088` + `src/services/reports/outbox-publisher.ts:168-229` | `attempts`, `nextRetryAt`, `lastError` — общие поля на два независимых потребителя `published`/`projected` (`schema.prisma:2081,2088`; комментарий признаёт — `runbook 004:50-51`). | Провал проекции несколько раз съедает попытки: публикующая сторона уходит в DLQ уже на первом своём сбое; либо backoff, назначенный проекцией, откладывает публикацию того же события (до 60 с). Одна строка может попасть в DLQ «не тем» потребителем. | Проверка: `... -c 'SELECT id,type,attempts,published,projected,\"nextRetryAt\" FROM \"OutboxEvent\" WHERE attempts>=3 OR \"nextRetryAt\">now() ORDER BY \"createdAt\" DESC LIMIT 20;'`. Исправление: раздельные `attempts`/`nextRetryAt` на потребителя или два поля.
3 | важно | ПРОЙДЕНО | `src/workers/unified-worker.ts:51-137` + `src/services/reports/outbox-publisher.ts:292-306` | `stop()` только `clearInterval`, `gracefulShutdown` не ждёт текущий `processOnce` и сразу `process.exit(0)`. | Перезапуск/деплой в момент отправки Telegram (или PDF): процесс выходит посреди обработчика, транзакция откатывается, событие повторяется → повторное сообщение в чат (Telegram ключей идемпотентности не знает). | Проверка: `dc stop workers` во время фоновой отправки и `dc logs workers` — есть ли выход без `Unified worker shutdown complete`. Исправление: `stop()` возвращает промис завершения текущего прохода, `gracefulShutdown` его ждёт в пределах дедлайна.
4 | важно | ПРОЙДЕНО | `src/workers/outbox-worker.ts:12-53` + `src/services/reports/domain-events.ts:134-138` | `outbox-worker.ts` вызывает `registerAllEventSchemas()`, но **не вызывает `registerAllEventHandlers()`**; конвейер публикации зовёт `emitDomainEvent`, который при пустом реестре для событий отчёта бросает исключение. | `npm run worker:outbox` (документированный скрипт, `package.json:48`): все `Report*` события падают с «No handlers…» → ретраи с backoff → DLQ. Событий не теряется (они в outbox и DLQ), но публикация ломается полностью. | Проверка: локально `npm run worker:outbox` + `SELECT type,attempts,left(\"lastError\",60) FROM \"OutboxEvent\" WHERE \"lastError\" LIKE '%No handlers%';`. Прод использует `unified-worker` (`Dockerfile.workers:99`) — там обработчики регистрируются (`outbox.ts:33-40`). Исправление: добавить `registerAllEventHandlers()`/`registerReadinessProjectionHandler()` в `main()`.
5 | важно | ПРОЙДЕНО (нет удаления) | `prisma/schema.prisma:2070-2100` + отсутствие кода очистки | У `OutboxEvent` нет ни TTL, ни retention. `rg` по `src/`/`scripts/` не находит `deleteMany`/prune по `outboxEvent`; суточные планировщики очередь не чистят. | Воркер, простоявший сутки, копит строки без предела; таблица растёт всегда (и published-строки тоже). Со временем замедляются `COUNT(*)` в health/статистике и растёт объём БД. | Проверка: `... -c 'SELECT count(*), pg_size_pretty(pg_total_relation_size($$\"OutboxEvent\"$$)) FROM \"OutboxEvent\";'`. Исправление: периодическая очистка `published=true AND projected=true AND \"createdAt\" < now()-interval 'N days'` (с оговоркой про долгие backoff).
6 | важно | ПРОЙДЕНО | `src/app/api/health/deep/route.ts:40-57` + `src/core/observability/health-tracker/checkers/outbox.ts:13-14` | `/api/health/deep` возвращает `503` при застое outbox, но в теле перечислены только database/redis/schedulers/storage — компоненты outbox нет. `checkOutbox` смотрит только `published=false`, `projected`-застой не влияет на общий вердикт. | Внешний мониторинг видит «unhealthy», но по ответу не понять, что виноват outbox; застой проекций не переключает health вовсе (только правило Prometheus). | Проверка: `curl -s localhost:3000/api/health/deep | jq .components`. Исправление: добавить `outbox` (и `workers`) в summary; учитывать `projected` в `checkOutbox`.
7 | важно | ПРОЙДЕНО | `src/services/reports/outbox-publisher.ts:317-326` + `src/workers/embedded-workers.ts:180-182` | `getOutboxStats().failed` = `published=false AND attempts>=5`. После переноса в DLQ строка становится `published=true` и уже **не** считается; `projected`-сторона не учитывается вовсе. | Метрика «failed» почти всегда 0, хотя DLQ непуста; встроенный воркер, который логирует error при `failed>0`, практически никогда не срабатывает. Оператор по статистике воркера не увидит «ядовитые» события. | Проверка: сравнить `... -c 'SELECT count(*) FROM \"DeadLetterQueue\" WHERE status=$$pending$$;'` и `getOutboxStats().failed`. Исправление: считать failed по `DeadLetterQueue`/по обоим потребителям.
8 | важно | ПРОЙДЕНО | `src/core/outbox/dead-letter-queue.ts:98-110` | Telegram-алерт о попадании в DLQ отправляется fire-and-forget (`void ... .catch(()=>{})`), без ретрая; плюс может быть подавлен настройкой организации (`alertEnabled`). | Если Telegram недоступен или выключатель «Недоставленные события» выключен — оператор не узнаёт, что событие попало в DLQ, пока не откроет админ-экран. | Проверка: выключить уведомления организации и уронить событие в DLQ — проверить, есть ли запись в DLQ и нет ли сообщения. Исправление: сделать DLQ-алерт durable (через outbox) или хотя бы логировать с уровнем critical.
9 | важно | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:456-488` + `prisma/schema.prisma:2536-2561` | `handleAuditEvent` не дедуплицируется (в `FeedbackEvent` нет уникального ключа по исходному событию) и глотает ошибки (`catch`+log). | Двойная обработка (failover лидера, повтор) даёт два одинаковых следа в ленте; сбой БД — событие помечено доставленным, запись теряется тихо. | Проверка: `... -c 'SELECT \"targetId\",action,count(*) FROM \"FeedbackEvent\" GROUP BY 1,2 HAVING count(*)>1 LIMIT 10;'`. Исправление: ключ дедупликации по `sourceOutboxId`/`eventId`.
10 | важно | ГИПОТЕЗА | `src/services/reports/event-handlers.ts:658-671` + `src/core/notifications/telegram-delivery-progress.ts:9-24` | Доставка PDF: `SELECT … FOR UPDATE` + проверка `published`, квитанции по чатам пишутся той же транзакцией до `published=true`. Но при падении процесса после ответа Telegram и до commit транзакция откатывается — квитанции тоже. | Деплой/перезапуск в этот момент → повторная отправка отчёта в чат. Телеграм идемпотентности не поддерживает; частичные квитанции помогают только от повторной доставки в уже подтверждённые чаты внутри коммита. | Проверка: трудновоспроизводимо; оценить по логам `ReportPdfDeliveryRequested` с `attempts>1`. Осознанное at-least-once; при желании — вынести квитанции в отдельную таблицу, коммитимую до отправки.
11 | важно | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:405-442,337-361` | Алерт про простой: ошибка Telegram глушится (`catch`+log, не бросает) → событие помечается опубликованным. Дедуп — в Redis, при его недоступности отправка идёт без дедупа. | Telegram недоступен → алерт о простое >2 ч потерян без ретрая/DLQ. Двойной прогон без Redis → дубль алерта. | Проверка: `... -c 'SELECT attempts,left(\"lastError\",60) FROM \"OutboxEvent\" WHERE type='DOWNTIME_ADDED' ORDER BY \"createdAt\" DESC LIMIT 5;'`. Исправление: пробрасывать ошибку доставки (как в `deliverReportPdf`) либо перевести на durable-конвейер.
12 | важно | ПРОЙДЕНО | `src/modules/reports/infrastructure/report.repository.ts:46-72` | События отчётов пишутся в outbox без `dedupeKey` (поле есть в схеме, но не заполняется). | На уровне outbox дедупликации нет — защита от повторов целиком на обработчиках. Для аудита (№9) это даёт дубли, для остальных безопасно. | Проверка: `... -c 'SELECT type,count(*) FROM \"OutboxEvent\" WHERE \"dedupeKey\" IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10;'`. Исправление: осознанно оставить, задокументировав; либо проставлять ключ вида `report:<reportId>:<type>:<version>`.
13 | важно | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:553-568` | `newerPending` считает более новые `ReportSubmitted` по `published=false` (с `id != event.id`), порядок в пачке/между репликами не гарантирован (см. №1-вопрос) — при пропуске ожидаемого порядка возможен уход «устаревшего» PDF или, наоборот, пропуск нужного. | При гонке двух потребителей или разбиении на батчи диспетчер может получить не то уведомление об отчёте, либо не получить вовсе. | Проверка: `... -c 'SELECT id,aggregateId,published,\"createdAt\" FROM \"OutboxEvent\" WHERE type='ReportSubmitted' ORDER BY \"createdAt\" DESC LIMIT 20;'`. Исправление: опираться на версию отчёта/`occurredAt`, а не только на `published`.
14 | важно | ПРОЙДЕНО | `src/services/reports/outbox-publisher.ts:88-166,658-670` | Проход обрабатывает до 100 событий подряд без бюджета времени; для `ReportPdfDeliveryRequested` один обработчик может держать транзакцию до 60 с. | «Головная блокировка»: одно медленное/ядовитое событие задерживает все следующие в пачке; после длительного простоя догон ограничен суммой задержек обработчиков, а не только `BATCH_SIZE`/интервалом. | Проверка: `SELECT count(*) FROM \"OutboxEvent\" WHERE type='ReportPdfDeliveryRequested' AND published=false;` на фоне `outbox_lag_seconds`. Исправление: ограничить время прохода / вынести тяжёлые доставки в отдельную очередь.
15 | важно | ГИПОТЕЗА | `src/core/infrastructure/leader-election.ts:114-119,146-198` + `src/services/reports/outbox-publisher.ts:111-166` | Локальное обнаружение потери лидера привязано к `leaseTimer` (TTL 30 с); проверки `isLeader()` перед каждым событием нет, `onLoseLeadership` лишь снимает интервал. Новый лидер может взять `SET NX` после истечения TTL, пока старый ещё дорабатывает текущий батч. | Смена поколения при выкладке / пауза GC / сетевой сбой Redis → краткое окно двух активных обработчиков → повторная обработка. Идемпотентные обработчики выдержат, Telegram/аудит — дубли. | Проверка: `curl -s localhost:3000/api/metrics | grep outbox_leader`; искусственно вызвать паузу — сравнить. Исправление: проверять `isLeader()` перед каждым утверждением строки; уменьшить `renewInterval`.
16 | мелочь | ПРОЙДЕНО | `src/app/api/admin/dlq/route.ts:124-139` | POST `/api/admin/dlq` вызывает `retryDlqEntry(id)`/`discardDlqEntry(id)` по глобальному id, без фильтра по организации (`requireTenantId` используется только в GET, `route.ts:58`). | Гейт `dlq.manage` выдан только `ADMIN` (`authorization-service.ts:133`), а ADMIN — платформенная роль (решение владельца), поэтому сегодня не находка. Перед организацией №2 админ одной организации сможет retry/discard запись другой. | Проверка: `... -c 'SELECT id,\"tenantId\" FROM \"DeadLetterQueue\" LIMIT 5;'` и вызов POST с чужим id под ролью, видящей только свою организацию. Исправление: скоуп по тенанту при мутациях (или явная платформенная оговорка).
17 | мелочь | ПРОЙДЕНО | `src/core/observability/health-tracker/checkers/outbox.ts:46-48` | При исключении проверка возвращает `{status:'stalled', pendingCount:-1}`. | Разовый таймаут БД (`DB_CHECK_TIMEOUT_MS=2000`, `thresholds.ts:6`) переводит `/api/health/deep` в `503 unhealthy`, хотя очередь может быть здорова → ложная тревога внешнего мониторинга. | Проверка: наблюдать `health_status` при кратковременном замедлении БД. Исправление: отличать «ошибка измерения» от «застой» (отдавать отдельный статус/оставлять предыдущий).
18 | мелочь | ПРОЙДЕНО | `src/services/reports/outbox-publisher.ts:36-42` | `getBackoffDelay(attempts)` считает `base * 2^attempts`, где `attempts` уже = число сбоев. | Первая задержка получается ≈2000 мс, а не 1000, как читается из «1 s base» — расхождение с ожиданием оператора/документации. Не ломает надёжность. | Проверка: юнит-тест `outbox-worker.test.ts` или лог `Outbox event scheduled for retry` с `backoffMs`. Исправление: `2^(attempts-1)` либо поправить комментарий.
19 | мелочь | ПРОЙДЕНО | `src/modules/reports/application/projections/projection-worker.ts:181-198` | Ежечасный пересчёт недельного тренда имеет `weeklyRunning`-гвард, но не проверяет `election.isLeader()` внутри интервала. | Пока процесс считается лидером, всё в порядке; при кратком двойном лидерстве возможен двойной тяжёлый пересчёт (идемпотентно, но нагрузка). | Проверка: `projection_lag_seconds`/нагрузка БД в момент смены лидера. Исправление: добавить проверку лидера в `weeklyInterval`.
20 | мелочь | ПРОЙДЕНО | `src/workers/outbox-worker.ts:100-116` + `src/services/reports/outbox-publisher.ts:301-304` | На SIGTERM/SIGINT срабатывают и обработчик `outbox-worker.ts`, и слушатель, зарегистрированный внутри `startOutboxWorker` (оба зовут `stop`). | Безвредно (двойной `clearInterval`), но лишний шум; `outbox-worker.ts` к тому же завершается `process.exit(0)`, не дожидаясь прохода. | Проверка: чтение кода. Исправление: не регистрировать внешний обработчик при `startOutboxWorker`.
21 | мелочь | ПРОЙДЕНО | `src/core/outbox/dead-letter-queue.ts:132-148` | `retryDlqEntry` намеренно не переносит `dedupeKey` (комментарий: исходное событие с ключом ещё в outbox). | Для событий отчётов ключа и так нет; для readiness-событий повтор опирается на дедуп снимка (`project-event.ts:60-64`). Риск дубля снимка низкий, но ключ не восстанавливается. | Проверка: `... -c 'SELECT \"dedupeKey\",type FROM \"OutboxEvent\" WHERE \"dedupeKey\" IS NOT NULL ORDER BY \"createdAt\" DESC LIMIT 10;'`. Исправление: переносить ключ (с новым суффиксом) при повторе.

## Что изменилось с `09-workers-reliability.md` (2026-09-25)

ПРОЙДЕНО по коду — часть прежних находок закрыта:

- Ретрай DLQ восстанавливает организацию и потребителя (`dead-letter-queue.ts:132-148`,
  коммит `126e9d39 fix(outbox): повтор из DLQ сохраняет организацию и потребителя (R9-2)`).
- В `DeadLetterQueue` появились `tenantId`/`aggregateType`/`consumer` (`schema.prisma:2848-2850`).
- Leader election переведён на Redis **состояния** (`leader-election.ts:11,165`), lease считается
  монотонным временем (`leader-election.ts:162,194`), что снимает прежние предупреждения о
  рассинхроне кэш/стейт-инстансов.
- Telegram-доставка отчёта стала транзакционной с блокировкой строки и частичными квитанциями
  (`event-handlers.ts:658-671`), появились ключ `report-pdf:${event.id}` и отдельный тип события
  (`event-handlers.ts:535,573-588`) — прежняя «тихая потеря Telegram-уведомлений» закрыта.
- Пульс планировщиков добавлен (`scheduler-heartbeat.ts`, `checkers/schedulers.ts`), алерты
  Prometheus на outbox/projection/DLQ/worker присутствуют (`alerts.yml:171-294`).

Осталось (перенесено в текущий отчёт): атомарность DLQ+claim (№1), общий `attempts` (№2),
отсутствие дожима прохода (№3), неидемпотентный аудит (№9), fire-and-forget DLQ-алерт (№8),
игнорирование `projected` в `checkOutbox` (№6), разрыв `worker:outbox` (№4 — новый).

## Не проверено

- **Живой стенд не запускался.** В окружении нет доступа к БД/Redis/прод-контейнерам (`dc ...`
  из runbook не исполнялся). Все команды в отчёте — рецепты чтения, не выполненные прогоны.
- **Фактические объёмы и худшее время догонки** (вопрос 1) не измерены: нужны `count(*)` по
  `OutboxEvent` и история `outbox_lag_seconds` на реальной нагрузке.
- **Реальное окно двойного лидера** (находка №15) не воспроизведено: требует паузы процесса/отказа
  Redis на стенде.
- **Реальная доставка оповещений** (Alertmanager→webhook→Telegram) не проверялась — читались
  только конфиги `alerts.yml`/`alertmanager.yml`; применение правил на сервере не подтверждалось.
- **Число реплик/простаивание** в текущем проде не проверялось (нет доступа к compose на сервере);
  вывод «лидер обрабатывает ровно один» — из кода leader election и комментария runbook 004.
- **`deliverReportPdf`/`generateSinglePdf` падение в середине** (№10) — гипотеза: отдельно не
  моделировалось.
- **`EMBEDDED_WORKERS` для app-сервиса** в `docker-compose.prod.yml` не открывался (только
  базовый `docker-compose.yml`): возможно, в проде встроенные воркеры отключены — на выводы
  это не влияет (leader election покрывает оба случая), но состав процессов мог быть иным.
