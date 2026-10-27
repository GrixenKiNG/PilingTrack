# Доказательная ночь 26–27 октября 2026

Промежуточный отчёт на 27 октября, 14:16 МСК. Работа продолжается. База origin/main — `efd95008eac3bc846c89003c4b7766f2eb5c1c9b`; ветка codex/night-evidence-1026, рабочая папка D:/PillingR/wt-night-evidence-1026. Последний коммит приложения — 1b0a2663. Push, merge и выкладки не было.

| Задача | Статус | Доказательство / остаток |
|---|---|---|
|1. Все 241 пропуска|Готово|241/241 matched и passed в последнем полном запуске; сам полный unit красный по отдельной исходной гонке main, см. ниже|
|2. Отказы outbox|Готово|Пять реальных PG-сценариев, crash отдельного процесса; разрешённый tenant guard; общий retry/backoff сохранён|
|3. Матрица допуска|Готово|10 случаев × 5 путей, решения совпали, отличия предупреждений не менялись|
|4. Docker app/workers и smoke|Готово|Исходный main efd95008: app build0/360с, workers0/43с, workers smoke0/9с; совместный запуск и prod:smoke13/13 exit0, cleanup=true|
|5. Длинные файлы|Готово|15 отслеживаемых текстовых файлов: 7 прикладных, 8 тестовых; только чтение|
|6. Роли и все экраны оператора|**Частично**|7 ролей × 3 браузера:21/0/0; полный v7 × одна/две установки ×3:6/0/0; V3 selector3/0/0. Полный v10 × одна/две установки ×3:6/0/0. Остальные полные циклы, все CRUD и сквозные цепочки не доказаны|
|7. Документация против кода|Готово в указанном объёме|42 утверждения обязательных категорий;7 вопросов. Очевидные пути/команды исправлены; архивы целиком не объявляются проверенными|

## ДЕФЕКТЫ

| Приоритет | Подтверждённый дефект | Состояние |
|---|---|---|
|P2|ASSISTANT получал403 общего bootstrap в «ТБ и допуски»|Исправлен 0e3e2c9a, RED9b9cce5f; существующий личный экран без расширения прав|
|P2|Outbox без канонического tenantId доходил до handler|Исправлен 48aa4689 по точечному разрешению; retry/DLQ сохранены; старые строки не backfill|
|P2|20 конкурентных approval иногда получают raw23505 по legacy unique(scope,key)|**Не исправлен, ожидается точечное разрешение**. Воспроизведён на исходном main и в ветке существующим неизменённым тестом. PERMIT-IDEMPOTENCY-RACE.md|
|P3|FOREMAN-dashboard запрашивал закрытый список документов пользователей|Исправлен befa99f9 через существующее право users.documents.read_all|
|P3|Два S3-key helper без tenantId возвращали default-prefix|Исправлены 7ad5d3bd, два существующих теста включены по разрешению. Вызовы в приложении не найдены; реальная утечка не заявляется|
|P3|V3 desktop: нижняя навигация перекрывала выбор объекта|Исправлен 1b0a2663, одна CSS-классовая добавка; RED1desktop/2mobile → GREEN3. Это не полный цикл V3|

## Последние проверки

- tsc: exit0,24с; lint: exit0,137с,zero warnings; host build: exit0,260с,source1b0a2663.
- **Полный unit: exit1,5775 passed /1 failed /0 skipped,512файлов,981с wrapper**. Единственный failed — tests/integration/tech-readiness-work-permits.spec.ts (20-way approval race). На чистом исходном main тот же23505 воспроизведён вторым повтором. Все241исторических passed.
- Полный Playwright --list после v10 на одинаковых одноразовых QA-фикстурах: exit0,360 тестов/30файлов против318/28 наBASE,exit0. Wrapper39с,cleanup=true.
- Роли21/0/0 exit0/661с;V7полныйцикл6/0/0 exit0/333с;V3selector3/0/0 exit0/54с;C3fresh1/0/0 exit0/52с;V10полныйцикл6/0/0 exit0/274с — приложение1b0a2663. После E2E-расширения tsc0/17с и lint0/73с,zero warnings.
- Свежий Chromium QA68: **53 passed /14 skipped /1 failed,exit1**. Единственная C3ошибка устаревшего email-контракта исправлена поfixture-ID с проверкой скрытия контактов, затем focusedC3прошёл. Весь набор68 после исправления не повторён, зелёным не объявляется. Все14 причин пропусков в QA-RUN.md.
- Уведомления:6/0/0,exit0/54с на свежихPG/Redis и локальном HTTP-получателе. Реальный Telegram/железо не проверялись.

Старые полные5776/0/0 сохранены, но не заменяют последний RED. Причины иных исходных красных запусков, BASE-сравнение22auth/device-тестов, версии SHA и команды повтора — VERIFICATION.md. Reviewer один, его Important по переносимости PG-теста исправлен; это не приёмка владельца.

## Границы и оставшаяся работа

Задача6 остаётся частичной: не доказаны полные циклы operator/v2/v3/v5, каждый CRUD каждой роли, все чужие URL и все сквозные цепочки дефект→ремонт→готовность / инцидент→инженер ОТ. Полный V10 подтверждён шестью браузерными сценариями. Четыре исходные пробы селекторов сохранены отдельно, это ошибки нового harness, а не дефекты приложения. Для нескольких установок v10 отображает назначение по умолчанию, отдельного выбора другой установки в его форме нет — не подменяем это доказательством выбора.

Не менялись схема, миграции, зависимости, auth/security; версии оператора и ORION сохранены. Содержимое .env не читалось и не создавалось. Только свои одноразовые PG18/Redis/MinIO и fixtures; рабочий стенд3100 не затронут. Образы main не являются проверкой образов исправленной ветки.

Отчёты: INTEGRATION-RUN.md, OUTBOX.md, CLEARANCE-MATRIX.md, ROLES-WALKTHROUGH.md, OPERATOR-CYCLE.md, QA-RUN.md, V3-SELECTOR.md, IMAGES.md, DOCS-VS-CODE.md, LONG-FILES.md, VERIFICATION.md и REVIEW.md. Сырые логи/JSON/скриншоты и актуальная точка продолжения — D:/PillingR/night-logs/night-evidence-1026/. Одноразовая автоматизация13-25 после запуска удалена.

## Коммиты ветки (на момент отчёта)

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

Изменённые файлы и числа строк — CHANGED-FILES.md. Этот отчёт не является разрешением на выкладку.
