# CODEX T6 — ночь 03→04.10.2026

Рабочая папка D:\PillingR\wt-codex6; ветка codex/night-1004; база b1d988e8 (T5). Задание CODEX-THREAD-6.md и внешний обзор 2026-10-03-release-b67fefb.md прочитаны полностью. Выполнение F1–F8 по порядку. Production/SSH/push, реальные учётки и секреты не используются; .env не читается/не создаётся. Новых зависимостей нет.

## Реестр 13 находок

| № ревью | Этап | Состояние |
|---:|---|---|
|1 — барьер SIGTERM/восстановление|F1|подтверждено: E0a принял app143, но не восстанавливал старое поколение; исправляется|
|2 — DLQ → вечный503|F2|ожидает проверки/исправления|
|3 — повторы Alertmanager|F6|ожидает проверки/исправления|
|4 — Telegram configId|F4|ожидает проверки/исправления|
|5 — постоянная ошибка чата|F3|ожидает проверки/исправления|
|6 — PDF timeout5s|F6|ожидает проверки/исправления|
|7 — свежесть health/lag metrics|F6|ожидает проверки/исправления|
|8 — GitHub deploy без барьера|F6|ожидает проверки/исправления|
|9 — logout игнорирует false|F6|ожидает проверки/исправления|
|10 — KPI ошибки аналитики|F6|ожидает проверки/исправления|
|11 — удаление объекта между trend queries|F6|ожидает проверки/исправления|
|12 — cleanup удерживает shutdown|F6|ожидает проверки/исправления|
|13 — команды выкладки|F5|ожидает исправления документации|

## F1 — барьер смены поколения

На установленном Next16.3.6 node_modules/next/dist/server/lib/start-server.js:374–375 подтвержден process.exit(143) для SIGTERM, обработчик подключён:389. Новый тест использует реальный Node HTTP server: SIGTERM → close → exit143; workers — реальный Node процесс с exit0/143. Сборка приложения/доступ к БД для воспроизведения семантики сигнала не требуются. Использован локальный Node runtime image pt-audit-app:a8567732 через собственный tag codex-nextlike-t6:f1, test healthcheck отключён явно (его старый прикладной /api/health к этому процессу не относится); контейнеры/сеть — только уникальный codex-deploytest-*.

Исправление: все дедлайны, RUNNING, отсутствие one-off, согласованность image/restart проверяются до первой мутации. Живая one-off/остановленная или неоднородная старая реплика — отказ до STOP. Restart=no ставится непосредственно перед STOP; при ошибке восстанавливается. Сохранены immutable imageIDs, restart policy (включая on-failure:N), число реплик. После неудачного STOP/drain запускаются исходные контейнеры; после неудачного/частичного START сначала останавливается и проверяется отсутствие нового RUNNING, затем восстанавливаются старые контейнеры либо старые imageIDs через краткий compose override, если force-recreate уже удалил исходные ID. Секреты/config не выгружаются в override. START ждёт healthy/running (--wait), успешный START сохраняет число реплик. При невозможности автоматического возврата — явный OUTAGE с ручной командой. Начальный/финальный exit остаётся1 при отказе, даже если RECOVERED.

Границы возврата: если исходные IDs удалены, прежний image/restart/replica count сочетаются с текущим compose (не снимок прежних env/volumes/command); это рассчитано на релиз образов без изменения topology/env. При неоднородности/не RUNNING требуется ручная проверка до STOP. Если Docker недоступен или новые процессы нельзя остановить, гарантировать восстановление нельзя: скрипт печатает OUTAGE и не запускает параллельных лидеров.

Красный: bash scripts/test-worker-generation.sh на прежнем барьере exit1, app143 passed, workers143 — FAIL old workers not restored (f1-red.log). Первый исправленный прогон exit1: Windows Git Bash mktemp путь /tmp был неверно прочитан native Compose; исправлен cygpath для временного/base пути. Повтор exit0, но во время прогона обновлялась переносимость, поэтому итогом считается отдельный полный прогон окончательного кода, результат ниже. Ошибочный node -e patch завершился SyntaxError до записи, исправлен обычной записью текста; этот запуск не считается проверкой.

GitNexus impact replace-worker-generation exit1: CLI unavailable. Разрешённый заданием fallback rg+git diff; graph risk UNKNOWN, не LOW. Вызывающие: deploy-prod.sh:114/143 (deploy/rollback), test-worker-generation.sh и ранбуки008/016. Production deploy script не запускался. Перед commit — detect-changes с фактическим exit и diff --check.

Итог F1: bash scripts/test-worker-generation.sh exit0, 6 PASS/0 FAIL (app143, workers143+возврат, live one-off доSTOP, preflight безмутаций, partial START+image/policy/replica возврат, failed drain+возврат). f1-complete.log; свои контейнеры/сеть/tag удалены EXIT trap. bash -n exit0; git diff --check exit0; detect-changes exit1 CLI unavailable. Коммит F1 содержит только барьер, его тест и этот отчёт.

## F2 — новая попытка после DLQ (ревью №2)

Подтверждено на текущей ветке: published + Moved to DLQ отвечал503 без попытки отправки. Теперь повтор создаёт отдельное durable OutboxEvent с новым retry UUID, пустыми receipts и attempts по умолчанию, доставляет через существующий serializing deliverQueuedAlert. Прежние outbox/DLQ записи сохраняются. Если Telegram всё ещё недоступен —503 и новая попытка остаётся для воркера; после восстановления —200, сообщение доставлено. Дубли допускаются решением владельца «дубль лучше потери»; плановые повторы уже успешно опубликованного исходного алерта отдельно относятся к находке №3/F6.

Red f2-red.log exit1:16passed/1failed (реальный ответ503 вместо200). Green f2-green.log exit0:2files/29passed/0skip, маршрут+durable delivery; asserts сохраняют прежнюю DLQ, новую опубликованную строку и реальный вызов notifier mock. Live PG/Telegram stub proof будет в F8. GitNexus impact POST/detect exit1 unavailable, risk UNKNOWN; fallback подтвердил Alertmanager/disk-guard callers и durable-alert-delivery/outbox routing. git diff --check exit0. F1 commit:28898142.

## F3 — постоянный отказ одного чата (ревью №5)

Подтверждено: прежний deliverToAll возвращал false после любого отказа. Теперь sendMessage/sendAlert/sendDocument различают transient false и permanent: Telegram401/403,400 с chat not found/blocked/not a member/deactivated/chat_write_forbidden. Остальные400,429,5xx, timeout/network остаются retry. Постоянный отказ отключает только соответствующий TelegramConfig (id+tenantId+enabled+updatedAt compare), дописывает понятную русскую причину в существующий label и logger.warn; токены не попадают в отметку. Обновление под tenant context и вне inherited GUC scope: global DB connection получает RLS tenant. При конкурирующей правке конфигурации/ошибке БД — retry, не отключение чужой новой настройки.

Доставлено в A + B permanent => true, durable outbox published; подтверждение A сохраняется, B не выдаётся за доставленный. Если все чаты сломаны/нет рабочего — false, без ложной успешной доставки. Рабочий A + временный B => false, receipts A сохранены, повтор только B (существующий I08 test сохранён). Администратор видит отключённый канал и причину в label через существующий список настроек; кэш списка может обновиться в пределах его прежнего60s TTL. Схема/миграция/UI не менялись. После исправления бота канал нужно включить в настройках; label редактируется там же.

Red первоначальный exit1:26passed/2failed alert+PDF; полный red с дополнительными классификациями на HEAD Telegram source exit1:28passed/4failed (f3-red-complete.log). Первый implementation run exit1:62passed/2failed — HTTP error branches ещё возвращали false; подключены к обработчику. Итог f3-complete.log exit0:3files/68passed/0skip (Telegram+durable alert+report PDF). Подготовлен дополнительный реальный PG/RLS test в существующем disposable-m6-m8.spec.ts; запуск F8, пока не считается passed. Impact deliverToAll/detect exit1 CLI unavailable; UNKNOWN, fallback callers alert/daily-summary/PDF/DLQ/PM. diff --check exit0. F2 commit576990ec.
