# AU155-S7-WORKERS-QUEUES: Воркеры — очереди и обработчики

Версия кода: `git rev-parse HEAD` → `bbcafbc54819b5f307a97b56218c0a63e34612fd`
Ветка: `hermes/q4-0926` (worktree D:\PillingR\wt-night). Только чтение кода приложения; изменён лишь этот отчёт.

## Итог

Проверены все очереди и обработчики в `src/workers/**` и связанных модулях (`outbox-publisher`, `projection-worker`, `pdf-queue`, DLQ, планировщики). Найдено 13 находок: 0 критично, 4 важно, 9 мелочь/гипотеза.

- Очередь outbox (БД `OutboxEvent`, два независимых потребителя) — самая зрелая: повторы `MAX_RETRIES=5` с экспоненциальным backoff и джиттером, атомарный claim, DLQ, транзакционный захват строки для Telegram. ПРОЙДЕНО.
- 5 суточных/часовых планировщиков (pm, readiness, projection-rebuild, idempotency-cleanup, pdf-cleanup) — обработчики БЕЗ повторов: единичный сбой = пропуск целого интервала (до 24 ч) до следующего тика. ВАЖНО.
- У polling-циклов outbox/projection защита от наложения (`running`) не имеет таймаута: зависший обработчик навсегда останавливает проход, а `/health` при этом продолжает показывать `running`. ВАЖНО.
- PDF-очередь BullMQ: нет per-job таймаута/`lockDuration`, нет обработчика `stalled` в unified-варианте, нет DLQ и нет метрики (`getQueueMetrics` не вызывается нигде). ВАЖНО.
- Метрики воркеров (`/metrics`) отдают только `enabled/status/is_leader/uptime` — счётчиков обработанных/упавших/повторов и глубины очередей нет.

Самая важная находка — см. №1 (зависший обработчик молча останавливает очередь при зелёном health).

## Методика

Что и как искал (воспроизводимо):

1. `git rev-parse HEAD` — версия зафиксирована.
2. `find src/workers -type f` + `wc -l` — инвентаризация 32 файлов (реализация + тесты).
3. Прочитаны целиком ядровые файлы: `src/workers/unified-worker.ts`, `unified-worker/{config,state,health-server,outbox,projection,pdf,pm-scheduler,readiness-scheduler,projection-rebuild-scheduler,pdf-cleanup-scheduler,idempotency-cleanup-scheduler,scheduler-heartbeat,sentry,env-int}.ts`, `src/workers/{outbox-worker,pdf-worker,projection-worker,embedded-workers,register-readiness-projection}.ts`.
4. Обработчики очередей: `src/services/reports/outbox-publisher.ts`, `src/modules/reports/application/projections/projection-worker.ts`, `src/services/reports/domain-events.ts`, `src/services/reports/event-handlers.ts` (фрагментами), `src/core/outbox/dead-letter-queue.ts`, `src/core/infrastructure/leader-election.ts`.
5. PDF-очередь: `src/lib/pdf-queue.ts`, `src/lib/pdf-generator/cleanup.ts`, `src/workers/unified-worker/pdf.ts`.
6. Поиски: `rg -n "getQueueMetrics|getDlqStats|getOutboxStats"`, `rg -n "lockDuration|stalledInterval|jobTimeout|maxStalledCount"`, `rg -n "REDIS_URL|getStateRedisClient|getRedisClient" src/workers`, `rg -n "pdf-queue"`.
7. Проверено отсутствие `lockDuration`/таймаута задачи и наличие/отсутствие `stalled`-обработчиков.
8. Frozen-зоны (operator/ORION) не затронуты — в `src/workers` их нет.

Матрица «очередь → обработчик → свойства» (файл:строка):

| Очередь / цикл | Обработчик | Повторы | Таймаут | Идемпотентность | DLQ | Метрика |
|---|---|---|---|---|---|---|
| outbox→published (`OutboxEvent`) | `emitDomainEvent` (`domain-events.ts:97`) через `publishOutboxEvents` (`outbox-publisher.ts:243`) | да, MAX_RETRIES=5 + backoff (`outbox-publisher.ts:26-41,173`) | нет на обработчик; есть re-entrancy guard без дедлайна (`outbox-publisher.ts:276`) | на обработчике (Telegram — lock строки `event-handlers.ts:658`) | да (`dead-letter-queue.ts:46`) | только логи stats (`outbox.ts:89`) |
| outbox→projected (`OutboxEvent`) | `projectEvent` (`projection-worker.ts:105`) через `projectOutboxEvents` (`outbox-publisher.ts:254`) | да, те же (`outbox-publisher.ts:169-232`) | нет (`projection-worker.ts:157`) | проекции идемпотентны, ретрай по throw (`projection-worker.ts:134-144`) | да (общий с published) | только логи (`projection-worker.ts:162`) |
| PDF (`pdf-generation`, BullMQ) | `processPdfJob` (`pdf-worker.ts:50`) / `startPdf` (`unified-worker/pdf.ts:16`) | да, attempts=2 + exponential (`pdf-queue.ts:29,91-95`) | НЕТ (нет lockDuration/stalled) | файл перезаписывается по jobId (`pdf.ts:62`) | НЕТ (removeOnFail `pdf-queue.ts:97`) | НЕТ (`getQueueMetrics` не вызван) |
| pm-scheduler (суточный) | `runOnce` (`pm-scheduler.ts:69`) | НЕТ | нет | да (dedup по открытому наряду, `pm-scheduler.ts:1-5`) | — | пульс (`pm-scheduler.ts:85`) |
| readiness-scheduler (часовой) | `runOnce` (`readiness-scheduler.ts:26`) | НЕТ | нет | да (`readiness-scheduler.ts:9-11`) | — | пульс (`readiness-scheduler.ts:44`) |
| projection-rebuild (суточный) | `runOnce` (`projection-rebuild-scheduler.ts:27`) | НЕТ | нет | да, полный пересчёт (`projection-rebuild-scheduler.ts:13`) | — | пульс (`projection-rebuild-scheduler.ts:34`) |
| idempotency-cleanup (суточный) | `runOnce` (`idempotency-cleanup-scheduler.ts:35`) | НЕТ | нет | да (повтор удалит 0) | — | пульс (`idempotency-cleanup-scheduler.ts:39`) |
| pdf-cleanup (суточный) | `run` (`pdf-cleanup-scheduler.ts:12`) | НЕТ | AbortController только на остановку | да (dry-run по умолчанию) | — | пульс (`pdf-cleanup-scheduler.ts:19`) |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|---|---|---|---|---|
| 1 | важно | src/services/reports/outbox-publisher.ts:276-290 | Re-entrancy guard `running` без таймаута/дедлайна: если обработчик не завершится (зависший запрос к БД без statement timeout, сеть), флаг `running` не сбросится | Поллинг outbox навсегда останавливается, `setInterval` продолжает тикать вхолостую, а `/health` показывает воркер `running` → очередь копится молча, наблюдаемость зелёная. Аналогично для projection | Обернуть `publishOutboxEvents(handler)` в `withTimeout(...)`; при истечении — логировать и снимать `running` |
| 2 | важно | src/modules/reports/application/projections/projection-worker.ts:157-170 | Тот же паттерн без таймаута на проходе проекций (и на weekly-цикле, стр.180-198) | Зависший upsert `projectWeeklyTrend` навсегда останавливает проекции; health не замечает | Тот же `withTimeout` вокруг прохода |
| 3 | важно | src/workers/unified-worker/pm-scheduler.ts:86-93; readability-scheduler.ts:45-52; projection-rebuild-scheduler.ts:35-42; idempotency-cleanup-scheduler.ts:36-45 | Планировщики без повторов: `catch` логирует + Sentry, затем ждут следующий интервал | Транзиентный сбой (kill БД, таймаут сети) откладывает суточную рутину (автозакрытие смен, истечение нарядов, план ТО, пересборка витрин) на целые сутки; в худшем случае — до 24 ч простоя данных | Один-два быстрых повтора с малым backoff внутри прохода либо повтор при следующем коротком тике |
| 4 | важно | src/workers/unified-worker/pdf.ts:72-78; src/workers/pdf-worker.ts:102-111 | BullMQ-PDF-задача без `lockDuration`/таймаута: длинный рендер (периодический отчёт) может превысить дефолтный лок 30 с → job помечается stalled и перезапускается; в unified-варианте нет даже обработчика `stalled` (в `pdf-worker.ts:130` он есть) | Долгий PDF обрабатывается повторно (`removeOnComplete`/`getState`) → лишняя нагрузка, дубль файла; рассинхрон поведения двух PDF-воркеров | Задать `lockDuration`/`maxStalledCount` явно; добавить `.on('stalled')` в unified-вариант |
| 5 | важно | src/lib/pdf-queue.ts:245 | PDF-очередь без DLQ и без метрики: `getQueueMetrics` экспортирована, но не вызывается нигде; failed-задачи удаляются `removeOnFail` (24 ч/5000, `pdf-queue.ts:97`) | Упавшие PDF негде посмотреть (только `getPdfJobStatus` с общей строкой «Не удалось сформировать PDF», `pdf-queue.ts:216`) и не видно в `/metrics`; глубина очереди не наблюдаема | Отдавать `getQueueMetrics()` в `/metrics` воркера и/или в `/api/health/deep`; хранить failed-задачи дольше |
| 6 | мелочь | src/workers/unified-worker/health-server.ts:11-14,45-52 | `/health` считает воркер `running` по `status`, не различая лидера и standby; `/metrics` не содержит счётчиков processed/failed/retry и глубины очередей | Standby-реплика без лидера рапортует `running` → ложнозелёный health; нет цифр для алертов по «застреваниям» | Добавить признак лидера в вердикт и счётчики обработанных/упавших событий |
| 7 | мелочь | src/workers/outbox-worker.ts:100-107; src/workers/projection-worker.ts:66-72; src/workers/pdf-worker.ts:138-143 | Standalone-воркеры на SIGTERM зовут `process.exit(0)` сразу, не дожидаясь текущего прохода (нет graceful-дедлайна как в `unified-worker.ts:49-136`) | Незавершённый проход обрывается. Смягчено dispatch-then-claim (строка не помечена → повторится), но in-flight PDF-задача BullMQ может быть оборвана (stalled-перезапуск) | Опционально: дождаться завершения текущего прохода/`worker.close()` перед выходом |
| 8 | мелочь | src/services/reports/outbox-publisher.ts:303-307; src/workers/embedded-workers.ts:102-108 | Каждый экземпляр `startOutboxWorker`/`startProjectionWorker` плюс embedded/hook регистрируют собственные `process.on('SIGTERM'…)` | При нескольких воркерах в одном процессе возможно `MaxListenersExceededWarning` (>10) и снятие чужих обработчиков | Централизовать один shutdown-hook на процесс |
| 9 | мелочь | src/core/outbox/dead-letter-queue.ts:173-193 | Записи DLQ не имеют автоустаревания/лимита: `pending` копится до ручного разбора | Без оператора таблица DLQ растёт неограниченно | Срок/лимит для DLQ или дашборд-алерт по глубине |
| 10 | гипотеза | src/workers/pdf-worker.ts:158 | `if (require.main === module)` — проверка CJS-стиля в файле, запускаемом через `tsx`; при ESM/`type:module` контексте может не выполниться/упасть | Косметика: логирование старта, но маркер запуска ненадёжен | Не проверено фактическим запуском (см. «Не проверено») |
| 11 | мелочь | src/workers/pdf-worker.ts:1-160 vs src/workers/unified-worker/pdf.ts:1-140 | Две независимые реализации PDF-воркера с разными путями конфигурации (env-чтение в двух местах: `pdf-worker.ts:26-28` и `unified-worker/config.ts:9-10`) | Рассинхрон поведения/конфигов; правку надо делать дважды | Свести к одному входу |
| 12 | мелочь | src/services/reports/outbox-publisher.ts:26-29 | `BATCH_SIZE=100`, `MAX_RETRIES=5`, cap 60 с заданы константами кода, без env | Нельзя настроить без пересборки; при массовом сбое окно повторов ≈ 2 мин и затем DLQ | Вынести в env (как сделали `positiveIntEnv` для воркеров) |
| 13 | мелочь | src/workers/unified-worker/config.ts:12-15 | `ENABLED_WORKERS` не валидируется: любое значение (опечатка `pfd`) молча отфильтровывается → воркер не стартует, но health вернёт `stopped` только для известных имён | Опечатка в env оставляет очередь без обработчика, а запуск проходит «успешно» | Логировать неизвестные имена и/или падать при пустом наборе |

Статусы: №1-5, 7-9, 11-13 — ПРОЙДЕНО по коду (чтение с указанных строк). №6 — ПРОЙДЕНО (health-server прочитан). №10 — ГИПОТЕЗА (требует запуска). Подтверждений, что какая-либо из зон frozen, среди находок нет — `src/workers` в frozen-список не входит.

## Что не проверено

- Реальное поведение BullMQ (stalled-перезапуск, `lockDuration`) на живом Redis — не запускал; выводы №4/№7 из чтения опций `Worker`/`Queue`, а не из прогона. Статус: ГИПОТЕЗА.
- `require.main === module` в `pdf-worker.ts:158` — не запускал файл через `tsx`, тип модуля проекта (ESM/CJS) на этом файле не подтверждён. Статус: ГИПОТЕЗА.
- Наличие/отсутствие statement timeout на стороне БД для обработчиков outbox (риск №1/№2) — параметры соединения Prisma/pg в этом аудите не читал.
- Фактическая выставленность env (`ENABLED_WORKERS`, `PDF_TEMP_CLEANUP_ENABLED`, `IDEMPOTENCY_CLEANUP_ENABLED`) в проде — `.env*` и `docker-compose*` не читал (запрещено правилами). Наблюдение о `IDEMPOTENCY_CLEANUP_ENABLED: в сервис workers и app не добавлена` взято из комментария `unified-worker.ts:200-202`, самостоятельно не проверял.
- Не запускал ни один тест/сборку: задача только на чтение, проверок §6 AGENTS.md не выполнял.
- Обработчики `handleAuditEvent`, `handleReportForAnalytics` (полные тела) — читал по списку регистрации и комментариям; детальную проверку на «проглатывание ошибок» каждого не делал.
