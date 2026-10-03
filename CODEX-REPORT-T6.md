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

## F4 — кнопка тестирует свой канал (ревью №4)

Подтверждено и воспроизведено: сервер игнорировал configId; service выбирал первый enabled канал. Route теперь withMutation + readJsonBody + zod safeParse configId, tenant только requireTenantId(user), существование проверяется id AND tenantId; чужой/несуществующий —404 без вызова Telegram, missing tenant403 без DB, malformed400, auth/role guard сохранён. Затем testConnection(configId, tenantId) читает ровно выбранную конфигурацию, фильтр до chatId dedupe. Из HTTP DEFAULT_TENANT_ID fallback исключён; фоновые вызовы без аргументов сохраняют прежний контекст/default. Можно проверять свою disabled конфигурацию явным API-запросом; существующая кнопка на disabled остаётся disabled.

Задание прямо требует route test: добавлен один новый файл __tests__/route.test.ts,9существенных guards. Red route exit1:2passed/7failed; service red exit1:32passed/1failed при одинаковом chatId и разных bot tokens. Green f4-green.log exit0:3files/44passed/0skip (route+service+клиент). Токен из DB наружу не возвращается. Auth/security/RLS files не редактировались. Impact testConnection/detect exit1 unavailable (UNKNOWN), fallback найден один HTTP caller и existing unit suite; diff --check exit0. F3 commit9ff444c0.

## F5 — единая документация выкладки (ревью №13)

Прочитаны фактические deploy-prod.sh flags и .claude/skills/deploy/SKILL.md. CLAUDE.md изменён одной строкой, header deploy-prod.sh только2комментария (body не менялся и не запускался). Навык deploy, ранбуки008/016 теперь показывают одинаковый основной вызов: WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers; флаг строго первым, ws отсутствует. Внешняя остановка подтверждается оператором заранее, app/workers всегда заменяются вместе. Ручной deploy/rollback через replace-worker-generation.sh, последовательные build и smoke до STOP, сохранение rollback tags до build. Убраны старые unguarded compose-up и «атомарная замена без простоя», destructive stop/rm/rebuild fallback; описан автоматический возврат F1, limits текущего compose, RECOVERED vs OUTAGE. Аварийный compose-up оставлен только после ручной проверки, не обычный путь.

Docs не запускают production и не дают Codex права на выкладку. F5 — явное исключение задания для CLAUDE/skill/deploy header. Проверка rg: в указанных docs нет строк-команд ^docker compose up; ws встречается только «сервиса нет». bash -n scripts/deploy-prod.sh exit0; git diff подтверждает неизменность executable body; diff --check exit0; detect exit1 unavailable, docs graph UNKNOWN. Новые тесты для обратимой документации не добавлялись. F4 commite2803183.

## F6 / ревью №3 — плановые повторы Alertmanager

Подтверждено: labels+startsAt подавлял повтор навсегда. В dedupe identity добавлено UTC окно по реальному observability/alertmanager/alertmanager.yml:critical1h, остальные4h. В одном окне транспортный retry/reordered batch по-прежнему шлёт только недоставленные; в новом окне создаётся новый durable event и напоминание снова доставляется. На границе окна возможен дубль transport retry (решение владельца: дубль лучше потери). При изменении repeat_interval нужно синхронно изменить эти две константы; нет нового env flag. Red exit1:17pass/2fail, green exit0:19pass/0skip, f6-3-red/green.log. Impact/detect exit1 unavailable UNKNOWN, fallback Alertmanager route verified; diffcheck0. F5 commit91005228.

## F6 / ревью №6 — PDF upload timeout

5000ms подтверждено в source; реальное время production upload не измерялось. Red с управляемыми таймерами: upload подтверждается через6s, прежний abort5s => exit1/33pass1fail. Исправлено:30s максимум одного PDF-запроса и45s всей sendDocument рассылки (включая config read), чтобы receipts успели commit в существующей60s транзакции. Оставшиеся после бюджета чаты возвращают transient false и идут в retry, подтверждённые не дублируются. GetChat/sendMessage остаются5s. Telegram ambiguous timeout по-прежнему может дать дубль, BotAPI не поддерживает idempotency. Green exit0/2files58pass0skip, f6-6-red/green.log; impact/detect1 unavailable UNKNOWN; diffcheck0. Новых env flags/deps нет. Находка3 commitb3320b02.

## F6 / ревью №7 — health/lag snapshots между Next bundles

Вероятная находка подтверждена на реальном production Next с собственным PG/2Redis: build exit0,107миграций, metrics authenticated own ADMIN,4samples/45s —lag_snapshot_timestamp_seconds0 иhealth_snapshot_age_seconds-1 (f6-metrics-before.log). Никакого production доступа. Дополнительные red module-reset tests exit1:29pass/2fail: новый экземпляр модуля терял произведённый snapshot. Исправлено: typed globalThis holders только для last successful health/lag snapshots; module copies instrumentation/API в одном процессе делят snapshot. Ошибка collection не обновляет timestamp (прежний test сохранён), monitor lifecycle не переносился/не дублировался, разные процессы сохраняют собственные timestamps. Green exit0/4files67pass0skip (producer/consumer,metrics,deep-health), f6-7-green.log. Production green перепроверяется F8 после финальной сборки; не заявляется по unit. Диагностический supervisor exit0/CLEANUP done, собственные PG/2Redis удалены. Impact getLagMetrics/getCurrentStatus/detect1 unavailable UNKNOWN; fallback consumers metrics/system/status/deep-health/aggregate; diffcheck0. PDF commitf12534cb.

## F6 / ревью №8 — GitHub deploy обходил барьер

Подтверждено: workflow прямой compose-up и удалённый ws choice. Теперь manual dispatch требует boolean external_workers_stopped (по умолчанию false); preflight отказывает до Install SSH key/SSH при неподтверждённой остановке/неизвестном сервисе. Все3choices app/workers/app workers заменяют оба, сохраняются фактические старые imageIDs в rollback tags до build, последовательно строятся образы+smoke, remote переключение вызывает только replace-worker-generation.sh с подтверждением. app SHA проверяется для каждого choice (включая workers-only). Workflow не запускался, SSH/секреты не использовались; изменение локального файла разрешено F6 требованием закрыть находку.

Новый один scripts/test-deploy-workflow.cjs — существенный guard destructive deploy: извлекает реально исполняемые preflight/run snippets, false/true на3choices и unknown ws; SSH заменён локальным shim до исполнения, захваченная remote-команда проверена на общий barrier+rollback tags, bash -n. Red exit1 missing Confirm step; green exit0/PASS, f6-8-red/green.log. Новых packages нет (YAML библиотека не требовалась; проверка require yaml отказала, не устанавливалась). Impact/detect1 unavailable UNKNOWN; fallbackworkflow callers docs007/008, shellsyntax0/diffcheck0. Snapshot commitd575a1fc.

## F6 / ревью №9 — SECURITY logout не подтверждал отзыв

Подтверждено: route игнорировал false; logoutClient finally стирал UI даже при non-ok/network. Red существующего route suite расширен4essential guards, exit1:2pass4fail. Route теперь false→503 с понятным отказом, без cookie/cache clearing и audit успешного logout. Клиент non-ok/network показывает toast, возвращает false, сохраняет store/session; success возвращает true и очищает state. Общий helper нужен потому, что shell и frozen operator вызывают его через void: unhandled exception не вводилась, caller экраны не редактировались. Auth/session/revocation/RLS implementation не менялся; подтверждённая security находка позволяет route/helper и отдельный SECURITY commit, test-first выполнен.

Green exit0:3files36pass0skip (logout,session-service,existing api-error tests), f6-9-red/green.log. Legacy/invalid/expired token с false теперь консервативно отказывает503, а не обещает revocation; без token anonymous logout остаётся200. AuthFetch401 cleanup по-прежнему сбрасывает уже неподтверждённую локальную сессию, explicit logout — только success. Реальный Redis outage proof планируется F8; unit mock не выдаётся за него. Impact revokeSessionToken/logoutClient/detect1 unavailable UNKNOWN; fallback2shell+frozenoperator callers; diffcheck0. Workflow commit4ecd6e3e.

## F6 — находка 10: недоступность KPI аналитики

Подтверждена. При ответах аналитики 403/500 плитки свай, бурения и простоя показывали нули или предыдущие числа. Теперь они показывают «— / Данные не загрузились», без прогресса; независимые отчёты, парк и ТО сохраняются.

Красный тест: `node node_modules/vitest/vitest.mjs run src/components/piling/__tests__/admin-dashboard.test.tsx`, exit 1, 7 passed / 2 failed. После изменения: тот же запуск exit 0, 9 passed / 0 skipped. Проверяется реальное содержимое KPI при обеих ошибках. GitNexus detect-changes exit 1 (CLI недоступен, UNKNOWN); ручной diff и поиск зависимостей выполнены. `git diff --check`: exit 0. Браузерная проверка — F8.
