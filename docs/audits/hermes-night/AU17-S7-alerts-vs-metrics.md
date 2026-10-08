# AU17-S7 — Алерты против реально отдаваемых метрик

Версия: `git rev-parse HEAD` = `b66ecbd1dfddaf159425ccc6b63c61794bff04d6` (ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`).
Дата аудита (UTC): 2026-10-08T23:00:49Z. Только чтение; ни один существующий файл не изменён.

## Итог

Активных правил в `observability/prometheus/alerts.yml` — 31, закомментированных — 4 (числа из `grep`, см. Методику).
Все 31 активных правила ссылаются на метрику, у которой есть источник: либо рукописный экспорт приложения (`src/app/api/metrics/route.ts` + `src/core/observability/**`), либо endpoint воркеров (`src/workers/unified-worker/health-server.ts`), либо метрики внешних экспортёров/самого Prometheus. Полностью «мёртвых» активных правил (метрики нет нигде) не найдено — метрики без источника есть только в 4 закомментированных правилах.
Главная проблема — не отсутствие имени метрики, а условная отдача: пять бизнес-алертов (outbox/projection/dlq) и четыре backup-алерта берут значения из in-memory снимка фонового трекера (`src/app/api/metrics/route.ts:100,107-137`). Если трекер не стартовал, эти метрики в ответе отсутствуют, и алерты молчат; страхует только `LagSnapshotStale` (alerts.yml:226) и `HealthSnapshotStale` (alerts.yml:300).
По серьёзности: критично — 0; важно — 4; мелочь — 6; отдельным списком — 4 метрики без источника (все в закомментированных правилах). Все внешние экспортёры (postgres/redis/node/alertmanager) в этом окружении не запускались — статус НЕ ПРОВЕРЕНО.
Самое важное: `route.ts:118` и `route.ts:100` — бизнес- и backup-метрики отдаются только при живом health-снимке, поэтому набор алертов «деградация очереди/бэкапа» может замолчать ровно тогда, когда фоновый трекер сломался.

## Методика

Прочитаны целиком (read_file): `observability/prometheus/alerts.yml` (417 строк), `observability/prometheus/prometheus.yml` (87), `observability/prometheus/prometheus-prod.yml` (92), `docker-compose.yml` (фрагмент 60–209), `docker-compose.prod.yml` (150), `docker-compose.monitoring-prod.yml` (183), `src/app/api/metrics/route.ts` (159), `src/core/observability/http-metrics.ts` (91), `src/core/observability/audit-feedback-metrics.ts` (24), `src/core/observability/lag-monitor.ts` (455), `src/core/observability/event-loop-lag.ts` (48), `src/core/observability/health-tracker/tracker.ts` (131), `.../index.ts` (47), `.../aggregate.ts` (136), `.../thresholds.ts` (14), `.../checkers/backup.ts` (139), `.../checkers/workers.ts` (63), `src/workers/unified-worker/health-server.ts` (67), `.../config.ts` (15), `.../state.ts` (75), `src/workers/embedded-workers.ts` (326), `src/instrumentation.ts` (75), `src/core/api-wrapper.ts` (223), `src/lib/cache-metrics.ts` (143).

Поиски (search_files) по всему репозиторию: имена каждой метрики из `expr` — `http_requests_total|http_request_duration_seconds_bucket|process_heap_(used_)?bytes|nodejs_eventloop_lag_seconds|outbox_(lag_seconds|pending_count)|projection_lag_seconds|lag_snapshot_timestamp_seconds|dlq_pending_count|audit_feedback_write_failures_total|health_(status|snapshot_age_seconds)|backup_(age_hours|last_success_available|monitoring_enabled|s3_synced)|worker_(status|enabled)|pg_stat_activity_count|pg_stat_database_deadlocks|redis_memory_(used|max)_bytes|node_filesystem_(avail|size)_bytes|alertmanager_notifications_failed_total`; и «мёртвых» имён `reports_created_total|sync_errors_total|sync_updates_total|nodejs_gc_duration|pg_stat_statements_mean_time`; а также точки старта `startLagMonitor|startHealthTracker|startHealthServer|recordHttpRequest|recordAuditFeedbackFailure`.

Команды с числами:

```
grep -cE '^\s*- alert:' observability/prometheus/alerts.yml        # 31
grep -cE '^\s*#\s*- alert:' observability/prometheus/alerts.yml    # 4
git rev-parse HEAD                                                  # b66ecbd1dfddaf159425ccc6b63c61794bff04d6
```

Файлы под `docs/audits/` (кроме этого отчёта) и `docs/strategy` не открывались — независимость первого прохода. Строки, случайно попавшие в вывод широкого `grep` по `docs/audits/**`, в отчёт не брались.

## Таблица: активные правила → метрика → источник

| № | Правило (alerts.yml:строка) | Метрика в expr | Источник (file:line) | Если метрики нет | Серьёзность/статус |
|---|---|---|---|---|---|
| 1 | HighAPILatencyP95 :12 | `http_request_duration_seconds_bucket` | `src/core/observability/http-metrics.ts:82` (экспорт), запись `src/core/api-wrapper.ts:144`, отдача `src/app/api/metrics/route.ts:145` | серия появляется только после первого запроса; нет данных — алерт молчит (не ложно) | мелочь / ПРОЙДЕНО |
| 2 | CriticalAPILatencyP95 :23 | `http_request_duration_seconds_bucket` | то же | то же | мелочь / ПРОЙДЕНО |
| 3 | HighAPIErrorRate :34 | `http_requests_total` | `http-metrics.ts:73`, запись `api-wrapper.ts:144`, отдача `route.ts:145` | молчит при отсутствии серий | ПРОЙДЕНО |
| 4 | APIEndpointDown :45 | `up{job="pilingtrack-app"}` | сам Prometheus | алерт и есть индикатор недоступности | ПРОЙДЕНО (дубль с TargetDown) |
| 5 | PostgresHighConnectionCount :62 | `pg_stat_activity_count` | в репо НЕТ; `postgres-exporter` (`docker-compose.monitoring-prod.yml:101-116`) | при недоступности exporter — молчит | НЕ ПРОВЕРЕНО |
| 6 | PostgresConnectionPoolExhausted :73 | `pg_stat_activity_count` | там же | там же | НЕ ПРОВЕРЕНО |
| 7 | PostgresDeadlocks :98 | `pg_stat_database_deadlocks` | в репо НЕТ; `postgres-exporter` | молчит | НЕ ПРОВЕРЕНО |
| 8 | HighMemoryUsage :113 | `process_heap_used_bytes / process_heap_bytes` | `route.ts:74` и `route.ts:78` | нет серии → молчит | мелочь / ПРОЙДЕНО |
| 9 | EventLoopLagHigh :124 | `nodejs_eventloop_lag_seconds` | `route.ts:82` (значение из `event-loop-lag.ts:35`) | молчит | ПРОЙДЕНО |
| 10 | OutboxBacklog :172 | `outbox_pending_count` | `lag-monitor.ts:350` → `route.ts:100` | нет свежего lag-снимка → серии нет → молчит (прикрыт LagSnapshotStale) | важно / ПРОЙДЕНО |
| 11 | OutboxLagHigh :185 | `outbox_lag_seconds` | `lag-monitor.ts:346` → `route.ts:100` | молчит | важно / ПРОЙДЕНО |
| 12 | OutboxLagWarn :195 | `outbox_lag_seconds` | то же | молчит | важно / ПРОЙДЕНО |
| 13 | ProjectionLagHigh :205 | `projection_lag_seconds` | `lag-monitor.ts:358` → `route.ts:100` | молчит | важно / ПРОЙДЕНО |
| 14 | ProjectionLagWarn :215 | `projection_lag_seconds` | то же | молчит | важно / ПРОЙДЕНО |
| 15 | LagSnapshotStale :226 | `lag_snapshot_timestamp_seconds` | `lag-monitor.ts:339` → `route.ts:100` | это и есть сторож отсутствия метрик (значение 0) | ПРОЙДЕНО |
| 16 | AuditFeedbackWriteFailures :237 | `audit_feedback_write_failures_total` | app: `audit-feedback-metrics.ts:18` → `route.ts:150`; workers: `health-server.ts:54` | молчит | ПРОЙДЕНО |
| 17 | DeadLetterQueueNotEmpty :246 | `dlq_pending_count` | `lag-monitor.ts:366` → `route.ts:100` | молчит (прикрыт LagSnapshotStale) | важно / ПРОЙДЕНО |
| 18 | TargetDown :264 | `up` | сам Prometheus | индикатор недоступности | ПРОЙДЕНО |
| 19 | WorkersDown :276 | `up{job="pilingtrack-workers"}` | Prometheus + job `prometheus-prod.yml:43` | индикатор | ПРОЙДЕНО (дубль с TargetDown) |
| 20 | WorkerNotRunning :288 | `worker_status`, `worker_enabled` | `src/workers/unified-worker/health-server.ts:46-47` | если воркера нет в `workerStates` — серии нет → молчит | ПРОЙДЕНО |
| 21 | HealthSnapshotStale :300 | `health_snapshot_age_seconds` | `route.ts:117` | sentinel -1 ловится веткой `<0`; ветка `==0` недостижима | мелочь / ПРОЙДЕНО |
| 22 | HealthDegraded :311 | `health_status` | `route.ts:114` | при отсутствии снимка = -1, `>0` не сработает → молчит | ПРОЙДЕНО |
| 23 | AlertmanagerDown :323 | `up{job="alertmanager"}` | Prometheus (`prometheus-prod.yml:86`) | индикатор | ПРОЙДЕНО |
| 24 | AlertmanagerNotificationsFailing :335 | `alertmanager_notifications_failed_total` | Alertmanager (`monitoring-prod.yml:118-149`) | молчит при отсутствии скрейпа | НЕ ПРОВЕРЕНО |
| 25 | RedisHighMemory :345 | `redis_memory_used_bytes / redis_memory_max_bytes` | `redis-exporter` (`monitoring-prod.yml:151-172`) | при NOAUTH (нет `REDIS_PASSWORD`) серий нет → молчит | НЕ ПРОВЕРЕНО |
| 26 | HostDiskSpaceLow :355 | `node_filesystem_avail_bytes/_size_bytes` | `node-exporter` (`monitoring-prod.yml:83-99`) | молчит | НЕ ПРОВЕРЕНО |
| 27 | HostDiskSpaceCritical :365 | `node_filesystem_avail_bytes` | `node-exporter` | молчит | НЕ ПРОВЕРЕНО |
| 28 | BackupMissing :375 | `backup_last_success_available`, `backup_monitoring_enabled` | `route.ts:127`, `route.ts:124` | серий нет при отсутствии health-снимка → молчит; при `BACKUP_ENABLED` пусто = 0 → не сработает никогда | важно / ПРОЙДЕНО |
| 29 | BackupStale :386 | `backup_age_hours`, `backup_monitoring_enabled` | `route.ts:132`, `route.ts:124` | то же | важно / ПРОЙДЕНО |
| 30 | BackupCritical :397 | `backup_age_hours`, `backup_monitoring_enabled` | `route.ts:132`, `route.ts:124` | то же | важно / ПРОЙДЕНО |
| 31 | OffsiteBackupNotSynced :409 | `backup_s3_synced`, `backup_monitoring_enabled`, `backup_last_success_available` | `route.ts:136`, `route.ts:124`, `route.ts:127` | то же | важно / ПРОЙДЕНО |

Job-метки, использованные в правилах, все объявлены в проде: `pilingtrack-app` (:28), `pilingtrack-workers` (:43), `node` (:51), `postgresql` (:59), `redis` (:67), `alertmanager` (:86) — `observability/prometheus/prometheus-prod.yml`.

## Метрики в правилах без источника (отдельный список)

Все четыре — в закомментированных (отключённых) блоках, поэтому сейчас не срабатывают ни при каких условиях:

| Метрика | Где упомянута | Что не так |
|---|---|---|
| `reports_created_total` | `alerts.yml:151` (комментарий `NoReportsCreated`) | в `src/` счётчика нет; совпадение только `performance/k6/report.test.js:19` (k6-метрика, не приложение) |
| `sync_errors_total`, `sync_updates_total` | `alerts.yml:162` (комментарий `HighSyncFailureRate`) | в `src/` нет ни одной |
| `nodejs_gc_duration_seconds_sum` | `alerts.yml:135` (комментарий `HighGarbageCollectionTime`) | приложение рукописно отдаёт метрики без GC-метрики; в `src/` совпадений нет |
| `pg_stat_statements_mean_time_seconds` | `alerts.yml:88` (комментарий `PostgresSlowQueries`) | нет ни в приложении, ни во включённых коллекторах `postgres-exporter` (`monitoring-prod.yml:101-116` без `--collector.stat_statements`) |

Правило `LagSnapshotStale` (`alerts.yml:226`) и `HealthSnapshotStale` (`alerts.yml:300`) — наоборот, метрики-сторожа: они специально срабатывают при отсутствии/нуле свежих данных.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что делать |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/metrics/route.ts:100` + `src/core/observability/lag-monitor.ts:438-440,342` + `src/instrumentation.ts:69-74` | Метрики `outbox_lag_seconds`, `projection_lag_seconds`, `outbox_pending_count`, `dlq_pending_count` берутся из in-memory снимка (`getLagMetrics()`), который наполняет только фоновый lag-монитор (`lag-monitor.ts:396`), запускаемый из health-трекера (`health-tracker/tracker.ts:41`). Запуск обёрнут в `try/catch` с `logger.warn` (`instrumentation.ts:72`). Если трекер не стартовал, `getLagMetrics()` возвращает `null`, и `route.ts:100` отдаёт лишь `lag_snapshot_timestamp_seconds 0` (`lag-monitor.ts:342`). | Регрессия при старте приложения: очередь outbox растёт или проекция отстаёт, но 5 бизнес-алертов (№10–14, 17) молчат. Единственный сигнал — `LagSnapshotStale`. | Добавить внешний сторож по самой метрике `lag_snapshot_timestamp_seconds` (уже есть) и/или отдавать lag-метрики из отдельного процесса/воркера, пишущего в постоянное состояние. |
| 2 | важно | `src/app/api/metrics/route.ts:118` | Блок `backup_*` отдаётся только при `if (status?.components.backup)`. При пустом `sharedHealth` (трекер ещё не делал снимок или упал) backup-серий в ответе нет. | `BackupMissing/Stale/Critical/OffsiteBackupNotSynced` (№28–31) молчат, когда фоновый трекер не работает; страхует только `HealthSnapshotStale`. | Отдавать `backup_monitoring_enabled`/`backup_last_success_available` и при отсутствии снимка (значением «недоступно») либо явно сигналить об отсутствии источника. |
| 3 | важно | `src/core/observability/health-tracker/checkers/backup.ts:17-21` + `route.ts:124` + `docker-compose.yml:129` | `backup_monitoring_enabled=0`, когда `BACKUP_ENABLED` не задан (в compose дефолт пустой). Тогда `BackupMissing/Stale/Critical/OffsiteBackupNotSynced` не сработают никогда. | Развёртывание без `BACKUP_ENABLED` — бэкапы «не наблюдаются», но и тревоги нет. | Сделать `BACKUP_ENABLED` обязательным в проде (валидатор `scripts/validate-env.ts:140` уже предупреждает) либо завести отдельный алерт «мониторинг бэкапов выключен». |
| 4 | важно | `observability/prometheus/alerts.yml:172` vs `src/core/observability/lag-monitor.ts:85` vs `src/core/observability/health-tracker/thresholds.ts:3` | Один факт «очередь outbox велика» описан тремя числами: алерт `>1000`, `pendingCriticalThreshold=5000` в lag-мониторе, `OUTBOX_BACKLOG_THRESHOLD=1000` в health-трекере. | Порог алерта (1000) не совпадает с понятием «critical» кода (5000) — при разборе неясно, какое число истинное. | Свести к одной константе/документу либо явно развести смысл (warn vs critical). |
| 5 | мелочь | `observability/prometheus/alerts.yml:300` | В `HealthSnapshotStale` ветка `... or health_snapshot_age_seconds == 0` недостижима: «отсутствие снимка» кодируется значением `-1` (`route.ts:109`) и ловится веткой `< 0`. | Мёртвое условие (скопировано из `LagSnapshotStale`), создаёт ложное впечатление, что 0 = отсутствие. | Убрать `== 0` либо привести sentinel к 0. |
| 6 | мелочь | `observability/prometheus/alerts.yml:12,23` | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{...}[5m]))` без агрегации по `le`: квантilь считается по каждой комбинации `(method,route,status)`, а не по API в целом; 2xx и 5xx одного маршрута — отдельные гистограммы. | Один медленный маршрут даёт тревогу «API p95», хотя общий p95 может быть в норме; метрика названа «API»‑широкой, но таковой не является. | Использовать `sum by (le) (rate(...))` для общей p95 или явно `by (route, le)`. |
| 7 | мелочь | `observability/prometheus/alerts.yml:45,276` vs `:264` | Дубли: `TargetDown` (`up{job!="alertmanager"} == 0`, :264) уже срабатывает для `pilingtrack-app` и `pilingtrack-workers`, поэтому `APIEndpointDown` (:45) и `WorkersDown` (:276) дублируют ту же аварию. | Две тревоги об одном падении. | Оставить один слой (либо TargetDown как общий, либо точечные). |
| 8 | мелочь | `observability/prometheus/prometheus.yml:61-66` | Job `nodejs-processes` скрейпит `app:3000` по умолчанию на `/metrics` (приложение отдаёт `/api/metrics`) → 404/`up=0`; при этом `HighMemoryUsage` (:113) и `EventLoopLagHigh` (:124) без job-селектора. | В dev/observability-стеке (`docker-compose.observability.yml:28` монтирует `prometheus.yml`) тот же процесс app скрейпится двумя job'ами, и один из них всегда «down». | Убрать job `nodejs-processes` или указать ему `metrics_path: /api/metrics`; в прод-конфиге этого job нет. |
| 9 | мелочь | `src/app/api/metrics/route.ts:88-90` | `process_uptime_seconds` объявлен как `# TYPE ... counter`, хотя это gauge (неубывающая величина). | Косметика/корректность экспозиции. | Сменить тип на `gauge`. |
| 10 | мелочь | `observability/prometheus/alerts.yml:113` | `process_heap_used_bytes / process_heap_bytes > 0.9`: `process_heap_bytes` — это `heapTotal`, который V8 меняет динамически; отношение может быть волатильным. | Возможен шум предупреждений (гипотеза, в рантайме не проверялось). | Проверить в проде, при необходимости поднять порог/добавить `for`. |

## Не проверено

- Метрики внешних экспортёров (`pg_stat_activity_count`, `pg_stat_database_deadlocks`, `redis_memory_used_bytes`, `redis_memory_max_bytes`, `node_filesystem_avail_bytes`, `node_filesystem_size_bytes`, `alertmanager_notifications_failed_total`) — ни Prometheus, ни контейнеры экспортёров не запускались; их реальная отдача и точный набор серий подтверждены только по имени и составу сервисов в `docker-compose.monitoring-prod.yml`. Статус: НЕ ПРОВЕРЕНО.
- «Что будет, если метрики нет» для активных правил — вывод из кода PromQL-семантики (серия отсутствует → вектор пуст → правило не даёт срабатываний) и из ветвлений в `route.ts`; живой Prometheus для подтверждения не поднимался. Статус: ГИПОТЕЗА (для правил, зависящих от условной отдачи).
- Находка №10 (волатильность `heapUsed/heapTotal`) в рантайме не наблюдалась. Статус: ГИПОТЕЗА.
- Фактическое содержание `REDIS_PASSWORD`/`METRICS_SCRAPE_TOKEN`/`BACKUP_ENABLED` в проде не проверялось — `.env*` не читались по правилам AGENTS.md. Влияние незаданных значений оценено только по коду (fail-closed) и дефолтам в `docker-compose.yml`.
- Файлы под `docs/audits/` (кроме этого отчёта), `CODEX-REPORT*`, `docs/strategy` не открывались.
