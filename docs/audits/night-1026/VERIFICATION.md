# Текущие проверки UI и сквозных цепочек, 28 октября 2026

Прикладная сборка: **44126b987c9dd02b0bbefe28e8094f282b94aaf0**. Unit/type/lint выполнялись в worktree86358ae3; последующие изменения — только E2E и отчёты. Пустой git diff прикладных src/prisma/package*/next.config.ts подтверждён перед повторным использованием сборки. Это не новая сборка позднего тестового SHA.

| Команда / сценарий | Exit | Passed / failed / skipped | Время |
|---|---:|---|---|
| npm run build |0|Production-сборка44126, HTTP health подтвердил SHA|143 с|
| npx tsc --noEmit |0|.next/dev/types проверен/удалён перед запуском|19 с|
| npm run lint |0|Zero warnings, text integrity passed|65 с|
| npm run test:unit -- --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=…/full-unit-fresh.json |0|**5776 / 0 / 0**, 512 файлов|831,50 с Vitest / 873 с wrapper|
| npx playwright test --list через disposable-qa |0|384 теста / 30 файлов; BASE318 / 28, тоже exit0|38 с wrapper|
| Пять канонических версий × три браузера × одна/две установки |0|**30 / 0 / 0**, flaky0, 30CLOSED/30уникальных отчётов|1178 с|
| V3: шесть legacy-отчётов + три selector |0|**9 / 0 / 0**, flaky0|168 с|
| Существующие critical paths на совершенно свежем стенде |0|**6 / 0 / 0**, flaky0, cleanup=true|58 с|

Все241 ранее пропущенных теста найдены по пути и полному имени и прошли в том же полном JSON. Новый повтор всех unit из-за E2E-only не нужен. После E2E выполнены отдельные tsc/lint/list — результаты ниже.

Сырые данные: night-ui-final-gates-results.json, night-ui-final-validated-summary.json, full-unit-night-ui-final.json/log, unit-night-ui-final-result/public.json, night-ui-final-playwright-*-list.*, canonical-thirty-final-raw/, v3-nine-final-2-raw/, critical-fresh-final-raw/. Freshness-validator: exit0. Временные unit/list/critical PG, Redis и HTTP-процессы очищены; рабочий3100 не использован.

## Новые сквозные цепочки

Результаты и команды — CROSS-ROLE.md/json. Это разные синтетические аккаунты OPERATOR, DISPATCHER, MECHANIC, ADMIN и SAFETY_ENGINEER, без режима «Действую как». Первые красные попытки нового harness сохранены: отсутствовало ожидание окончания транзакции чек-листа; ожидался другой URL PUT; exact-label не учитывал подсказку; формат чисел не совпал с существующим formatCountMeters. Ожидания SQL, авторов, статусов и чисел не ослаблялись. Новых дефектов приложения в этих попытках не доказано.

Ниже сохранена история предыдущих полных RED/GREEN. Слова «последний/ожидается» внутри истории относятся к тому снимку, а не текущему состоянию.

---

# Проверки ветки и причины красных запусков

## Исторический результат 27 октября, код 1b0a2663

Проверки выполнены последовательно на собственной одноразовой инфраструктуре. Ниже — последний полный запуск, а не сумма выборочных зелёных повторов.

| Команда / сценарий | Exit | Результат |
|---|---:|---|
| npx tsc --noEmit |0|24 с; .next/dev/types отсутствовал|
| npm run lint |0|137 с, zero warnings, проверка целостности текста прошла|
| npm run test:unit -- --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=…/full-unit-fresh.json |1|**5775 passed / 1 failed / 0 skipped**, 512 файлов, 981 с вместе с созданием и очисткой стенда|
| npx playwright test --list |0|354 теста, 30 файлов; исходная база: 318 тестов, 28 файлов, exit0|
| npm run build |0|260 с; настоящий host production build 1b0a2663|
| Семь ролей × три браузера |0|21 passed / 0 failed / 0 skipped, 661 с|
| Полный цикл v7, одна/две установки × три браузера |0|6 passed / 0 failed / 0 skipped, 333 с|
| V3 достижимость выбора объекта после CSS-правки |0|3 passed / 0 failed / 0 skipped, 54 с; до правки 2 passed / 1 failed / 0 skipped, exit1|
| C3 CRUD на совершенно свежем стенде |0|1 passed / 0 failed / 0 skipped, 52 с|

**Последний полный unit красный.** Единственный файл: tests/integration/tech-readiness-work-permits.spec.ts, сценарий 20-way approval race. При конкуренции tryClaim иногда возвращает P2010/23505 по legacy-ограничению IdempotencyKey_scope_key_key. Дубли approval/audit/outbox в этом тесте не обнаружены: упала проверка допустимых ошибок. На неизменённой исходной базе efd95008 ошибка воспроизведена вторым повтором того же теста: первый 1 passed, второй 1 failed; по три остальных сценария намеренно отфильтрованы. Это существующая гонка main, а не доказанная регрессия ветки. HTTP 500 отдельно не воспроизводился.

Все **241 исторический пропуск найдены и passed даже в последнем красном полном прогоне**. Детали нового дефекта, точечное предложение и ограничение AGENTS — PERMIT-IDEMPOTENCY-RACE.md. Код tryClaim не менялся; ожидается ответ владельца на исключение из заморозки tenancy. Зелёные полные прогоны до этого (5776/0/0) ниже сохранены как история, они не заменяют последний RED.

Сырые источники: full-unit-v3-final.json, unit-v3-final-result.json, permit-race-baseline-results.json, permit-race-base-2.json, roles-v3-final.*, v7-cycle-v3-final.*, v3-selector-green.*, c3-v3-final.*, playwright-default-list.*, host-build-v3-final.* во внешней папке D:/PillingR/night-logs/night-evidence-1026/. Для инфраструктуры последнего unit cleanup=true, cleanupErrors=[].

После этих проверок расширен только существующий E2E-сценарий для v10. Полный v10: **6 passed /0failed /0skipped,exit0,274с**, три браузера × одна/две установки. После изменения harness tsc exit0/17с, lint exit0/73с,zero warnings. Полный default-config Playwright через disposable-qa fixture: **360 тестов/30файлов,exit0**; BASE с той же процедурой318/28,exit0; wrapper39с,cleanup=true. Приложение по-прежнему1b0a2663: повторять тяжёлый fullunit ради E2E-only изменений не стали, его последний RED выше сохранён.

Отдельный обычный npx playwright test --list без disposable fixture дал354/30,exit0/4с: он использовал стандартную QA matrix. Синтетический wrapper дополнительно регистрирует6 retained-V3 fixture cases. Сравнение списков подтвердило ровно это различие; тесты не удалялись. Для сравнения ветки с BASE используем одинаковую одноразовую процедуру360 против318. Rawv10-collection/ иplaywright-list-v10.*.

GitNexus force-index exit0:257с wrapper,72,2с анализатор;33469узлов,72699связей. Общая генерация flows предупреждает об обрезанном бюджете, поэтому отсутствие flow не используется как доказательство безопасности. Конкретные detect scopeall и compareBASE завершены без partial/truncated: all13changed/0affected,LOW;compare55changed/7affected,HIGH. Семь цепочек ведут через уже исправленный OperatorDashboardV3; HIGH сохранён и ранее сообщён владельцу. Сырые detect-v10-all.json/detect-v10-compare.json. Anonymous E2E callbacks граф не раскрывает целиком; их проверка — реальный браузер и assertions БД.

---

## История предыдущих запусков (не последний итог)

База: `efd95008eac3bc846c89003c4b7766f2eb5c1c9b`. Рабочая ветка: `codex/night-evidence-1026`. Код приложения после `7e3aa7e` не менялся; в `fa0f8c3d` исправлены только нормальные тестовые строки outbox.

## Полный unit/integration

Команда:

```text
npm run test:unit -- --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=D:/PillingR/night-logs/night-evidence-1026/full-unit-fresh.json
```

Результат: **exit 0; 5776 passed / 0 skipped / 0 failed; 512 файлов**. Время Vitest: 815,41 с. Весь запуск с подготовкой отдельного PostgreSQL, Redis, HTTP-приложения, предварительной проверкой и очисткой: 857 с. Все 241 исторических пропуска найдены по пути и полному имени в этом же JSON: 241 passed, ни одного отсутствующего.

Стенд создан внешним `D:/PillingR/night-logs/night-evidence-1026/unit-fresh-stand.cjs`. PostgreSQL 18 с полным `migrate deploy` и app/identity grants; два собственных Redis; настоящий HTTP-сервер из host production build `7e3aa7e`. Встроенные и отдельные фоновые потребители на этой БД выключены, чтобы они не забирали события у тестов. Некоторые тесты, включая новый outbox-набор, дополнительно создают собственный PostgreSQL.

В HTTP-приложении сохранены настоящие настройки одноразового стенда, включая identity-role и S3. Unit-процесс получает действующие адреса своей БД, Redis и HTTP, но не настройки работающего приложения: `DB_IDENTITY_ROLE`, `NODE_ENV`, S3-переменные, session/lookup secrets, proxy/host/port, worker flags и E2E-учётки исключены из его окружения. Vitest сам устанавливает обычный тестовый режим. Это не отключает DB/HTTP-gates и не меняет права HTTP-приложения. Предварительный запуск шести затронутых файлов: 64 passed / 0 failed / 0 skipped, exit 0.

Повтор: поднять штатный одноразовый supervisor `runner.cjs` и его `scripts/test-day-stand.cjs`, затем передать `unit-fresh-stand.cjs` как команду дочернего стенда. Пароли генерируются fixtures; их нельзя копировать в `.env` или отчёт. Скрипт удалил только свои новые контейнеры и HTTP-процесс: `cleanup=true`, ошибок очистки нет.

## Первый полный красный запуск

`full-unit-final`: exit 1, 840 с; **5744 passed / 26 failed / 6 skipped**, 512 файлов. Этот запуск использовал уже заполненную браузерными и RLS-фикстурами БД и унаследовал runtime identity-role от supervisor.

| Файл | Failed | Причина и действие |
|---|---:|---|
|`src/workers/__tests__/projection-worker.test.ts`|4|Нормальные mock-строки содержали tenant только в payload, но не в канонической колонке. После разрешённого guard такой вход отклоняется. Пяти нормальным строкам добавлен тот же `tenant-1`; утверждения не менялись. Явный tenantless PG-сценарий сохранён. Коммит `fa0f8c3d`.|
|`src/services/auth/__tests__/auth-service-credentials.test.ts`|12|Унаследованный `DB_IDENTITY_ROLE` включал настоящий transaction-adapter поверх mock-db без `$transaction`. Файл и код auth не правились.|
|`src/services/auth/__tests__/auth-service-login-rate-limit.test.ts`|3|Та же несовместимость runtime-настройки и mock-db; код и тесты не правились.|
|`src/services/auth/__tests__/auth-service-session.test.ts`|1|Ожидалась ошибка bcrypt, но выполнение раньше падало на отсутствующем mock `$transaction`; код и тесты не правились.|
|`src/services/telemetry/__tests__/device-key-service.test.ts`|6|Тот же identity-role adapter в моках; код и тесты не правились.|
|`tests/integration/disposable-scripts.spec.ts`|0, но suite failed|Шесть реальных сценариев J7 не исполнились: защитная подготовка отказала при уже существующем `orion`. В этой собственной БД его имя было `RLS spec tenant`. Удалять его ради зелёного результата или ослаблять проверку не стали. На свежей БД все 18 сценариев файла прошли.|

Все 22 auth/device-падения воспроизведены на точном архиве исходного `efd95008`, с теми же lockfile-зависимостями и сгенерированным клиентом неизменённой схемы: 27 passed / 22 failed / 0 skipped, exit 1. Полные имена 22 ошибок совпали с веткой один к одному. Четыре проекционных сценария на исходном коде проходили. После нормализации пяти фикстур и отделения runtime role от mock-unit окружения выбранные пять файлов дали 49 passed / 0 failed / 0 skipped, exit 0. Ни один auth/security/RLS-файл ради этого не менялся.

Архив исходников находится в `unit-base/` рядом с логами. Он не содержит `.env`; `node_modules` и `src/generated` там являются junction на установленный набор данной рабочей папки. Их нельзя удалять рекурсивно без проверки junction.

## Ошибки вспомогательного запуска, не выдаваемые за успех тестов

Первый запуск на свежей БД завершился exit 1 из-за неверной передачи Windows-пути JSON-отчёта через Bash (`ENOENT` при создании каталога). Тесты дошли до завершения, но надёжные passed/failed из этого запуска не сохранены. Зелёным он не считается. Логи и результат сохранены как `unit-fresh-report-path-error.*`.

Следующая попытка была остановлена после обнаружения унаследованного S3 access key. Существующий тест отсутствия credentials восстанавливает исходное окружение и потому ошибочно видел реальный ключ тестового MinIO. Это исправлено отделением окружений, без изменения тестового ожидания. Частичный запуск сохранён как `unit-fresh-app-env-partial.*`; он не является полным прогоном.

Для окончательного запуска путь нормализован, одновременно включены обычный и JSON reporters, а unit-процесс отделён от runtime-настроек. Полный успешный результат приведён первым, исходные ошибки не удалены.

## Дополнительная настоящая доставка уведомлений

```text
node --test tests/integration/notifications/delivery.integration.mjs
```

Exit 0, 55 с; **6 passed / 0 failed / 0 skipped**. Реальные PostgreSQL, Redis, HTTP-сокеты и отдельные процессы; Telegram заменён только собственным HTTP-получателем на loopback, не mock-SQL.

Проверены параллельный dedupeKey, перекрытие разных ключей, реальная отмена медленного HTTP-запроса, неоднозначный исход после принятия сообщения и обрыва сокета, авария polling worker и повтор уже подтверждённой строки. Тесты подтверждают возможность дубля при неоднозначном ACK; гарантии exactly-once для Telegram нет.

Этот набор оставляет свои строки в БД для исследования. Для повтора нужна отдельная одноразовая БД без фоновых потребителей. Собственные 12 `NotificationDeliveryRequested` и единственная тестовая `TelegramConfig` из первоначального запуска удалены с проверкой фиксированного marker tenant; чужие строки не затрагивались. Измерения находятся в `output/notify-tx-1023/measurements.json`, команда и exit — во внешнем `notifications-delivery-night.result.json`.

## Остальные проверки

| Проверка | Зафиксированный результат | Граница |
|---|---|---|
|`.next/dev/types`|Отсутствует, удаление не понадобилось|Проверен путь этой рабочей папки|
|`npx tsc --noEmit`|Exit 0, 16 с|После него менялся тестовый браузерный harness; нужен заключительный повтор|
|`npm run lint`|Exit 0, 66 с; zero warnings, text integrity passed|Нужен заключительный повтор после всех тестовых/документальных правок|
|Host `npm run build`|Exit 0, 203 с, source `7e3aa7e`|Все четыре изменения приложения включены; позже менялись тесты и отчёты|
|Playwright|См. ROLES-WALKTHROUGH.md|Есть исходные красные и частичные прогоны; полный цикл шести вариантов ещё не доказан|
|Полный `playwright test --list`|Ожидается|Ограниченный night config не заменяет полный сбор|
|Docker app/workers build + smoke|Ожидается|Должны быть из `origin/main` `efd95008`, отдельно от ветки исправлений|

Не запускались push, merge, deploy, SSH, production-запросы к базе, миграции разработки/reset/db push. Схема, миграции и зависимости не менялись. Настройки окружения не записывались в `.env` и не включены в отчёт. Сам Vitest-config умеет читать `.env` при наличии; именно поэтому использовалась отдельная папка без него.

Повтор delivery на совершенно свежих PG18+Redis: 6 passed /0failed /0skipped, exit0; 54 с сами тесты, 78 с wrapper. notifications-fresh.result.json: cleanup=true, cleanupErrors=[]. Внешняя доставка по-прежнему не проверялась.

Docker main: app build exit0 360с, workers build exit0 43с; workers smoke exit0 9с; совместный запуск и prod:smoke exit0 145с wrapper, 13/13. Полные сведения и исходная ошибка внешней internal network — IMAGES.md.

Заключительный unit после review-portabilityfix: 5776 passed/0failed/0skipped,512files,exit0;908с Vitest/978с wrapper. Реальные5PGoutbox и10clearance входят в этот полный запуск. Linux executable-selection: RED2passed2failedexit1 → GREEN4passed0failedexit0; настоящий Linux PG-прогон отдельно не проводился. Заключительный npx tsc --noEmit: exit0,22с.

## Проверка сохранения v7 после добавления v10

Сценарий f154f8b4: Chromium, одна/две установки —2passed/0failed/0skipped,exit0/59с. Полный v7 across3browsers6/0/0 остаётся отдельным предыдущим прогоном того же приложения1b0a2663. Rawv7-after-v10-regression/. Это повтор после изменения общего E2E-body, не замена исходного полного6.

## После добавления основного /operator

E2E сохранён в58a2b64f; приложение по-прежнему1b0a2663. Основной /operator:6passed/0failed/0skipped,exit0/279с (Chromium,MobileSafari,MobileChrome;single/multiple). После изменения E2E: npx tsc --noEmit exit0/17с; npm run lint exit0/75с,zero warnings,text integrity passed. Сбор default-config Playwright через собственную одноразовую QA-фикстуру:366тестов/30файлов,exit0;тот же BASE318/28,exit0;wrapper38с,cleanup=true. Сырые operator-six-cycles/,operator-collection/,tsc-operator.*,lint-operator.*. Новых unit/app изменений нет: последний полный unit остаётся5775/1/0,exit1 по исходной гонке,не заменён выборочными зелёными.

GitNexus scopeall перед58a2b64f:3changed/0affected,4файла,LOW,безpartial/truncated (detect-operator-precommit.json). Нулевой affected для анонимного E2E callback не является доказательством отсутствия его вызовов; общие бизнес-assertions и реальный стенд проверены непосредственно.

## Очистка после сохранения доказательств

Сначала штатный stop branch24304 завершил app21208/worker792, затем stop parent31316 удалил свой MinIO/дваRedis, затем stop outer35488 удалил codex-pg-cc9926812e04 и codex-night-redis-cc9926812e04. Все пять PID отсутствуют, docker ps --filter name=codex- пуст; cleanup.json:cleaned=true. Порты своих app/PG/Redis не слушают;3100 по-прежнему слушает рабочий процесс9852. Рабочие контейнеры/данные не затрагивались. Повтор требует нового одноразового supervisor, живых проверок больше нет.

## Полная проверка исправления f51b0f30

Все команды выполнены отдельно и последовательно на собственной инфраструктуре. **Ни один тест не переписан ради этой правки.**

| Команда / проверка | Exit | Результат |
|---|---:|---|
| npm run build |0|Стенд вывел BUILD exit0; HTTP /api/health вернул200 и version=f51b0f30465c0273905853d0e1e8bc333a9ee0e5. Отдельное время команды не измерялось|
| npx tsc --noEmit |0|31с; перед ним проверен и очищен только путь .next/dev/types этой рабочей папки|
| npm run lint |0|75с, zero warnings, text integrity passed|
| npm run test:unit -- --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=…/full-unit-fresh.json |0|**5776 passed /0 failed /0 skipped**,512файлов;856,05с Vitest,901с с подготовкой/очисткой стенда|
| Полный default-config Playwright --list через собственный disposable-qa wrapper |0|366тестов/30файлов;BASE318/28,exit0;37с wrapper,cleanup=true|

**241/241 исторических случая найдены по относительному пути и полному имени и passed в том же полном запуске.** Это не сумма focused-прогонов. JSON признан свежим только после проверки sourceBuildSha=f51 и времени записи после создания нового HTTP-стенда. Отдельный валидатор exit0.

Временные PG/Redis/HTTP для fullunit и collection очищены:cleanup=true,cleanupErrors=[]. Основной собственный supervisor остаётся жив для продолжения задачи6; рабочий3100 не затронут.

Сырые:full-unit-claim-fix.json,full-unit-claim-fix.log,unit-claim-fix-result.json,unit-claim-fix-public.json,claim-fix-gates-results.json,claim-fix-validated-summary.json,claim-fix-build-health.json,claim-fix-playwright-default-list.log,claim-fix-playwright-base-list.log. Старый RED5775/1/0 сохранён отдельно как full-unit-v3-final.json,baselineRED как permit-race-base-2.json.

Старые21ролевой и18полных операторских сценариев относятся к приложению1b0a2663. Их не выдаём за повтор наf51. Новый fresh-review не дублировался.


## Последние E2E-only проверки

| Проверка | Passed / failed / skipped | Exit | Время wrapper |
|---|---|---:|---|
|Chromium: полный v2 + диспетчер/ОТ; отдельная цепочка ремонта|2 / 0 / 0|0|86 с|
|Ремонтная цепочка во всех трёх браузерах|3 / 0 / 0|0|172 с|
|Все семь ролей × три браузера на текущем приложении|21 / 0 / 0|0|749 с|
|npx tsc --noEmit после изменений E2E|—|0|19 с|
|npm run lint после изменений E2E|Zero warnings|0|124 с|
|npx playwright test --list, одинаковая disposable-процедура|387 тестов / 30 файлов против BASE318 / 28|0 / 0|40 с|

Retries=0; flaky=0. Полный unit ранее прошёл на той же прикладной сборке:5776/0/0. После него менялись только E2E и отчёты, поэтому unit/build повторно ради E2E не запускались.


Подробности и ограничения — CROSS-ROLE.md/json.


## Текущий C1–C3 на сборке44126b98, 28 октября

Chromium, совершенно свежие собственные PG18/два Redis/HTTP, другой набор fixtures. Все три существующих сценария прошли: **3 passed / 0 failed / 0 skipped**, exit0;32,2с Playwright/67с с подготовкой и очисткой. cleanup=true,cleanupErrors=[]. C1:создание справочника,архивация/отмена и массовая архивация. C2:создание объекта,статус «Выполнен»/отмена,деактивация с подтверждением и удаление. C3:диспетчер создаёт,правит и удаляет свой отчёт. Доказательство ограничено assertions существующих сценариев, не каждымCRUD приложения.

Сырьё crud-current-raw/qa-195-results.json,artifacts/ и run/;команда и exit — crud-current-result.json и crud-current-tests.log. Состояния авторизации не копировались в доказательный архив. Исходный полный QA68 остаётся53/14/1;этот focused3 не считается повтором68.


## История графа до обнаружения повреждённого индекса

Эти формальные LOW/0affected впоследствии признаны ненадёжными:инкрементальный индекс возвращал посторонние связи. Полное перестроение восстановило данные;актуальные результаты приведены ниже. Исходный индекс перед fa2:33 508 узлов,72 752 ребра,566кластеров,1 225потоков. Финальные detect(scope=all) и compare(BASEefd95008) завершились exit0,partial=false,truncated=false;сырые полные ответы detect-final-docs.json/compare-final-branch.json. В документальном снимке 31 изменённая секция в 18 файлах,compare78символов/54файла;оба LOW/0affected. Ноль affected не означает отсутствие влияния: анонимные E2E и часть нового Markdown не разрешены индексом.

Перед fa2 privatechecklist имелUNKNOWN;текст подтвердил только локальные вызовы в одном тесте,после добавления8мест. После обновления точный helper не разрешился;это остаётсяUNKNOWN. Один поисковый запрос вернул повреждённые отображаемые filePath у части определений;по ним выводы о приложении не делались. Зависимости цепочек сверены исходниками и реальным SQL/HTTP,не нулём графа. Полный ответ detect сохранён без усечения;усечение вывода терминала не применялось как доказательство. Нового прикладного изменения вfa2 нет.


## Последние проверки после полного осмотра механиком

| Проверка | Exit | Passed / failed / skipped | Время |
|---|---:|---|---|
| Весь inspection-to-flow.spec.ts: Chromium, Mobile Safari, Mobile Chrome |0|**12 / 0 / 0**, flaky0; 3 новых +9 прежних|214.3с PW / 246с fresh wrapper|
| npx tsc --noEmit |0|—|15с|
| npm run lint |0|0 ошибок / 0 предупреждений|62с|
| npx playwright test --list |0|390 тестов / 30 файлов против BASE 318 / 28; оба exit0|37с wrapper|


Полный предыдущийunit5776/0/0 иbuild44126не повторялись:E2E-only изменение. Первые12прошли с1предупреждением нового теста;текущий повтор12/0/0 и lint0/62с уже без предупреждений. Details:MECHANIC-INSPECTION.md/json.


## Актуальный граф после полного перестроения

Повреждение подтверждено двумя путями:LocalBackend и штатный CLI отдавали requirePageAbility с посторонними apiCall/accesses и без правильного UID/filePath. Полное node .gitnexus/run.cjs analyze --index-only --force завершилось exit0/120с. Новый индекс:33 535узлов,72 806рёбер,567кластеров,1 225потоков. Затем context дал правильный Function:src/lib/require-page-ability.ts:requirePageAbility,15реальных вызовов из раскладок/страницы и can/readPageSessionUser;они совпали с текстом исходников. Результат до перестроения context-page-ability-cli-before.log,после context-page-ability-after.log. Старые LOW/0affected не используются как доказательство отсутствия влияния.

На восстановленном индексе detect(scope=all) для нового механического теста/отчётов:exit0,LOW; compare(BASEefd95008):exit0,HIGH,7затронутых потоков OperatorDashboardV3 (FetchWithTimeout,Cleanup,GetCurrentResetTimeout,FormatEntry,ShouldLog,IsSensitiveKey,GetMinLevel). HIGH заранее сообщён владельцу перед последующими изменениями. Это уже существующая правка CSS вV3,покрытая9браузерными сценариями на44126b98;все отказные ветви этим не доказаны. Последнее изменение добавляет тесты/отчёты. Impact узла файла E2E остаётсяUNKNOWN0:текст подтверждает динамический вход через playwright.night.config.ts и nightly-e2e.yml;тест не удаляется и не считается неиспользуемым.

Полные ответы detect-mechanic-fresh.json/compare-mechanic-fresh.json:partial=false,truncated=false. Ограничение самого построения процессов сохраняется:2 567candidate entrypoints не вошли в1 225flows,часть обходов ограничена глубиной/ветвлением. Отсутствующий flow не означает отсутствие кода. Реальная проверка зависимостей дополнена исходниками/SQL/HTTP и тестами, а не числом0. Анализ не менял AGENTS/CLAUDE или прикладные файлы.
