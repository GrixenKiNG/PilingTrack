# CODEX-REPORT-T4 — поток 4, 03.10.2026

Рабочая папка D:\PillingR\wt-codex4, ветка codex/night-1003, исходный HEAD 7f676926. Production, SSH, push, секреты и .env не затрагивались. Пакеты не устанавливались.

GitNexus: impact gracefulShutdown через разрешённый runner с GITNEXUS_INVOCATION=gitnexus — exit 1 (глобальный CLI отсутствует). Автоустановка запрещена. Используется прямо разрешённый fallback rg + git diff --stat/--check перед правками и коммитами; callers/processes/risk графа не установлены, не считаются нулевыми/низкими.

## D1 — барьер смены поколения

Новый --replace-worker-generation обязателен для app/workers. App запускает embedded outbox/projection по умолчанию (instrumentation.ts, embedded-workers.ts), поэтому эти сервисы заменяются вместе. Сборка и передача образов остаются до остановки. Отдельный scripts/replace-worker-generation.sh используется и для rollback: перечисляет все старые контейнеры проекта с service=app/workers, запрещает restart, останавливает compose и оставшиеся one-off, проверяет фактический state/exit/OOM, затем заново проверяет отсутствие RUNNING, и только после всего барьера делает up. При ошибке up останавливает частично поднятые сервисы.

Внешние процессы/другие хосты скрипт обнаружить не может: требует явного WORKER_GENERATION_EXTERNAL_STOPPED=1 после ручной проверки/отключения их автозапуска. По умолчанию проект pilingtrack. Compose timeout 30с проверяется против реально заданного WORKER_SHUTDOWN_TIMEOUT_MS старых контейнеров (по умолчанию 8000) с запасом ≥5с. Увеличение compose timeout не продлевает внутренний дедлайн. Exit 1/137/143/OOM блокирует новое поколение: необходим разбор drain, автоматически не обходится.

Красная проверка scripts/test-worker-generation.sh до создания helper: exit 127 (helper отсутствует); журнал output/codex-t4/d1-red.log. Зелёная проверка на реальном Docker, проект codex-deploytest, Alpine sleep, app + две реплики workers: exit 0. Порядок STOP→VERIFY→START доказан журналом; ID старых контейнеров после force-recreate отсутствуют. Fault injection делает stop успешным без реальной остановки: helper отказывает с exit 1, START отсутствует, ID остаются прежними. Все codex-deploytest контейнеры/сеть удалены trap. Deploy на сервере не запускался. Ранбук 008 дополнен.

Проверки: bash -n — exit 0; git diff --check — exit 0. Unit tests не относятся к shell-барьеру; реальные контейнеры проверены. Ограничение: compose up не атомарен, поэтому отказ во время старта компенсируется stop; если сам Docker недоступен при stop, требуется ручная проверка (ошибка печатается).
Коммит D1: df0913d7.

## D2 — доказательства на живом Postgres

Добавлены tests/integration/disposable-m6-m8.spec.ts и scripts/test-m6-m8.sh. Поднимается только codex-pg-<random>, все 107 миграций применяются существующим test-db-up.sh; cleanup гарантирован trap test-db-down.sh. Сгенерированные реквизиты остаются в памяти shell; файлы .env/production БД не используются. Модели и RLS не замоканы: приложение работает ролью pilingtrack_app; владелец только создаёт/проверяет/убирает свои фикстуры. Telegram fetch заглушён на telegram.invalid, реальные сообщения не отправлялись.

M6: реальный черновик с 3 сваями ×6м не попадает в FleetSnapshot и SiteDailySummary, включая rebuild. После изменения сохранённого статуса на submitted живой recompute (тот же обработчик REPORT_SUBMITTED) даёт 3 сваи/18м/1 отчёт; rebuild даёт идентичные значения. HTTP отправка отчёта в этой проверке не проверялась.

M7: A подтверждён, B получает сетевую ошибку. Транзакция сохраняет telegramDeliveredChatIds=[A] в OutboxEvent при published=false. Затем Prisma disconnect, удаление кэшированного клиента и resetModules; новый клиент/обработчик читает строку из БД и отправляет только B. Повтор published=true не отправляет никому. Это имитация перезапуска клиента и модулей в одном тестовом процессе, не аварийное убийство процесса.

M8: настоящие Media-строки фото и PDF-вложения плюс их реальные файлы. Dry-run: 1 кандидат/0 удалений, все строки/файлы остаются. Apply: удалён только UUID PDF из storage/pdf-results возрастом 31 день; свежий PDF, фото и вложение сохранены побайтно, строки Media идентичны. S3 в этой проверке не использовался.

Красный прогон реального старого кода: временно подставлены rebuild/fleet b6f602b5 и Telegram e6982cc1, затем автоматически восстановлены без смены ветки. Exit 1: 2 failed/1 passed/0 skipped (M6 draft KPI=3 вместо 0; M7 частичный успех ошибочно завершён). Зелёный текущий код после восстановления: exit 0, 3 passed/0 failed/0 skipped, 1 файл, 2.45с. Журналы output/codex-t4/d2-red-old-code.log и d2-green.log. Первый диагностический прогон был exit 1 (1 failed/2 passed): тест возвращал ленивый PrismaPromise из tenant-контекста; тестовый callback исправлен на async/await, реализация tenancy не менялась. TypeScript exit 0. Одноразовые контейнеры после каждого прогона удалены.