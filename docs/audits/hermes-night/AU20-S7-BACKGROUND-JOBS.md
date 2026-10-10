# AU20-S7-BACKGROUND-JOBS — фоновые задачи: список, повторы, очередь недоставленных

Версия рабочей папки: `git rev-parse HEAD` → `d7e68db4fce3c828c36137950e3337590ff482ba` (ветка `hermes/q4-0926`).
Режим: только чтение; код приложения не менялся. Отчёт — единственный новый файл.

## Итог

- Просмотрено 30+ файлов кода, все — статически (`read_file`), рантайм не запускался.
- Найдено 20 позиций: **важно — 8**, **мелочь — 12**, критичных нет.
- Фоновых контуров в коде — 9: воркеры-потребители (outbox, projection, PDF), пять планировщиков в контейнере `workers`, плюс два процесса наблюдаемости в `app`.
- Топ-5:
  1. TTL пульса планировщиков = 3×интервала; у суточных это 72 ч — остановку планировщика при живом контейнере видно до 3 суток (`scheduler-heartbeat.ts:40`).
  2. Неделенный пересчёт тренда (`projection-worker.ts:181`) не имеет ни пульса, ни метрики, ни DLQ — признака жизни нет вообще.
  3. Упавшие PDF-задачи BullMQ живут только в очереди 24 ч, без DLQ и без метрики (`pdf-queue.ts:97`, `pdf.ts:96-106`).
  4. Пульс планировщиков не выходит отдельной метрикой; наружу — только агрегат `health_status` уровня warning (`health-server.ts:45-54`, `alerts.yml:309`).
  5. `getOutboxStats().failed` практически всегда 0 — при исчерпании попыток строка клеймится как обработанная (`outbox-publisher.ts:200-209` против `:322-327`).

## Методика

- `git rev-parse HEAD`, `git status`, `git branch --show-current` — фиксация версии.
- `search_files` (файлы): `*{worker,scheduler,outbox,queue,projection,cron,dlq}*` по всему репо; `*notification*`; `docker-compose*`.
- `search_files` (содержимое): `setInterval|setTimeout` по `src/`; `deliverReportPdf|REPORT_PDF_DELIVERY_EVENT|durable-alert`; `EMBEDDED_WORKERS`; `worker_enabled|lag_snapshot|system:scheduler`; `3002|health/deep|scrape_configs`.
- Прочитаны (`read_file`) и разобраны: `src/workers/**`, `src/workers/unified-worker/**`, `src/services/reports/{outbox-publisher,event-handlers,domain-events}.ts`, `src/core/outbox/dead-letter-queue.ts`, `src/core/observability/**` (tracker, lag-monitor, thresholds, checkers/*, scheduler-registry, aggregate), `src/core/infrastructure/leader-election.ts`, `src/core/notifications/{telegram,durable-alert}.ts`, `src/services/notifications/durable-alert-delivery.ts`, `src/modules/reports/application/projections/**`, `src/modules/readiness/{application/scheduler,infrastructure/readiness-worker-entry}.ts`, `src/modules/equipment/application/commands/pm-scheduler.ts`, `src/lib/pdf-queue.ts`, `src/lib/pdf-generator/cleanup.ts`, `src/instrumentation.ts`, `src/app/api/{health/deep,metrics}/route.ts`, `Dockerfile.workers`, `docker-compose.yml`, `observability/prometheus/{prometheus-prod,alerts}.yml`, `package.json`.
- Существующие отчёты `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` НЕ читались (независимость первого прохода). Отдельные имена соседних файлов всплыли в выводе `search_files` — по ним ничего не цитируется.

Статусы: **ПРОЙДЕНО** — вывод подтверждён открытым кодом по указанному `path:line`; **ГИПОТЕЗА** — вывод о поведении в рантайме/проде; **НЕ ПРОВЕРЕНО** — нет данных (см. раздел «Не проверено»).

## Инвентарь фоновых процессов

### Воркеры-потребители

| # | Задача | Интервал / триггер | Что делает | Падение посреди работы | Повторы и лимиты | Куда уходят недоставленные (DLQ) | Защита от двойного запуска | Как узнать, что не работала |
|---|--------|--------------------|-----------|------------------------|------------------|----------------------------------|----------------------------|------------------------------|
| 1 | Outbox-публикатор событий | `OUTBOX_INTERVAL_MS`=10 с (`config.ts:7`); embedded 2 с (`embedded-workers.ts:142`), standalone 10 с (`outbox-worker.ts:32`), unified 10 с (`unified-worker/outbox.ts:52`) | Читает `OutboxEvent` c `published=false`, отдаёт `emitDomainEvent`, атомарно ставит `published=true` (`outbox-publisher.ts:87-258`) | dispatch-then-claim: падение до клейма → строка переберётся следующим тиком (`:156-168`) | MAX_RETRIES=5 (`:26`), backoff 1 с→60 с c джиттером (`:35-41`), повторы по `nextRetryAt` | `moveToDlq` (`:177`) → `DeadLetterQueue` (`dead-letter-queue.ts:46-111`) | Выбор лидера по Redis `getOutboxLeaderElection` (`outbox.ts:13`, `leader-election.ts:268`) + single-flight (`outbox-publisher.ts:276-290`) | Пульс `system:worker:heartbeat:outbox` (`checkers/workers.ts:52`), `outbox_lag_seconds`/`outbox_pending_count` (`lag-monitor.ts:360`), алерты `OutboxLagHigh/Warn`, `OutboxBacklog` (`alerts.yml:171,181,194`) |
| 2 | Projection-воркер (CQRS) | `PROJECTION_INTERVAL_MS`=5 с (`config.ts:8`); embedded 1 с (`embedded-workers.ts:245`) | Читает `OutboxEvent` c `projected=false`, обновляет витрины (`projection-worker.ts:147-214`, `outbox-publisher.ts:254`) | Ошибка обработчика пробрасывается (`projection-worker.ts:143`) → ретрай/DLQ | Те же MAX_RETRIES/backoff, отдельная колонка `projected` | Тот же `moveToDlq`, consumer=`projected` (`outbox-publisher.ts:187`) | Выбор лидера `getProjectionLeaderElection` (`projection.ts:10`) | Пульс `...heartbeat:projection`, `projection_lag_seconds`/`projection_pending_count` (`lag-monitor.ts:368`), алерты `ProjectionLagHigh/Warn` (`alerts.yml:204,214`) |
| 3 | PDF-воркер (BullMQ) | очередь `pdf-generation`, concurrency 2 (`config.ts:9`) | Генерит PDF (period/single), сохраняет на диск/S3 (`pdf.ts:16-140`) | Job помечается failed; воркер остаётся `running` (специально) (`pdf.ts:96-106`) | BullMQ `attempts=2` (`pdf-queue.ts:29,90`), backoff 2 с (`:92-95`) | **Нет DLQ.** Только BullMQ failed-set, `removeOnFail` 24 ч/5000 (`pdf-queue.ts:97`) | Очередь BullMQ (несколько потребителей допустимы) | Пульс `...heartbeat:pdf` (`pdf.ts:63,120-128`), `worker_status{name="pdf"}` + `WorkerNotRunning` (`alerts.yml:285`) — но НЕ исход упавших задач |

### Планировщики (живут только в контейнере `workers`, `unified-worker.ts:173-207`)

| # | Задача | Интервал / задержка старта | Что делает | Падение посреди работы | Повторы | DLQ | Защита от двойного запуска | Как узнать |
|---|--------|---------------------------|-----------|------------------------|---------|-----|----------------------------|-----------|
| 4 | PM-планировщик ТО | 24 ч, старт +60 с (`pm-scheduler.ts:16-17`) | Оценивает регламенты, создаёт PLANNED-наряды, шлёт сводку о просрочках (`pm-scheduler.ts:69-94`) | Планировщик НЕ пишет пульс при исключении (`pm-scheduler.ts:86-90`); работа идемпотентна | Повтор на след. тике; дедуп по открытому наряду + advisory-lock (`modules/equipment/.../pm-scheduler.ts:106-119`) | нет | `passRunning` (`pm-scheduler.ts:67`); наряд защищён PG advisory lock | Пульс `system:scheduler:pm-scheduler` TTL 72 ч (`scheduler-heartbeat.ts:40`) → `health_status` degraded |
| 5 | Пересборка витрин | 24 ч, старт +90 с (`projection-rebuild-scheduler.ts:22-23`) | `rebuildAll()` — полный пересчёт ReportAnalytics/SiteDaily/SiteWeekly (`rebuild.ts:233`) | Ошибка → лог+Sentry, пульс не пишется (`:35-42`) | Повтор на след. тике | нет | `passRunning` (`:25`); идемпотентна | Пульс `...:projection-rebuild` TTL 72 ч |
| 6 | Техготовность (наряды + автозакрытие смен) | 1 ч, старт +90 с (`readiness-scheduler.ts:21-22`) | Истекает наряды, автозакрывает смены, сдаёт черновики, заказывает пересчёт (`scheduler.ts:113-279`) | Ошибка → лог+Sentry, пульс не пишется (`:45-49`) | Повтор на след. тике; идемпотентна (`scheduler.ts:20-22`) | нет | `passRunning` (`:24`); контекст на каждый тенант (`forEachTenant`) | Пульс `...:readiness-scheduler` TTL **3 ч** (интервал 1 ч) → самый «быстрый» детектор |
| 7 | Уборка ключей идемпотентности | 24 ч, старт +120 с (`idempotency-cleanup-scheduler.ts:32-33`) | `cleanupExpiredKeys()` | Ошибка → лог+Sentry (`:40-45`) | Повтор на след. тике | нет | `passRunning` нет; идемпотентна | Пульс только при включении; по умолчанию ВЫКЛ (`scheduler-registry.ts:49-51`); пульс `...:idempotency-cleanup` TTL 72 ч |
| 8 | Уборка временных PDF | 24 ч, старт +60 с (`pdf-cleanup-scheduler.ts:25-26`) | Удаляет временные PDF старше 30 дней (dry-run по умолчанию) | `.catch` → лог (`:22`) | Повтор на след. тике; `running`-guard (`:12-13`) | нет | по умолчанию ВЫКЛ (`:8`, `scheduler-registry.ts:76`) | Пульс `...:pdf-cleanup` TTL 72 ч, только при включении |

### Процессы наблюдаемости и прочее (в `app`)

| # | Задача | Интервал / триггер | Что делает | Как узнать |
|---|--------|-------------------|-----------|-----------|
| 9 | Health-трекер | 15 с, `setTimeout`-цикл (`tracker.ts:97`, `thresholds.ts:11`) | Опрашивает БД/Redis/outbox/воркеры/планировщики/хранилище/бэкап, кэширует | Метрики `health_status`, `health_snapshot_age_seconds` (`metrics/route.ts:112-117`); алерт `HealthSnapshotStale` (`alerts.yml:297`) |
| 10 | Lag-монитор | 10 с (`lag-monitor.ts:81,429`) | Считает лаг outbox/проекции, DLQ, дрейф аналитики | Метрики `outbox_lag_seconds` и др. (`lag-monitor.ts:334-386`) |
| 11 | Telegram-доставка уведомлений | по событию outbox (`NotificationDeliveryRequested`) | `deliverQueuedAlert` (`durable-alert-delivery.ts:22-58`) | Только через общий лаг/DLQ outbox; отдельной метрики по типу нет |
| 12 | Доставка PDF отчёта в Telegram | по событию outbox (`ReportPdfDeliveryRequested`) | `deliverReportPdf` (`event-handlers.ts:599-672`) | То же — общий лаг/DLQ |
| 13 | Буфер телеметрии | 5 с flush (`telemetry-buffer.ts:79`) | Пачки записей телеметрии | Спящий (телеметрия не подключена); метрики нет |
| 14 | Prune трекера ошибок | 60 с (`error-tracker.ts:134`) | Чистит окно ошибок | Метрики нет |
| 15 | Бэкап БД | внешний cron `scripts/backup-postgres.sh` (пишет `system:backup:*`) | Дамп + S3 | `backup_age_hours`, алерты `BackupStale/Critical` (`alerts.yml:384,395`); гейт `BACKUP_ENABLED` (`checkers/backup.ts:17-21`) |

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Как чинить | Статус |
|---|----------|-----------|----------|--------------------------|-----------|--------|
| 1 | важно | `src/workers/unified-worker/scheduler-heartbeat.ts:40` | TTL пульса = `интервал × 3`. Для суточных планировщиков это 72 ч (`pm-scheduler.ts:16`, `projection-rebuild-scheduler.ts:22`, `idempotency-cleanup-scheduler.ts:32`, `pdf-cleanup-scheduler.ts:26`) | Планировщик внутри живого контейнера молча перестал ходить (таймер снят, проход всегда падает): ключ не истекает до 3 суток, `checkSchedulers` (`checkers/schedulers.ts:22-39`) молчит. Только `readiness-scheduler` (интервал 1 ч) виден за 3 ч | Отдельный порог устаревания, не зависящий от интервала (напр. `min(интервал×3, 26 ч)`), либо писать пульс с фиксированным TTL | ПРОЙДЕНО |
| 2 | важно | `src/workers/unified-worker/health-server.ts:45-54` | `/metrics` контейнера `workers` отдаёт только `worker_enabled/status/is_leader/uptime`; пульсы планировщиков (`system:scheduler:*`) отдельной метрикой не выходят | «Планировщик не работал» видно лишь через агрегат `health_status` app (`metrics/route.ts:107-114`) и алерт `HealthDegraded` уровня warning (`alerts.yml:309`), да ещё с задержкой TTL. Нет ни gauge, ни alert, привязанного к конкретному планировщику | Экспонировать `scheduler_heartbeat_age_seconds{name=...}` из `checkSchedulers` и завести alert | ПРОЙДЕНО |
| 3 | важно | `src/modules/reports/application/projections/projection-worker.ts:181-198` | Часовой пересчёт недельного тренда (внутри projection-воркера): нет пульса, нет метрики, нет DLQ; ошибка только логируется (`:193-194`) | Если пересчёт падает/не идёт, `SiteWeeklyTrend` тихо устаревает; отдельного признака жизни у этой петли нет (спасает только суточная `rebuildAll`, находка 5) | Вынести в планировщик с пульсом (`recordSchedulerHeartbeat`) и метрикой строк/длительности | ПРОЙДЕНО |
| 4 | важно | `src/lib/pdf-queue.ts:29,90,97` + `src/workers/unified-worker/pdf.ts:96-106` | PDF-задача после 2 попыток остаётся в BullMQ failed-set (`removeOnFail` 24 ч/5000). В `DeadLetterQueue` не попадает, статус воркера не меняется, метрики нет | Пользователь запросил PDF — задача провалилась дважды — через сутки о ней нельзя узнать ничего, кроме docker-лога и Sentry (`pdf.ts:103`). При пустом `SENTRY_DSN` в контейнере workers (`docker-compose.yml:206`) нет и Sentry | Метрика `pdf_jobs_failed_total` + алерт, либо запись провалов в DLQ | ПРОЙДЕНО |
| 5 | важно | `src/services/reports/outbox-publisher.ts:200-209` против `:322-327` | `getOutboxStats().failed` = `published:false AND attempts>=5`. Но при исчерпании попыток та же функция ставит `published=true` (`:200-209`), поэтому `failed` ≈ всегда 0 | Периодический «Outbox stats» (`outbox.ts:98-99`, `embedded-workers.ts:180`) не отражает реальные провалы; настоящий сигнал — только DLQ (`dlq_pending_count`, `alerts.yml:245`, warning) | Считать `failed` по признаку `lastError LIKE 'Moved to DLQ%'` либо считать pending DLQ в самом stats | ПРОЙДЕНО |
| 6 | важно | `src/workers/unified-worker/pm-scheduler.ts:36-37,58-64` | Сводка о просроченном ТО шлётся best-effort: ошибка/недоступный Telegram глотается, метрики у этого сигнала нет | Просроченные регламенты ТО — предмет допуска к работе; если Telegram не настроен или отказ глотается, сигнал исчезает бесследно (в логе — error, но без метрики/алерта) | Счётчик отправленных/неотправленных сводок + алерт; либо перевести на durable-alert (outbox) | ПРОЙДЕНО |
| 7 | важно | `src/workers/unified-worker/pm-scheduler.ts:67`, `readiness-scheduler.ts:24`, `projection-rebuild-scheduler.ts:25` | Защита от двойного запуска суточных планировщиков — только внутрипроцессный `passRunning`; распределённого замка нет | `workers` сейчас один (`docker-compose.yml:155-160`), но при втором реплике/втором контейнере дневные задания пойдут параллельно. Идемпотентность заявлена, но `rebuildAll` — тяжёлый полный пересчёт | Разделяемый lease (как у outbox/projection) или advisory-lock на планировщик | ГИПОТЕЗА (прод — один контейнер) |
| 8 | важно | `src/modules/readiness/application/scheduler.ts:274-278` | Пульс доказывает «планировщик прошёл», но не «оценки свежие»: результат ограничен логом при `permitsExpired>0 / shiftsAutoClosed>0` (`readiness-scheduler.ts:36-42`); метрики числа истёкших нарядов/закрытых смен нет | Если проход формально успешен, но по факту не находит ничего (например, сбой тенантного контекста), наружу уйдёт только «пульс есть» | Счётчики-метрики expired/auto-closed/requested | ПРОЙДЕНО |
| 9 | важно | `src/workers/outbox-worker.ts` (весь файл), `src/workers/projection-worker.ts` (весь файл), `src/workers/pdf-worker.ts:102-160` | Отдельные точки входа воркеров не инициализируют Sentry (нет `initWorkerSentry`); `pdf-worker.ts` не пишет пульс воркера | Если в проде запустить их вместо `unified-worker.ts` (скрипты `package.json:48-50`), ошибки не уйдут в Sentry, а PDF-воркер не оставит признака жизни | Либо удалить/пометить как dev-only, либо добавить Sentry+heartbeat как в unified | ПРОЙДЕНО |
| 10 | мелочь | `src/core/observability/health-tracker/tracker.ts:97` + `src/core/observability/lag-monitor.ts:429` | Циклы health-трекера и lag-монитора — на процесс, без выбора лидера; у них нет собственного пульса | При нескольких репликах `app` опросы БД/Redis и логи дублируются. При остановке самих циклов их отсутствие ловит только `HealthSnapshotStale`/`LagSnapshotStale` (по метрикам, которые они же и наполняют) | Выбор лидера для цикла либо отдельный heartbeat-ключ | ПРОЙДЕНО |
| 11 | мелочь | `src/core/observability/error-tracker.ts:134` | `setInterval(..., 60_000)` на уровне модуля, без `unref` и без дедупликации | В Next модуль может загрузиться в нескольких бандлах — получится несколько таймеров; каждый держит процесс | Инициализировать лениво/по флагу, `unref()` | ГИПОТЕЗА (зависит от бандлинга) |
| 12 | мелочь | `src/workers/unified-worker.ts:207` | `startPdfCleanupScheduler()` вызывается всегда; при выключенном флаге возвращает no-op, но `stopPdfCleanup` всё равно назначается и ожидается при shutdown | Косметика: лишний no-op в graceful-shutdown | Запускать под тем же флагом | ПРОЙДЕНО |
| 13 | мелочь | `src/core/observability/health-tracker/checkers/outbox.ts:46-47` + `aggregate.ts:25` | Ошибка БД в `checkOutbox` → `stalled` → общий `unhealthy` → `/api/health/deep` 503 | DB_CHECK_TIMEOUT_MS=2000 (`thresholds.ts:6`); разовый медленный запрос может ложно увести deep-health в 503 | Различать «БД недоступна» и «outbox отстал» | ПРОЙДЕНО |
| 14 | мелочь | `src/core/observability/health-tracker/checkers/workers.ts:13,59` | SET `system:workers` никогда не чистится; имена воркеров накапливаются | Безвредно (логика берёт максимальный возраст пульса), но множество растёт | TTL/чистка множества | ПРОЙДЕНО |
| 15 | мелочь | `src/workers/embedded-workers.ts:26,43-64` + `docker-compose.yml:178` | Встроенные outbox+projection в `app` работают по умолчанию (переменная `EMBEDDED_WORKERS` не задана) параллельно контейнеру `workers` | Разводит только выбор лидера по Redis (`leader-election.ts:158-218`). При сбое state-Redis обе стороны могут начать обработку; дублирование частично гасится блокировкой строки outbox (`event-handlers.ts:658-670`) | Задать `EMBEDDED_WORKERS=none` в `app`, если отдельный контейнер есть | ГИПОТЕЗА |
| 16 | мелочь | `src/core/outbox/dead-letter-queue.ts:94-106` | Telegram-алерт о попадании в DLQ — best-effort (`.catch(()=>{})`), гейтится настройкой `deliveryFailures` | При выключенном тумблере или неудаче отправки DLQ-алерт пропадает; остаётся метрика `dlq_pending_count` (warning) | Гарантировать хотя бы метрику; алерт — общий | ПРОЙДЕНО |
| 17 | мелочь | `src/core/outbox/dead-letter-queue.ts:113-151` | Автоматического разбора DLQ нет — только ручной `retryDlqEntry` через админку | Записи лежат до ручного вмешательства; по замыслу, но стоит помнить при разборе инцидента | Оставить как есть / добавить кнопочный джоб с метрикой | ПРОЙДЕНО |
| 18 | мелочь | `src/services/reports/outbox-publisher.ts:26,35-41` | Общая для обоих потребителей (`published`/`projected`) история попыток/backoff — одна колонка `attempts` | Падение одного потребителя увеличивает `attempts` и ускоряет исчерпание лимита (DLQ) у соседнего | Раздельные счётчики попыток на потребителя | ГИПОТЕЗА |
| 19 | мелочь | `src/instrumentation.ts:63-74` | Запуск embedded-воркеров и health-трекера обёрнут в `try/catch → logger.warn` | При сбое старта (напр., БД недоступна) воркеры в `app` не поднимутся молча; спасение — `WorkersNotRunning`/`HealthSnapshotStale` по метрикам | Оставить, но проверить, что метрики реально ловят | ПРОЙДЕНО |
| 20 | мелочь | `src/workers/unified-worker/sentry.ts:24` | Sentry воркера включается только при `SENTRY_DSN`, а в compose он по умолчанию пуст (`docker-compose.yml:206`) | Ошибки outbox/projection/pdf в контейнере `workers` по умолчанию не уходят в Sentry | Задать `SENTRY_DSN` в окружении workers | ПРОЙДЕНО |

### Задачи без любого признака жизни в метриках

- Часовой пересчёт недельного тренда — `projection-worker.ts:181-198` (нет пульса/метрики/DLQ).
- Результат `rebuildAll`: логируется (`projection-rebuild-scheduler.ts:33`), но метрик строк/длительности нет.
- Сводка о просроченном ТО — `pm-scheduler.ts:30-65` (только Telegram, best-effort, без метрики).
- Исходы доставки уведомлений/PDF по типу — нет отдельной метрики (только общий лаг/DLQ outbox): `durable-alert-delivery.ts:22-58`, `event-handlers.ts:599-672`.
- Буфер телеметрии — `telemetry-buffer.ts:79-88` (спящий).
- Prune трекера ошибок — `error-tracker.ts:134`.
- Сами петли наблюдаемости (health-трекер `tracker.ts:97`, lag-монитор `lag-monitor.ts:429`) собственного пульса не пишут.

## Не проверено

- **Рантайм не запускался.** Проверка — только статическое чтение кода; ни `build`, ни `tsc`, ни vitest/Playwright не гонялись (задача read-only). Все выводы о поведении — из текста кода.
- **Значения окружения в проде неизвестны.** `.env*` не читал (запрет). Выводы об интервалах/включённости планировщиков — по значениям по умолчанию в коде и по `docker-compose.yml`; фактическое окружение не подтверждено.
- **Активность Prometheus/Alertmanager в проде** — прочитан только конфиг (`observability/prometheus/*.yml`); что правила реально загружены и алерты доставляются, не проверял.
- **Доступность инстанса состояния Redis из workers** (оба пульса и `dlq_pending_count`) — по конфигу `docker-compose.yml:171-172`; живое соединение не проверялось.
- **Расписание и включённость бэкапа** (`BACKUP_ENABLED`, cron `scripts/backup-postgres.sh`) — по коду `checkers/backup.ts`; `.env` не читал.
- **Настройки уведомлений тенанта** (`isNotificationEnabled` для `deliveryFailures`, `maintenanceOverdue`, `newReports`) — влияют на то, придёт ли Telegram-алерт; значения в БД/настройках не читал.
- **Число реплик `app`/`workers` в проде** — влияет на находки 7 и 15; из compose следует по одному контейнеру, фактически не проверено.
- **Существующие отчёты** `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` не читались; совпадения с ранее найденным не сверялись.
