# ДЕФЕКТ: вторая назначенная установка недоступна в журналах

P3, функциональный отказ API. Проверено на прикладном SHA 451acce2b30e5130a9055e9d966edcf4a413ff67; HEAD отчётов 816e388acf80b725ef7512ccfd9566ab8e83ecdb. Исправление ещё не применено.

На свежем собственном PG18 созданы оператор, две активные назначенные ему установки и одна неназначенная того же tenant. Настоящий вход в Chromium, HTTP без моков. Паспорта обеих назначенных машин дают200, неназначенной404.

| Ресурс | Первая GET/POST | Вторая GET/POST | Неназначенная GET/POST |
|---|---|---|---|
|meter-readings|200/201|403/403|403/403|
|fuel|200/201|403/403|403/403|

SQL: одна MeterReading и одна FuelLog только у первой установки; recordedById совпадает с оператором. FeedbackEvent: meter.reading.added и equipment.fuel.created, actorId тот же. Для второй нет записей; для неназначенной лишних записей нет. Все12ответов собраны до положительного assertion.

Причина: getCrewForOperator выбирает первую бригаду пользователя без фильтра установки; два guard сравнивают её equipmentId с запрошенной. При двух назначениях первая бригада не доказывает отсутствие второго назначения. Это не подтверждение утечки или неисправности всех экранов оператора.

## Проверки и воспроизведение

Существующий e2e/release-critical-path.spec.ts, case equipment multiple:, Chromium, playwright.night.config.ts. Обёртка equipment-multiple-confirmed-red-fresh-stand.cjs создаёт собственные PG/Redis, запускает проверенную сборку451 и worker; реальные credentials только в RAM. Команда внутри: node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --config=playwright.night.config.ts e2e/release-critical-path.spec.ts --trace=off --grep 'equipment multiple:' --project=chromium.

Результат: exit1,0passed/1failed/0skipped/0flaky,34с wrapper / 6.077с Playwright. Cleanup=true,ошибок очистки нет. Полный raw: D:\PillingR\night-logs\night-evidence-1026/equipment-multiple-confirmed-red-raw; наблюдения и hashes — соседний JSON. Тела прежних тестов сохранены; сравнение с Git выполнено после нормализации CRLF в LF (рабочий файл содержит прежние CRLF).

Первый read-only RED сохранён equipment-multiple-read-red-raw. Следующая расширенная попытка остановилась на ошибке harness SQL: FeedbackEvent не имеет tenantId. Она сохранена equipment-multiple-writes-harness-red-raw и не считается доказательством записей. Исправлен только запрос аудита по scope и собственным targetId; текущий повтор подтвердил реальные HTTP/SQL результаты выше. Assertions не ослаблены.

Три прикладных файла побайтно совпадают с базой efd95008eac3bc846c89003c4b7766f2eb5c1c9b; это статическое сравнение. HTTP на исходной базе для этого нового сценария не запускался. Старый полный unit5783/0/0 и48браузерных случаев относятся к451 и прежним сценариям; новый случай красный и не скрыт skip. Полные unit/build не повторялись ради одного нового E2E.

## Влияние и границы

GitNexus привязан к D:/PillingR/wt-night-evidence-1026. Индекс при impact отставал на один коммит отчётов; прикладной код совпадает. getCrewForOperator: HIGH,6символов,2прямых guard,4GET/POST entrypoint,28flow hits. HIGH заранее сообщён владельцу. Текстовый поиск нашёл ещё динамический /api/crews/my, пропущенный графом. Полный impact equipment-multiple-impact.json, поиск equipment-multiple-callers.log.

Точечное предложение — PERMIT-EQUIPMENT-MULTIPLE.md. Нынешнее разрешение на девять строк GET паспорта не расширяется на общий query. Задача6 остаётся частичной.


## Новый RED: две назначенные установки, журналы топлива и моточасов

Подтверждено на451acce2: первая назначенная установка GET200/POST201 для обоих ресурсов; вторая GET/POST403; неназначенная4x403. Реальный Chromium и собственный PG18, SQL1MeterReading/1FuelLog и2audit сactorOP; чужих записей нет. Целевой сценарий0passed/1failed/0skipped/0flaky,exit1/34с; это новый открытый P3, не общий зелёный итог. Raw equipment-multiple-confirmed-red-raw; EQUIPMENT-MULTIPLE-RED.md/json. Общий query и два вызова не изменены, точечное разрешение запрошено в PERMIT-EQUIPMENT-MULTIPLE.md.

Перед RED-коммитом команды отдельно и последовательно:

|Команда|Exit|Секунды|
|---|---:|---:|
|npx tsc --noEmit|0|17|
|npm run lint|0|106|
|npx playwright test --list + BASE collection, собственная fresh wrapper|0|37|

Перед tsc удалён только .next/dev/types, если существовал. Lint без предупреждений. Коллекция 405/30 противBASE318/28; обаexit0. Полные unit/build не повторялись для одного E2E-only дополнения; полный5783/0/0 иbuild0/151с проверены на том же прикладном451, но не объявляют новый случай зелёным. Все прежние test bodies сохранены после нормализации прежних CRLF/LF.
