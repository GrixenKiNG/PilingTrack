# Качество тестов и слепые зоны (W143, независимый аудит)

READ-ONLY. Код не менялся, тесты не запускались, миграции/деплой не выполнялись.
Аудируемая версия: `D:/PillingR/wt-audit-0f53`, SHA **0f53cd01a264ffae97e3eaa7fea7582d90bf657d**.
Все числа получены командами подсчёта по этой версии; все `path:line` — реально
открытые или прогнанные `grep -n` строки. Где факт не подтверждён — стоит «не проверено».

## Итог

Всего тестовых блоков (`it(`/`test(`) по версии 0f53 — **3531**: unit 3291
(356 файлов), contract 65 (9 файлов), integration 82 (20 файлов), e2e 93
(27 файлов). Пропусков/заглушек: `.only` — 0; `it.todo` — 0; статических
`describe.skip` — 3 (в них **16** отключённых `it()`); условных
`describe.skipIf` — 12 и `describe.runIf` — 4 (все в `tests/integration`);
динамических `test.skip` в e2e — 15.

Находок: **критично 5, важно 12, мелочь 7** (всего 24). Топ-5:

1. `npm run test:unit` на самом деле тянет и `tests/integration` —
   `vitest.config.ts:38`. «Юнит-прогон» зависит от БД и молча пропускает
   гейтнутые наборы: зелёный прогон без базы не проверяет ничего.
2. 12 интеграционных спеков (единственные реальные проверки RLS, гонок
   отчёта, восстановления из дампа) гейтятся на `INTEGRATION_DATABASE_URL_OWNER`
   / `_APP`, которых нет ни в одном `.env*`-примере, а подстановка в
   `vitest.config.ts:17` знает только `DATABASE_URL_POSTGRES`/`_APP_ROLE` —
   локально все они всегда пропускаются.
3. `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` —
   7 `it()` (state machines готовности) спрятаны в `describe.skip` и не
   выполняются никогда.
4. `tests/contract/tech-readiness-api.spec.ts:49` — 9 `it()` в `describe.skip`,
   а харнесс на `:28-33` бросает «Bind ApiContractHarness»: контракта нет,
   а файл создаёт видимость покрытия.
5. e2e: CI гоняет лишь 5 спеков + `role-audit` (`.github/workflows/ci.yml:361-367`);
   ~18 из 27 файлов (весь `e2e/qa/`, `e2e/qa-ac/`, `smoke-e2e`,
   `monitoring-tile-editor`, `inspection-to-flow`, …) не запускаются нигде
   автоматически.

## Методика

Всё — в `D:/PillingR/wt-audit-0f53`, команды читают только файлы (ничего не пишут).

- Инвентарь и конфиги: `cat vitest.config.ts`, `cat vitest.integration.config.ts`,
  `node -e "…package.json.scripts"`, `cat playwright.config.ts`, шапки
  `playwright.qa*.config.ts` / `acqa` / `operator-v3` / `manual`.
- Число файлов: `find src \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l`
  (356); `ls tests/contract tests/integration`; `find e2e -name '*.spec.*'` (27).
- Число блоков: `grep -rEho '\b(it|test)\s*\(' … | wc -l` по каждому каталогу
  отдельно. Регекс НЕ считает `it.each(...)` как отдельный случай — реальных
  кейсов больше (в `src` 82 использования `.each`, т.е. блоков-параметризаций).
- Разбивка по каталогам: `grep -rnE '…' src | cut -d: -f1 | awk -F/ '{print $1"/"$2}' | sort | uniq -c`.
- Пропуски: `grep -rnE '\b(it|describe|test)\.(skip|todo|only|failing|concurrent)\b'`
  и `grep -rnE '(skipIf|runIf)'`.
- Моки: `grep -rhoE "vi\.mock\(['\"][^'\"]+['\"]" … | sort | uniq -c`;
  отдельно `grep -rln "vi.mock('@/lib/db'" src` (97 файлов).
- Условия запуска интеграции: чтение шапок всех `tests/integration/*.spec.ts`,
  `grep -rhoE 'process\.env\.[A-Z_0-9]+' tests/integration/*.spec.ts`,
  `cat tests/integration/helpers/disposable-db.ts`, `cat .env.example`.
- CI: `cat .github/workflows/ci.yml`, `cat .github/workflows/integration.yml`,
  `cat scripts/check-integration-results.cjs`.
- Команды проверок из §6 AGENTS.md (tsc/lint/test/build) и `playwright --list`
  НЕ запускались — задание запрещает прогон тестов; соответствующие цифры
  помечены «не проверено».

## Таблица по каталогам

| Каталог | Файлов | Блоков `it(`/`test(` | Тип | Как запускается |
|---|---|---|---|---|
| `src/**` (unit) | 356 | 3291 | unit | `vitest run` (`package.json:42`) |
| `tests/contract/*.spec.ts` | 9 | 65 | contract | `vitest run tests/contract` (`:43`), плюс в общий `vitest run` (`vitest.config.ts:37`) |
| `tests/integration/*.spec.ts` | 20 | 82 | integration | `vitest run tests/integration` (`:44`, идёт через `vitest.config.ts`, не через `vitest.integration.config.ts`) |
| `e2e/**` | 27 | 93 | e2e (Playwright) | `npx playwright test` (`:38`) |

Разбивка unit по подкаталогам (блоки): `src/components` 1152, `src/modules` 787,
`src/app` 393, `src/services` 348, `src/core` 288, `src/lib` 227, `src/workers` 85,
`src/__tests__` 8, `src/test` 2.

Разбивка `src/modules` по подмодулям (файлов/блоков): crews 5/64, equipment 10/129,
inspections 9/72, layout 1/22, monitoring 2/13, operator-mobile 9/91,
readiness 21/134, reports 10/147, safety 3/23, settings 2/14, sites 7/78.
**Ноль тестовых файлов**: `src/modules/analytics`, `src/modules/system`,
`src/modules/telemetry`, `src/modules/users` (это фасады к `src/services`).

## Пропущенные и заглушённые тесты

Статические (`describe.skip` — выполняются никогда):

| path:line | Что отключено | Отключённых `it()` |
|---|---|---|
| `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80` | «Tech Readiness production state machines [PRD §6]» | 4 (строки 100,115,123,134) |
| `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:143` | «Tech Readiness evaluation [PRD §5]» | 3 (144,155,167) |
| `tests/contract/tech-readiness-api.spec.ts:49` | «Tech Readiness API contract [PRD §8]»; харнесс на `:28-33` бросает `Bind ApiContractHarness` | 9 |

Итого: **16 отключённых `it()` в 3 статических `describe.skip`.**

Условные гейты в `tests/integration` (12 `describe.skipIf` + 4 `describe.runIf`):

- на `INTEGRATION_DATABASE_URL_OWNER` (+ `_APP`/`INTEGRATION_DB_CONTAINER`/`CODEX_STAND_URL`):
  `disposable-analytics-performance.spec.ts:11,32`, `disposable-equipment-race.spec.ts:7`,
  `disposable-idor.spec.ts:64`, `disposable-m6-m8.spec.ts:12`,
  `disposable-report-race.spec.ts:7`, `disposable-restore.spec.ts:32`,
  `disposable-rls.spec.ts:7`, `disposable-scripts.spec.ts:37`,
  `tech-readiness-write-pipeline.spec.ts:18`;
- на `DATABASE_URL_APP_ROLE`: `rls-tenant-enforcement.spec.ts:44`;
- на `DATABASE_URL_POSTGRES` (`runIf`): `tech-readiness-projection.spec.ts:24`,
  `tech-readiness-shifts.spec.ts:37`, `tech-readiness-work-permits.spec.ts:40`,
  `tenant-dictionary-migration.spec.ts:14`; (`skipIf`) `tenant-transaction-pool.spec.ts:21`.

Динамические `test.skip` в e2e (15): `e2e/inspection-to-flow.spec.ts:8` (нужен
`INTEGRATION_DATABASE_URL_OWNER`), `e2e/monitoring-tile-editor.spec.ts:13,15`
(проект + `E2E_S3_READY`), `e2e/rate-limit-e2e.spec.ts:9`, `e2e/release-critical-path.spec.ts:17,65,91`,
`e2e/report-creation-flow.spec.ts:40,49`, `e2e/qa-ac/post-merge-smoke.spec.ts:35,67,82,83,92,93,102,111,117`
(гейт `POST_MERGE_SMOKE`).

`it.todo` — 0. `.only` — 0 (хорошо: «залипшего» фокуса нет).

## Ключевые модули

| Модуль | Тесты | Mock или реальная база | Что не покрыто |
|---|---|---|---|
| **Смена** | `src/modules/readiness/domain/shifts/__tests__/shifts.test.ts` (переходы/передачи, чистая логика); `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts`; `src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts` | domain — реальная логика; `shift-close.test.ts:14,17` — **mock** `@/modules/readiness/server` и audit-сервиса (транзакция подменена); реальная БД — только `tech-readiness-shifts.spec.ts:37` (`runIf`, локально skip) | реальный старт/закрытие смены по SQL+RLS вне CI-диспозитива; авто-закрытие; поведение при параллельной гонке (есть лишь в гейтнутых `disposable-*`) |
| **Отчёты** | `src/modules/reports/application/commands/__tests__/report-command-service.test.ts`; `src/modules/reports/domain/__tests__/report-aggregate.test.ts`; `src/components/piling/admin-reports/__tests__/report-totals.test.ts`; ~15 route-тестов `src/app/api/reports/**` | агрегат и итоги — реальная логика; `report-command-service.test.ts:79` мокает `@/lib/db`, `:98` — репозиторий (mock); route-тесты — mock `@/lib/db`; реальная БД — `disposable-report-race.spec.ts:7` (skip всегда вне CI-диспозитива) и `tech-readiness-write-pipeline.spec.ts:18` (skipIf) | реальный upsert отчёта (SQL `report.repository`) против живой БД; расчёт часов простоя/метров на реальных данных через UI |
| **Расчёты** | `src/lib/__tests__/pile-length.test.ts`, `pile-meters-invariant.test.ts`, `downtime-hours.test.ts`, `downtime-hours-input.test.ts`, `components/piling/admin-reports/__tests__/report-totals.test.ts` | чистая логика (без БД) | лучший по качеству контур: длинна свай, часы простоя, итоги проверяются на конкретных числах и упадут при неверном результате. Регресс «формат/экран» (не сама математика) — не проверено |
| **Права** | `src/services/auth/__tests__/authorization-service.test.ts`; `tests/integration/authorization-boundaries.spec.ts` (матрица роль↔ability, чистая); `resource-access-service.test.ts` (акторы руками, без БД) | всё — реальная логика, но **без базы** | права на живой БД/RLS end-to-end (кросс-тенантный 404) — только `disposable-idor.spec.ts:7,64` (нужен `CODEX_STAND_URL`, локально всегда skip) |
| **Офлайн-очередь** | `src/components/piling/operator-mobile/offline-queue.test.ts` (реальный `localStorage`, fetch подменён); `__tests__/queue-flow.test.tsx` (реальные `offline-queue.ts`/`api.ts`/`use-offline-queue.ts`, подменены `fetch`/`localStorage`/`onLine`); `__tests__/use-offline-queue.test.tsx` (модуль очереди замокан) | реальная логика очереди; сеть — mock | серверный конец — маршрут `/api/operator/mobile/command` ни одним тестом очереди не проверяется; «записано → реально сохранилось на сервере» не доказывается |

Все пять модулей имеют хотя бы один тест, который упадёт при неверном
результате чистой логики. Ни у одного нет регулярной проверки против реальной
БД: единственные такие тесты гейтнуты и локально молчат (см. находки 2, 6–9, 11).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемый фикс |
|---|---|---|---|---|---|
| 1 | критично | `vitest.config.ts:38` + `package.json:42` | `include` содержит `tests/integration/**/*.spec.ts`, поэтому `npm run test:unit` (`vitest run`) запускает и интеграционные спеки. | «Юнит-прогон» на самом деле зависит от БД: без неё гейтнутые наборы молча skips, и разработчик видит зелёное, не проверив интеграцию. Один и тот же `npm run test:unit` даёт разный охват на разных машинах. | Убрать `tests/integration` из unit-`include` либо явно печатать/падать на пропущенных наборах. |
| 2 | критично | `tests/integration/disposable-rls.spec.ts:7`, `disposable-restore.spec.ts:32`, `disposable-report-race.spec.ts:7`, `disposable-idor.spec.ts:64` и др. (12 `skipIf`) | Единственные настоящие проверки RLS, восстановления из дампа, гонок записи отчёта и IDOR гейтятся на `INTEGRATION_DATABASE_URL_OWNER`/`_APP`/`CODEX_STAND_URL`/`INTEGRATION_DB_CONTAINER`, которых нет ни в `.env.example`, ни в `.env.docker.example`, ни в `.env.production.example`. | Вне специального CI-диспозитива эти наборы не запускаются вовсе (у `disposable-db.ts` жёсткое требование локального `codex_test`). Локально «всё зелёное» — а самых дорогих проверок не было. | Задокументировать подъём одноразовой БД (`scripts/test-db-up.sh`) и gate-ить в отдельной команде; не считать эти спеки частью обычного прогона. |
| 3 | критично | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` | 7 `it()` (state machines смены/передач и оценка готовности) внутри `describe.skip`; имя файла `.todo.test.ts` это подтверждает. | Машины состояний готовности не проверяются. Файл лежит в наборе и создаёт ложное ощущение покрытия; в отчётах по числу тестов они посчитаны. | Либо реализовать и включить, либо удалить с явной записью — не оставлять в skip. |
| 4 | критично | `tests/contract/tech-readiness-api.spec.ts:28-33,49` | 9 `it()` в `describe.skip`; объект `api` бросает `Bind ApiContractHarness to the implemented readiness routes` / `Bind isolated test tenant seed`. | Контракт техготовности не реализован, но 9 тестов числятся в contract (65 блоков). Реального контракта нет. | Пометить/удалить нереализованный харнесс; завести контракт-тест после появления маршрутов. |
| 5 | критично | `.github/workflows/ci.yml:361-367`, `e2e/qa-ac/post-merge-smoke.spec.ts:35` | CI-джоб e2e запускает только `app`, `admin-users`, `admin-dictionaries`, `operator-report-smoke`, `report-creation-flow` + `role-audit`. Остальные ~18 файлов (весь `e2e/qa/`, `e2e/qa-ac/`, `smoke-e2e`, `monitoring-tile-editor`, `inspection-to-flow`, `release-critical-path`, `rate-limit-e2e`, `orion-…`) не гоняются ни в одном workflow. | Регресс в UI техготовности, выгрузках, клавиатуре, RBAC-негативах, rate-limit не поймается до прода. Динамический `test.skip` дополнительно глушит `post-merge-smoke` и `inspection-to-flow`. | Ввести периодический (nightly) прогон полного e2e; для env-гейтов — падать или явно отмечать skip. |
| 6 | важно | `src/modules/reports/application/commands/__tests__/report-command-service.test.ts:79,98` | Write-path отчёта проверяется на mock-`@/lib/db` и mock-репозитории. | Mock-тест не проверяет реальный SQL/схему: переименование колонки/ошибка upsert пройдут незамеченными, пока не сломается гейтнутый интеграционный тест. | Один реальный интеграционный тест upsert против одноразовой БД (в контуре disposable). |
| 7 | важно | `tests/integration/disposable-idor.spec.ts:7,64` | Кросс-тенантный доступ (401/403/404 на чужом ресурсе) на живой БД проверяется только здесь и требует `CODEX_STAND_URL`. | Владелец-доверие: изоляция — критичная зона, а её единственный HTTP-тест вне CI не запускается. | Прогонять IDOR-спек в том же CI-диспозитиве, что и остальные disposable. |
| 8 | важно | `tests/integration/rls-tenant-enforcement.spec.ts:44` | Гейт на `DATABASE_URL_APP_ROLE`; при её отсутствии (или если в `.env` креды суперпользователя, обходящего RLS) набор молча пропускается. | Комментарий в файле ссылается на CI-шаг «RLS isolation suite must actually run» — он существует только в `ci.yml:202`. Локальный прогон охраны не имеет и может показывать пройденный «пустой» тест. | Локально: проверять `rolsuper/rolbypassrls=f` перед прогоном или падать при skip. |
| 9 | важно | `tests/integration/tech-readiness-write-pipeline.spec.ts:18` | Реальный контур «инспекция → outbox → снапшот → read-model» гейтнут `skipIf` на `INTEGRATION_DATABASE_URL_*`. | Самый ценный end-to-end тест записи (включая откат при сбое outbox-insert) вне CI-диспозитива не идёт. | Включить в nightly-CI; локально — поднимать БД по инструкции. |
| 10 | важно | `e2e/inspection-to-flow.spec.ts:8` | `test.skip(!INTEGRATION_DATABASE_URL_OWNER)` — переменной нет и в env e2e-джоба CI. | Сценарий осмотра «до потока» не выполняется нигде автоматически, хотя требует лишь seed-шаблонов. | Либо поднять шаблоны в seed и снять гейт, либо вынести в nightly с явной БД. |
| 11 | важно | `src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts:14,17` | `closeShift` проверяется на замоканной транзакции (`withReadinessTenantTransaction`) и замоканном audit-сервисе. | Проверяется логика вызовов, а не реальная запись/RLS/идемпотентность закрытия смены. | Реальный интеграционный кейс закрытия смены в disposable-контуре. |
| 12 | важно | `src/services/auth/__tests__/resource-access-service.test.ts` (без mock) + `tests/integration/authorization-boundaries.spec.ts:12` | Матрица прав и `ensureTenantAccess` покрыты только in-process; акторы собираются руками. | Не проверяется связка «сессия из БД → права → запрос»: смена маппинга ролей в БД не отразится. | Один интеграционный кейс «роль из реальной сессии получает/не получает доступ». |
| 13 | важно | `tests/contract/tech-readiness-api.spec.ts:49` (см. #4), `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` (см. #3) | 16 contract/domain-тестов отключены, но засчитаны в общих числах (65 contract, 3291 unit). | Отчёты «сколько тестов» завышены: реально выполняемых меньше. | Держать отдельный учёт skip в CI/отчётах. |
| 14 | важно | `src/app/api/**` (20 файлов мокают `@/lib/db`), `src/services/audit`, `src/services/users` | Ряда модулей нет в тестах иначе как через mock-БД: route-хендлеры, audit-сервис, users. | Mock-тесты доказывают маршрутизацию, но не работу с реальной схемой; регрессы миграций не ловятся. | Дымовые интеграционные проверки ключевых пишущих маршрутов. |
| 15 | важно | `src/components/piling/operator-mobile/offline-queue.test.ts`, `__tests__/queue-flow.test.tsx` | Очередь тестируется глубоко, но `fetch` всегда подменён; серверный обработчик `/api/operator/mobile/command` не участвует. | «Запись ушла» проверяется против фейкового fetch; несовпадение формата команды с реальным роутом не поймается. | Один кейс «queue → реальный роут на одноразовой БД». |
| 16 | важно | `vitest.config.ts:17,33` | Из `.env` в тесты подставляются только `DATABASE_URL_POSTGRES` и `DATABASE_URL_APP_ROLE`. | Прочие DB-ключи (`INTEGRATION_*`) не подставляются → интеграционные спеки непредсказуемо skip/run в зависимости от машины. | Унифицировать переменные окружения тестов. |
| 17 | важно | `playwright.config.ts:41-58` (проекты) + `e2e/rate-limit-e2e.spec.ts:9`, `release-critical-path.spec.ts:17,65,91` | 4 проекта (chromium, Mobile Safari, Mobile Chrome, unauthenticated) и проектные `test.skip` уменьшают реальный охват; `unauthenticated` матчит только `login.spec.ts`. | Ожидаемое число e2e-запусков ≠ числу блоков; часть контента выполняется лишь на chromium. | Учесть в отчётах «сколько реально выполняется на проект». |
| 18 | мелочь | `vitest.config.ts:69-73` | Порог покрытия 24/23/19/19 %. | Добавление кода без тестов почти не ловится ratchet-флором. | Поднимать по мере роста покрытия (правило проекта — вверх, не вниз). |
| 19 | мелочь | `src/**` — 82 `.each` | `it.each` даёт больше кейсов, чем блоков `it(`; числа из «сырых» grep несопоставимы. | Подсчёт «тестов» гуляет в зависимости от метода. | Для отчётов считать и блоки, и кейсы, и помечать метод. |
| 20 | мелочь | `e2e/comprehensive-test.ts` | Не собирается Playwright (имя не `*.spec.ts`), т.е. не запускается. | Мёртвый файл создаёт видимость покрытия. | Удалить или переименовать в `*.spec.ts`, если он живой. |
| 21 | мелочь | `playwright.qa.config.ts`, `playwright.acqa.config.ts`, `playwright.operator-v3.config.ts`, `playwright.manual.config.ts` | Отдельные конфиги с другим `testDir`; базовый `npm run test:e2e` их не использует. | Часть e2e видна только при явном `-c`. | Держать в README явный список того, что и как запускается. |
| 22 | мелочь | `src/modules/analytics`, `src/modules/system`, `src/modules/telemetry`, `src/modules/users` | Ноль тестовых файлов в модуле (фасады к `src/services`). | Покрытие есть только на уровне `src/services` (mock). | Решить, где живёт настоящий тест — services или modules. |
| 23 | мелочь | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts` (имя) | Слово `.todo` в имени файла, но внутри `describe.skip` — смешаны два механизма. | Механику пропуска не видно по имени. | Однообразно: либо todo, либо skip. |
| 24 | мелочь | `.github/workflows/ci.yml:85` | Unit-джоб гоняет `vitest run src/ tests/contract --coverage`, т.е. собирает покрытие по `src/**`; integration-джобы — без покрытия. | Общий знаменатель покрытия — только по unit. | Если важен сквозной процент — считать и по интеграции. |

## Не проверено

- Тесты не запускались (запрет задания): реальные числа passed/skipped, факт
  красноты/зелени и `npx playwright test --list` (сколько именно e2e-кейсов
  собирается по 4 проектам) — **не проверено**.
- Содержимое `.env`/`.env.local` в рабочем дереве не читалось (правило проекта);
  вывод «локально интеграция пропускается» сделан по конфигам и `.env*-example`,
  а не по фактическому файлу — **не проверено на конкретной машине**.
- Текущее состояние CI (зелёные ли прогоны) — не проверялось.
- Наличие/отсутствие теста `fuel-log.ts` (`computeFuelConsumption`) не проверял.
- Не проверял, покрыт ли реальной БД маршрут `/api/operator/mobile/command` где-либо вне очереди.

## Приложение: сравнение с прошлыми отчётами

Старые отчёты читались только ПОСЛЕ независимого прохода.

- Отчёт 06 (`06-test-gaps.md`) перечислял `src/lib/downtime-hours.ts` без
  прямого теста. В версии 0f53 файлы `src/lib/__tests__/downtime-hours.test.ts`,
  `pile-length.test.ts`, `report-totals.test.ts` существуют — часть тех дыр
  закрыта; `fuel-log` не перепроверял (см. «Не проверено»).
- Отчёт 25 (`25-e2e-gaps.md`) описывал набор из 12 e2e-файлов и 114
  листинг-тестов и отсутствие операторского контура. В 0f53 e2e-файлов **27**,
  появились `e2e/qa/`, `e2e/qa-ac/`, `smoke-e2e`; при этом CI по-прежнему
  запускает лишь горстку спеков (находка 5). Числа из отчёта 25 к 0f53
  неприменимы — пересчитаны здесь заново.
- Отчёт 13 (`13-readiness-e2e-skip.md`) разбирал `e2e/tech-readiness-production.spec.ts`.
  В 0f53 такого файла нет; его место занял unit-файл
  `production-contracts.todo.test.ts` — тоже целиком в `describe.skip`
  (находка 3). Вывод «эталон написан по контракту, а не по коду, и не
  запускается» сохраняется в новой форме.
- Мои находки 1–2 (unit-прогон тянет интеграцию; локальный молчаливый skip
  DB-гейтов) в прочитанных отчётах не встречались — они специфичны для
  текущего `vitest.config.ts` (0f53).
