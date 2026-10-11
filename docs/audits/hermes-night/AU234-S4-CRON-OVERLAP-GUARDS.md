# AU234-S4 — Фоновые задачи PilingTrack: защита от наложения (overlap guards)

Версия: `git rev-parse HEAD` = `95dc0f69ef508e4f8997154029009dbb0f08b2c5`
Ветка: `hermes/q4-0926`. Режим: только чтение, код приложения не менялся.

## Итог

Аудит показал, что почти все фоновые задачи PilingTrack защищены от наложения — либо process-guard'ом, либо выбором лидера, либо самопланирующим таймером. Проверено 18 задач; явных дыр уровня «двойная запись в БД» не найдено, потому что тяжёлые проходы идемпотентны.
Найдено: **критично — 0, важно — 4, мелочь — 5, подтверждённых защит (ПРОЙДЕНО) — 6, непроверено — 3** (числа — из перечисленного ниже; всего 16 пунктов + раздел «Не проверено»).
Топ-5:
1. `src/workers/unified-worker.ts:84-107` — при остановке контейнера stop-функции планировщиков только очищают таймеры и НЕ дожидаются текущего прохода; затем соединения БД/Redis закрываются. Идущий проход обрывается.
2. `src/workers/unified-worker/projection-rebuild-scheduler.ts:28` — `passRunning` защищает только внутри процесса; ручной POST `/api/admin/projections/rebuild` из app-контейнера может идти параллельно с суточным пересбором в workers-контейнере (распределённого замка нет).
3. `src/workers/unified-worker/readiness-scheduler.ts:26` — тот же внутрипроцессный guard; проход пишет audit-события по выбранным строкам до проверки результата `updateMany`, поэтому второй параллельный проход может дать дубль событий.
4. `src/workers/unified-worker/outbox.ts:76` — пульс воркера пишется отдельным `setInterval`, не завися от состояния прохода: зависший насмерть проход выглядит как «running» в `/api/health/deep`.
5. `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:35` — единственный планировщик без re-entrancy guard'а (все соседи его имеют).

Хорошая новость: у pm-scheduler защита двойная — process-guard **и** `pg_advisory_xact_lock` в команде (`src/modules/equipment/application/commands/pm-scheduler.ts:107`), поэтому ручной запуск и суточный тик дублей ТО не создают. У outbox/projection — распределённый выбор лидера через Redis-lease.

## Методика

Поиск по репозиторию (rg-like через search_files) и чтение файлов:
1. `search_files` по `src/` и `src/lib` на `setInterval|cron|schedule|setTimeout` — 57 совпадений `setInterval` в `src/`; + `src/lib` (rate-limiter, media-thumbnails, hooks).
2. Ручной разбор каталога `src/workers/` и `src/workers/unified-worker/` (`ls -R`): `unified-worker.ts`, `pm-scheduler.ts`, `projection-rebuild-scheduler.ts`, `readiness-scheduler.ts`, `idempotency-cleanup-scheduler.ts`, `pdf-cleanup-scheduler.ts`, `scheduler-heartbeat.ts`, `outbox.ts`, `projection.ts`, `pdf.ts`, `embedded-workers.ts`, `outbox-worker.ts`, `projection-worker.ts`, `pdf-worker.ts`.
3. `search_files` по `docker-compose*.yml` на `replicas|deploy:|workers:|command:|backup|schedule`; чтение `docker-compose.yml:150-209` и `docker-compose.prod.yml:25-94` (число реплик и `ENABLED_WORKERS`).
4. `search_files` по `scripts/` и всему репо на `cron|pg_cron|cron.schedule|flock|lock`.
5. Чтение инфраструктурных таймеров: `src/core/infrastructure/leader-election.ts`, `src/core/observability/lag-monitor.ts`, `src/core/observability/health-tracker/tracker.ts` + `checkers/schedulers.ts`, `src/services/telemetry/telemetry-buffer.ts`, `src/core/cache/response-cache.ts`, `src/core/error-boundary/bulkhead.ts`, `src/core/observability/error-tracker.ts`, `src/lib/rate-limiter.ts`, `src/lib/media-thumbnails.ts`.

Как перепроверить: `git rev-parse HEAD` должен совпасть с указанным выше; затем по каждому `path:line` открыть файл — строка содержит либо вызов таймера, либо объявление guard'а. Все выводы сделаны по коду, живая БД/Redis не поднимались (см. «Не проверено»).

## Находки

### Сводная таблица «задача | файл:строка | защита | статус/риск»

| Задача | Файл:строка | Защита | Статус / риск |
|---|---|---|---|
| PM-планировщик (план ТО) | `src/workers/unified-worker/pm-scheduler.ts:67,100` | `passRunning` + `pg_advisory_xact_lock` в команде (`src/modules/equipment/application/commands/pm-scheduler.ts:107`) | ПРОЙДЕНО |
| Outbox-публикатор | `src/services/reports/outbox-publisher.ts:276-290` | `running` single-flight + выбор лидера | ПРОЙДЕНО |
| Projection (CQRS) | `src/modules/reports/application/projections/projection-worker.ts:155-170` | `running` single-flight + выбор лидера | ПРОЙДЕНО |
| Недельный тренд (в том же воркере) | `src/modules/reports/application/projections/projection-worker.ts:180-198` | `weeklyRunning` | ПРОЙДЕНО |
| Пересборка витрин (projection-rebuild) | `src/workers/unified-worker/projection-rebuild-scheduler.ts:25-49` | `passRunning` (только процесс) | важно / ГИПОТЕЗА |
| Сброс техготовности (readiness) | `src/workers/unified-worker/readiness-scheduler.ts:24-52` | `passRunning` (только процесс) | важно / ГИПОТЕЗА |
| Уборка ключей идемпотентности | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:35-52` | нет guard'а | мелочь |
| Уборка временных PDF | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:9-32` | `running` promise + `AbortController` + `await running` при stop | ПРОЙДЕНО |
| PDF-воркер (BullMQ) | `src/workers/unified-worker/pdf.ts:72-78` | concurrency=2; блокировку задач держит BullMQ | ПРОЙДЕНО |
| Lag-монитор | `src/core/observability/lag-monitor.ts:410-432` | самопланирующий `setTimeout(tick)` ПОСЛЕ завершения | ПРОЙДЕНО |
| Health-tracker | `src/core/observability/health-tracker/tracker.ts:56-100` | самопланирующий `setTimeout(tick)` | ПРОЙДЕНО |
| Сброс телеметрии | `src/services/telemetry/telemetry-buffer.ts:124-128` | `flushPromise` single-flight | ПРОЙДЕНО |
| Чистка in-memory (rate-limit, cache, error-tracker, bulkhead) | `src/lib/rate-limiter.ts:114`, `src/core/cache/response-cache.ts:119`, `src/core/observability/error-tracker.ts:134`, `src/core/error-boundary/bulkhead.ts:261` | in-memory prune, идемпотентно | ПРОЙДЕНО |
| Остановка контейнера workers | `src/workers/unified-worker.ts:84-107` | stop-функции не дожидаются прохода | важно |
| Бэкап (cron хоста) | `scripts/backup-postgres.sh:5`, `scripts/backup.sh:8-9` | нет flock | ГИПОТЕЗА |
| Резервное копирование / партиции БД | `scripts/apply-full-ddl.sql:274` | pg_cron-расписание не в репозитории | НЕ ПРОВЕРЕНО |

### Детали

| # | важность | путь:строка | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/workers/unified-worker.ts:84-107` | В `gracefulShutdown` стоп-функции планировщиков (`stopPmScheduler()`, `stopProjectionRebuild()` и т.д.) синхронно очищают таймеры и не ждут текущего `runOnce`. Сразу после этого закрываются Redis (`:118-119`) и Prisma (`:127`). | If проход планировщика идёт в момент SIGTERM, работа обрывается на середине транзакции, а затем контейнер получает SIGKILL через 8 с (`SHUTDOWN_TIMEOUT_MS`, `:49,60-66`). Для outbox — повторная неидемпотентная отправка Telegram (см. #6). | Возвращать из `start*Scheduler` объект со `{ stop(): Promise<void> }`, который дожидается текущего прохода (как уже сделано в `pdf-cleanup-scheduler.ts:27-32`), и `await` его до закрытия соединений. |
| 2 | важно | `src/workers/unified-worker/projection-rebuild-scheduler.ts:28` и `src/app/api/admin/projections/rebuild/route.ts:54-63` | Пересборка витрин имеет только внутрипроцессный `passRunning`. Ручной POST из app-контейнера и суточный проход в workers-контейнере — разные процессы, общего замка нет. `rebuildSiteDailySummary`/`rebuildSiteWeeklyTrend` делают `deleteMany`+`createMany` в одной транзакции (`src/modules/reports/application/projections/rebuild.ts:80-83,164-167`). | Два одновременных полных пересбора бьют по одним и тем же строкам → блокировки/дедлок, либо кратковременно пустая витрина; админ увидит «другие числа» в аналитике. | Сериализовать через `pg_advisory_lock`/Redis-lease в `rebuildAll()` (по образцу pm-scheduler), либо запретить ручной пересбор, пока идёт суточный. |
| 3 | важно | `src/workers/unified-worker/readiness-scheduler.ts:26` и `src/modules/readiness/application/scheduler.ts:135-155,177-193` | `passRunning` — только внутри процесса. В `runReadinessScheduler` audit-события пишутся в цикле по `expiring`/`stale` независимо от результата `updateMany` (тот под условием `state:'APPROVED'`). | Второй параллельный проход (реплика контейнера / перезапуск при медленном первом) выберет те же строки и запишет дубль `work-permit.expired`/`shift.auto-closed` с одинаковым `entityVersion` — риск нарушения цепочки native-chain audit и падения прохода. | Писать audit только когда `updateMany().count > 0`; либо обернуть проход в распределённый замок. |
| 4 | важно | `src/workers/unified-worker/outbox.ts:76-82`, `src/workers/unified-worker/projection.ts:54-60` | Пульс воркера пишется своим `setInterval` каждые 30 с и не зависит от того, завершился ли проход. `checkWorkers` (`src/core/observability/health-tracker/checkers/workers.ts:38`) считает воркер живым по свежести пульса (`WORKER_STALE_MS=90s`, `thresholds.ts:5`). | Зависший (никогда не возвращающийся) проход не виден: пульс идёт, `/api/health/deep` показывает running, а очередь растёт. Частично компенсируется lag-монитором, но не для суточных задач. | Писать пульс планировщика/воркера только после успешного `runOnce` (как в суточных планировщиках через `recordSchedulerHeartbeat`), либо сравнивать время последнего успешного прохода. |
| 5 | мелочь | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:35-52` | Единственный суточный планировщик без re-entrancy guard'а: `runOnce` не проверяет «прошлый проход ещё идёт». У `pm-scheduler`/`projection-rebuild`/`readiness` есть `passRunning`, у `pdf-cleanup` — `running`. | При интервале 24 ч наложение практически невозможно, и `cleanupExpiredKeys()` (deleteMany, `src/core/security/idempotency.ts:21-29`) идемпотентен. Планировщик выключен по умолчанию (`isIdempotencyCleanupEnabled()`, `scheduler-registry.ts:49`). Риск низкий. | Добавить `let running=false` guard для единообразия. |
| 6 | мелочь | `src/services/reports/outbox-publisher.ts:264-275` | `consumeOutboxEvents` вызывает handler ДО атомарной пометки строки (dispatch-then-mark). При обрыве процесса между отправкой и пометкой строка остаётся `published=false`. | Обработчик отправки отчёта в Telegram — неидемпотентен (комментарий прямо это фиксирует). Убийство процесса при остановке (#1) → следующий проход повторно отправит PDF. | Пометка/атомарный claim перед неидемпотентным побочным эффектом, либо дедуп отправки по `(eventId,target)`. |
| 7 | мелочь | `scripts/backup-postgres.sh:5`, `scripts/backup.sh:8-9` | Скрипты рассчитаны на cron (`cron.daily`/`crontab`), но файла-замка (`flock`) нет. Имена дампов уникальны по timestamp (`backup-postgres.sh:40-41`). | Два перекрывающихся запуска не затрут один файл, но удвоят `pg_dump` и нагрузку на БД. | Обернуть в `flock` (или `mkdir`-lock). |
| 8 | — (ПРОЙДЕНО) | `src/workers/unified-worker/pm-scheduler.ts:100` + `src/modules/equipment/application/commands/pm-scheduler.ts:105-107` | Двойная защита: `passRunning` в планировщике и `pg_advisory_xact_lock(hashtext('pm:tenant:equipment:type'))` внутри транзакции с проверкой открытого наряда. Дубли ТО не создаются даже при ручном запуске (`src/app/api/maintenance-plans/run/route.ts`). | Это эталон для остальных планировщиков. | — |
| 9 | — (ПРОЙДЕНО) | `src/core/infrastructure/leader-election.ts:158-218` | Redis-lease: TTL 30 с, продление 10 с, `RENEW_LEASE`/`RELEASE_LEASE` через Lua с проверкой nodeId; локальный дедлайн по `performance.now()` (`:162`). Outbox и projection берут лидерство (`embedded-workers.ts:131,234`), app- и workers-контейнеры сосуществуют без дублей. | Покрывает случай двух контейнеров, запускающих outbox/projection. | — |
| 10 | — (ПРОЙДЕНО) | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:9-32` | `running` promise + `AbortController`, отмена по `stop`, `await running`. Единственный планировщик, корректно дожидающийся прохода при остановке. | Делает чистку безопасной при SIGTERM. | Распространить приём на суточные планировщики (см. #1). |
| 11 | — (ПРОЙДЕНО) | `src/core/observability/lag-monitor.ts:429`, `src/core/observability/health-tracker/tracker.ts:97` | `setTimeout(tick, interval)` ставится В КОНЦЕ обработчика, а не через `setInterval` → следующий тик не стартует, пока не завершился предыдущий. Наложения нет by design. | Устойчиво к медленным проходам. | — |
| 12 | — (ПРОЙДЕНО) | `src/services/telemetry/telemetry-buffer.ts:124-128` | `flush()` возвращает существующий `this.flushPromise`, если флаш уже идёт (single-flight); `finally` сбрасывает флаг. | Периодический флаш и флаш по переполнению буфера не накладываются. | — |
| 13 | — (ПРОЙДЕНО) | `src/workers/unified-worker/pdf.ts:72-78` | BullMQ-воркер с `concurrency: PDF_CONCURRENCY`; BullMQ держит блокировку задачи, одна задача не выдаётся двум воркерам. | Параллелизм — намеренный, не наложение одной задачи. | — |
| 14 | мелочь | `src/lib/rate-limiter.ts:114`, `src/core/cache/response-cache.ts:119`, `src/core/observability/error-tracker.ts:134`, `src/core/error-boundary/bulkhead.ts:261` | Периодические in-memory таймеры чистки кэшей/записей. | Операции идемпотентны и дешёвы; наложение безвредно. Таймеры не `.unref()`-ятся (кроме telemetry), но это вопрос выхода процесса, а не наложения. | — |
| 15 | НЕ ПРОВЕРЕНО | `scripts/apply-full-ddl.sql:274-302` | Функция `create_telemetry_partition` создана, но расписания `cron.schedule(...)` в репозитории нет (в `docs/archive/DDL-FULL.md:61` только рекомендация). Есть ли pg_cron на боевой БД и расписание — из этого окружения не видно. | Если партиции создаются по cron — функция идемпотентна (`CREATE TABLE IF NOT EXISTS`), наложение безвредно. Не проверено, создаются ли они вообще. | — |

## Не проверено

1. **Живой прогон.** Всё сделано статическим чтением кода. Ни БД, ни Redis не поднимались, поэтому #2 и #3 (гонки на `deleteMany/createMany` и на audit-цепочке) — гипотезы, подтверждённые только чтением, а не воспроизведением.
2. **Число реплик контейнера `workers` и `app` в проде.** В `docker-compose.yml:155-209` и `docker-compose.prod.yml:42-56` ключа `replicas` нет (одна реплика по умолчанию), но фактический деплой/оркестратор не читался. Если реплик >1, вероятность наложений #2/#3/#4 растёт. Не проверено.
3. **Фактическое расписание pg_cron и бэкапов на сервере** (`scripts/apply-full-ddl.sql:274`, `scripts/backup-postgres.sh:5`, `docker-compose.yml:124-125` упоминает «хостовый таймер pilingtrack-backup»). В репозитории расписаний нет; есть ли они в проде — не проверено.
4. **Реальные значения env, влияющие на таймеры** (`PM_SCHEDULER_INTERVAL_MS`, `READINESS_SCHEDULER_INTERVAL_MS`, `IDEMPOTENCY_CLEANUP_ENABLED` и т.п.): файлы `.env*` не читались (запрещено). Значения взяты из значений по умолчанию в коде.
5. **`ENABLED_WORKERS=outbox,projection,pdf`** (`docker-compose.yml:178`) — по коду суточные планировщики включаются независимо от `ENABLED_WORKERS` (они гейтятся своими env, `src/workers/unified-worker.ts:174-207`), значит они работают в контейнере `workers`. Наличие второго процесса, где они тоже стартуют, не проверено (в app-контейнере через `instrumentation.ts:63` стартуют только embedded outbox/projection — это доказано кодом).
