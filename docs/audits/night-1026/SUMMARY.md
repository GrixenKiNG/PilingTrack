# Доказательная ночь 26–27 октября 2026

Обновлено27октября18:35МСК. Ветка codex/night-evidence-1026,база origin/main `efd95008eac3bc846c89003c4b7766f2eb5c1c9b`. Последняя правка приложения **f51b0f30**:разрешённая одна SQL-строка. Push,merge и выкладки не было.

| Задача | Статус | Результат и границы |
|---|---|---|
|1. Повтор241пропуска|Готово|Все241 найдены и прошли в полном свежем прогоне5776/0/0 наf51|
|2. Отказы outbox|Готово|Пять PG-сценариев,авария отдельного процесса,разрешённый tenant guard;существующие тесты прошли и в полномf51|
|3. Матрица допуска|Готово|10случаев×5путей,решения совпали;предупреждения не унифицировались|
|4. Образы и smoke|Готово|Точный main efd95008:app0/360с,workers0/43с,workers smoke0/9с;совместный запуск и prod:smoke13/13 exit0,cleanup=true. Это образыmain,не ночной ветки|
|5. Длинные файлы|Готово|15текстовых файлов:7прикладных,8тестовых;только чтение|
|6. Роли и все экраны оператора|**Частично**|На1b0:роли21/0/0,полные /operator/v7/v10 по6/0/0. На новыйf51 это доказательство не перенесено. Продолжаются оставшиеся UI-сценарии;v2/v3/v5 и всеCRUD/цепочки пока не закрыты|
|7. Документы против кода|Готово в указанном объёме|42утверждения обязательных категорий,8вопросов;только очевидные пути/команды исправлены,архивы целиком не объявляются проверенными|

## ДЕФЕКТЫ

| Приоритет | Подтверждённый дефект | Исправление |
|---|---|---|
|P2|ASSISTANT получал403 общего bootstrap в «ТБ и допуски»|0e3e2c9a:существующий личный экран,без расширения прав;RED9b9cce5f|
|P2|Outbox без канонического tenantId доходил до handler|48aa4689 по разрешению;retry/DLQ сохранены,backfill не выполнялся|
|P2|20конкурентных approval иногда получали23505 по legacy UNIQUE(scope,key)|**f51b0f30** по точечному разрешению:только ON CONFLICT DO NOTHING.37существующих проверок,10повторов гонки и полный5776/0/0 прошли;тесты не менялись|
|P3|FOREMAN-dashboard запрашивал закрытый список документов пользователей|befa99f9 через существующее право users.documents.read_all|
|P3|Два S3-key helper без tenantId возвращали default-prefix|7ad5d3bd по разрешению,включены2существующих теста;вызовы в приложении не найдены,реальная утечка не заявляется|
|P3|V3 desktop:нижняя навигация перекрывала выбор объекта|1b0a2663,одна CSS-добавка;RED2mobile/1desktop→GREEN3. Это достижимость selector,не полный циклV3|

## Последние проверки на f51b0f30

| Команда / проверка | Exit | Результат |
|---|---:|---|
|npm run build|0|HTTP health подтвердил точныйSHAf51;время команды отдельно не измерялось|
|npx tsc --noEmit|0|31с|
|npm run lint|0|75с,zero warnings,text integrity passed|
|Полный npm run test:unit на свежем PG/Redis/HTTP|0|**5776 passed /0 failed /0 skipped**,512файлов;856,05с Vitest/901с wrapper|
|Полный Playwright --list через собственные одноразовые QA-фикстуры|0|366тестов/30файлов;BASE той же процедурой318/28 exit0;37с wrapper,cleanup=true|
|9существующих связанных файлов|0|37passed/0failed/0skipped,25с|
|10отдельных20-way approval race|Все0|Каждый1passed/0failed;по3прочих сценария отфильтрованы,не названы исполненными|

Все241исторических сопоставлены и passed в том же полном JSON. ИсходныйRED5775/1/0,его воспроизводимость наmain и все другие красные запуски сохранены в VERIFICATION.md;ни один не стёрт новым GREEN. Ни schema,ни индексы,ни tenant namespace/фильтры/транзакции не менялись.

## Границы UI и доставки

Прежние результаты относятся к приложению1b0a2663:семь ролей×три браузера21/0/0;полные /operator,v7,v10 по6/0/0;V3selector3/0/0;C3fresh1/0/0. Полный цикл включал допуск,осмотры,ТБ,офлайн2сваи и replay без дубля,бурение3м,простой0,25ч,инцидент,ЕО,закрытие,SQLanalytics/audit/outbox и открытие отчёта диспетчером. Наf51 эти UI-прогоны пока не повторены.

Дляv10 при двух вариантах проверено только принятие показанного назначения по умолчанию:другого chooser в форме нет. Паспорт сваи,полныеv2/v3/v5,каждыйCRUD,все чужиеURL и цепочки дефект→ремонт→готовность / инцидент→инженерОТ ещё не доказаны. Наличие команд в коде не подменяет полный браузерный цикл.

Первый свежий Chromium QA68 остаётся53passed/14skipped/1failed exit1. Устаревший email-контрактC3 исправлен поfixture-ID с проверкой скрытия контактов,focused повтор прошёл;весь68 после этого не повторялся. Причины14пропусков —QA-RUN.md.

На прежнем смешанном стенде перед очисткой сохранены40pendingDLQ:29NotificationDeliveryRequested,5синтетических ReportSubmitted без исходных данных,6ReadinessSnapshotRequested без equipment. Telegram не настроен,внешняя доставка не считается успешной. Отдельные6положительных delivery-сценариев прошли на свежихPG/Redis и своём HTTP-получателе. Политика ненастроенного канала —вопрос№8;подробностиOUTBOX.md. Железо,MQTT/датчики,реальныйTelegram не проверялись.

## Состояние работы

Одноразовая автоматизация18-30 запустила продолжение и удалена. Текущий собственный стенд наf51 оставлен для задачи6;временные unit/list-контейнеры очищены. Рабочий3100 и данные не затрагивались. .env не читались/не создавались;schema,migrations,dependencies,auth/security,ORION и версии оператора сохранены.

Прикладная дельта до1b0 прошла один независимый review;Important переносимости PG-теста исправлен. Новый fresh-review не дублировался. Дляf51 проверены ровно разрешённая строка и существующие тесты. Impact UNKNOWN из-заDI подтверждён текстом длякомандdefects/permits/shifts;полный detect перед коммитом безpartial/truncated. Глобальный бюджетflows и анонимныеE2E ограничивают полноту графа,ноль callers не принимается за безопасность.

Отчёты —docs/audits/night-1026/. Команды и история —VERIFICATION.md,однострочный фикс —PERMIT-IDEMPOTENCY-RACE.md,файлы и строки —CHANGED-FILES.md. Сырые JSON/логи/скриншоты и актуальная точка —D:/PillingR/night-logs/night-evidence-1026/. Полная очередь ещё не объявляется законченной;это не разрешение на выкладку.

## Коммиты ветки

До текущего документального снимка;актуальный полный список вместе с ним:git log --reverse --format="%H %s" efd95008..HEAD.

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
- a61aa205bd55817ca342f98b0310889f6f5aaff9 docs: record primary operator evidence and final isolated cleanup
- f51b0f30465c0273905853d0e1e8bc333a9ee0e5 fix(readiness): handle both idempotency unique constraints
