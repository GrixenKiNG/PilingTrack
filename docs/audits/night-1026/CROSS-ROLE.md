# Сквозные цепочки на реальных UI, PostgreSQL и worker

Сборка приложения **44126b987c9dd02b0bbefe28e8094f282b94aaf0**, тестовый коммит **fa2de8ec394b86dba29eb2861d0252a1416c647c**. В прикладных src/prisma/package*/next.config.ts дельта относительно сборки пустая. Продолжение 27–28 октября использовало новый собственный PG18 codex-pg-454e6b1d5f12:58831, два Redis, MinIO и HTTP62919. Рабочий3100 не трогали. Секреты fixtures существуют только в памяти. Старый завершённый стенд повторно не запускался с утраченными credentials.

| Проверка | Passed / failed / skipped | Exit | Время wrapper |
|---|---|---:|---|
|Chromium: полный v2 + диспетчер/ОТ; отдельная цепочка ремонта|2 / 0 / 0|0|86 с|
|Ремонтная цепочка во всех трёх браузерах|3 / 0 / 0|0|172 с|
|Все семь ролей × три браузера на текущем приложении|21 / 0 / 0|0|749 с|
|npx tsc --noEmit после изменений E2E|—|0|19 с|
|npm run lint после изменений E2E|Zero warnings|0|124 с|
|npx playwright test --list, одинаковая disposable-процедура|387 тестов / 30 файлов против BASE318 / 28|0 / 0|40 с|

Retries=0; flaky=0. Полный unit ранее прошёл на той же прикладной сборке:5776/0/0. После него менялись только E2E и отчёты, поэтому unit/build повторно ради E2E не запускались.

## Отчёт оператора → диспетчер → инженер ОТ

Оператор в браузере прошёл весь канонический цикл v2. Диспетчер вошёл под другим fixture-аккаунтом, открыл именно его отчёт в /admin/reports, затем /monitoring и /admin/analytics. Мониторинг вернул для конкретной установки 2сваи/24м,1скважину/3м,0,25ч простоя; карточка этой установки видна. API аналитики вернул эти числа для конкретного userId; строка UI показывает «2 шт. / 24 м.п.».

Инженер ОТ вошёл своей сессией и открыл /admin/to?view=incidents. Он увидел происшествие конкретной установки и записал вывод. Проверены reviewedById, reviewNote, reviewedAt в SafetyIncident и точный actorId/action=incident.reviewed в FeedbackEvent. Переключение фильтра на «Все» показало сохранённый разбор. Для того же incidentId существует NotificationDeliveryRequested в OutboxEvent. Это доказательство постановки в очередь, не доставки Telegram.

## Дефект осмотра → механик → администратор → готовность

Оператор отметил реальный пункт предсменного UI «Крюковая обойма: замок исправен» как «Отказ», описал учебный отказ и завершил осмотр. Одна транзакция создала EquipmentDefect HIGH/OPEN с настоящим reportedById и связанную MaintenanceRecord REPAIR/PLANNED. Worker по OPERATOR_CHECKLIST_COMPLETED создал ReadinessScoreSnapshot: осмотр завершён, healthScore<100, findings>0; evidence ссылается на этот OperatorChecklistExecution и открытый ремонт.

Механик открыл журнал дефектов в /admin/to?view=maintenance&equipmentId=…, взял запись в работу с её нарядом. Через /admin/maintenance/:id назначил себя, описал работы и перевёл наряд «В работе» → «Выполнено». SQL подтвердил DONE, workDone и closedById механика. Администратор отдельной сессией принял наряд; acceptedById точный. Дефект всё ещё IN_WORK: приёмка наряда не закрывает дефект автоматически.

Механик вернулся и нажал «Закрыть после ТО», описал результат. EquipmentDefect стал CLOSED/version3 с его resolvedById; AuditLog содержит точные defect.triage/version2 и defect.resolve/version3 с тем же actorId. Worker создал другой снимок по DEFECT_CHANGED/defectId:v3:resolve. Открытый ремонт исчез из evidence, ссылка на исходный осмотр сохранилась, как и его healthScore. Старый осмотр не переписан после ремонта. Полностью READY этим не обещается: действуют и другие правила/допуски.

Отказ осмотра создаёт HIGH, а не CRITICAL — существующее решение владельца; запрещать работу программой здесь нельзя. Тест не меняет это правило.

## Границы

Обход21 проверяет меню, страницы, доступные начальные вкладки, сетевые/JS-ошибки, прямой /admin/users, API users.read/запрещённый create, выход и замену сессии. Он не доказывает каждыйCRUD и каждый чужойURL. V3 остаётся отдельным legacy-процессом; вопрос№9 владельцу не решён самовольно. ВнешниеTelegram/MQTT/железо не проверены.

## Исходные RED и повтор

Все первые RED нового harness сохранены: defect-repair-first (не дождался завершения транзакции), defect-repair-wait (ждал /api/maintenance/:id вместо фактического equipment-scoped PUT), defect-repair-route (exact-label не учёл текст подсказки), dispatcher-downstream-first (новый тест ожидал иной формат чисел). SQL/статусы/авторы/числа и replay-assertions не удалялись. Исправлялся только тест. Приложение в этом продолжении не менялось.

Первый parent запускал встроенные потребители; перед финальной серией он остановлен. Финальный stand2 задаёт EMBEDDED_WORKERS=off, worker отдельный. Ошибка повторного запуска штатного seed на уже заполненной своей БД (duplicate Tenant_pkey) сохранена в cross-role-1027/stand2-seed-error; seed повторно не прогонялся, старые fixture-аккаунты не использовались. Каждый сценарий создаёт новые role fixtures.

Команды и реальные exits: cross-role-final-result.json, dispatcher-downstream-format-result.json, cross-role-three-result.json, roles-current-21-result.json. Сырьё: dispatcher-downstream-format-raw/, cross-role-three-raw/, roles-current-21-raw/. Tests остаются в e2e/night-operator-cycle.spec.ts; новых файлов тестов не добавлено.


## Текущий C1–C3 на сборке44126b98, 28 октября

Chromium, совершенно свежие собственные PG18/два Redis/HTTP, другой набор fixtures. Все три существующих сценария прошли: **3 passed / 0 failed / 0 skipped**, exit0;32,2с Playwright/67с с подготовкой и очисткой. cleanup=true,cleanupErrors=[]. C1:создание справочника,архивация/отмена и массовая архивация. C2:создание объекта,статус «Выполнен»/отмена,деактивация с подтверждением и удаление. C3:диспетчер создаёт,правит и удаляет свой отчёт. Доказательство ограничено assertions существующих сценариев, не каждымCRUD приложения.

Сырьё crud-current-raw/qa-195-results.json,artifacts/ и run/;команда и exit — crud-current-result.json и crud-current-tests.log. Состояния авторизации не копировались в доказательный архив. Исходный полный QA68 остаётся53/14/1;этот focused3 не считается повтором68.
