# Задача C — единый контракт расхода топлива

Ветка: codex/fuel-contract-1023. База: fdd67ccf688ec63561f3939fd4b665032cba7525. Изменения main не подмешивались. Окончательный коммит исходников: 30fc4b4c81aa623b99f3427559154a20136f12f7.

## Результат

Журнал и аналитика используют один контракт: liters (число либо null), source (telemetry/manual/none), quality (measured/insufficient). Приоритет: достоверная телеметрия → достоверный ручной баланс → null. Источники не суммируются. Измеренный ноль сохраняется; один замер, сброс 1000→5, уменьшение внутри интервала и конфликт значений в один момент не превращаются в расход. Точный дубликат точки не создаёт второе измерение.

Ручной баланс требует вместимости бака и двух замеров в разные моменты. Первый долив не учитывается повторно, если первая запись стала начальным остатком. При наличии предыдущего замера он служит началом баланса. Это баланс между фактическими замерами: начало может предшествовать from; интерполяция и экстраполяция на границы периода не выполняются.

При фильтре объекта ручной источник отключён: у FuelLog нет siteId, приписывать весь расход установки одному объекту недостоверно. Интерфейс объясняет это ограничение. Аналитика использует полуоткрытый интервал суток; журнал сохраняет включительную to, передавая в общий запрос to+1 мс. Неполный парк не выдаётся за полный суммарный расход.

Существующий публичный тип FuelConsumption калькулятора команд сохранён; новый тип опубликован как ResolvedFuelConsumption. Новые подписи источника имеют мобильный размер 14px. Старые соседние стили и замороженные экраны не изменялись.

## Доказательства

До исправления: регрессия одного ручного замера — 44 passed / 1 failed, exit 1; сброс 1000→5 — 15 passed / 1 failed, exit 1. Первоначальный запуск нового domain-теста до создания модуля завершился exit 1 на импорте (0 собранных тестов), это не доказательство поведения.

После окончательного исправления: scoped-набор оборудования, аналитики и UI — 220 passed / 0 skipped / 0 failed, exit 0. UI render-тесты happy-dom: 6 passed, exit 0. Реальная одноразовая PostgreSQL через штатные test-db-up/down и tracked run-fuel-disposable.sh: 10 passed / 0 skipped / 0 failed, exit 0 (6507.4316 мс). Проверены отсутствие данных, один/два счётчика и ноль, ручной первый долив и предыдущий остаток, оба источника, сброс и fallback, временные границы и чужой tenant, site-фильтр, включительная to журнала. Mocks не выдаются за PostgreSQL.

Сбор Playwright: 315 тестов в 28 файлах, exit 0; это collection, браузерные сценарии не запускались. npm run check:layers — exit 0, 4 grandfathered / 0 новых нарушений. Предыдущие tsc и npm run lint — exit 0; окончательные результаты ниже. Первая короткая попытка tsc истекла по timeout (не pass); ошибочно указанный отсутствующий check-module-layers.js дал exit 1, заменён правильным npm run check:layers.

## GitNexus

Перед изменениями существующие точки входа имели LOW. После incremental-индекса новые функции потеряли Function-узлы, fuzzy impact выдал CRITICAL (874/244/258 затронутых), точный запрос — UNKNOWN. Риск передан руководителю до дальнейших правок; исходные raw-артефакты сохранены. Собственная полная индексация --force --index-only --no-parse-cache с heap 4 GiB завершилась exit 0 и восстановила Function-узлы. Точные impacts с file_path: readFuelConsumptions — LOW, 4 затронутых / 2 прямых / 2 процесса; обе domain-функции — LOW, 5 / 1 / 2. Это исправление доказанного дефекта индекса, не молчаливое понижение CRITICAL.

Предкоммитный detect_changes all: exit 0, 13 файлов, 70 символов, 1 моделируемый процесс EquipmentAnalytics → Cn, risk medium; error/partial/truncated отсутствуют. Индекс ограничивает бюджет процессов (1221), поэтому отсутствие ребра не считается доказательством отсутствия использования. Текстовый поиск потребителей и реальные тесты дополняют граф.

## Изменённые файлы

Файлы не удалялись, старые экспорты не удалялись. Добавленные/удалённые строки исходного code diff:

```text
42	0	src/components/piling/__tests__/equipment-analytics.test.tsx
18	4	src/components/piling/equipment-analytics.tsx
14	9	src/components/piling/to/fuel-panel.tsx
44	26	src/modules/analytics/application/queries/__tests__/equipment-analytics-service.test.ts
20	29	src/modules/analytics/application/queries/equipment-analytics-service.ts
14	0	src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts
114	0	src/modules/equipment/application/queries/__tests__/fuel-contract.integration.ts
12	0	src/modules/equipment/application/queries/__tests__/run-fuel-disposable.sh
16	42	src/modules/equipment/application/queries/equipment-query.service.ts
54	0	src/modules/equipment/application/queries/fuel-consumption.ts
59	0	src/modules/equipment/domain/fuel-consumption.test.ts
50	0	src/modules/equipment/domain/fuel-consumption.ts
3	0	src/modules/equipment/index.ts
```

## Ограничения

Телеметрия за выбранный период пока читается целиком: группировка стала линейной Map вместо fleet×points, но объём rows/памяти не ограничен. До подключения железа нужен отдельный нагрузочный замер и при необходимости агрегирование в PostgreSQL. Несколько устройств, качество часов и идентичность счётчиков этим контрактом не решены. Реальное железо, физический телефон, production, браузер и полный E2E не проверялись.

Схема БД, миграции, зависимости, legacy commands/services, auth/security, operator*, ORION, .env и внешние credentials не менялись/не читались. Production/push/merge/deploy не выполнялись. Raw-логи в игнорируемом output/fuel-contract-1023 не коммитятся.

## Воспроизведение проверок

Каждая команда запускалась отдельно; коды не получены через tail/head. На Windows использован direct Node CLI эквивалент npx для локальных бинарников.

| Команда | Exit | Результат |
|---|---:|---|
| npm ci --ignore-scripts | 0 | собственные зависимости; новых зависимостей нет |
| npx tsc --noEmit | 0 | после P2; повтор после финальной сборки ниже |
| npm run lint | 0 | после P2, Text integrity check passed |
| npm run check:layers | 0 | 4 существующих исключения, 0 новых |
| npx vitest run src/modules/equipment src/modules/analytics src/components/piling/__tests__/equipment-analytics.test.tsx --maxWorkers=2 | 0 | 17 файлов, 220 passed / 0 skipped / 0 failed |
| npx playwright test --list | 0 | 315 тестов / 28 файлов |
| bash src/modules/equipment/application/queries/__tests__/run-fuel-disposable.sh | 0 | реальная PostgreSQL, 10 passed / 0 skipped / 0 failed |
| git diff --check | 0 | пробельных ошибок нет |

В .next/dev/types до проверки каталога не было, удаление не требовалось. Собственные node_modules и src/generated физические, junction/symlink не создавались.

## Независимое ревью и уточнение ручного баланса

Ревью выявило P2: условие recordedAt > start.recordedAt теряло отдельный долив с тем же timestamp, что базовый замер (ввод даты в UI может давать одинаковое время). Обратная граница тоже требует учитывать порядок: долив после конечного замера с тем же временем уже не подтверждён этим остатком. Точное impact summarizeManualFuel перед правкой снова LOW: 5 затронутых / 1 прямой / 2 процесса. Исправление и итоговые повторные проверки записаны ниже.

До этого уточнения полный npm run test:unit -- --maxWorkers=2 завершился exit 0: 490 файлов passed / 15 skipped, 5388 тестов passed / 265 skipped / 0 failed, 636.65 с. Пропуски принадлежат существующим integration suites с гейтами живых DB/стенда; в этом unit-процессе их окружение намеренно не задано. Данный результат не переносится автоматически на последующую правку. Финальный lint до P2: npm run lint exit 0, Text integrity check passed.

P2 исправлен через startIndex/endIndex в уже упорядоченном массиве: учитываются только записи после начальной и до конечной включительно, в том числе при равном recordedAt. Два новых unit-теста до исправления: 14 passed / 2 failed, exit 1 (60 вместо 80 и 80 вместо 60). После: scoped 17 файлов / 220 passed / 0 skipped / 0 failed, exit 0 (16.98 с). PostgreSQL: 10 passed / 0 skipped / 0 failed, exit 0 (6507.4316 мс); прежние 9 сценариев сохранены, 10-й фиксирует createdAt и обе границы одинакового времени. Контейнер этого прогона отсутствует после cleanup. Независимый reviewer повторил 7 TS asserts на граничные случаи, exit 0, новых замечаний нет.

Повторный detect_changes all после P2: exit 0, 13 файлов / 70 символов / 1 процесс, medium, без error/partial/truncated.

Сборка ДО P2: настоящий npm run build в собственном одноразовом стенде — BUILD exit 0, health READY, CLEANUP done, wrapper exit 0; собственные PG и два Redis отсутствуют. Предупреждения: SENTRY_AUTH_TOKEN не задан (source maps не загружаются), optional @valkey/valkey-glide у bullmq не найден. Зависимости ради предупреждений не менялись. Окончательная сборка ниже.

Окончательные лёгкие проверки после P2: npx tsc --noEmit — exit 0; npm run lint — exit 0, Text integrity check passed.

Сбор Playwright после P2 повторён: npx playwright test --list, exit 0, те же 315 тестов / 28 файлов. Отдельного браузерного прогона не было. Для build использован штатный scripts/test-day-stand.cjs с экспортами штатного test-db-up.sh только в памяти оболочки; helper останавливает собственный стенд после READY и выполняет test-db-down через trap. Подробные журналы и реальные exit JSON лежат локально в output/fuel-contract-1023.

## Локальные коммиты и окончательный unit

- 967da3fb — контракт, ручной баланс, запросы и журнал (7 файлов, +210/−51).
- 30fc4b4c81aa623b99f3427559154a20136f12f7 — аналитика, отображение и реальные PG/UI-тесты (6 файлов, +250/−59).

Перед каждым коммитом detect_changes all завершился exit 0 без error/partial/truncated: перед первым 70 символов / 10 видимых diff-файлов (новые файлы второй группы уже были покрыты предыдущим полным 13-файловым анализом), medium; перед вторым 23 символа / 6 файлов, medium. Всего код: 13 файлов, +460/−110.

Окончательный npm run test:unit -- --maxWorkers=2 после P2: **exit 0; 5390 passed / 265 skipped / 0 failed**, 490 файлов passed / 15 skipped (505), 587.11 с. Проверено окончательное содержимое исходников, сохранённое двумя коммитами выше; после запуска исходники не менялись. Пропущенные integration suites не считаются пройденными: 159 HTTP IDOR, 45 RLS, 7 M6–M8, 7 feedback RLS, 6 readiness pipeline, 5 tenant enforcement, 4 readiness projection, 4 work permits, 4 transaction pool, 3 shifts, 3 lock timeout, 3 report race, 3 equipment race, 2 analytics performance, 1 dictionary migration (265). Для них нужны соответствующие DB/стенд-переменные; задача C отдельно проверена своим PostgreSQL-прогоном без пропусков.

## Окончательная сборка и очистка

Настоящий npm run build после P2 на исходниках 30fc4b4c: **BUILD exit 0**, health READY (HTTP 200), CLEANUP done, wrapper exit 0. TypeScript внутри Next завершился успешно, сгенерировано 95 страниц. Предупреждения про Sentry и optional valkey сохранились; сборку не блокируют, зависимости не менялись.

Проверка exact names двух собственных Redis и exact ID PostgreSQL не нашла оставшихся контейнеров. Порты app/worker своего стенда больше не слушают. Чужие контейнеры/процессы не останавливались. Отдельный PostgreSQL-прогон также удалил собственный контейнер.

После окончательной сборки npx tsc --noEmit повторён: exit 0 (с актуальными route types). Итог: все обязательные команды выполнены с настоящими кодами; E2E collection без запуска браузера. Рабочая ветка предназначена для независимого review и принятия владельцем, готовность production не заявляется.
