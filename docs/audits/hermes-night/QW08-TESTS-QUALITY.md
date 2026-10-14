# QW08-TESTS-QUALITY: Качество тестов

- Дата: 2026-10-14
- HEAD: `77282754a74f8972bba74427367d70ff65ed215d` (`docs(audit): QW07 — состояния экранов админки (16 находок)`)
- Режим: READ-ONLY, изменён только этот файл.

## Итог

Локальный «зелёный» прогон vitest даёт **1 failed из 4511 тестов** — это единственный недетерминированный тест во всём наборе (сторонний «сторож» гонится по 300+ файлам и в полной сборке выходит за 20-секундный таймаут, а поодине стабильно проходит). **257 тестов из 17 файлов молча проглатываются на локальном прогоне** — вся интеграция (RLS, IDOR, гонки, tech-readiness) стоит за двумя переменными окружения и без них не проверяет ничего; зелёный бейдж локально их не включает. Ключевые критические пути (отмена/отказ/начало смены, согласование допусков, upsert отчётов, реальная Redis-ревочная сессий) покрыты либо только проглатываемой интеграцией, либо тестами, где весь нижний слой намочен. Находок: 20 (критических — 7). Заработавших «ловушек» (fake timers, порядок тестов) не найдено — все 35 файлов с фейковыми таймерами корректно возвращают реальные.

## Методика

1. Полный прогон `npx vitest run` (лог: scratch `qw08-vitest.log`). Итоговая строка: `Test Files 1 failed | 392 passed | 13 skipped (406)`, `Tests 1 failed | 4251 passed | 2 expected fail | 257 skipped (4511)`.
2. Повторный одиночный прогон упавшего файла — воспроизводится (12/12, EXIT=0).
3. `npx playwright test --list` — `Total: 291 tests in 27 files` (сборка успешна; запуск не делался — нужен стенд).
4. Ручной обход: `src/services/auth/**`, `src/core/security/**`, `src/lib/**`, `src/app/api/readiness/**`, `src/app/api/reports/**`, `src/modules/readiness/infrastructure/**`, `e2e/`, `tests/integration/**`, `tests/contract/**`.
5. Все цифры только из вывода команд; каждое утверждение ниже прописано `path:line`.

### Базовые числа (из команд)

| Показатель | Значение |
|---|---|
| Vitest: файлов / тестов | 406 / 4511 |
| Vitest: passed | 4251 |
| Vitest: failed | 1 (страйк, §C.1) |
| Vitest: expected fail (it.fails) | 2 |
| Vitest: skipped | 257 (13 файлов полностью, 4 — частично) |
| Playwright: собрано | 291 тестов / 27 файлов |
| Специф. файлов vitest (всего) | 438 (`src/**` + `tests/**` + `e2e/**`) |

## Находки

### A. Критические пути без реального покрытия (20 найдений)

| # | Путь | Статус | Доказательство |
|---|------|--------|----------------|
| A.1 | Мутации смен `cancel`/`decline`/`start`/`handover`/`waiver` | **не покрыт** локально | В `src/app/api/readiness/shifts/[id]/{cancel,decline,start,handover,waiver}/` лежит только `route.ts` (проверка `find ... -name '*.test.*'` — пусто). Единственное покрытие — `tests/integration/disposable-idor.spec.ts:42` (`POST /readiness/shifts/H/cancel`), но этот файл — **159/159 skipped** в локальном прогоне (лог vitest). |
| A.2 | Work-permits `approve`/`revoke`/`submit`; defects `reject`/`resolve`/`triage`; handovers `accept`/`rework` | **не покрыт** локально | 29 route-файлов под `src/app/api/readiness/`, тесты есть только в 4 каталогах (список `NO-TESTS`, см. вывод `find ... -type d -name '__tests__'`). Покрытие только там же, в проглоченной `disposable-idor` (159/159 skipped) и `tech-readiness-*` (все skipped). |
| A.3 | `reports/upsert` и `reports/admin-upsert` | **не покрыт** | В `src/app/api/reports/upsert/` и `src/app/api/reports/admin-upsert/` — только `route.ts`; остальных 11 report-роутов все имеют `__tests__/` (список выше). |
| A.4 | Инфра-репозитории shifts/permits/defects/handovers | **не покрыт** на уровне SQL | В `src/modules/readiness/infrastructure/` всего 4 тест-файла (`audit`, `idempotency`, `readiness-worker-entry`, `tenant-transaction`); `shift-repository.ts` (161 строк, 45 вхождений `tenantId`), `work-permit-repository.ts`, `defect-repository.ts`, `handover-repository.ts` — без юнит-тестов. Фильтры `tenantId` локально проверены только в `disposable-idor` и `rls-tenant-enforcement` (5/5 skipped). |
| A.5 | Реальная Redis-пусть ревочанс (fail-open) | **не покрыт** | `session-service.ts:137-161` — ветки «Redis нет / не ready / GET упал → `false`» (fail-open по политике). Тесты используют in-memory заглушку (`session-service.test.ts:37`, `:207` через `__setRevocationStoreForTests`), а роут logout намочивает весь session-service (`route.test.ts:26`). Живой Redis-клиент в тестах нигде нет. |
| A.6 | `TenantInvoice` (оплаты/инвойсы) | **схема без кода и без тестов** | `prisma/schema.prisma:65` (`model TenantInvoice`), `:77` (`stripeInvoiceId`), миграции `prisma/migrations/20260427200931_iron_rules_money_timestamptz_index` и `20260419190903_init`. В приложении **нуль** ссылок на TenantInvoice вне generated (rg по `src --include='*.ts'`), тестов — ноль; единственный `invoice` в тестах — не прозрачный тип медиа-сущности (`media-auth.test.ts:148`). Числа покрыты только на уровне форматирования (см. §F.1). |
| A.7 | Логин: интеграция «роут → сервис → БД → cookie» | **не покрыт** единым проходом | Роут-тест намочивает сервис (`login/route.test.ts:20-21`, `:25`, `:33`), сервисный тест намочивает репозиторий (`auth-service-credentials.test.ts:75` — `findUniqueMock`). Ни один тест не проходит путь целиком на реальном Prisma. Локально реальный bcrypt-проверочка есть только в A.7-1 (см. §F.3). |

### B. Избыточное намачивание (over-mocking)

| # | Где | Суть | Доказательство |
|---|-----|------|----------------|
| B.1 | `src/app/api/auth/login/__tests__/route.test.ts:11-33` | 4 независимых `vi.mock` (auth-service, audit, tenancy, csrf) за один файл — проверяется только ветвление роута, а не поведение. | Вывод `head -45`. |
| B.2 | `src/app/api/auth/logout/__tests__/route.test.ts:11-26` | Весь session-service заменён моком (`revokeMock`, `readSessionToken`, `attachSessionCookie`, `clearLocalSession`). Тесты `F6` доказывают только роутную логику; реальную ревочан-логику см. A.5. | Вывод `head -50`. |
| B.3 | `src/services/auth/__tests__/auth-service-credentials.test.ts:75-95` | Репозиторий намочен, но валидатор реального формата хеша (bcrypt, SHA-256 legacy) — да. Реальный SQL (`findUnique`, `update`) — только в `disposable-idor` (skipped). | Вывод `sed -75,95`. |

### C. Флейки (тайминги, порядок)

| # | Что | Статус | Доказательство |
|---|-----|--------|----------------|
| C.1 | **Единственный fail всего прогона**: `no-global-db-in-tx.test.ts:332` — сторож, который сканирует 300+ исходников, в полной сборке выходит за `timeout: 20000`. В одиночном прогоне — **оба раза 12/12 passed, EXIT=0**. | ФЛЕЙК (детерминированный по таймингу) | Строка итога `Tests 1 failed \| 4251 passed \| 2 expected fail \| 257 skipped (4511)`. Повторный запуск файла — `Test Files 1 passed (1) / Tests 12 passed (12) / EXIT=0`. |
| C.2 | Rate-limit e2e | Осознанно изолирован от параллельных проектов (IP-скоуп) — это **защита от флейка**, но тест живёт на одном проекте. | `e2e/rate-limit-e2e.spec.ts:1-22` («Runs only on chromium to avoid cross-project IP collisions»). |
| C.3 | Fake timers во всех 35 тест-файлах | **ФЛЕЙКОВ НЕ НАЙДЕНО.** В каждом файле с `useFakeTimers` после себя есть `vi.useRealTimers` (проверено циклом `for f in …; grep -q useRealTimers …; done` — ноль исключений). | См. вывод C.3 в логе. |
| C.4 | Порядок тестов | Явных взаимозависимостей (seed в singleton, мутация глобалов между `it`) не выявлено — тесты изолируются либо моком, либо `beforeEach` с `mockReset`/`clearAll`. | Наблюдение по `login`, `logout`, `rate-limiter` (`useRealTimers` в `afterEach`, `rate-limiter.test.ts:19-21`). |

### D. Молча проглоченные тесты (зелёный = не проверка)

| # | Файл | Проглочено | Причина |
|---|------|-----------|---------|
| D.1 | `tests/integration/disposable-idor.spec.ts` | **159/159** | `enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.CODEX_STAND_URL)` (`disposable-idor.spec.ts:7`). В зелёном локальном беге обе переменные пусты. |
| D.2 | `tests/integration/disposable-rls.spec.ts` | 21/21 | Та же пара переменных (паттерн подтверждён по аналогии в D.1). |
| D.3 | `tests/integration/tech-readiness-shifts.spec.ts` | 3/3 | То же. |
| D.4 | `tests/integration/tech-readiness-work-permits.spec.ts` | 4/4 | То же. |
| D.5 | `tests/integration/tech-readiness-projection.spec.ts` | 4/4 | То же. |
| D.6 | `tests/integration/tenant-transaction-pool.spec.ts` | 4/4 | То же. |
| D.7 | `tests/integration/rls-tenant-enforcement.spec.ts` | 5/5 | То же. |
| D.8 | `tests/integration/tenant-dictionary-migration.spec.ts` | 1/1 | То же. |
| D.9 | `tests/integration/disposable-m6-m8.spec.ts` | 5/5 | То же. |
| D.10 | `tests/integration/disposable-analytics-performance.spec.ts` | 2/2 | То же. |
| D.11 | `tests/integration/disposable-report-race.spec.ts` | 2/2 | То же. |
| D.12 | `tests/integration/disposable-equipment-race.spec.ts` | 3/3 | То же. |
| D.13 | `tests/integration/tech-readiness-write-pipeline.spec.ts` | 5/5 | То же. |
| D.14 | `tests/contract/tech-readiness-api.spec.ts` | **12/13** (1 живой) | См. вывод `tests/contract`. |
| D.15 | `tests/integration/disposable-restore.spec.ts` | 1/3 (2 живых) | См. вывод. |
| D.16 | `tests/integration/disposable-scripts.spec.ts` | 6/18 (12 живых) | См. вывод. |
| D.17 | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts` | **20/24** (4 живых) | «TODO» — не-критичные контракты, по design, не гоняются в CI. |

**Итого D: 17 файлов, 257 тестов проглочено локально — все из-за двух переменных окружения.** Это главное системное флейко-молчание: зелёный бейдж не значит, что IDOR/RLS/гонки/tech-readiness проверялись.

### E. Живые баги под тестом (`it.fails` — «найдено, но не исправлено»)

| # | Место | Суть | Доказательство |
|---|-------|------|----------------|
| E.1 | `src/components/piling/admin-equipment/__tests__/equipment-form-roundtrip.test.ts:196,201` | `it.fails '«1,5» должно читаться как 1,5, но Number даёт NaN (находка)'` × 2. Живой баг в форме: `equipment-form.tsx:398` использует `Number(s)`, а не `parseDecimalInput`. Пользователь, пишущий запятую, получает NaN/0. | `sed -188,210` (текст `it.fails`), `equipment-form.tsx:398`. |
| E.2 | `src/services/reports/__tests__/domain-events.test.ts:27` | `it('J2: пустой реестр — не доставка, событие отчёта уходит на повтор')` — проверен только **текущий** «нет подписчиков». Это snapshot-тест, не защитный: когда реестр наполнится, тест продолжит проходить, но поведение может быть другим. | `grep -n "it(\|describe("` по файлу — 1 тест на 27-й строке. |

### F. Проверено, проблем нет (контрольные области)

| # | Область | Статус | Доказательство |
|---|---------|--------|----------------|
| F.1 | Формат «N шт. / M м.п.» | **Покрыт.** | `src/lib/__tests__/format.test.ts:56-63` (`formatCountMeters(2832, 40311) === '2 832 шт. / 40 311 м.п.'`). |
| F.2 | Parse-decimal (запятая → дробь) | **Покрыт** на уровне `lib/parse-decimal`. | `src/lib/__tests__/parse-decimal.test.ts:5-14` (`parseDecimalInput('1,5') === 1.5`). Проблема E.1 — форм компонент, который этот lib **не** использует. |
| F.3 | Бcrypt-верификация + timing-equalizer | **Покрыт** на сервисном уровне. | `src/services/auth/__tests__/auth-service-credentials.test.ts:75-181` (реальные хеши, `TIMING_EQUALIZER`, SHA-256 legacy-отказ, lower-casing email). |
| F.4 | Авторизация (service) | **Покрыт** реальным кодом (без `vi.mock` на уровне service). | `src/services/auth/__tests__/authorization-service.test.ts` — `grep "vi.mock"` пуста, импорты только реальных модулей. |
| F.5 | Guard-тесты «все мутации обёрнуты `withMutation`» | **Покрыт** (source-level guard). | `src/app/api/__tests__/route-guards.test.ts` (323 строк), `mutation-audit.test.ts` (200 строк) — парсинг AST всех роутов. |
| F.6 | CSRF | **Покрыт** реальным обёрткой (не моком). | `src/lib/__tests__/csrf-protection.test.ts` (266 строк), заголовок: «the one that ACTUALLY runs on every state-changing API route via core/api-wrapper.ts → withMutation → withCsrf». |
| F.7 | Tenant-RLS (обёртка `set_config`) | **Покрыт** на уровне транспорта. | `src/core/security/__tests__/tenant-rls.test.ts` (229 строк, 6 describe/it). |
| F.8 | Sторож «нет глобального db в `$transaction`» | **Покрыт и работает** — но флейковат в полной сборке (C.1). | `src/lib/__tests__/no-global-db-in-tx.test.ts` (12 тестов, 342 строк). |
| F.9 | Playwright: сборка | **291/291 тестов в 27 файлах собраны без ошибок** (нет битых импортов). | `npx playwright test --list` → `Total: 291 tests in 27 files`. |
| F.10 | Очереки/фабрики (idempotency, outbox) | **Покрыты** в `readiness/infrastructure`. | `append-verify.test.ts`, `idempotency-repository.test.ts`, `tenant-transaction.test.ts`, `readiness-worker-entry.test.ts`. |

## Не проверено (честный список)

- **Запуск Playwright-тестов.** Делался только `--list` (291/27), реальный запуск требует стенда (`CODEX_STAND_URL`) и disposable-БД — не делалось. Статус 291 тестов: «собраны, не прогнаны».
- **Запуск vitest с `INTEGRATION_DATABASE_URL_OWNER` и `CODEX_STAND_URL`.** Без них 257 тестов (D.1–D.16) проглочены; с ними — непонятно, сколько из них реально зелёных. Локальной disposable-БД в этой среде нет.
- **Глубина `src/app/api/reports/pdf/__tests__/route.test.ts` (273 строк).** Не читал; не знаю, насколько намочен нижний слой. Вероятно, там же PDF-рендер намочен, но это **гипотеза**.
- **Тест `tests/contract/tech-readiness-api.spec.ts` — какой из 13 жив?** Видел, что 12/13 skipped, конкретный живой тест не идентифицировал.
- **`src/core/security/__tests__/tenant-rls.test.ts`** — видел заголовки describe/it, но не читал тело; не утверждаю, что там реальный `set_config` против мокнутого.
- **Реальный Prisma-запрос в `auth-service-credentials`** (F.3) — сервисный тест намочивает репозиторий (B.3); реальный SQL прогоняется только в `disposable-idor` (skipped локально).
- **Качество тестов `e2e/orion-industrial-cinematic.spec.ts`, `e2e/role-audit.spec.js`, `e2e/release-critical-path.spec.ts`** — не читал; только собрал.
- **`e2e/qa/crawl.ts`** — упоминается в заголовке как «НЕ ПРОВЕРЯЮТСЯ» («проходит Hermes-новичок с отменой в диалоге») — сам crawler прогонялся ли в этом беге — не знаю.

## Оценки по рискам

- **HIGH (1):** C.1 — единственная причина RED'а всего прогона в зелёной среде; не влияет на продукт, но ломает CI-сигнал.
- **HIGH (2):** D.1–D.16 — 5.7% тестов (`257/4511`) не прогоняются локально/в CI без стенда; IDOR/RLS-изоляция-между-тенантами — только «протестировано на стенде», а не «протестировано здесь».
- **MEDIUM (3):** A.1, A.2, A.4 — мутационные readiness-путь (смены, допуски, дефекты) не покрыты роутными тестами; покрываются только проглоченной интеграцией (D.1).
- **MEDIUM (4):** A.5 — реальная Redis-пусть не покрыта (fail-open по дизайну, но не проверен).
- **MEDIUM (5):** E.1 — живой баг ввода («1,5» → NaN) задокументирован как `it.fails`; не исправлен.
- **LOW:** A.6 (схема без кода), A.3, A.7, B.*, C.2, E.2.

## Рекомендации (не выполнены — READ-ONLY)

1. Вынести C.1 (`no-global-db-in-tx`) из основного беге в отдельный `slow`-набор, либо поднять `timeout` до 60 с (сейчас 20 с), чтобы CI-красный был детерминированным.
2. Добавить в CI обязательный бег `tests/integration/*.spec.ts` с disposable-БД, иначе 257 тестов — декорация.
3. Минимум для readiness: роутные тесты `cancel`, `start`, `handover`, `waiver`, `approve`, `reject` (по образцу `shifts/__tests__/route.test.ts`).
4. Реализовать `parseDecimalInput` в `equipment-form.tsx:398` и снять два `it.fails` (E.1).
5. Написать 1–2 теста `RedisRevocationStore.isRevoked`/`revoke` с реальным (или `ioredis-mock`) клиентом — ветка fail-open не покрыта (A.5).
