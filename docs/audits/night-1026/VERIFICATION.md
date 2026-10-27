# Проверки ветки и причины красных запусков

## Актуальный результат 27 октября, код 1b0a2663

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
