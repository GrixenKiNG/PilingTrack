# R81 — пропускаемые тесты vitest: 39 скипов, условные гейты и «пустые» тесты

## Итог

Полный прогон vitest на ветке `hermes/q4-0926` (97 коммитов впереди `origin/main`):
`node node_modules/vitest/vitest.mjs run` → **Test Files 297 passed | 2 skipped (299)**,
**Tests 2507 passed | 39 skipped (2546)**, exit code **0**. Числа в задании (2434/39) совпадают по
скипам, но не по «passed» — я привожу измеренные.

Все 39 скипов дают ровно **три файла**, и во всех трёх скип — это `describe.skip` над заготовкой с
непривязанным харнессом-заглушкой, а не забытый `it.skip`:

- `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts` — **20**;
- `tests/contract/tech-readiness-api.spec.ts` — **13**;
- `tests/integration/tech-readiness-write-pipeline.spec.ts` — **6**.

Отдельно: **5 файлов (21 тест)** гейтятся условно (`describe.skipIf`/`runIf` на `DATABASE_URL*`). В моём
прогоне гейт открыт (`.env` подхватывается `vitest.config.ts:25-32`) — наборы выполнились и прошли; но
страж против молчаливого скипа есть только у RLS-набора (`ci.yml:175-187`), у остальных четырёх нет.
Итого по серьёзности: **критично — 0, важно — 5, мелочь — 16** (плюс 5 честных отрицательных выводов).

Топ-5 по важности (детали — в «Находках»):
1. `tech-readiness-write-pipeline.spec.ts:38` — атомарность транзакции записи (источник + audit + outbox +
   идемпотентность), откат при сбое и атомарность проекции: **активного дубля нет ни в одном наборе**.
2. `tech-readiness-api.spec.ts:173,272,290` — безопасный 404 для чужого ресурса, курсор под другие фильтры,
   паритет хеша фильтров JSON/CSV: активного дубля нет (остальные 10 кейсов файла дублируются).
3. `production-contracts.todo.test.ts:80,143` — 20 тестов «непокрытой готовности», которая **на самом деле
   покрыта** активными доменными тестами; файл даёт ложную картину.
4. `tenant-transaction-pool.spec.ts:21` (и ещё 3 файла) — 21 тест молча исчезнет из прогона, если пропадёт
   `DATABASE_URL_POSTGRES`; стража CI на них не распространяется.
5. `csrf-protection.test.ts:81` — единственное утверждение `not.toBeNull()` на защите от CSRF.

Пустых тестов (без `expect`, с `expect` в непойманном промиссе или в непрошеном колбэке) в наборе
**нет**. Самые слабые с точки зрения силы утверждения перечислены отдельным топ-5.

## Методика

Всё воспроизводимо на этой ветке; ни один существующий файл не изменён (создан только этот отчёт).

1. **Честный прогон.** `node node_modules/vitest/vitest.mjs run > файл 2>&1; echo $?` — вывод в файл, без
   `| tail`, чтобы не потерять код возврата: `VITEST_EXIT=0`, `297 passed | 2 skipped (299)`,
   `2507 passed | 39 skipped (2546)`.
2. **Именованный список скипов.** Тот же прогон с `--reporter=json --outputFile=…`, затем разбор JSON
   (`status` = `skipped`) — получены имена и файлы всех 39 скипов, а не только счётчик. Именно так
   установлено, что условные `skipIf/runIf`-наборы **не** попали в скипы (гейт был открыт).
3. **Статический поиск скипов.** Регулярки по всему репозиторию: `(it|test|describe).(skip|todo|skipIf|runIf)`,
   `\.skip(`, `\.only(`, `xit|xtest|xdescribe|fit|fdescribe`, `=> {}`, `process.env` внутри тестов.
4. **AST-обход всех 299 собранных файлов** (`typescript` из `node_modules`, скрипт на адаптере
   `D:/tmp/r81-scan.cjs`): искались тесты без `expect`/`assert` вообще; тесты, где **все** `expect` лежат
   внутри колбэка к `setTimeout/…/Promise/.then`; пустые тела; `if (…) return;` прямо в теле теста;
   тесты, где **все** матчеры слабые (`toBeDefined/toHaveLength`… нет — `toBeDefined|toBeTruthy|toBeFalsy|
   toBeInstanceOf|not.toBeNull|not.toBeUndefined`); пустые `describe`; проглоченные ошибки (`catch {}`).
5. **Независимая проверка «пустых».** Отдельно: файлы, где вообще нет `expect`, но есть тесты
   (таких нет), и скан на `it.each` (AST обязан видеть `it.each([...])(...)`, иначе часть файлов
   выпадает из проверки — эта ошибка была в первом проходе и исправлена).
6. **Сверка с активным покрытием.** Для каждого скипнутого кейса искался действующий дубль: открыты
   `src/modules/readiness/**/__tests__/*.test.ts`, `src/app/api/readiness/**/__tests__/*.test.ts`,
   `tests/integration/**`. Оттуда вывод «дублируется / не дублируется».
7. **Не собираемые vitest файлы.** Сравнение `find` по `*.test.*`/`*.spec.*` (313 файлов) со списком из
   JSON-прогона (299): 14 «не собранных» — это `e2e/**` (Playwright) и `tests/e2e-archive/**` (исключён
   намеренно, `vitest.config.ts:45-48`). Ловушки именования (`*.spec.ts` под `src/`) — нет.
8. **Границы.** Замороженные зоны (варианты операторского экрана, ORION) не анализировались как источники;
   файлы вне vitest (Playwright, k6) отмечены отдельно.

## Находки

| # | серьёзность | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|---|---|---|---|---|
| 1 | важно | `tests/integration/tech-readiness-write-pipeline.spec.ts:38` (кейсы 39,76,94,125,142,167) | `describe.skip` всего набора; харнесс — `Proxy`, любой метод которого бросает «Bind IntegrationHarness to an isolated readiness test database» (стр. 30-36). 6 тестов: одна транзакция на источник+audit+outbox+идемпотентность, откат при сбое audit/outbox, атомарная проекция снапшота и отметки `projected`, read-model без переписывания истории, синхронное решение о пуске из авторитетных строк | **Активного дубля нет.** Ближайшие активные наборы проверяют другое: `tests/integration/outbox-projection.spec.ts:34-103` — только шину доменных событий (без транзакции/БД), `tests/integration/tech-readiness-shifts.spec.ts:153` — параллельные пуски, а не откат. Это ровно класс «полу-запись двух ключей об одном факте», на котором проект уже спотыкался (Redis MULTI/EXEC). Если модуль техготовности включён в проде, цена ошибки — неполная запись аудита/outbox | Включить нельзя «как есть»: привязать харнесс к одноразовой БД по образцу `tests/integration/tech-readiness-projection.spec.ts:24-46` (создаёт БД из явного списка миграций) — инфраструктура для этого в репозитории уже есть |
| 2 | важно | `tests/contract/tech-readiness-api.spec.ts:49` (кейсы 50,85,122,149,173,191,220,249,272,290) | `describe.skip` 13 контрактных тестов `/api/readiness/*`; харнесс `api.request/seedFixture/resetFixture` — заглушки, бросающие исключение (стр. 32-42) | 10 из 13 кейсов дублируются активными тестами (ETag/428/идемпотентность — `src/modules/readiness/application/command-pipeline/__tests__/command-pipeline.test.ts:17-58`; RBAC чтения — `src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts:62-86`; спуфинг контекста — `src/app/api/readiness/bootstrap/__tests__/route.test.ts:49`; команды смен — `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts:13-26`). **Активного дубля нет у трёх**: единый безопасный 404 для отсутствующего и чужого ресурса (стр. 173), отклонение курсора, выпущенного под другие фильтры (стр. 272), паритет хеша фильтров JSON-аудита и CSV-экспорта (стр. 290) | Не включать набор целиком. Три названных кейса (404, курсор) перенести в активные route-тесты с одноразовой БД, паритет фильтров — юнит-тестом рядом с `src/modules/readiness/application/__tests__/csv-export.test.ts` |
| 3 | важно | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80` и `:143` | Два `describe.skip` = 20 тестов. Все адаптеры — `pendingImplementation`, который всегда бросает (стр. 50-61): снять скип без переписывания файла невозможно, тесты упадут на первом же вызове | Файл создаёт ложное впечатление «production-поведение техготовности не покрыто». На деле оно покрыто активными доменными тестами: переходы смен и передач — `domain/shifts/__tests__/shifts.test.ts:9-40`, переходы и согласование нарядов (в т.ч. «две подписи разных людей», «запрет самосогласования») — `domain/permits/__tests__/work-permit.test.ts:40-150`, оценка готовности (fail-closed без опубликованных правил, блокер vs предупреждение по наряду) — `domain/evaluation/__tests__/evaluator.test.ts:33-173`. Активный блок аудита в этом же файле (стр. 179-240) дублирует `domain/audit/__tests__/audit-chain.test.ts:6-45` | Не «включать», а либо удалить файл (политика прямо запрещает снимать набор против заглушек — `docs/plans/tech-readiness-production-work-plan.md:53`), либо переписать адаптеры на реальные `transitionShift/approvePermit/evaluate`. Решение владельца |
| 4 | важно | `tests/integration/tenant-transaction-pool.spec.ts:21` | `describe.skipIf(!connectionString)` на `DATABASE_URL_POSTGRES`: без переменной 4 теста (ленивые тенант-транзакции, роли без BYPASSRLS) пропускаются молча | В моём прогоне гейт открыт и набор прошёл (подтверждено `--reporter=verbose`). Но, в отличие от RLS-набора, у него **нет стражи** против молчаливого скипа: CI-шаг «RLS isolation suite must actually run» (`.github/workflows/ci.yml:175-187`) проверяет только `rls-tenant-enforcement.spec.ts`. Достаточно правки в конфиге/окружении — и 4 теста изоляции тенантов исчезнут, а прогон останется зелёным | Распространить CI-проверку «в логе нет `skipped`» на все DB-гейт-файлы (или добавить в каждый набор `expect.hasAssertions`-эквивалент) |
| 5 | важно | `src/lib/__tests__/csrf-protection.test.ts:81-84` | Единственное утверждение охраны от CSRF — `expect(res).not.toBeNull()`, тогда как соседний тест того же класса (стр. 72-79) проверяет `res!.status === 403` | Контракт `withCsrf`: `null` = запрос пропущен, непустой ответ = заблокирован (см. стр. 96). Тест ловит только «не пропущен», но не фиксирует статус/тело: любой непустой ответ (например 400 от другой ветки) пройдёт. Это защитный (security) регресс-тест — слабое утверждение здесь дороже обычного | `expect(res!.status).toBe(403)` — как в соседнем кейсе |
| 6 | мелочь | `tests/integration/tech-readiness-work-permits.spec.ts:40` | `describe.runIf(Boolean(connectionString))` — 4 теста (гонки согласований, cross-tenant FK) молча пропускаются без `DATABASE_URL_POSTGRES` | Тот же риск, что в №4; стражи нет | Как №4 |
| 7 | мелочь | `tests/integration/tech-readiness-shifts.spec.ts:37` | То же, 3 теста (20 параллельных пусков, конфликт двух диспетчеров, устаревший снапшот) | Как №4 | Как №4 |
| 8 | мелочь | `tests/integration/tech-readiness-projection.spec.ts:24` | То же, 4 теста (дедупликация доставки, откат частичной проекции, отставание доставки) | Как №4 | Как №4 |
| 9 | мелочь | `tests/integration/tenant-dictionary-migration.spec.ts:14` | То же, 1 тест (независимые копии справочника у тенантов) | Как №4 | Как №4 |
| 10 | мелочь | `tests/integration/rls-tenant-enforcement.spec.ts:44` | `describe.skipIf(!APP_ROLE_URL)` — единственный набор со стражей (комментарий стр. 24-29 + CI-шаг) | Не проблема, а **эталон**: остальные DB-гейты надо привести к нему. Фиксирую, чтобы не «починить» наоборот | Оставить, тиражировать |
| 11 | мелочь | `tests/contract/tech-readiness-api.spec.ts:122-147` | В скипнутом наборе зашита RBAC-матрица: handover от `MECHANIC` ожидается 200, от `DISPATCHER` — 403 | Соседний активный набор утверждает иначе про запуск смены: «Запуск смены — решение диспетчера» (`tests/integration/tech-readiness-shifts.spec.ts:156-157`). Включив кейс как есть, можно зафиксировать неверное поведение. Матрицу в коде (`src/modules/readiness/domain/access-matrix.ts`) я не сверял — это «не проверено» | Сверить матрицу с кодом до любого включения (решение владельца/архитектора) |
| 12 | мелочь | `src/app/api/__tests__/api-routes.test.ts:62-68` | Тест «exports required functions»: четыре `toBeDefined()` на экспортах `authorization-service`, ни одного утверждения о поведении | Не поймает ни смену сигнатуры, ни регресс прав. Дым, создающий ощущение покрытия сервиса авторизации | Удалить: матрица прав уже запиннена целиком в `tests/integration/authorization-boundaries.spec.ts` |
| 13 | мелочь | `src/app/api/__tests__/api-routes.test.ts:121-127` | То же для `rate-limiter` (`rateLimiter`, `.check`, `.reset` — только `toBeDefined`) | Как №12; поведение лимитера покрыто `src/lib/__tests__/rate-limiter.test.ts` | Удалить |
| 14 | мелочь | `src/app/(app)/(readiness-admin)/__tests__/layout.test.tsx:40-49` | `it.each` на 4 роли, единственное утверждение — `expect(result).toBeTruthy()` | Фактически проверяется «не бросило и не редиректнуло». Пропуск запрещённой роли поймается (отдельные кейсы ниже), а «отрендерил нужное дерево» — нет | Достаточно `toBeDefined`-уровня? Оставить, но не считать это проверкой содержимого: при необходимости добавить `toContain('READINESS')` |
| 15 | мелочь | `src/core/security/__tests__/tenant-context.test.ts:92-96` | Единственное утверждение — `expect(stored).toBeDefined()` | Здесь это осмысленно (проверяется именно наличие на `globalThis`), помечено для полноты — ложный «пустой» кандидат | Оставить |
| 16 | мелочь | `src/components/piling/__tests__/login-page.test.tsx:69-75` | 5 × `toBeDefined()` на элементах формы | `getByText`/`getByLabelText` сами бросают при отсутствии, поэтому тест работоспособен; матчер ослабляет намерение и маскирует «элемент есть, но не отрендерен/скрыт» | `toBeInTheDocument()`/`toBeVisible()` |
| 17 | мелочь | `tests/contract/layout-template.spec.ts:36-45` | `expect(saveLayout(...)).resolves.toBeTruthy()` — единственное утверждение кейса «ships a valid equipment-card default template» | Проверяется «промис разрешился», а не то, что сохранён именно валидный шаблон; смысл теста шире утверждения | Сверить возвращённый объект через `toMatchObject` с `DEFAULT_EQUIPMENT_CARD_TEMPLATE` |
| 18 | мелочь | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:179-240` | Активный (не скипнутый) блок аудита дублирует `domain/audit/__tests__/audit-chain.test.ts:6-45` — тот же порядок ключей RFC 8785, маскирование и золотой дайджест ADR-0043 | Дубль не вредит рантайму, но поддерживает жизнь файла-заготовки из №3 | Решать вместе с №3 |
| 19 | мелочь | `e2e/monitoring-tile-editor.spec.ts:11`, `e2e/rate-limit-e2e.spec.ts:8`, `e2e/report-creation-flow.spec.ts:39,48` | Скипы Playwright (не vitest): по проекту (2 файла) и по данным справочников (2 кейса). В прогон vitest не входят, но это те же «пропускаемые тесты» | Часть набора не выполняется никогда (Mobile Safari), а «пустой справочник» и «нет объектов у оператора» выглядят успехом при подсчёте только `passed` | Уже задокументировано (`docs/audits/hermes-night/25-e2e-gaps.md:67`); при желании — переносить в проектный `testMatch`, а не в рантайм-скип |
| 20 | мелочь | `tests/chaos/circuit-breaker.test.js` (k6) | Набор k6 (chaos) не запускается ни одним workflow и не виден vitest (`vitest.config.ts:45-48` исключает `tests/chaos/**`) | Заявленная проверка устойчивости (circuit breaker, backoff outbox) не выполняется ни в CI, ни локально по умолчанию | Задокументировать как ручной набор k6 (или убрать из репозитория, если она не поддерживается) |

### Честные отрицательные выводы (проверял — не нашёл)

- **Тестов без утверждений нет.** 4 кандидата (`src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts:68,71,74,77`)
  утверждают через общий помощник `expectForbidden` (стр. 54-60) — AST-обход по телу callback их пометил,
  ручное чтение опровергло.
- **`expect` в непойманных промисах / колбэках таймеров нет**: ни одного теста, где все `expect` лежат
  внутри `setTimeout/setInterval/queueMicrotask/new Promise/.then/.catch` (AST-обход, 299 файлов).
- **`if (!process.env…) return` внутри тестов нет.** `process.env` встречается только там, где он задаётся
  (`src/workers/unified-worker/__tests__/*`, `src/core/security/__tests__/encryption.test.ts:20-41`).
- **Нет `it.only`/`fit`/`describe.only`, нет `it.todo`/`test.todo`, нет `xit`/`xdescribe`** — прогон не
  «прячет» тесты.
- **Нет файлов, не попадающих в vitest из-за имени.** 14 несобранных файлов — это 10 `e2e/**` (Playwright) и
  4 `tests/e2e-archive/**` (исключены намеренно). Ловушки «`*.spec.ts` под `src/`» нет.
- Пустых `describe` и конструкций `catch {}` в тестах не найдено.

### Топ-5 тестов, которые стоит вернуть (по ценности, а не по объёму)

1. `tests/integration/tech-readiness-write-pipeline.spec.ts:39` — одна транзакция на источник+audit+outbox+идемпотентность.
2. `tests/integration/tech-readiness-write-pipeline.spec.ts:76` — откат записи источника при сбое audit/outbox.
3. `tests/contract/tech-readiness-api.spec.ts:173` — одинаковый безопасный 404 для отсутствующего и чужого ресурса.
4. `tests/contract/tech-readiness-api.spec.ts:272` — отвергается курсор, выпущенный под другие фильтры.
5. `tests/contract/tech-readiness-api.spec.ts:290` — паритет хеша фильтров между JSON-аудитом и CSV-экспортом.

(Три из пяти — из одного файла: №2 в таблице. Включать их следует точечно, а не снимать `describe.skip`
целиком, иначе набор упадёт.)

### Топ-5 «пустых»/слабых тестов

Полностью пустых тестов в наборе нет; ниже — те, чьё утверждение слабее заявленного смысла:

1. `src/lib/__tests__/csrf-protection.test.ts:81` — «запрещено» доказывается `not.toBeNull()`; должен быть `status === 403`.
2. `src/app/api/__tests__/api-routes.test.ts:62` — 4 × `toBeDefined()` на экспортах, ни одного о поведении.
3. `src/app/api/__tests__/api-routes.test.ts:121` — то же для rate-limiter.
4. `src/app/(app)/(readiness-admin)/__tests__/layout.test.tsx:40` — 4 роли × `toBeTruthy()`, без проверки содержимого.
5. `src/components/piling/__tests__/login-page.test.tsx:69` — 5 × `toBeDefined()` вместо `toBeInTheDocument()`/`toBeVisible()`.

## Не проверено

- **Включён ли модуль техготовности в проде.** От этого зависит, читать находки №1 и №3 как «важно» или
  «критично». В коде есть маршруты и группа страниц `src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx`,
  но флага включения я не искал и `.env*` не читал (запрет AGENTS §1).
- **Реальная матрица прав** для `handover`/`start` (кейс №11): сверку скипнутого контракта с
  `src/modules/readiness/domain/access-matrix.ts` и `tests/integration/authorization-boundaries.spec.ts` я не
  делал — вывод «матрица могла устареть» основан только на комментарии в `tech-readiness-shifts.spec.ts:156-157`.
- **Причины выбора именно этих заготовок** (что мешает их привязать сегодня) — в тексте задач плана
  `docs/plans/tech-readiness-production-work-plan.md` (733 строки) я прочитал только шапку и правило
  graduation (стр. 53); остальные слайсы не разбирал.
- **Гонки и флаки** в DB-гейт-наборах (20 параллельных пусков и т.п.) — не воспроизводил повторными
  прогонами, только один раз зафиксировал зелёный результат.
- **Playwright** не запускался (`npx playwright test --list` и сами спеки) — по e2e приведены только
  статически найденные `test.skip` (№19).
- **Покрытие номеров строк** в скипнутых кейсах `it.each` (например `tech-readiness-api.spec.ts:122` — 4
  роли из одной строки) дано по объявлению `it.each`, а не по каждой сгенерированной строке.

### Приложение А — все 39 скип-сайтов (path:line, число кейсов)

- `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts` — `describe.skip:80` (кейсы
  87, 96, 100, 111, 115, 123, 134 → **17**) и `describe.skip:143` (144, 155, 167 → **3**). Итого 20.
- `tests/contract/tech-readiness-api.spec.ts` — `describe.skip:49` (50, 85, 122, 149, 173, 191, 220, 249, 272, 290
  → **13**, из них `it.each:122` даёт 4). Итого 13.
- `tests/integration/tech-readiness-write-pipeline.spec.ts` — `describe.skip:38` (39, 76, 94, 125, 142, 167 → **6**). Итого 6.
