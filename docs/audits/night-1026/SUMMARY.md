# Доказательная ночь 26–27 октября 2026

Состояние на 27 октября, 14:42 МСК. Ветка **codex/night-evidence-1026**, база origin/main — `efd95008eac3bc846c89003c4b7766f2eb5c1c9b`. Код приложения проверен на **1b0a2663**; последние изменения E2E — **58a2b64f**. Прикладной код после 1b0a2663 не менялся.

| Задача | Статус | Результат и границы |
|---|---|---|
|1. Повтор 241 пропуска|Готово для всех 241|В последнем полном запуске все 241 найдены по файлу и полному имени и прошли. Вне этого реестра найден исходный конкурентный дефект main; весь unit остаётся красным|
|2. Отказы outbox|Готово|Пять реальных PG-сценариев, авария отдельного процесса, разрешённый tenant guard. Общий retry/backoff сохранён|
|3. Матрица допуска|Готово|10 случаев × 5 путей; решения совпали. Различия предупреждений не менялись|
|4. Образы и smoke|Готово|Main efd95008: app build0/360с, workers0/43с, workers smoke0/9с; совместный запуск и prod:smoke13/13, exit0; cleanup=true|
|5. Длинные файлы|Готово|15 отслеживаемых текстовых файлов: 7 прикладных, 8 тестовых; только чтение|
|6. Роли и все экраны оператора|**Частично**|7 ролей × 3 браузера:21/0/0. Полные /operator, v7, v10: по6/0/0. Полные v2/v3/v5, каждый CRUD и все сквозные цепочки не доказаны|
|7. Документы против кода|Готово в указанном объёме|42 утверждения обязательных категорий, 8 вопросов владельцу. Исправлены только очевидные пути/команды; архивы целиком не объявляются проверенными|

## ДЕФЕКТЫ

| Приоритет | Подтверждённый дефект | Состояние |
|---|---|---|
|P2|ASSISTANT получал403 общего bootstrap в «ТБ и допуски»|Исправлен0e3e2c9a, RED9b9cce5f; существующий личный экран, без расширения прав|
|P2|Outbox без канонического tenantId доходил до handler|Исправлен48aa4689 по точечному разрешению; retry/DLQ сохранены; старые строки не backfill|
|P2|20 конкурентных approval иногда получают raw23505 по legacy UNIQUE(scope,key)|**Не исправлен: ожидается точечное разрешение.** Та же ошибка воспроизведена на исходном main существующим неизменённым тестом|
|P3|FOREMAN-dashboard запрашивал закрытый список документов пользователей|Исправленbefa99f9 через существующее право users.documents.read_all|
|P3|Два S3-key helper без tenantId возвращали default-prefix|Исправлены7ad5d3bd; включены два существующих теста по разрешению. Вызовы в приложении не найдены; реальная утечка не заявляется|
|P3|V3 desktop: нижняя навигация перекрывала выбор объекта|Исправлен1b0a2663 одной CSS-добавкой; RED2mobile/1desktop → GREEN3. Это не полный цикл V3|

## Последние проверки

| Проверка | Exit | Результат |
|---|---:|---|
|npx tsc --noEmit после E2E-расширения|0|17с|
|npm run lint после E2E-расширения|0|75с, zero warnings, text integrity passed|
|Полный npm run test:unit на свежем PG/Redis/HTTP|**1**|**5775 passed /1 failed /0 skipped**, 512файлов, 981с вместе с подготовкой и очисткой|
|Полный Playwright --list с собственными одноразовыми QA-фикстурами|0|366тестов/30файлов; BASE той же процедурой318/28, exit0; wrapper38с, cleanup=true|
|Host npm run build|0|260с; приложение1b0a2663|
|Семь ролей в трёх браузерах|0|21 passed /0 failed /0 skipped, 661с|
|Полные циклы v7 /v10 /основного /operator|0 /0 /0|По6 passed /0 failed /0 skipped; 333с /274с /279с|
|V3: достижимость выбора объекта после исправления|0|3 passed /0 failed /0 skipped, 54с|
|Свежий focused C3 CRUD|0|1 passed /0 failed /0 skipped, 52с|
|Свежая доставка через собственный HTTP-получатель|0|6 passed /0 failed /0 skipped, 54с; реальный Telegram не проверялся|

Полные циклы — три браузера × одна/две установки. Проверены СИЗ, инструктаж, знания, приёмка, осмотры, ТБ, офлайн-запись двух свай, повтор clientCommandId без дубля, бурение3м, простой0,25ч, инцидент, ЕО, закрытый Report/Shift, аналитика2/3/0,25, audit, outbox и открытие отчёта диспетчером. Для v10 доказано принятие показанного назначения по умолчанию при двух вариантах; выбора другой установки в его форме нет.

Единственный failed полного unit — tests/integration/tech-readiness-work-permits.spec.ts, сценарий20-way approval race. На исходном efd95008 тот же23505 воспроизведён вторым повтором. Дубли approval/audit/outbox в этом тесте не обнаружены; HTTP500 отдельно не воспроизводился. Все241 исторических прошли даже в этом красном запуске. Предшествующие полные5776/0/0 сохранены как история и не заменяют последний RED. Предложение одной SQL-строки и причина необходимого разрешения — PERMIT-IDEMPOTENCY-RACE.md.

Первый свежий Chromium QA68 остаётся **53 passed /14 skipped /1 failed, exit1**. Устаревший email-контракт C3 исправлен по fixture-ID с проверкой скрытия контактов, focused повтор прошёл. Весь набор68 после исправления не повторялся. Все14 причин пропусков перечислены в QA-RUN.md.

## Очереди, ограничения и оставшаяся работа

Перед остановкой общего испытательного стенда сохранены **40 pending DLQ**:29 NotificationDeliveryRequested,5 ReportSubmitted без исходных данных синтетического отчёта и6 ReadinessSnapshotRequested без authoritative equipment. В worker наблюдалось «Telegram not configured». Внешняя доставка на браузерном стенде не настроена и не считается успешной; отдельные6 положительных delivery-сценариев использовали свежие PG/Redis и свой HTTP-получатель. Нельзя подменять закрытие отчёта доставкой уведомления. Политика ненастроенного канала — восьмой вопрос владельцу. Подробности OUTBOX.md.

Задача6 остаётся частичной: полные v2/v3/v5, паспорт сваи, каждый CRUD каждой роли, все чужие URL и цепочки дефект→ремонт→готовность / инцидент→инженер ОТ ещё не доказаны. Пробы различий DOM/кнопок нового harness сохранены отдельно и не названы дефектами приложения. Физическое оборудование, MQTT/датчики и реальные внешние получатели не проверялись.

GitNexus: полный detect перед каждым коммитом, без partial/truncated. Сравнение с BASE сохранило HIGH для7 цепочек через V3; владелец предупреждён, HIGH не переименован в LOW. Общая генерация flows ограничена бюджетом, анонимные E2E callbacks раскрываются не полностью: отсутствие связи не принимается за доказательство безопасности. Один независимый review прикладной дельты завершён, Important по переносимости PG-теста исправлен. Новые E2E-расширения не выдаются за новый независимый review всего HEAD.

Все свои стенды, workers, PG18/Redis/MinIO остановлены и удалены после сохранения доказательств. Работающий3100 не трогали. Push, merge, deploy, SSH, production-доступа не было; схема, миграции, зависимости, auth/security, ORION и версии оператора сохранены. .env не читались и не создавались. TryClaim не менялся без разрешения. Одноразовая автоматизация13-25 удалена.

Отчёты находятся в docs/audits/night-1026/. Сырые логи, JSON, скриншоты, точные сценарии и актуальная точка продолжения — D:/PillingR/night-logs/night-evidence-1026/. Полные команды и исходные красные запуски — VERIFICATION.md; файлы и строки — CHANGED-FILES.md. Это не разрешение на выкладку.

## Коммиты ветки

Ниже все коммиты до заключительного документального снимка. Актуальный список вместе с самим снимком: git log --reverse --format="%H %s" efd95008..HEAD.

- 17fd1277d3ee97b49b1f4736fd77aa8318a5097a test(storage): expose tenantless S3 key regression
- 7ad5d3bd7192b8976ce11113b68b54c93dbfe655 fix(storage): reject tenantless report and CSV keys
- 9b9cce5f08e1e5f2bd25d6b62e4aa0db3c65706a test(safety): reproduce blocked personal clearance for assistant
- 0e3e2c9ad87ad85f2948c98ea56cfae21a88021c fix(safety): render personal clearance for assistant without park bootstrap
- d7c2af5b6df4e7247dc3d9e67719d119c9ea1f16 test(dashboard): reject forbidden document control prefetch
- befa99f93b878199af8d23eae777e62fe78706fa fix(dashboard): respect document reading permission before fetch
- 05bc33fc147e58e3f3d36fd9cd3c75f04cb7f74c test(outbox): prove retries crash replay and tenantless processing on PostgreSQL
- 48aa4689b50e745325decf7ecab0f1b45e5a2d79 fix(outbox): require canonical tenant before invoking handlers
- 86b5101f5c45f13d03c3a26adb8bb5ae1e2ff7a3 test(safety): verify document clearance matrix across all consumers
- ac8dc9e58649f843c37458ead687d8e25a037396 test: align real Prisma fixtures with the runtime RLS adapter types
- 7e3aa7e15833f33a57ce2fa87c8acdd5bd3e318a test(e2e): walk role pages tabs API denials and session replacement
- 4e77e3667dba5db3ca1816f6e146c6109a3a0018 docs: correct notification source path and disposable browser commands
- 0653c6e5fea4728f2e3f000da405227458b3eba8 test(e2e): wait for hydrated readiness and include retained v3 fixture
- ff582e7e2d2e6c4c68144ce56d8d677bfffe45a6 docs(audit): record real integration outbox clearance and code evidence
- fa0f8c3dd2dc3c841452765adf3e15014dfe765d test(outbox): supply canonical tenants in normal projection fixtures
- 3f671dae5fd63f5d5329fe838f6945c0865e647a test(outbox): select platform shell for disposable PostgreSQL helpers
- ea22fd18dea34df804cdc14df60a1780d761000d test(e2e): select dispatcher report fixture by public user id
- f87c2b5000a2273a5efa56e9cf44b61febd48ffc test(e2e): verify role sessions, full v7 shifts and blocked v3 selector
- 1b0a2663d19c5d9f77e22f64882ba59c306bbf8c fix(operator-v3): retain bottom spacing above desktop navigation
- f154f8b400eaa04c789f4096c8da7bab45fe8f62 test: verify complete v10 operator shift on disposable stand
- 535485522b10c35bdfd49323ade47149bf219b9a docs: preserve night evidence, baseline race and verification limits
- 58a2b64f7a9437e6badbc1474bfb279ee95c5a18 test: exercise full primary operator shift and offline replay
