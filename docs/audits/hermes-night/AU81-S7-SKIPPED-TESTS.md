# AU81-S7 — Актуальный список пропущенных и отключённых тестов

Версия (HEAD рабочей папки D:\PillingR\wt-night): `a0b5fb7a87f30f443a3b7b9d932b3c843526da07`
(ветка `hermes/q4-0926`). Аудит только на чтение, тесты не запускались.

Файл отчёта: `docs/audits/hermes-night/AU81-S7-SKIPPED-TESTS.md`

## Итог

Найдено **37 маркеров пропуска в 23 файлах**, они закрывают **около 272 сценариев** (если считать
параметризованные `it.each` и циклы как отдельные прогоны). Цифры по каталогам: `src` — 2 маркера /
20 сценариев; `tests/contract` — 1 маркер / 13 сценариев; `tests/integration` — 16 маркеров /
226 сценариев; `e2e` — 18 маркеров / 13 сценариев.

По моей оценке важности: **критично — 7 маркеров**, **важно — 20**, **мелочь — 10**.

Топ-5 по важности:
1. `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80` и `:143` — **безусловный** `describe.skip`, никогда не выполняется ни локально, ни в CI (адаптер домена бросает `pendingImplementation`, строка 50). Контракты допуска/прав/аудита-цепочки.
2. `tests/contract/tech-readiness-api.spec.ts:49` — **безусловный** `describe.skip` API-контракта готовности (харнесс бросает, строки 32-42). Тоже никогда не запускается.
3. `tests/integration/disposable-idor.spec.ts:64` — 161 сценарий проверки IDOR/прав оператора и помощника; гейт по `INTEGRATION_DATABASE_URL_OWNER` + `CODEX_STAND_URL`.
4. `tests/integration/disposable-rls.spec.ts:7` — 21 сценарий реальной изоляции тенантов через роль `pilingtrack_app`; гейт по двум `INTEGRATION_DATABASE_URL_*`.
5. `e2e/qa-ac/post-merge-smoke.spec.ts` — 6 дымовых тестов допуска/прав, 9 маркеров `test.skip`; при отсутствии `POST_MERGE_SMOKE` или файлов сессий пропускаются молча.

Ключевой вывод: **два файла с безусловным `describe.skip`** (`production-contracts.todo.test.ts`,
`tech-readiness-api.spec.ts`) не выполняются вообще никогда — это контракты ещё не реализованной части
«Технической готовности». Остальные интеграционные наборы гейтятся переменными окружения, которые
`vitest.config.ts:17-33` подставляет из `.env` (только адреса БД), поэтому локально гейт может
открываться, а на чистой машине без `.env` — молча закрываться.

## Методика

Поиск индексатором (ripgrep через search_files) по всему репозиторию, шаблоны:
`\b(describe|it|test|xit|xdescribe)\.(skip|todo)\b`, `\.skipIf\b`, `\.runIf\b`, `\bxdescribe\b`, `\bxit\b`,
`\.(skip|todo|only|fixme)\s*[('`]`, `test\.fixme`, `test\.describe\.skip`, `test\.describe\.configure`.
Каталоги: `src/`, `tests/`, `e2e/` (и корень для конфигов).
Число сценариев — ручной подсчёт объявлений `it(`/`test(` внутри пропущенного `describe` с раскрытием
`it.each([...])` и циклов `for(...) it(...)`; для `disposable-idor.spec.ts` длина массива `cases`
посчитана node-скриптом (`method:` = 80 записей). Строки открыты через read_file — каждая строка
из таблицы существует в файле на своей позиции.
`.only`, `.todo`, `.fixme`, `xit`, `xdescribe` в `src`, `tests`, `e2e` — **не найдено (0)**.
Конфиг-исключение Playwright: `playwright.qa.config.ts:33` — `testIgnore: /operator-/` (замороженный
экран оператора, к пропускам внутри спеков не относится).

## Находки

Каталог `src` (vitest, по `vitest.config.ts:36` включается в прогон):

| # | важно | файл:строка | что пропущено | сценариев | условие пропуска | причина (из кода/имени) | критично? |
|---|-------|-------------|---------------|-----------|------------------|-------------------------|-----------|
| 1 | критично | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80` | `describe.skip('Tech Readiness production state machines [PRD §6, ADR-0041]')` | 17 (5×Shift + 4×Handover + 1 terminal + 4×Permit + норматив/повышенный/самоподпись) | безусловный (`describe.skip`) | файл `.todo`, адаптер домена не реализован (`pendingImplementation`, строки 50-59) | ДА — допуск (смены, передача смены, наряды-допуски) |
| 2 | критично | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:143` | `describe.skip('Tech Readiness evaluation [PRD §5, backend design §8]')` | 3 (fail-closed, блокер наряда, предупреждение) | безусловный (`describe.skip`) | адаптер `readiness.evaluate` не реализован (строка 61) | ДА — допуск (оценка готовности) |

Каталог `tests/contract`:

| # | важно | файл:строка | что пропущено | сценариев | условие пропуска | причина (из кода) | критично? |
|---|-------|-------------|---------------|-----------|------------------|-------------------|-----------|
| 3 | критично | `tests/contract/tech-readiness-api.spec.ts:49` | `describe.skip('Tech Readiness API contract [PRD §8, backend design §10]')` | 13 (список/ETag/428/RBAC×4/подмена тенанта/404/409/422/idempotency/курсор/CSV) | безусловный (`describe.skip`) | харнесс `api` бросает «Bind ApiContractHarness…» (строки 32-42) | ДА — права/тенант/допуск по API |

Каталог `tests/integration` (vitest; гейты по переменным окружения):

| # | важно | файл:строка | что пропущено | сценариев | условие пропуска | причина (из комментария/переменной) | критично? |
|---|-------|-------------|---------------|-----------|------------------|-------------------------------------|-----------|
| 4 | критично | `tests/integration/disposable-idor.spec.ts:64` | `describe.skipIf(!enabled)` «E2 HTTP IDOR on disposable production app» | 161 (80 кейсов × 2 роли OPERATOR/ASSISTANT + 1 «foreign records remain intact») | `!enabled`, где `enabled = INTEGRATION_DATABASE_URL_OWNER && CODEX_STAND_URL` (строка 7) | изоляция/права на одноразовом стенде | ДА — права/тенант (IDOR) |
| 5 | критично | `tests/integration/disposable-rls.spec.ts:7` | `describe.skipIf(!enabled)` «RLS on all deployed migrations, real application role» | 21 (1 + 3×6 таблиц + транзакционный пул + запрет чтения журнала) | `!enabled`, где `enabled = …OWNER && …APP` (строка 4) | RLS на реальной роли `pilingtrack_app` | ДА — изоляция тенантов |
| 6 | критично | `tests/integration/rls-tenant-enforcement.spec.ts:44` | `describe.skipIf(!APP_ROLE_URL)` «RLS отделяет тенантов по-настоящему» | 5 (роль без bypass, свой/чужой тенант, транзакция, без тенанта) | `!APP_ROLE_URL` (`DATABASE_URL_APP_ROLE`, строка 31) | подробный комментарий 7-30: до 22.09.2026 набор «молчал» | ДА — изоляция тенантов |
| 7 | критично | `tests/integration/tenant-transaction-pool.spec.ts:21` | `describe.skipIf(!connectionString)` «lazy tenant transactions with a single database connection» | 4 (роль без bypass, изоляция в ленивой tx, отсутствие утечки контекста, откат) | `!connectionString` (`DATABASE_URL_POSTGRES`, строка 10) | одноразовая БД/роль создаются в `beforeAll` | ДА — изоляция тенантов |
| 8 | важно | `tests/integration/disposable-analytics-performance.spec.ts:11` | `describe.skipIf(!…OWNER)` «E5 combined pile aggregate semantics» | 1 (период не меняет итог, черновик исключён) | `!INTEGRATION_DATABASE_URL_OWNER` | агрегация свай на живой БД | ДА — запись/итоги отчёта |
| 9 | важно | `tests/integration/disposable-analytics-performance.spec.ts:32` | `describe.skipIf(!…OWNER)` «J8 pile journal period indexes» | 1 (индексы по occurredAt/NULL-fallback, планы) | `!INTEGRATION_DATABASE_URL_OWNER` | требует одноразовой `codex_test` под ролями `piling`/`pilingtrack_app` (строки 37-45) | НЕТ — производительность чтения |
| 10 | важно | `tests/integration/disposable-equipment-race.spec.ts:7` | `describe.skipIf(!…OWNER)` «E4 PG equipment optimistic lock» | 3 (устаревшая карточка, гонка двух сохранений, откат показания) | `!INTEGRATION_DATABASE_URL_OWNER` | оптимистичная блокировка записи оборудования | ДА — целостность записи |
| 11 | важно | `tests/integration/disposable-m6-m8.spec.ts:12` | `describe.skipIf(!enabled)` «M6–M8 on disposable migrated Postgres» | 5 (черновик вне KPI, durable-доставка, RLS-конфиг, DLQ+webhook, очистка PDF) | `!enabled`, где `enabled = …OWNER && …APP` (строка 9) | комментарий 11: «Real db / RLS / projections / delivery» | ДА — RLS/проекции/доставка |
| 12 | важно | `tests/integration/disposable-report-race.spec.ts:7` | `describe.skipIf(!…OWNER \|\| !CODEX_STAND_URL)` «E3 real concurrent report saves» | 1 (один победитель, второй 409) | `!CODEX_STAND_URL \|\| !INTEGRATION_DATABASE_URL_OWNER` | гонка сохранения отчёта на стенде | ДА — запись отчёта |
| 13 | важно | `tests/integration/disposable-restore.spec.ts:32` | `describe.skipIf(!enabled)` «restore synthetic dump from one consistent snapshot» | 1 (восстановление дампа, подмена манифеста) | `!enabled`, где `enabled = …OWNER && …APP && INTEGRATION_DB_CONTAINER` (строки 29-30) | восстановление из снимка | НЕТ — эксплуатация/бэкапы |
| 14 | важно | `tests/integration/disposable-scripts.spec.ts:37` | `describe.skipIf(!ownCleanupEnabled)` «J7 orphan cleanup real own Postgres» | 6 (dry-run, backup+restore, отказ по цели/тенанту, живой Report, FK/триггер, подмена контрольной суммы) | `!ownCleanupEnabled`, где `ownCleanupEnabled = …OWNER && INTEGRATION_DB_CONTAINER` (строка 36) | удаление осиротевших строк `ReportAnalytics` | ДА — удаление данных |
| 15 | важно | `tests/integration/tech-readiness-projection.spec.ts:24` | `describe.runIf(Boolean(connectionString))` «readiness snapshot projection on disposable PostgreSQL» | 4 (дедуп, nullable facts, не-регресс проекции, откат+чекпоинт) | `runIf(!connectionString)` → выполняется только при `DATABASE_URL_POSTGRES` | одноразовая БД поднимается в `beforeAll` | ДА — допуск (проекции готовности) |
| 16 | важно | `tests/integration/tech-readiness-shifts.spec.ts:37` | `describe.runIf(Boolean(connectionString))` «shifts and handovers on disposable PostgreSQL» | 3 (20 параллельных пусков, приём двумя диспетчерами, блокирующее решение) | `runIf(!connectionString)` | ручной список миграций (строки 21-32) | ДА — допуск (смены) |
| 17 | важно | `tests/integration/tech-readiness-work-permits.spec.ts:40` | `describe.runIf(Boolean(connectionString))` «work permits on disposable PostgreSQL» | 4 (кросс-тенантные FK, гонка согласование/правка, 20-кратное согласование, две подписи) | `runIf(!connectionString)` | комментарий 16-25: набор точечных миграций | ДА — допуск (наряды) |
| 18 | важно | `tests/integration/tech-readiness-write-pipeline.spec.ts:18` | `describe.skipIf(!enabled)` «Tech Readiness real source → outbox → snapshot → read model» | 5 (откат источника, идемпотентное событие, чужой тенант, откат проекции, реальная проекция) | `!enabled`, где `enabled = …OWNER && …APP` (строки 14-15) | боевой конвейер outbox→snapshot | ДА — допуск (запись/проекции) |
| 19 | мелочь | `tests/integration/tenant-dictionary-migration.spec.ts:14` | `describe.runIf(Boolean(connectionString))` «tenant dictionary migration on PostgreSQL» | 1 (независимые копии справочников, сохранение связей) | `runIf(!connectionString)` (`DATABASE_URL_POSTGRES`) | проверка SQL-миграции справочников | НЕТ — миграция справочников |

Каталог `e2e` (Playwright):

| # | важно | файл:строка | что пропущено | сценариев | условие пропуска | причина (из комментария) | критично? |
|---|-------|-------------|---------------|-----------|------------------|--------------------------|-----------|
| 20 | мелочь | `e2e/inspection-to-flow.spec.ts:8` | `test.skip(!INTEGRATION_DATABASE_URL_OWNER, 'Requires owned disposable PostgreSQL')` в тесте «J9 inactive equipment…» | 1 | `!INTEGRATION_DATABASE_URL_OWNER` | требует одноразовой БД | НЕТ — e2e-стенд |
| 21 | мелочь | `e2e/monitoring-tile-editor.spec.ts:13` | `test.skip(!['chromium','Mobile Chrome'].includes(project))` | 1 (в паре с №22) | имя проекта Playwright | прогон только на двух проектах | НЕТ |
| 22 | мелочь | `e2e/monitoring-tile-editor.spec.ts:15` | `test.skip(E2E_S3_READY !== 'true', 'Requires verified disposable S3')` | 1 (в паре с №21) | `E2E_S3_READY` | требует проверенного S3 | НЕТ |
| 23 | мелочь | `e2e/rate-limit-e2e.spec.ts:9` | `test.skip(project !== 'chromium', …)` в тесте «rate limiting on login» | 1 | имя проекта | комментарий 4-6: обойти коллизии IP между проектами | НЕТ |
| 24 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:35` | `test.skip(!POST_MERGE_SMOKE, GATE)` — S1 «журнал забивки» | 1 | `POST_MERGE_SMOKE` | комментарий 7: запуск только при `POST_MERGE_SMOKE=1` | НЕТ — дым после слияния |
| 25 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:67` | `test.skip(!POST_MERGE_SMOKE, GATE)` — S2 «фильтр Все» | 1 | `POST_MERGE_SMOKE` | то же | НЕТ |
| 26 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:82` | `test.skip(!POST_MERGE_SMOKE, GATE)` — S3 «мастер: аналитика» | 1 | `POST_MERGE_SMOKE` | то же | НЕТ |
| 27 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:83` | `test.skip(!hasSession(FOREMAN), …)` — S3 доп. гейт | — (в том же тесте) | отсутствие файла сессии мастера | комментарий 29-32: сессия в `D:/PillingR/qa/.auth` | НЕТ |
| 28 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:92` | `test.skip(!POST_MERGE_SMOKE, GATE)` — S4 «инженер ОТ» | 1 | `POST_MERGE_SMOKE` | то же | НЕТ |
| 29 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:93` | `test.skip(!hasSession(SAFETY_ENGINEER), …)` — S4 доп. гейт | — | отсутствие сессии инженера ОТ | то же | НЕТ |
| 30 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:102` | `test.skip(!POST_MERGE_SMOKE, GATE)` — S5 «помощник: нет доступа» | 1 | `POST_MERGE_SMOKE` | то же | НЕТ |
| 31 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:111` | `test.skip(!POST_MERGE_SMOKE, GATE)` — S6 «метрики» | 1 | `POST_MERGE_SMOKE` | то же | НЕТ |
| 32 | важно | `e2e/qa-ac/post-merge-smoke.spec.ts:117` | `test.skip(response.status() !== 200, …)` — S6 доп. гейт | — | метрики недоступны из сессии | комментарий 115-116: пропуск с причиной, а не дефект | НЕТ |
| 33 | мелочь | `e2e/release-critical-path.spec.ts:17` | `test.skip(project !== 'chromium', …)` — «dispatcher draft…PDF» | 1 | имя проекта | комментарий: путь один раз | НЕТ |
| 34 | мелочь | `e2e/release-critical-path.spec.ts:65` | `test.skip(project !== 'chromium', …)` — «ADMIN creates…work order» | 1 | имя проекта | то же | НЕТ |
| 35 | мелочь | `e2e/release-critical-path.spec.ts:91` | `test.skip(project !== 'chromium', …)` — «ADMIN deletes a cluster…» | 1 | имя проекта | то же | НЕТ |
| 36 | мелочь | `e2e/report-creation-flow.spec.ts:40` | `test.skip(!dict.pileGrades?.length, …)` — «operator creates a report…» | 1 (в паре с №37) | пустой справочник марок свай | комментарий 39: пустой справочник — пропуск, не успех | НЕТ |
| 37 | мелочь | `e2e/report-creation-flow.spec.ts:49` | `test.skip(!sites.sites?.length, …)` — тот же тест | 1 (в паре с №36) | у оператора нет доступных объектов | то же | НЕТ |

### Итог числами по каталогам

| каталог | файлов с пропусками | маркеров | оценочно сценариев | критично | важно | мелочь |
|---------|--------------------:|---------:|-------------------:|---------:|------:|-------:|
| `src` | 1 | 2 | 20 | 2 | 0 | 0 |
| `tests/contract` | 1 | 1 | 13 | 1 | 0 | 0 |
| `tests/integration` | 15 | 16 | 226 | 4 | 12 | 1 |
| `e2e` | 6 | 18 | 13 | 0 | 9 | 9 |
| **всего** | **23** | **37** | **≈272** | **7** | **20** | **10** |

Пояснение к «сценариям» в `tests/integration`: 226 = 161 (IDOR, 80 кейсов × 2 роли + 1) + 21 (RLS) +
5 + 5 (m6-m8) + 5 (rls-tenant-enforcement) + 4 (tenant-transaction-pool) + 4 (projection) + 4 (permits) +
3 (shifts) + 3 (equipment-race) + 2 (analytics-perf) + 1 + 1 + 1 + 1 + 1. В `e2e` парные гейты
(№21+22, №26+27, №28+29, №31+32, №36+37) закрывают один и тот же тест, поэтому сценариев 13, а не 18.

## Что не проверено

- **Тесты не запускались** (условие задания). Не подтверждено фактическое число отчётов `passed/skipped`
  у vitest/Playwright; числа сценариев — это подсчёт объявлений в исходниках, а не вывод прогонщика.
- Не проверено, **какие именно** переменные (`INTEGRATION_DATABASE_URL_OWNER/APP`, `CODEX_STAND_URL`,
  `E2E_S3_READY`, `POST_MERGE_SMOKE`, `INTEGRATION_DB_CONTAINER`) реально заданы в текущем `.env` / CI:
  файлы `.env*` не читались (запрет AGENTS.md). Поэтому неизвестно, открываются ли гейты сейчас в CI.
- Существующие отчёты в `docs/audits/` (в т.ч. `R81-skipped-tests.md`, `13-readiness-e2e-skip.md`)
  **не читались** по условию задания — возможные пересечения не сверялись.
- Сценарии в `tests/integration/disposable-idor.spec.ts` (80) посчитаны скриптом по вхождениям `method:`
  в массиве `cases`; ручная проверка одной строки не делалась — возможна погрешность на ±1.
- Причина безусловного пропуска в `production-contracts.todo.test.ts` / `tech-readiness-api.spec.ts`
  прочитана из кода (заглушка `pendingImplementation` / харнесс бросает). Истинный замысел автора
  (временная заготовка vs забытый TODO) — **гипотеза**, документации не читал.
- Разбивка «критично/важно/мелочь» — **моя оценка** по привязке к допуску (готовность/смены/наряды),
  правам (RLS/IDOR) и записи отчёта. Формального критерия в проекте не найдено.
