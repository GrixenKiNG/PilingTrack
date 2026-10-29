# Недостающие сценарии ролей — 29.10.2026

Ветка codex/roles-gaps-1029, база 17f235e54d4bb25bbde047929005a8fd612e685f. Сценарии и проверенная сборка: c1b6fc3f905d8c2eb7adeb02d7487ef6309a4a72. Приложение, schema/migrations, auth/RLS, зависимости не менялись.

**18 passed /0 failed /0 skipped /0 flaky**, exit0, 300с. Шесть сценариев × три настроенных профиля. Это Chromium desktop, WebKit iPhone и Chromium Android: два движка, три профиля, без Firefox и без физических телефонов. Firefox в окружении не установлен. Не объявлять это тремя независимыми движками.

## Что доказано

1. Администратор меняет пароль через реальную форму /admin/users. SQL sessionVersion увеличился ровно на1; исходный cookie из UI сохранён в отдельном контексте без фонового polling и получил401. Вход новым паролем через форму прошёл, /api/auth/me подтвердил того же пользователя; старый пароль из отдельного браузерного контекста вернул401. В FeedbackEvent есть user.updated от этого ADMIN к этому OPERATOR. Пароли/cookies не сохранены в отчёт/артефакты.
2. Семь предметных типов удостоверений из scripts/seed-user-document-types.ts прочитаны как данные, без исполнения dotenv/DB entrypoint. Добавлен восьмой произвольный бессрочный вид, чтобы проверить настраиваемый справочник. Все8 заведены ADMIN через HTTP из браузера с requiredForOperator=true только в своих fixtures; затем документы OPERATOR созданы тем же публичным API. Для каждого из7 срочных видов проверены MISSING→VALID→EXPIRED→EXPIRING→VALID в /api/operator/mobile/state; окончания подтверждены независимым SQL. /api/user-documents/control показывает ровно одну просрочку/истечение на соответствующем шаге и пустеет после продления. У бессрочного SQL expiresAt=NULL, verdictVALID, в attention он не появляется.
3. Все7 enum-видов документов установки созданы через UI: PASSPORT, OTS, INSURANCE, INSPECTION, CERTIFICATE, MAINTENANCE_LOG, OTHER. Выбор типа сверён со всем generated enum; дата2020-01-02 даёт видимое «Истёк…», тип и дата подтверждены SQL. Для каждого срок продлён через UI, SQL и DOM подтвердили результат; после reload остаются все7 записей. Влияние на персональные документы замерено отдельно: /api/user-documents/control и identity.documents того же оператора остаются прежними.
4. Двенадцать чувствительных route templates проверены для OPERATOR/MECHANIC/DISPATCHER в каждом профиле:108 отказов403/404. Перед ними7 GET целей прогреты реальным ADMIN другой fixture-организации:63 положительных200, поэтому отказ не подменён несуществующим id. После каждого отказа SQL-снимок9 бизнес-таблиц совпал с исходным; это включает чтения и попытки PUT/POST.

Для этих маршрутов код явно ограничивает tenant/родителя/владельца. Проверка не отменяет платформенные права ADMIN/DISPATCHER на других маршрутах и не классифицирует их законный глобальный доступ как дефект. Две организации — собственные disposable fixtures, не рабочие данные.

## Матрица чужих id

В каждой ячейке — наблюдённые статусы всех трёх профилей; SQL неизменен во всех108 проверках.

| Маршрут | OPERATOR | MECHANIC | DISPATCHER |
|---|---|---|---|
|GET /api/equipment/:id|404|404|404|
|GET /api/equipment/:id/details|403|404|404|
|GET /api/equipment/:id/device-keys|403|403|403|
|PUT /api/equipment/:id/documents/:documentId|403|403|403|
|GET /api/maintenance/:id|403|404|404|
|GET /api/inspections/:id|404|404|404|
|GET /api/checklist-templates/:id|403|404|404|
|GET /api/users/:id/documents|403|403|404|
|PUT /api/users/:id/documents/:documentId|403|403|403|
|POST /api/briefings/:id/sign|404|404|404|
|PUT /api/sites/:id|403|403|404|
|PUT /api/crews/:id|403|403|404|

## Два семейства документов

EquipmentDocument — паспорт, ОТС, страховка и прочие реквизиты установки. UserDocument/UserDocumentType — удостоверение конкретного человека. Контроль /api/user-documents/control читает UserDocument и сроки его типа (src/modules/users/user-documents.ts:115), а личный допуск OPERATOR строит checkOperatorDocuments (src/modules/operator-mobile/domain/operator-admission.ts:59; mobile-shift-query.ts:111). Создание просроченного паспорта установки не создаёт просроченного удостоверения человека — это подтверждено HTTP/SQL/DOM.

Восемь типов человека — полный созданный для этой проверки предметный справочник (7из текущего source catalogue+1динамический). Настраиваемые production-типы не читались; нельзя объявлять проверенными все когда-либо заведённые пользователями виды. Автоматические служебные документы инструктажа/проверки знаний имеют отдельные команды; данный тест не заменяет их полный цикл.

Control — список внимания диспетчера, не команда открытия смены. Здесь проверены сроки и document-verdict личного допуска; фактический OPEN_SHIFT для каждого типа, полный общий work-permit с СИЗ/инструктажом/осмотром и блокировка по документам установки не проверялись. Сканы/загрузка файлов удостоверений также не проверялись: работа шла с реквизитами.

## Изменения

- e2e/roles-gaps.spec.ts — новый файл, 324строк. Исключение AGENTS §5 применимо: он защищает смену пароля/отзыв сессии и операции с чужими id. Runtime guards не изменялись.
- playwright.night.config.ts — 26→26строк, добавлено одно имя в testMatch. Остальные сценарии/проекты сохранены.
- docs/audits/night-1026/ROLES-GAPS-1029.md/json — отчёт и структурированные доказательства.

Ничего не удалено. equipment.document.updated не исследовался и не добавлялся: вопрос оставлен решению владельца. Новых дефектов приложения эти сценарии не воспроизвели; рабочий код не исправлялся.

## Проверки одного SHA c1b6fc3f905d8c2eb7adeb02d7487ef6309a4a72

| Команда | Exit | Результат |
|---|---:|---|
| npm run build |0|229с; health.version совпал с SHA|
| Playwright roles-gaps, night config, trace off |0|18passed/0failed/0skipped/0flaky;300с|
| npx tsc --noEmit |0|51с; .next/dev/types удалены перед командой|
| npm run lint |0|67с|
| npm run test:unit -- --maxWorkers=1 --no-file-parallelism |0|6029passed/0failed/0skipped;529файлов;851с wrapper|
| npx playwright test --list |0|429тестов/31файл; исходно411/30, добавлено18/1|

Каждая тяжёлая проверка выполнена отдельно и последовательно. Fresh npm ci --ignore-scripts:0/748пакетов/audit0; отдельная генерация Prisma7.10.1:0. Фиктивный URL был только inline-окружением этой отдельной команды, в setup/файлы он здесь не записывался. .env не читался/не создавался. Все DB/Redis/MinIO — собственные disposable; stand3100 не затронут. Fresh PG полного unit отдельный, без конкурирующего worker.

Эта ветка от main не содержит отдельную warnings-ветку: предупреждение старого Vitest configLoader и unit-worker MaxListeners здесь известны по исходной базе, не скрыты. Исправление конфига находится в codex/warnings-1029, поэтому здесь6029unit, не6030; дополнительные48 coverage-тестов и23 equipment-теста также принадлежат своим независимым веткам. Совместная сборка всех веток не проверялась и без команды владельца не создавалась.

## GitNexus и доказательства

До записи tests выполнены собственный index/impact/detect. Новый файл not-found UNKNOWN; config file UNKNOWN. Они подтверждены текстом: default testDir=e2e, night explicit testMatch, новый auth-spec до работы отсутствовал. Ни одна функция приложения не редактировалась. До коммита tests — force-index/context и complete detect all/compare; перед отчётным коммитом повторяются полные graph gates без partial/truncated. Нулевые callers/affected не названы доказательством безопасности.

Внешняя папка D:/PillingR/night-logs/roles-gaps-1029: initial-browser.json/log/result, initial-raw (точная копия scenario/JSON/PNG), browser-verified.json (18 разобранных case attachments), test-source-proof.json, final-gates-results.json, finish-result.json, full-unit-final.json. SQL/body доказательства в attachments password-reset-proof/personnel-catalogue-proof/equipment-catalogue-proof/foreign-id-proof. Собственный stand удаляется после окончания с before/after proof.

Просмотрены три сохранённых full-page PNG после продления документов установки (desktop, Mobile Safari, Mobile Chrome). Это визуальная сверка сохранённых состояний; пиксельная регрессия и физические устройства не проверялись. Полный существующий браузерный набор не исполнялся: запущены18 новых случаев, а429 — число собранных тестов, не число прошедших E2E.
