# Бригада: формы, назначения, аудит и деактивация

Прикладная сборка **44126b987c9dd02b0bbefe28e8094f282b94aaf0**. Проверенный тест SHA256 **ac31c348ec2ba07e0ddc27b817db8400fcaa8044d4886b84a762f19614f10470**. HEAD при проверке f938298c9fcdab0611ff0c1361176be01e1756b8 с добавленным сценарием; код приложения, схема и зависимости не менялись.

**3 passed / 0 failed / 0 skipped**, flaky0. Chromium, Mobile Safari и Mobile Chrome выполнили один и тот же новый сценарий. Это три теста с несколькими проверками внутри.

|Команда / сценарий|Exit|Время|
|---|---:|---:|
|Playwright: новый сценарий бригады, три браузера|0|291 с|
|npx tsc --noEmit|0|17 с|
|npm run lint|0|70 с|
|npx playwright test --list: default и BASE|0|39 с|

Playwright: 258.2с; свежий wrapper 291с. Lint без предупреждений. Коллекция 396 тестов / 30 файлов против BASE 318 / 28, оба exit0. Временные PG18/дваRedis/app/worker и ресурсы отдельной коллекции удалены: cleanup=true/errors[]. Родительский собственный MinIO остаётся для очереди. Полный unit5776/0/0 и build44126 сохранены в VERIFICATION.md, ради E2E-only не повторялись.

## Что выполнено через интерфейс

1. ADMIN открыл «Добавить бригаду», выбрал машиниста, установку и объект, ввёл уникальное название и выбрал помощника. POST200. SQL подтвердил точные operatorId/equipmentId/siteId/isActive и CrewAssistant с userId/снимком имени.
2. Через «Редактировать» изменены название, установка и объект; помощник снят через диалог состава. PUT200, SQL сохранил новые связи и пустой roster. В состоянии того же OPERATOR новый equipment/site появился среди options, прежняя свободная установка исчезла. Это проверка штатного API состояния оператора; выбор новой установки через его формы этим не объявляется доказанным.
3. MECHANIC вошёл другой сессией, увидел изменённую бригаду в UI. Кнопок добавления, изменения и деактивации нет. Прямые PUT с валидным name и DELETE дали403; строка и бизнес-аудит crews не изменились.
4. ADMIN открыл деактивацию: до подтверждения DELETE не отправлялся. «Отмена» сохранила активность без запроса. Повторное подтверждение отправило ровно один DELETE200; строка Crew сохранилась с isActive=false. Из API options оператора эта бригада исчезла.
5. ADMIN активировал ту же строку кнопкой «Активировать»: PUT200/isActive=true; назначение вернулось в options оператора. Проверка выполнялась реальными отдельными аккаунтами, без «Действую как».

## Записи и сохранность истории

Для проверки сохранности заранее создан один собственный синтетический исторический draft Report, связанный с машинистом, первоначальной установкой и объектом. Его поля id/userId/equipmentId/siteId/status буквально совпали до деактивации, после неё и после активации. Создание этого draft сделано fixture-SQL, не выдаётся за отправку отчёта через форму; настоящая отправка оператора подтверждена отдельными30полными циклами.

FeedbackEvent:ровно crew.created→crew.updated→crew.deleted→crew.updated; у всех actorId данного ADMIN. Метаданные редактирования содержат прежнюю/новую установку и помощника до/после. crew.deleted имеет deactivated=true. В OutboxEvent сохранены CrewCreated/CrewUpdated/CrewEquipmentAssigned/CrewAssigned/CrewDeactivated/CrewReactivated. Здесь доказана запись событий, не внешняя доставка и не обработка каждого из них воркером.

Исходные тела существующего release-critical-path.spec.ts сохранены побайтно; добавлен отдельный тест в том же файле. Новых тестовых файлов, skips и ослаблений проверок нет. Первый focused Chromium также прошёл1/0/0,exit0/105с wrapper (72,9с Playwright); приложение не исправлялось, RED дефекта приложения не получен.

## Границы

Не проверены браузером смена самого машиниста, конкурентные записи/409, повторная активация занятой установки, отключённый/удалённый помощник и все сочетания tenant/assignment. MECHANIC проверен на чтение и отказы; роли FOREMAN/SAFETY_ENGINEER и кастомные матрицы этим сценарием отдельно не покрыты. Техническое состояние машины и готовность не выводятся из одной активности бригады. Другие CRUD и внешние системы остаются в ACTION-COVERAGE.md.

Сырьё: D:/PillingR/night-logs/night-evidence-1026/crew-probe-raw/ и crew-final-fresh-raw/; crew-final-pipeline-result.json, отдельные логи tsc/lint/list. Повтор на своём disposable стенде: node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --config=playwright.night.config.ts e2e/release-critical-path.spec.ts --grep "crew lifecycle:". Credentials только из RAM fixtures; .env не использовался.

## GitNexus и финальный контроль

Полная переиндексация --index-only --force:exit0/142с. Контрольный context requirePageAbility:правильный UID/путь,15настоящих callers. File-impact нового сценария UNKNOWN/0 подтверждён текстовым подключением release-critical-path.spec.ts в playwright.night.config.ts и nightly-e2e.yml; исходные тела тестов не менялись.

Полные all/compare до staging новых отчётов:exit0;all={"changed_count":18,"affected_count":0,"changed_files":6,"risk_level":"low"};compare={"changed_count":189,"affected_count":7,"changed_files":59,"risk_level":"high"}. Флагов partial/truncated нет. Список семи HIGH-потоков побайтно сопоставлен по именам с предыдущим снимком:OperatorDashboardV3 → FetchWithTimeout/Cleanup/GetCurrentResetTimeout/FormatEntry/ShouldLog/IsSensitiveKey/GetMinLevel. Пользователь предупреждён перед последующими правками отчёта. Девять V3-сценариев зелёные на44126, все ветви отказа не доказаны. Глобальные ограничения обхода execution flows не являются доказательством отсутствия остальных связей. Повреждённые старые incremental-снимки не используются.

После последнего изменения отчётов и staging выполняется ещё один полный all/compare перед коммитом; реальные финальные счётчики — detect-crew-staged.json/compare-crew-staged.json. Полные логи/JSON и crew-final-graph-results.json сохранены во внешней evidence-папке.

Git нормализует CRLF только в новой добавке теста. Проверенный файл имеет SHA256 ac31c348ec2ba07e0ddc27b817db8400fcaa8044d4886b84a762f19614f10470; Git-blob — 98098fad25e52b1331ad692dec560b24cfd0d3654cf3aab2142498b6e42cd81e. Полное содержимое буквально совпадает после CRLF→LF; исходный префикс прежних тестов в обоих вариантах совпадает побайтно с HEAD. Проверка crew-line-ending-proof.json сохранена отдельно. Это нормализация окончаний строк, не изменение выражений или проверок; runtime-результаты выше привязаны к исходным сохранённым байтам.
