# CODEX-REPORT-T4 — поток 4, 03.10.2026

Рабочая папка D:\PillingR\wt-codex4, ветка codex/night-1003, исходный HEAD 7f676926. Production, SSH, push, секреты и .env не затрагивались. Пакеты не устанавливались.

GitNexus: impact gracefulShutdown через разрешённый runner с GITNEXUS_INVOCATION=gitnexus — exit 1 (глобальный CLI отсутствует). Автоустановка запрещена. Используется прямо разрешённый fallback rg + git diff --stat/--check перед правками и коммитами; callers/processes/risk графа не установлены, не считаются нулевыми/низкими.

## D1 — барьер смены поколения

Новый --replace-worker-generation обязателен для app/workers. App запускает embedded outbox/projection по умолчанию (instrumentation.ts, embedded-workers.ts), поэтому эти сервисы заменяются вместе. Сборка и передача образов остаются до остановки. Отдельный scripts/replace-worker-generation.sh используется и для rollback: перечисляет все старые контейнеры проекта с service=app/workers, запрещает restart, останавливает compose и оставшиеся one-off, проверяет фактический state/exit/OOM, затем заново проверяет отсутствие RUNNING, и только после всего барьера делает up. При ошибке up останавливает частично поднятые сервисы.

Внешние процессы/другие хосты скрипт обнаружить не может: требует явного WORKER_GENERATION_EXTERNAL_STOPPED=1 после ручной проверки/отключения их автозапуска. По умолчанию проект pilingtrack. Compose timeout 30с проверяется против реально заданного WORKER_SHUTDOWN_TIMEOUT_MS старых контейнеров (по умолчанию 8000) с запасом ≥5с. Увеличение compose timeout не продлевает внутренний дедлайн. Exit 1/137/143/OOM блокирует новое поколение: необходим разбор drain, автоматически не обходится.

Красная проверка scripts/test-worker-generation.sh до создания helper: exit 127 (helper отсутствует); журнал output/codex-t4/d1-red.log. Зелёная проверка на реальном Docker, проект codex-deploytest, Alpine sleep, app + две реплики workers: exit 0. Порядок STOP→VERIFY→START доказан журналом; ID старых контейнеров после force-recreate отсутствуют. Fault injection делает stop успешным без реальной остановки: helper отказывает с exit 1, START отсутствует, ID остаются прежними. Все codex-deploytest контейнеры/сеть удалены trap. Deploy на сервере не запускался. Ранбук 008 дополнен.

Проверки: bash -n — exit 0; git diff --check — exit 0. Unit tests не относятся к shell-барьеру; реальные контейнеры проверены. Ограничение: compose up не атомарен, поэтому отказ во время старта компенсируется stop; если сам Docker недоступен при stop, требуется ручная проверка (ошибка печатается).