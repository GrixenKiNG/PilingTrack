# W121 — Фоновые задачи по расписанию: опись и обработка ошибок

Дата: 2026-10-08. Ветка `hermes/q4-0926` (worktree). Только чтение: код не менялся,
создан один файл — этот отчёт. Планировщики операторских экранов и ORION (замороженные
зоны) не рассматривались.

## Итог

Плановых задач найдено **12** (плюс 5 внутрипроцессных таймеров сопровождения). Отдельной
cron-библиотеки (`node-cron`, `cron`) в проекте нет — расписание реализовано через
`setInterval`/`setTimeout`. В prod контейнер `workers` (`Dockerfile.workers`, CMD
`src/workers/unified-worker.ts`) поднимает три воркера (outbox, projection, pdf) и четыре
планировщика (PM, техготовность, пересборка витрин, уборка PDF); ещё два планировщика
(уборка ключей идемпотентности, уборка временных PDF) выключены по умолчанию. Приложение
дополнительно поднимает встроенные outbox/projection (с выбором лидера) и health-tracker.

Обработка ошибок есть у **всех** падающих задач: каждый планировщик/воркер оборачивает
проход в `try/catch` с `logger.error` и (в unified-worker) `Sentry.captureException`.
Пульс от планировщиков пишется (`recordSchedulerHeartbeat`), но не всеми.

Найдено **14** нахождений: **1 критично**, **6 важно**, **7 мелочь**.

Топ-5:
1. Остановка планировщика контейнера `workers` почти невидима: healthcheck контейнера
   смотрит только на outbox/projection/pdf, `/api/health` при `degraded` (в т.ч.
   остановившийся планировщик) отдаёт **200**, а TTL пульса суточных планировщиков — 72 ч.
2. `forEachTenant` не изолирует ошибку по организации: исключение на одном тенанте
   обрывает весь проход, остальные тенанты в этот день не обслуживаются.
3. Планировщики PM/техготовность/пересборка запускаются без выбора лидера — при двух
   репликах `workers` прогон идёт параллельно у всех (идемпотентно, но дублирование нагрузки).
4. Ежечасный пересчёт недельного тренда идёт без `running`-гварда и без проверки лидерства.
5. Уборка временных PDF выключена по умолчанию и не включена в compose; при включении
   не пишет пульс и не входит в реестр планировщиков — невидима health'у.

## Методика

Поиск: `setInterval`, `setTimeout`, `node-cron`, `cron`, `schedule(` по `src/`, `scripts/`,
`src/core/`, `src/services/`; команды контейнеров — `docker-compose.yml`,
`docker-compose.prod.yml`, `Dockerfile.workers`; точки входа — `package.json`
(`worker:*`), `src/instrumentation.ts`. Планировщики и воркеры прочитаны целиком; для
каждой задачи заполнены поля: файл:строка · периодичность · что делает · обработка ошибок ·
блокировка от повторного запуска. Проверено также наличие CI/cron (`schedule:`/`cron:` в
yml/yaml/json) — не найдено; `vercel.json` отсутствует.

Ключевые источники (все открыты): `src/workers/unified-worker.ts`,
`src/workers/unified-worker/{pm,readiness,projection-rebuild,idempotency-cleanup,pdf-cleanup}-scheduler.ts`,
`src/workers/unified-worker/scheduler-heartbeat.ts`, `.../{outbox,projection,pdf,state,config,health-server,sentry}.ts`,
`src/workers/{embedded-workers,outbox-worker,projection-worker,pdf-worker}.ts`,
`src/modules/reports/application/projections/projection-worker.ts`,
`src/modules/reports/application/projections/rebuild.ts`,
`src/modules/equipment/application/commands/pm-scheduler.ts`,
`src/modules/readiness/application/scheduler.ts`,
`src/services/reports/outbox-publisher.ts`, `src/lib/pdf-queue.ts`,
`src/core/outbox/dead-letter-queue.ts`, `src/core/infrastructure/leader-election.ts`,
`src/lib/tenant-iteration.ts`,
`src/core/observability/health-tracker/{tracker,aggregate}.ts` + `checkers/{workers,schedulers}.ts`,
`src/core/observability/{lag-monitor,error-tracker}.ts`,
`src/services/telemetry/telemetry-buffer.ts`,
`src/core/{cache/response-cache,error-boundary/bulkhead}.ts`, `src/lib/rate-limiter.ts`,
`src/instrumentation.ts`, `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile.workers`,
`package.json`.

## Опись задач

| # | задача | path:line | периодичность | что делает | обработка ошибок | блокировка от повтора |
|---|--------|-----------|---------------|------------|------------------|------------------------|
| 1 | outbox-воркер (unified) | `src/workers/unified-worker/outbox.ts:49`, интервал `.../config.ts:7` | 10 с (`OUTBOX_INTERVAL_MS`) | читает `OutboxEvent`, публикует события через `emitDomainEvent` | да: `startOutboxWorker` processOnce `try/catch` → `logger.error` (`outbox-publisher.ts:277-289`); ручной heartbeat 30 с (`outbox.ts:76-82`) | лидер-выборы (`leader-election.ts`) + `running`-гвард (`outbox-publisher.ts:276-290`) |
| 2 | projection-воркер (unified) | `src/workers/unified-worker/projection.ts:30` | 5 с (`PROJECTION_INTERVAL_MS`) | проекции витрин по событиям (`projectOutboxEvents`) | да: `try/catch` (`projection-worker.ts:156-168`) + `Sentry` в pdf | лидер-выборы + `running`-гвард |
| 3 | PDF-воркер (BullMQ) | `src/workers/unified-worker/pdf.ts:28` | по событиям очереди (не расписание) | генерация PDF, `concurrency=2` | да: `failed`→`logger.error`+`Sentry`, `error`→`setError` (`pdf.ts:96-115`) | очередь BullMQ (распределение задач), без лидера |
| 4 | планировщик ТО (PM) | `src/workers/unified-worker/pm-scheduler.ts:99-100` | старт +60 с, далее каждые 24 ч (`PM_SCHEDULER_INTERVAL_MS`) | наряды PLANNED по регламентам, уведомление о просрочке ТО | да: `runOnce` `try/catch`+`Sentry` (`:86-93`); алерт `notifyOverdue` отдельно (`:58-64`) | `passRunning` (`:67-71`) + advisory-lock в `pm-scheduler.ts:104-105`; лидер-выборов НЕТ |
| 5 | планировщик техготовности | `src/workers/unified-worker/readiness-scheduler.ts:58-59` | старт +90 с, далее каждый час (`READINESS_SCHEDULER_INTERVAL_MS`) | истечение нарядов-допусков, автозакрытие смен, дозаказ пересчёта готовности | да: `try/catch`+`Sentry` (`:45-52`) | `passRunning` (`:24-28`); идемпотентно по построению; лидера НЕТ |
| 6 | пересборка витрин | `src/workers/unified-worker/projection-rebuild-scheduler.ts:48-49` | старт +90 с, далее каждые 24 ч (`PROJECTION_REBUILD_INTERVAL_MS`) | полный `rebuildAll()` (аналитика, daily, weekly) | да: `try/catch`+`Sentry` (`:35-42`) | `passRunning` (`:25-29`); лидера НЕТ |
| 7 | уборка ключей идемпотентности | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:51-52` | старт +120 с, далее 24 ч | `cleanupExpiredKeys()` | да: `try/catch`+`Sentry` (`:36-45`) | нет `passRunning`; идемпотентно; **включён только при `IDEMPOTENCY_CLEANUP_ENABLED='true'`** (`scheduler-registry.ts:48-50`) — по умолчанию выключен |
| 8 | уборка временных PDF | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:19-20` | старт +60 с, далее 24 ч | `cleanupTemporaryPdfs()` (первый прогон dry-run) | да: `.catch()` → `logger.error` (не в Sentry) (`:14-17`) | `running`+`stopping` (`:10-11`); **включён только при `PDF_TEMP_CLEANUP_ENABLED='true'`** (`:6`) — выключен |
| 9 | встроенный outbox (в процессе app) | `src/workers/embedded-workers.ts:142` | 2 с | дублирует #1 в процессе Next.js, лидер-выборы исключают двойную работу | да: использует тот же `startOutboxWorker` | лидер-выборы + `running`-гвард |
| 10 | встроенный projection (в процессе app) | `src/workers/embedded-workers.ts:245` | 1 с | дублирует #2 в процессе Next.js | да | лидер-выборы + `running`-гвард |
| 11 | ежечасный пересчёт недельного тренда | `src/modules/reports/application/projections/projection-worker.ts:179-190` | 3600000 мс (1 ч, жёстко) | `projectWeeklyTrend` по всем объектам всех организаций | да: `try/catch`+`logger.error` | НЕТ ни `running`-гварда, ни проверки лидерства |
| 12 | health-tracker (в процессе app) | `src/core/observability/health-tracker/tracker.ts:97` | `POLL_INTERVAL_MS` (самопланирование) | опрос всех подсистем, снапшот здоровья | да: `try/catch` (`:56-95`) | нет; запускается в каждом процессе |
| 13 | lag-monitor | `src/core/observability/lag-monitor.ts:429` | 10 с (`pollIntervalMs`) | метрики лага outbox/проекций, алерты | да: `try/catch` (`:410-427`) | нет; стартует внутри health-tracker |
| 14 | буфер телеметрии | `src/services/telemetry/telemetry-buffer.ts:79` | 5 с (`flushIntervalMs`) | пакетная запись телеметрии в БД | да: `.catch()` (`:80-82`), ошибка flush → запись в лог, записи возвращаются в буфер (`:154-160`) | `flushPromise` (коалесцирование) |
| 15 | уборка `ErrorTracker` | `src/core/observability/error-tracker.ts:134` | 60 с | очистка старых записей в памяти | нет try/catch | нет |
| 16 | evict кэша ответов | `src/core/cache/response-cache.ts:119` | 30 с | LRU-вытеснение | нет try/catch | нет |
| 17 | статистика bulkhead | `src/core/error-boundary/bulkhead.ts:261` | 30 с | лог активных доменах | нет try/catch | нет |
| 18 | уборка in-memory rate-limiter | `src/lib/rate-limiter.ts:114` | 5 мин | очистка просроченных записей | нет try/catch | нет |

## Находки

# | severity | path:line | проблема | сценарий / почему важно | предложение
- | --- | --- | --- | --- | ---

1 | критично | `Dockerfile.workers:93-94` + `src/workers/unified-worker/health-server.ts:11-16` + `src/core/observability/health-tracker/aggregate.ts:40` + `src/core/observability/health-tracker/scheduler-heartbeat.ts:40` | Остановка планировщиков (PM, техготовность, пересборка) почти не видна: контейнерный healthcheck `/health` считает только `workerStates` (outbox/projection/pdf) и не знает про планировщики; `/api/health` при `degraded` (куда входят `schedulers.stale`) отдаёт **200** (`aggregate.ts:40`, тест `src/app/api/health/__tests__/route.test.ts:64-68`); TTL пульса = 3×интервала, у суточных — 72 ч | Контейнер `workers` жив, outbox/projection/pdf пишут пульс, а планировщик тихо встал (ошибка БД, вызов не стартовал). Docker не перезапускает контейнер, HTTP-код зелёный; суточная рутина (автозакрытие смен, истечение допусков, план ТО) не идёт до 3 суток, алерт — только если внешний монитор читает JSON-тело | Добавить планировщики в healthcheck контейнера и/или в `workerStates`; отдавать non-2xx при `schedulers.stale`; для суточных задач — отдельный признак «время последнего успешного прогона» вместо грубого TTL
2 | важно | `src/lib/tenant-iteration.ts:30-36` (использование: `pm-scheduler.ts:78`, `readiness-scheduler.ts:34`, `projection-worker.ts:181`, `rebuild.ts:33`) | `forEachTenant` не изолирует ошибку по организации: цикл `for...await run(id)` без per-tenant `try/catch` | Падение на одном тенанте (битые данные, ошибка БД) выбрасывает исключение из `forEachTenant`, и остальные организации в этом проходе не обслуживаются. Пульс (`recordSchedulerHeartbeat` идёт после цикла, напр. `readiness-scheduler.ts:44`) не пишется → health уходит в `stale` позже TTL | Обернуть `run(id)` в `try/catch` с `logger.error({tenantId})` и продолжать цикл
3 | важно | `src/workers/unified-worker.ts:173-189` | PM, техготовность и пересборка витрин запускаются без выбора лидера; комментарий «no leader election needed» (`:173`) | При >1 реплике `workers` каждый планировщик идёт параллельно у всех реплик: PM защищён advisory-локом (`pm-scheduler.ts:104-105`), техготовность идемпотентна, но `rebuildAll()` — тяжёлый полный пересчёт витрин, и он выполняется на каждой реплике одновременно | Ввести leader election для этих планировщиков либо явно зафиксировать «ровно одна реплика workers» и проверять это в деплое
4 | важно | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:5-6,14-17` + `docker-compose.yml:164-206` | Уборка временных PDF выключена по умолчанию (`PDF_TEMP_CLEANUP_ENABLED !== 'true'` → no-op) и переменная не задана в compose; при включении не пишет пульс и не входит в `SCHEDULER_NAMES` | Если S3 не настроен, PDF кладутся в локальный `storage/` (`Dockerfile.workers:79-82`); каталог растёт, очистки нет. При включении уборки её остановка невидима health'у (нет пульса/реестра) | Включить переменную в compose для сервиса `workers`; добавить имя планировщика в реестр и запись пульса
5 | важно | `src/modules/reports/application/projections/projection-worker.ts:179-190` | Ежечасный `weeklyInterval` без `running`-гварда (в отличие от `processOnce` `:156-169`) и без проверки `isLeader()` | Полный пересчёт `projectWeeklyTrend` по всем объектам каждой организации тяжёл; на медленной БД проходы накладываются, при смене лидера возможен двойной прогон → лишняя нагрузка | Добавить `running`-гвард и проверку лидерства, как у `processOnce`
6 | важно | `src/workers/unified-worker/pdf.ts:96-106` + `src/lib/pdf-queue.ts:29,90-98,212-218` | Постоянно падающая PDF-задача (после `attempts:2`) только логируется в Sentry/лог; оператору видна обобщённая «Не удалось сформировать PDF» (`pdf-queue.ts:216`), отдельного алерта/DLQ для очереди нет | PDF-задача сгорает после 1 ретрая, перманентный сбой виден лишь тому, кто читает Sentry; владелец узнаёт о проблеме только при попытке скачать отчёт | Алерт на накопление failed-задач (как для outbox) либо DLQ для PDF
7 | важно | `src/workers/unified-worker.ts:60-136` | Graceful shutdown очищает таймеры (`stop()`), но НЕ дожидается текущего прохода планировщика/воркера; через `SHUTDOWN_TIMEOUT_MS` (8 с) процесс завершается | Деплой/перезапуск во время суточного прогона: часть работы может не завершиться (запись обрывается на SIGKILL). Операции идемпотентны, поэтому потери данных нет, но отчёт о проходе и часть работы теряются | Ждать завершения выполняющегося прохода перед выходом (grace period)
8 | мелочь | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:35-46` | `runOnce` без `passRunning`-гварда, в отличие от соседних планировщиков (`pm-scheduler.ts:67`, `readiness-scheduler.ts:24`) | При долгом `DELETE` интервальный прогон может наложиться на стартующий. Сейчас задача выключена (opt-in), риск латентный | Добавить `passRunning`
9 | мелочь | `src/services/reports/outbox-publisher.ts:296-299` | `startOutboxWorker` регистрирует `process.on('SIGTERM'/'SIGINT')` на каждый вызов; вызывается и из embedded, и из unified | Повторная регистрация слушателей при нескольких запусках (один процесс) → предупреждения MaxListeners; `clearInterval` идемпотентен, вреда мало | Гвард регистрации обработчиков
10 | мелочь | `src/workers/unified-worker.ts:174-205` | PM/техготовность/пересборка включаются по умолчанию (`!== 'false'`), но переменные не заданы в `docker-compose.yml:164-206` → нет явного контроля и аудита состава планировщиков в деплое | Невозможно точечно выключить планировщик без правки окружения контейнера; состав «что реально идёт» не читается из compose | Прописать переменные явно в compose
11 | мелочь | `src/workers/outbox-worker.ts:32`, `src/workers/projection-worker.ts:23`, `src/workers/pdf-worker.ts:158` + `package.json:48-50` | Отдельные точки входа (`worker:outbox`, `worker:projection`, `worker:pdf`) не используются в prod (compose запускает только `unified-worker`) | Если кто-то запустит их рядом с `unified-worker`, воркеры задвоятся (лидер-выборы защищают только outbox/projection) | Отметить как локальные/альтернативные точки входа
12 | мелочь | `src/core/observability/error-tracker.ts:134`, `src/core/cache/response-cache.ts:119`, `src/core/error-boundary/bulkhead.ts:261`, `src/lib/rate-limiter.ts:114` | Внутрипроцессные таймеры сопровождения вызываются без `try/catch`; исключение внутри коллбэка `setInterval` уходит в `uncaughtException` | Синхронные операции (фильтрация Map, логирование) почти не бросают, но при исключении процесс app может упасть без явной диагностики | Оборачивать коллбэки в `try/catch`
13 | мелочь | `src/modules/reports/application/projections/projection-worker.ts:192-203` | `startProjectionWorker` регистрирует `process.on('SIGTERM'/'SIGINT')` при каждом старте (в т.ч. при переизбрании лидера) без гварда | При переизбрании лидера слушатели накапливаются | Гвард регистрации
14 | мелочь | `src/core/observability/health-tracker/scheduler-heartbeat.ts:35-48` | Пульс — это единственный след планировщика; отдельной метрики «время последнего успешного прогона» нет, а TTL пульса = 3 интервала | Для суточных задач TTL=72 ч делает остановку грубо различимой (см. #1); нельзя быстро ответить «когда прошёл последний прогон» | Публиковать метрику времени последнего прохода

## Задачи без обработки ошибок

Планировщики и воркеры в `src/workers/**` — **все** с обработкой ошибок (`try/catch` + `logger`,
часть + `Sentry`). Без `try/catch` остаются только внутрипроцессные таймеры сопровождения:
`src/core/observability/error-tracker.ts:134`, `src/core/cache/response-cache.ts:119`,
`src/core/error-boundary/bulkhead.ts:261`, `src/lib/rate-limiter.ts:114` (см. нахождение #12).
Задачи без блокировки от повторного запуска: PM/техготовность/пересборка (нет leader election,
#3), ежечасный пересчёт тренда (#5), уборка ключей идемпотентности (#8).

## Не проверено

- Реальный состав и число реплик контейнера `workers` в проде (сколько процессов гоняют
  планировщики одновременно) — из окружения не проверяется; выводы #1/#3 даны «при одной /
  при нескольких репликах».
- Фактическое значение `POLL_INTERVAL_MS` (health-tracker) и `WORKER_STALE_MS` — константы
  прочитаны как ссылки (`health-tracker/thresholds.ts` не открывался построчно).
- Действительно ли системный cron на хосте (вне репозитория) вызывает что-либо дополнительно —
  в репозитории расписаний CI/cron нет, но хост-планировщик недоступен из этого окружения.
- Поведение `cleanupExpiredKeys()` и `cleanupTemporaryPdfs()` внутри (условия удаления,
  dry-run) — открыты по вызову, не построчно; вывод об их периодичности сделан по файлам
  планировщиков.
- Влияние остановки планировщиков на здоровье выражается как `degraded`; как внешний
  мониторинг реагирует на `degraded` в теле `/api/health` — вне кода, не проверено.
