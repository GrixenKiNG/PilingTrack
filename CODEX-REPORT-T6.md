# CODEX T6 — ночь 03→04.10.2026

Рабочая папка D:\PillingR\wt-codex6; ветка codex/night-1004; база b1d988e8 (T5). Задание CODEX-THREAD-6.md и внешний обзор 2026-10-03-release-b67fefb.md прочитаны полностью. Выполнение F1–F8 по порядку. Production/SSH/push, реальные учётки и секреты не используются; .env не читается/не создаётся. Новых зависимостей нет.

## Реестр 13 находок

| № ревью | Этап | Состояние |
|---:|---|---|
|1 — барьер SIGTERM/восстановление|F1|подтверждено и исправлено; тесты/доказательства ниже|
|2 — DLQ → вечный503|F2|подтверждено и исправлено; тесты/доказательства ниже|
|3 — повторы Alertmanager|F6|подтверждено и исправлено; тесты/доказательства ниже|
|4 — Telegram configId|F4|подтверждено и исправлено; тесты/доказательства ниже|
|5 — постоянная ошибка чата|F3|подтверждено и исправлено; тесты/доказательства ниже|
|6 — PDF timeout5s|F6|подтверждено и исправлено; тесты/доказательства ниже|
|7 — свежесть health/lag metrics|F6|подтверждено и исправлено; тесты/доказательства ниже|
|8 — GitHub deploy без барьера|F6|подтверждено и исправлено; тесты/доказательства ниже|
|9 — logout игнорирует false|F6|подтверждено и исправлено; тесты/доказательства ниже|
|10 — KPI ошибки аналитики|F6|подтверждено и исправлено; тесты/доказательства ниже|
|11 — удаление объекта между trend queries|F6|подтверждено и исправлено; тесты/доказательства ниже|
|12 — cleanup удерживает shutdown|F6|подтверждено и исправлено; тесты/доказательства ниже|
|13 — команды выкладки|F5|подтверждено и исправлено; тесты/доказательства ниже|

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

Доставлено в A + B permanent => true, durable outbox published; подтверждение A сохраняется, B не выдаётся за доставленный. Если все чаты сломаны/нет рабочего — false, без ложной успешной доставки. Рабочий A + временный B => false, receipts A сохранены, повтор только B (существующий I08 test сохранён). Администратор видит отключённый канал и причину в label через существующий список настроек; список показывает изменение после перечитывания страницы/настроек. Схема/миграция/UI не менялись. После исправления бота канал нужно включить в настройках; label редактируется там же.

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

Вероятная находка подтверждена на реальном production Next с собственным PG/2Redis: build exit0,107миграций, metrics authenticated own ADMIN,4samples/45s —lag_snapshot_timestamp_seconds0 иhealth_snapshot_age_seconds-1 (f6-metrics-before.log). Никакого production доступа. Дополнительные red module-reset tests exit1:29pass/2fail: новый экземпляр модуля терял произведённый snapshot. Исправлено: typed globalThis holders только для last successful health/lag snapshots; module copies instrumentation/API в одном процессе делят snapshot. Ошибка collection не обновляет timestamp (прежний test сохранён), monitor lifecycle не переносился/не дублировался, разные процессы сохраняют собственные timestamps. Green exit0/4files67pass0skip (producer/consumer,metrics,deep-health), f6-7-green.log. Production green подтверждён в F8 на финальной сборке отдельной строгой проверкой; результат ниже. Диагностический supervisor exit0/CLEANUP done, собственные PG/2Redis удалены. Impact getLagMetrics/getCurrentStatus/detect1 unavailable UNKNOWN; fallback consumers metrics/system/status/deep-health/aggregate; diffcheck0. PDF commitf12534cb.

## F6 / ревью №8 — GitHub deploy обходил барьер

Подтверждено: workflow прямой compose-up и удалённый ws choice. Теперь manual dispatch требует boolean external_workers_stopped (по умолчанию false); preflight отказывает до Install SSH key/SSH при неподтверждённой остановке/неизвестном сервисе. Все3choices app/workers/app workers заменяют оба, сохраняются фактические старые imageIDs в rollback tags до build, последовательно строятся образы+smoke, remote переключение вызывает только replace-worker-generation.sh с подтверждением. app SHA проверяется для каждого choice (включая workers-only). Workflow не запускался, SSH/секреты не использовались; изменение локального файла разрешено F6 требованием закрыть находку.

Новый один scripts/test-deploy-workflow.cjs — существенный guard destructive deploy: извлекает реально исполняемые preflight/run snippets, false/true на3choices и unknown ws; SSH заменён локальным shim до исполнения, захваченная remote-команда проверена на общий barrier+rollback tags, bash -n. Red exit1 missing Confirm step; green exit0/PASS, f6-8-red/green.log. Новых packages нет (YAML библиотека не требовалась; проверка require yaml отказала, не устанавливалась). Impact/detect1 unavailable UNKNOWN; fallbackworkflow callers docs007/008, shellsyntax0/diffcheck0. Snapshot commitd575a1fc.

## F6 / ревью №9 — SECURITY logout не подтверждал отзыв

Подтверждено: route игнорировал false; logoutClient finally стирал UI даже при non-ok/network. Red существующего route suite расширен4essential guards, exit1:2pass4fail. Route теперь false→503 с понятным отказом, без cookie/cache clearing и audit успешного logout. Клиент non-ok/network показывает toast, возвращает false, сохраняет store/session; success возвращает true и очищает state. Общий helper нужен потому, что shell и frozen operator вызывают его через void: unhandled exception не вводилась, caller экраны не редактировались. Auth/session/revocation/RLS implementation не менялся; подтверждённая security находка позволяет route/helper и отдельный SECURITY commit, test-first выполнен.

Green exit0:3files36pass0skip (logout,session-service,existing api-error tests), f6-9-red/green.log. Legacy/invalid/expired token с false теперь консервативно отказывает503, а не обещает revocation; без token anonymous logout остаётся200. AuthFetch401 cleanup по-прежнему сбрасывает уже неподтверждённую локальную сессию, explicit logout — только success. Результаты настоящего Redis отказа и браузерного сценария приведены в F8; unit mock не выдаётся за реальный отказ. Impact revokeSessionToken/logoutClient/detect1 unavailable UNKNOWN; fallback2shell+frozenoperator callers; diffcheck0. Workflow commit4ecd6e3e.

## F6 — находка 10: недоступность KPI аналитики

Подтверждена. При ответах аналитики 403/500 плитки свай, бурения и простоя показывали нули или предыдущие числа. Теперь они показывают «— / Данные не загрузились», без прогресса; независимые отчёты, парк и ТО сохраняются.

Красный тест: `node node_modules/vitest/vitest.mjs run src/components/piling/__tests__/admin-dashboard.test.tsx`, exit 1, 7 passed / 2 failed. После изменения: тот же запуск exit 0, 9 passed / 0 skipped. Проверяется реальное содержимое KPI при обеих ошибках. GitNexus detect-changes exit 1 (CLI недоступен, UNKNOWN); ручной diff и поиск зависимостей выполнены. `git diff --check`: exit 0. Браузерная проверка — F8.

## F6 — находка 11: удалённый объект в ежечасном пересчёте

Подтверждена. Планировщик теперь передаёт `tenantId` третьим аргументом `projectWeeklyTrend(site.id, null, tenantId)`. Реальный контекст `forEachTenant` сохраняется: удалённый после выборки объект пропускается, следующий пересчитывается; скрытый объект с неверным контекстом по-прежнему вызывает ошибку.

Красный тест планировщика: exit 1, 6 passed / 1 failed. После исправления тесты планировщика и fail-closed обработчика: exit 0, 12 passed / 0 skipped. GitNexus impact/detect-changes exit 1 (CLI недоступен, UNKNOWN); проверены все текстовые вызовы и diff. `git diff --check`: exit 0.

## F6 — находка 12: отмена очистки PDF при shutdown

Подтверждена при включённом opt-in. Планировщик отменяет текущий проход через AbortController, запрещает новый и ждёт завершения отменённого прохода. Все S3 запросы получают abortSignal; локальная очистка проверяет отмену между файлами и непосредственно перед unlink. Текущая локальная файловая операция должна завершиться — shutdown не выдаёт преждевременный успех. Флаг по умолчанию остаётся выключенным. Защита Media, вложений, ссылок, PDF-сигнатуры и возраста сохранена.

Красные тесты: exit 1, 7 passed / 2 failed. После изменения очистка, планировщик и unified-worker: exit 0, 20 passed / 0 skipped. Проверены отмена зависшего S3 listing, destroy клиента, остановка таймеров, существующие ограничения удаления. GitNexus impact/detect-changes exit 1 (CLI недоступен, UNKNOWN); текстовые зависимости и diff проверены. `git diff --check`: exit 0.

## F7 — ревью дневных правок Hermes перед слиянием

Проверен полный список `git diff b67fefb6..hermes/q4-0926 -- src/`; новые изменения относительно уже слитого в T5 `28265e0b` — 36 файлов. Изменения относятся к оболочке, доступным именам/клавиатуре, сообщениям отказов, Telegram, парку, отчётам и техготовности. Frozen operator*/ORION, auth/security, schema/migrations не изменены. Предварительный `git merge-tree --write-tree HEAD hermes/q4-0926`: exit 1, три смысловых конфликта: equipment-detail, use-equipment-list, fleet-dashboard-template.test. При разрешении сохраняются версия карточки/409 из E4, новые сообщения и onSaved Hermes; обе группы тестов мониторинга.

В ревью отмечено: проверка `window.open(..., ''noopener'')` в журнале инструктажей может ошибочно объявлять блокировку, потому что noopener возвращает null и при открытом окне. Проверка настоящим браузером и исправление после слияния. Несущественные ограничения: XLSX пустота пока определяется только при наличии серверного заголовка; `catchText` трактует TypeError как сетевой сбой. Большие файлы и повторяющиеся сообщения не рефакторились.

Слияние: конфликтов осталось 0; версия `expectedUpdatedAt`, перечитывание после 409, новый `extractApiError`, `onSaved` и все группы тестов сохранены. Затронутые тесты после объединения: exit 0, 28 files / 235 passed / 0 skipped (`output/codex-t6/f7-merge-tests.log`). Graph detect-changes exit 1 (CLI недоступен); ручной анализ staged diff и зависимостей, diff-check exit 0. Chromium до исправления печати: `returnedNull=true, popupOpened=true`, exit 0 — ложный тост подтверждён.

### F7: исправленная регрессия печати Hermes

Chromium подтвердил: noopener возвращает null даже при открытом окне. Теперь синхронно открывается пустое окно, при null сообщается реальная блокировка; иначе opener обнуляется до перехода на печатную форму. Красный тест exit 1 (1 passed / 1 failed), зелёный exit 0 (2 passed / 0 skipped). GitNexus impact/detect exit 1, UNKNOWN; текстовые зависимости и diff проверены, diff-check exit 0. Настоящий браузерный сценарий печати включён в F8.

## F8 — выполненные проверки

Стенд: собственный `codex-pg-*`, все 107 миграций, роль `pilingtrack_identity`, два отдельных `codex-redis-*` (state/cache), приватный `codex-s3-*` с HTTPS proxy и проверкой PUT/GET/DELETE. Пароли и ключи генерируются только в памяти; на диск сохраняется только публичный CA, удаляемый supervisor. Собственные ADMIN/DISPATCHER/OPERATOR/ASSISTANT и роли создаются в этой базе. Production не используется.

- Первый tsc: exit 2, ошибка cast Promise resolve → EventListener в новом тесте F6№12. Исправлено на callback `() => resolve()`; повтор tsc exit 0. Первый build exit 1 на той же ошибке, supervisor очистил стенд. Повторный `npm run build` exit 0; приложение `next start` production и unified workers запущены. После добавления всех тестов `npx tsc --noEmit` (эквивалент `node node_modules/typescript/bin/tsc --noEmit`) exit 0. `.next/dev/types` перед первым запуском безопасно удалён только внутри рабочего дерева.
- `npm run lint`: exit 0, ESLint 0 errors/0 warnings и Text integrity passed. Финальный повтор после тестовых изменений — журнал `f8-lint-final.log`.
- Первый полный `npm run test:unit`: exit 1, 3126 passed / 1 failed / 250 skipped, 339 passed files / 1 failed / 14 skipped. Старый тест ожидал прямой compose up в workflow, который F6№8 специально заменил барьером. Тест теперь проверяет build → smoke → barrier, наличие внешнего подтверждения и отсутствие прямого up. Повтор полного Vitest: exit 0, 3127 passed / 250 skipped, 340 passed files / 14 skipped, всего 3377 tests / 354 files. Пропуски не выданы за выполненные интеграционные тесты.
- `vitest --config vitest.integration.config.ts` на настоящем codex-pg: exit 0, 10 files / 204 passed / 0 skipped. Включает реальные RLS/DB транзакции F2/F3 и предыдущие M6–M8/E2–E4.
- Дополнительный F2 red на сохранённом маршруте T5: exit 1, новый DB-тест failed, 4 прочих теста намеренно не выбраны (`-t F2:`). После восстановленной связи старый route вернул 503 вместо 200. Текущий route точно восстановлен (`git diff --exit-code`:0); зелёный F2 входит в полный PG прогон выше. Проверены новая опубликованная строка с attempts=0 и receipts A/B, сохранённые старый outbox с attempts=5 и настоящая pending DLQ.
- Production metrics: до F6№7 четыре пробы давали lag timestamp=0 / health age=-1 (exit 0 у диагностического скрипта, это не успех freshness). Теперь строгая проверка exit 0: четыре пробы за 45s, health age 7.059–7.078s, lag timestamp увеличивается 1791042643.798 → 1791042683.937. Проверяется возраст обоих снимков ≤90s и обновление timestamp.
- Logout: сетевое выключение собственного Redis дало timeout ответа 45s, exit 1; Docker stop/start поменял динамический опубликованный порт. Redis восстановлен на исходном фиксированном порту. Этот опыт не считается зелёным. Отдельный настоящий отказ SET (`CONFIG SET min-replicas-to-write 1`) на том же собственном Redis: exit 0, API503, видимый русский тост, дашборд/сессия сохранены; после возврата настройки в finally выход API200 и экран входа. Auth/security/rate-limiter source не менялись. Полный сетевой отказ может задерживать запрос до слоя revoke — остаётся ограничением проверки/риском, точный источник задержки не доказан.
- `npx playwright test --list` (эквивалент `node node_modules/@playwright/test/cli.js test --list`): exit 0, 117 tests / 12 files; база T5 108, добавлено 9 (3 сценария × 3 браузерных проекта). Итоговый полный прогон завершён; результат и таблица ниже. F4 браузерная проверка тестирует реальную кнопку/отправляемый configId, HTTP конфигураций и тест-ответ подменены; серверные guards отдельно проверены route/service тестами. F7 печать использует настоящую BriefingRecord в своей базе, row удаляется в finally.
- `docker build --pull=false -f Dockerfile.workers --target runner -t codex-workers-t6:f8 .`: exit 0. `bash scripts/smoke-workers-image.sh codex-workers-t6:f8`: exit 0, старт и Arming подтверждены.
- `bash scripts/test-worker-generation.sh`: exit 0, 6 PASS / 0 FAIL; реальные Node SIGTERM app143, worker143, live one-off, preflight, partial START rollback, failed drain rollback. Свои контейнеры/сети/тестовый тег удалены скриптом.
- `node scripts/test-deploy-workflow.cjs`: exit 0, локальный SSH shim, сеть/SSH сервер не использованы.

Сохранившиеся предупреждения: Next build сообщает об отсутствующем optional @valkey/valkey-glide (build exit 0, пакет не добавлялся); production `MaxListenersExceededWarning` stack ведёт в Next compiled compression/httpxy. Собственный SSE wrapper из E0c не в этом stack. Не исправлялся зависимостями/CSP/заглушением warning; остаётся ограничением T5. Vitest worker tests дают process-listener warnings; pg adapter — предупреждение о параллельных query на одном клиенте. Проверки не называют эти warnings lint errors.

### F8: ошибки нового браузерного теста и исправление сида

Первый полный Playwright: exit 1, 105 passed / 3 failed / 9 skipped (117). Все три отказа — новый сценарий печати в трёх проектах; KPI/Telegram и прежние сценарии прошли. Диагностический повтор только печати: exit 1, 3 failed; настоящий bootstrap вернул `503: Tenant settings are not configured`. Канонический адрес журнала — `/admin/safety?view=briefings`; переход с `/admin/to` исправлен в тесте, но причина API503 отдельно доказана.

Сид T5 создавал Tenant, но не TenantSettings. Тестовый сид `e2e/fixtures/disposable-seed.mjs` теперь создаёт настройки обоих собственных тенантов, как это уже делал role-audit fixture. В работающую собственную базу добавлены те же строки отдельной защищённой командой (localhost/codex_test/piling/codex-pg guard); существующие данные не перезаписывались. Продуктовый bootstrap сохраняет отказ при отсутствующих настройках, ответ не подменён. Impact CLI exit 1 UNKNOWN; найден единственный caller test-day-stand. Повтор печати и итоговый полный Playwright приведены ниже.

## Перед выкладкой владельцу

- Новых миграций в T6 нет. `git diff --name-only b67fefb6..HEAD -- prisma/migrations` пуст: эта ветка не добавляет миграций и относительно релизной базы. Схема и миграции не редактировались. На тестовом PostgreSQL применены все существующие 107 миграций.
- Перед сменой поколения проверить/остановить внешние экземпляры workers, затем подтвердить это через `WORKER_GENERATION_EXTERNAL_STOPPED=1`. App и workers обновляются вместе. Команда: `WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers`. Флаг строго первым, `ws` не добавлять. Ничего из этой команды не выполнялось на сервере.
- GitHub ручная выкладка тоже требует explicit external_workers_stopped=true, проходит общий барьер и сохраняет rollback image tags до build. Локальная проверка workflow использует shim SSH.
- PDF_TEMP_CLEANUP_ENABLED по умолчанию остаётся выключенным. Если владелец решит включить: сначала dry-run (PDF_TEMP_CLEANUP_DRY_RUN по умолчанию true), проверить журнал кандидатов, затем отдельно разрешить удаление. Очищаются только временные UUID PDF старше 30 дней, не фотографии/Media/вложения.
- Постоянно сломанные Telegram-каналы теперь отключаются с причиной в label. После исправления бота/чата администратор должен включить канал и при необходимости отредактировать label. Если все каналы сломаны, событие не выдаётся за доставленное.
- Alertmanager repeat_interval в observability (critical 1h, остальные 4h) должен оставаться согласован с временными окнами в webhook. Повтор у границы окна может дать дубль: это соответствует решению владельца «дубль лучше потери».
- F1 возврат фиксирует image/restart/число реплик, но при удалённых контейнерах использует текущий compose/env/volumes/command. Изменение топологии/env одновременно с таким релизом требует отдельной проверки владельца. При недоступном Docker/неостанавливаемом новом поколении скрипт сообщает OUTAGE; ручную аварийную команду выполнять только после проверки отсутствия параллельных RUNNING.

## Что оставлено без изменений

Защищённые auth/security/RLS/rate-limiter/CSRF, schema/migrations, Docker/compose, исходники operator*/ORION не менялись; выполнялись их существующие e2e. SECURITY-коммиты F4/F6№9 затрагивают HTTP route/клиентское поведение и не меняют модель доверия. У deploy-prod изменены только два комментария шапки. Нет удалённых файлов/экспортов: отдельное доказательство «не используется» не требуется. Удалённые Hermes кнопки UI не обещали реально существующие операции; их функции/файлы не удалялись. Устаревшие инструкции выкладки заменены по F5. Новых пакетов и изменений версий нет. Push/SSH/production deploy не выполнялись.

Риски/непроверенное: GitNexus недоступен, все graph команды exit 1 и risk UNKNOWN — использованы разрешённые task fallback rg и diff, не выдано за green graph. Реальное время многомегабайтной загрузки Telegram через production Cloudflare не замерялось; проверены 6s unit delay и 30s/45s budget. Сетевой Redis outage в дополнительном опыте не подтвердил быстрый ответ logout; проверка настоящего отказа записи прошла. Сохранились Next compression/httpxy close-listener warnings и указанное выше optional-module warning. Общие TypeError-тексты и XLSX без row-count header — ограничения Hermes, без рефакторинга соседнего кода.

### F8: повтор полного набора требует новой базы

Печать после дополнения сида: отдельный Chromium exit 0 / 1 passed. Следующий полный Playwright на той же БД: exit 1, 107 passed / 1 failed / 9 skipped. F4/F6/F7 прошли во всех трёх проектах, включая настоящий bootstrap и печатную запись. Единственный отказ — прежний T5 key path при INSERT draft: `Report_user_site_date_without_shift_key`. Прежний первый прогон сохранял свои отчёты в одноразовой БД (в finally закрывает соединение); повтор всего набора на той же базе не предусматривался. Продуктовый индекс/код/тестовые assertions не ослаблялись, чужие строки не удалялись. Для воспроизводимого полного итогового прогона запускается новая собственная база и новый стенд с исправленным сидом.

Просмотрены PNG KPI (Chromium) и печати (Mobile Safari): производственные плитки показывают недоступность, независимые данные отображаются; документ содержит свою строку. Это не проверка всей широкой печатной таблицы на мобильном экране.

## Коммиты T6

Один логический фикс — отдельный коммит; no-ff merge Hermes содержит исходные дневные коммиты. Финальный коммит отчёта указан в сообщении владельцу.

| Commit | Изменение |
|---|---|
|28898142|(CODEX-F1) Возвращать старое поколение при отказе барьера и проверять настоящий SIGTERM|
|576990ec|(CODEX-F2) Создавать новую попытку алерта после DLQ|
|9ff444c0|(CODEX-F3) Отключать постоянно недоступный Telegram-чат и сохранять повторы временных ошибок|
|e2803183|(CODEX-F4) SECURITY Проверять выбранный Telegram-канал в организации пользователя|
|91005228|(CODEX-F5) Согласовать команды выкладки и возврата поколения во всех инструкциях|
|b3320b02|(CODEX-F6) Доставлять плановые напоминания Alertmanager в новых временных окнах|
|f12534cb|(CODEX-F6) Дать загрузке PDF отдельный бюджет без истечения транзакции receipts|
|d575a1fc|(CODEX-F6) Делить health и lag snapshots между instrumentation и API bundles|
|4ecd6e3e|(CODEX-F6) Не позволять GitHub выкладке обходить внешний и compose барьеры|
|dce0b38b|(CODEX-F6) SECURITY Не сообщать об успешном выходе без записанного отзыва сессии|
|9f8b8720|(CODEX-F6) Показывать недоступность производственных KPI при сбое аналитики|
|409c457b|(CODEX-F6) Продолжать пересчёт тренда после удаления объекта|
|d240a5fe|(CODEX-F6) Отменять очистку временных PDF при остановке воркера|
|eba3cf3a|(CODEX-F7) Записать ревью новых дневных правок Hermes|
|4fab0117|(CODEX-F7) Слить дневные правки Hermes с сохранением проверки версий|
|803dea4f|(CODEX-F7) Не сообщать о блокировке успешно открытого окна печати|
|966265ac|(CODEX-F8) Дополнить одноразовый сид и проверить реальные отказы|

## Изменённые файлы относительно b1d988e8

Таблица включает слитые изменения Hermes. Числа — добавленные/удалённые строки по git diff --numstat; удалённых файлов нет. Пути относительно D:\PillingR\wt-codex6.

| Файл | + | − |
|---|---:|---:|
|.claude/skills/deploy/SKILL.md|40|64|
|.github/workflows/deploy.yml|27|17|
|CLAUDE.md|1|1|
|CODEX-REPORT-T6.md|301|0|
|docs/runbooks/008-manual-deploy.md|24|45|
|docs/runbooks/016-release-2026-10.md|7|7|
|e2e/fixtures/disposable-seed.mjs|1|1|
|e2e/release-critical-path.spec.ts|56|0|
|scripts/deploy-prod.sh|2|2|
|scripts/replace-worker-generation.sh|107|48|
|scripts/test-deploy-workflow.cjs|39|0|
|scripts/test-worker-generation.sh|87|54|
|src/app/(app)/__tests__/layout.test.tsx|93|0|
|src/app/(app)/layout.tsx|63|53|
|src/app/api/alerts/webhook/__tests__/route.test.ts|35|2|
|src/app/api/alerts/webhook/route.ts|15|4|
|src/app/api/auth/logout/__tests__/route.test.ts|42|4|
|src/app/api/auth/logout/route.ts|4|2|
|src/app/api/notifications/telegram/test/__tests__/route.test.ts|51|0|
|src/app/api/notifications/telegram/test/route.ts|13|2|
|src/components/piling/__tests__/admin-dashboard.test.tsx|14|1|
|src/components/piling/__tests__/admin-telegram.test.tsx|136|0|
|src/components/piling/admin-dashboard.tsx|3|3|
|src/components/piling/admin-equipment/__tests__/equipment-mobile-targets.test.tsx|137|1|
|src/components/piling/admin-equipment/admin-equipment.tsx|1|1|
|src/components/piling/admin-equipment/detail/__tests__/equipment-detail-overview.test.tsx|133|2|
|src/components/piling/admin-equipment/detail/equipment-detail.tsx|14|5|
|src/components/piling/admin-equipment/detail/equipment-photos.tsx|16|5|
|src/components/piling/admin-equipment/detail/equipment-report-export.tsx|65|5|
|src/components/piling/admin-equipment/equipment-filters.tsx|5|4|
|src/components/piling/admin-equipment/equipment-table.tsx|13|1|
|src/components/piling/admin-equipment/use-equipment-list.ts|4|6|
|src/components/piling/admin-reports/__tests__/admin-reports.test.tsx|111|0|
|src/components/piling/admin-reports/__tests__/report-filters.test.tsx|32|0|
|src/components/piling/admin-reports/admin-reports.tsx|22|2|
|src/components/piling/admin-reports/report-filters.tsx|3|3|
|src/components/piling/admin-reports/report-thumbnail.tsx|17|2|
|src/components/piling/admin-sites/site-editor/__tests__/plan-section-field-labels.test.tsx|41|0|
|src/components/piling/admin-sites/site-editor/drilling-plan-section.tsx|3|0|
|src/components/piling/admin-sites/site-editor/pile-plan-section.tsx|3|1|
|src/components/piling/admin-telegram.tsx|67|9|
|src/components/piling/inspections/__tests__/inspection-messages.test.tsx|18|0|
|src/components/piling/inspections/inspection-item-photos.tsx|16|5|
|src/components/piling/maintenance/__tests__/maintenance-messages.test.tsx|18|0|
|src/components/piling/maintenance/__tests__/maintenance-mobile-targets.test.tsx|22|0|
|src/components/piling/maintenance/maintenance-board.tsx|5|5|
|src/components/piling/maintenance/work-order-photos.tsx|16|5|
|src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx|70|1|
|src/components/piling/monitoring/fleet-dashboard.tsx|39|9|
|src/components/piling/to/readiness/screens/__tests__/briefings-screen.test.tsx|78|0|
|src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx|39|0|
|src/components/piling/to/readiness/screens/__tests__/safety-screen.test.tsx|101|1|
|src/components/piling/to/readiness/screens/briefings-screen.tsx|10|1|
|src/components/piling/to/readiness/screens/employee-card.tsx|4|7|
|src/components/piling/to/readiness/screens/knowledge-screen.tsx|2|2|
|src/components/piling/to/readiness/screens/safety-overview-screen.tsx|8|12|
|src/components/piling/to/readiness/screens/shared.tsx|7|0|
|src/core/notifications/__tests__/telegram.test.ts|69|8|
|src/core/notifications/telegram.ts|53|23|
|src/core/observability/__tests__/health-tracker.test.ts|10|0|
|src/core/observability/__tests__/lag-monitor.test.ts|7|0|
|src/core/observability/health-tracker/tracker.ts|6|4|
|src/core/observability/lag-monitor.ts|7|5|
|src/lib/api.ts|11|2|
|src/lib/pdf-generator/__tests__/cleanup.test.ts|22|0|
|src/lib/pdf-generator/cleanup.ts|12|5|
|src/modules/reports/application/projections/projection-worker.ts|1|1|
|src/workers/__tests__/projection-worker.test.ts|16|1|
|src/workers/__tests__/workers-image-smoke.test.ts|4|1|
|src/workers/unified-worker/__tests__/pdf-cleanup-scheduler.test.ts|23|2|
|src/workers/unified-worker/pdf-cleanup-scheduler.ts|14|5|
|tests/integration/disposable-m6-m8.spec.ts|55|0|

## F8 — итог на чистом стенде

Итоговый полный `npx playwright test --workers=2 --reporter=list` через disposable-https fixture: exit 0, 108 passed / 9 skipped / 0 failed, 117 tests / 12 files, 7.0m. Новые F4/F6/F7 прошли во всех трёх проектах: Chromium, Mobile Safari, Mobile Chrome. Отчёт → отправка → проекция/KPI → PDF воркером, ТО и подтверждение удаления, семь ролей, существующие operator/ORION и мобильные сценарии выполнены на новой собственной БД. Девять прежних условных пропусков (повтор desktop key paths на mobile, Safari rate/photo/editor ограничения) не выданы за passed; новых skip нет.

Финальные доказательства: `output/codex-t5/f8-playwright-fresh-result.json` содержит exit 0, полный журнал рядом `f8-playwright-fresh.log`; PNG KPI и печати сохранены в `test-results/release-critical-path-*`. Bootstrap и печатная запись настоящие, только сценарии отказа аналитики и отправки выбранного configId используют описанную выше HTTP подмену. Финальный production build после исправления сида также exit 0 (`output/codex-t5/stand-build.log`, `output/codex-t6/f8-fresh-manager.log`).

| Проверка | Exit | Итог |
|---|---:|---|
| Безопасное удаление собственной .next/dev/types перед первым tsc | 0 | Только внутри wt-codex6 |
| npx tsc --noEmit | 0 | Финальный literal npx.cmd, f8-npx-tsc-final.log |
| npm run lint | 0 | 0 errors / 0 warnings, text integrity passed |
| npm run test:unit | 0 | 3127 passed / 250 skipped; 340 files passed / 14 skipped |
| npx playwright test --list | 0 | Финальный literal npx.cmd:117 tests / 12 files |
| npm run build | 0 | Финальная сборка с seed TenantSettings, production Next |
| Vitest integration config, реальный codex-pg | 0 | 204 passed / 0 skipped, 10 files |
| Полный Playwright, свежий одноразовый стенд | 0 | 108 passed / 9 skipped / 0 failed, 7.0m |
| Docker build workers runner | 0 | codex-workers-t6:f8, без новых зависимостей |
| bash scripts/smoke-workers-image.sh codex-workers-t6:f8 | 0 | Start + Arming |
| bash scripts/test-worker-generation.sh | 0 | 6 PASS / 0 FAIL, реальный Node SIGTERM |
| node scripts/test-deploy-workflow.cjs | 0 | Локальный shim, без SSH/сети |
| Строгая production metrics freshness проверка | 0 | 4 samples, обе метрики обновляются |
| Logout при реальном отказе записи собственного Redis | 0 | 503 сохраняет UI, восстановление → 200/login |
| GitNexus detect-changes --scope all --repo . | 1 | CLI недоступен, UNKNOWN; fallback rg+diff |
| git diff --check | 0 | Нет whitespace ошибок |
| Supervisor stop / очистка своего стенда | 0 | CLEANUP done; собственный PG удалён shell trap |
| Удаление двух собственных временных image tags | 0 | Только codex-workers-t6:f8 и codex-s3-t5:e7 |
| Проверка удаления контейнеров/портов/CA | 0 | codex-* список пуст,50180/50181 не слушают, CA отсутствует |

Supervisor остановлен штатной командой stop после успешного Playwright; его собственные процессы app/workers и HTTPS proxy закрыты. Собственные PG/Redis/S3 контейнеры удалены, публичный CA удалён; временные теги codex удалены. Контейнеры/теги pilingtrack не изменялись. Сохранены только игнорируемые журналы, тестовые helper scripts и визуальные доказательства; секреты на диск не сохранялись. Рабочая ветка остаётся codex/night-1004, push/merge в main/выкладка не выполнялись.

Несущественные ограничения ревью Hermes, оставленные по E6:

| Область | Ограничение | Решение |
|---|---|---|
| XLSX export | Пустой набор определяется клиентом только при серверном row-count header | Не изменять соседний контракт вне задачи |
| catchText / TypeError | Общий текст сетевого отказа также может скрывать иную TypeError | Записать для ревью; массовый refactor не выполнять |
