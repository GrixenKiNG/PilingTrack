# R70 — кандидаты на ложные падения тестов под нагрузкой (дефолтный таймаут 5 с)

Дата: 30.09.2026. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`). Только чтение, правок в коде нет.

## Итог

- Проверено: 276 тест-файлов / 2224 теста (`vitest list`); замерено 92 файла (131 одиночный прогон, по одному файлу за раз).
- На **простаивающей** машине (12 ядер, нагрузка 0) порог 1.5 с по одному тесту превысили ровно **3 теста** — и все три уже закрыты явным таймаутом: `unified-worker.test.ts` (3188 мс, 15 с), `auth-api.spec.ts` (2020 мс, 30 с), `tech-readiness-shifts.spec.ts` (1108 мс, 30 с). То есть **точного повторения** аварии 29.09 (pdf-generator) и 30.09 (to-module-shell) в неохраняемом виде не нашлось.
- Реальный риск — **множитель**. Те же два файла в первом (холодном, кэш Vite пустой) прогоне дали 1944 мс и 1576 мс на тест против 626 мс и 806 мс в тёплом — то есть **2.5–3× на пустом кэше без всякой нагрузки**. Дефолтные 5 с — это всего 2.5× запаса от 2 с.
- Найдено 2 критичных места: `unified-worker.test.ts` (запас 15 с всего ~4.7×, а проектный комментарий сам фиксирует масштабирование ×22 при 48 воркерах) и `beforeAll` четырёх интеграционных спеков, которые под дефолтным **hookTimeout 10 с** создают БД с полным DDL.
- Самое важное: **`@testing-library` по умолчанию ждёт всего 1000 мс** (`@testing-library/dom/dist/config.js:15`), `configure()` в проекте нет нигде, а `waitFor`/`findBy` с явным таймаутом не вызывается ни разу в 100+ местах. Это в 5 раз строже, чем 5 с витста, и явный `30_000` на тест от этого класса падений **не спасает вообще**.
- Итого по важности: критично — 2, важно — 12, мелочь — 26 (в таблице 40 строк, остальное — приложением).
- Топ-5 по одному предложению: (1) bcrypt cost 12 считается по-настоящему в 9 телах тестов без таймаута; (2) hookTimeout 10 с на `CREATE DATABASE` + DDL в 4 интеграционных спеках; (3) `asyncUtilTimeout: 1000` в RTL не настроен; (4) `unified-worker.test.ts` — единственный тест >3 с в покое; (5) 6 файлов с 9–18 `waitFor/findBy` без единого явного таймаута.

## Методика

Всё воспроизводимо, порядок такой.

1. Статический отбор кандидатов — скрипты в скретч-каталоге (вне репозитория):
   - обход импорт-графа от каждого `*.test.ts(x)` с флагами тяжёлых зависимостей (`pdfkit`, `sharp`, `bullmq`, `recharts`, `@aws-sdk`, `framer-motion`, `@prisma/client`, `bcryptjs`): `scan4.cjs` → `heavy4.json`. Результат сам по себе шумный (`ioredis` и `next/server` есть почти везде), поэтому использован только как фильтр кандидатов.
   - подсчёт асинхронных ожиданий и явных таймаутов по файлам: `async-count.cjs` (регэкспы `waitFor(`, `findBy*`, `}, N)`).
   - текстовый поиск ключевых признаков: `render(<…Module|Shell|App|Screen|Dashboard…`, `await import(`, `vi.resetModules()`, `import('pdfkit')`, `timeout`, `_000)`.
2. Замер времени — по одному файлу за раз, последовательно, без параллельной нагрузки от самого замерщика:
   - прогон 1 (pilot+49 файлов): `node node_modules/vitest/vitest.mjs run <файл>`, замер `date +%s%3N` вокруг процесса + разбор `Duration` и `Tests passed` из вывода → `r70-timings.txt`;
   - прогон 2/3/5/6 (по одному файлу, JSON-репортер — он даёт **длительность каждого теста отдельно**): `node node_modules/vitest/vitest.mjs run <файл> --reporter=json --outputFile=<N>.json` → сводки `r70-json-summary*.txt`, сведённые в `merged.json`.
   - Важная оговорка: строка `Duration 5.66s` в выводе витста — это **весь файл** (трансформ + окружение + тесты), и она **не ограничена** `testTimeout`. Для флейков важна именно длительность отдельного теста, её и брал.
3. Конфигурация и дефолты прочитаны по месту: `vitest.config.ts`, `src/test/setup.ts`, `node_modules/@testing-library/dom/dist/config.js`, `node_modules/vitest/package.json` (5.0.1) и `node_modules/vitest/dist/chunks/cac.fSuRXrAx.js:924` (pool по умолчанию — `forks`).

Команды для повторного прогона одного кандидата:

```bash
cd /d/PillingR/wt-night
node node_modules/vitest/vitest.mjs run src/workers/__tests__/unified-worker.test.ts
# с длительностью каждого теста отдельно:
node node_modules/vitest/vitest.mjs run <файл> --reporter=json --outputFile=/tmp/one.json
```

## Находки

Колонки: № | важность | файл:строка | что тяжёлое | время (одиночный прогон, простой) | таймаут | риск / что сделать.

| # | важность | файл:строка | что тяжёлое | время | таймаут | риск / предложение |
|---|---|---|---|---|---|---|
| 1 | критично | `src/workers/__tests__/unified-worker.test.ts:214-228` | холодный `await import('@/workers/unified-worker')` — граф из 153 файлов (pdfkit, bullmq, ioredis, aws-sdk, sentry), плюс 8× `vi.resetModules()` (`:171`) | **3188 мс** один тест (1 воркер); сумма по файлу 3957 мс; `Duration` файла 6.57 с | **есть, 15 с**, только у первого теста (`:228`) | Запас к 5 с = 1.6×, к 15 с = 4.7×. Комментарий на `:202-207` сам фиксирует масштабирование холодного импорта: 1 воркер 376 мс → 48 воркеров 8.4 с (×22). Остальные 7 тестов (`:232-301`) идут без таймаута и оплачивают повторный импорт после `resetModules` — сейчас ~110 мс каждый, но это тот же класс. Поднять до 30 с и вынести в `beforeAll` один тёплый импорт, а не 8 холодных. |
| 2 | критично | `tests/integration/tech-readiness-shifts.spec.ts:58-151` (+ `tech-readiness-work-permits.spec.ts:102`, `tech-readiness-projection.spec.ts:34`, `tenant-transaction-pool.spec.ts:22`) | `beforeAll` создаёт **отдельную БД** и накатывает полный DDL вручную (`CREATE DATABASE` + ~25 `CREATE TABLE/TYPE`, `:59-96`) | файл 6890 мс стеной, тесты внутри 1344 мс, остальное — хук + `DROP DATABASE … WITH FORCE` в `afterAll` (`:151`) | **нет ни у хука, ни у 2 из 3 тестов** | **hookTimeout по умолчанию 10 с** (витст 5.0.1), запас ~3×. Четыре таких спека в одном прогоне параллельно создают по БД и по схеме на общем Postgres — это самый вероятный кандидат на «timed out in 10000ms» в ночном прогоне. Дать `beforeAll(fn, 60_000)` или `hookTimeout` проекту. |
| 3 | важно | `src/services/auth/__tests__/auth-service-credentials.test.ts:75-177` | **настоящий bcrypt**, cost 12, в телах 9 из 10 тестов (по одному `hash/compare` ≈ 250–300 мс, в тесте `:148` — сразу два) | сумма тестов файла 3084 мс (прогон 1), 2617 мс (прогон 2); максимум одного теста 365 мс | **нет у тестов** — 30 с стоит только у хука `beforeAll` (`:60-62`) | bcryptjs — чистый JS-CPU: он замедляется линейно от переподписки ядер, в отличие от IO. Нужно 14–17×, чтобы перевалить 5 с, но это ровно тот множитель, что даёт ночная параллельная нагрузка на 12 ядрах. Проставить явный таймаут на `describe(..., { timeout: 30_000 })` — сейчас защита есть только у подготовки хеша, а не у самих проверок. |
| 4 | важно | `src/test/setup.ts:1` (нет `configure`), дефолт в `node_modules/@testing-library/dom/dist/config.js:15` | `asyncUtilTimeout: 1000` — **все** `waitFor`/`findBy*`/`findAllBy*` ждут 1 с, а не 5 с; в проекте нет ни одного `configure({ asyncUtilTimeout })` | — | **нет нигде** | Это в 5 раз строже `testTimeout`, и добавление `30_000` на тест от этого класса не помогает: сообщение будет «Unable to find an element», а не «Test timed out». Именно так удобнее всего оклеветать чужую правку. Поднять `asyncUtilTimeout` до 5–10 с в `setup.ts` — самый дешёвый способ убрать большую часть флейков. |
| 5 | важно | `src/components/piling/admin-dictionaries/__tests__/admin-dictionaries.test.tsx:36-135` | 10× `render()` полного `AdminDictionaries`, **18** `waitFor`/`findBy*`, ни одного с явным таймаутом | макс. теста 253 мс; `Duration` файла 3.28 с | нет | 253 мс × множитель ночной нагрузки → ломается не 5-секундный лимит, а 1-секундный RTL (см. #4). Лечить общим `asyncUtilTimeout`, точечный таймаут на тест не поможет. |
| 6 | важно | `src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx:127-207` | 9× `render()` редактора плитки + **16** `waitFor`/`findBy*` без таймаутов | макс. теста 205 мс; файл 2.63 с | нет | То же, что #5. |
| 7 | важно | `src/components/piling/report-form/__tests__/use-report-form.length.test.ts:56-197` | хук `useReportForm` с 10 `waitFor`, ожидания нескольких последовательных состояний (`loading` → `pileGrades` → `piles`) | макс. теста 133 мс, сумма 556 мс | нет | Цепочка из двух-трёх `waitFor` подряд умножает риск: каждый шаг ограничен 1 с (см. #4). |
| 8 | важно | `src/components/piling/__tests__/workspace-settings.test.tsx:41-87` | 3× `render()` `WorkspaceSettings`, 9 `waitFor`/`findBy*`; в графе — `framer-motion` (в самом тесте замокан) | макс. теста 175 мс, файл 1.87 с | нет | Тест про откат тумблера — сценарий из QA 28.09; ложное падение здесь читается как регрессия UI. |
| 9 | важно | `src/lib/__tests__/pdf-generator.test.ts:269-277` | девятый тест файла делает `await import('@/lib/pdf-generator/format')` внутри тела, и **это единственный тест без 30 с** (остальные 8 закрыты, `:74-260`) | 1 мс (модуль крошечный) | **нет** (в отличие от соседей) | Асимметрия внутри уже «починенного» файла: следующий, кто допишет в этот `describe` тест с импортом, повторит историю 29.09. Добавить `}, 30_000)` для единообразия. |
| 10 | важно | `src/services/reports/__tests__/daily-summary.test.ts:162` | импорт графа из 54 файлов, 22 теста в файле, всё замокано | макс. теста **455 мс**, сумма 585 мс, файл 1.93 с | нет | Самый долгий одиночный тест среди файлов без таймаута. До 5 с далеко, но это первая десятка по абсолютному времени. |
| 11 | важно | `src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx:91-101` | 2× `render(<FleetDashboard />)` целиком, 3 `waitFor` без таймаута | макс. теста 167 мс; файл 2.12 с | нет | Рендер всего дашборда — ровно профиль to-module-shell, но объём меньше. |
| 12 | важно | `src/components/piling/to/readiness/screens/fleet-screen.test.tsx:84-121` | 10× `render(<FleetScreen …/>)` с крупным деревом, 2 `waitFor` | макс. теста 223 мс, сумма 862 мс; файл 3.33 с | нет | Соседний экран, уже прошедший через правки вкладок; под нагрузкой 10 рендеров дают длинный хвост. |
| 13 | важно | `src/components/piling/admin-users/__tests__/admin-users.test.tsx:1-100` | 2× рендер админского экрана пользователей, граф 43 файла | макс. теста 192 мс; `Duration` файла 2.67 с | нет | Мало тестов, много подготовки — плохо переносит конкуренцию за трансформ. |
| 14 | важно | `src/app/api/reports/pdf/__tests__/route.test.ts:1-40` и `src/app/api/reports/single-pdf/__tests__/route.test.ts:1-40` | статический импорт роута тянет `pdfkit` + `bullmq` + `ioredis` + `@aws-sdk/client-s3` (граф 49 файлов) | `Duration` файла **5.66 с** (прогон 1) / 2.7–3.3 с (прогон 2) при сумме тестов 37 мс | нет (и не нужно на тесты) | Стоимость целиком в фазе сбора, `testTimeout` её не ограничивает — это не флейк, а замедление и борьба за CPU: 12 таких файлов по 3–6 с добавляют десятки секунд к ночному прогону и растиражируют контеншн для #1. Проверить, не выносится ли `pdfkit` из роута ленивым импортом. |
| 15 | мелочь | `src/components/piling/to/readiness/tech-readiness-module.test.tsx:12-22` | `render(<TechReadinessModule …>)` целиком, граф 196 файлов | макс. теста 90 мс; `Duration` файла 2.66 с | нет | Ту же защиту, что получил `to-module-shell` (30 с), логично иметь и здесь — файл из того же кластера. |
| 16 | мелочь | `src/components/piling/to/readiness/module-tab-list.test.tsx:22-40` | рендер списка вкладок, граф 190 файлов | макс. теста 66 мс; файл 1.77 с | нет | То же. |
| 17 | мелочь | `src/components/piling/to/readiness/boundaries/boundaries.test.tsx:40-100` | ловушки фокуса, ошибки рендера, `@sentry/nextjs` в графе | макс. теста 97 мс | нет | Работа с фокусом чувствительна к таймингам анимаций/микротасков. |
| 18 | мелочь | `src/components/piling/to/readiness/screens/__tests__/safety-screen.test.tsx:60-76` | 2× `render(<SafetyScreen/>)`, 3 `waitFor`/`findBy` | макс. теста 105 мс | нет | — |
| 19 | мелочь | `src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx` | рендер центра, граф 103 файла | макс. теста 132 мс; файл 2.35 с | нет | — |
| 20 | мелочь | `src/components/piling/to/readiness/shared/command-dialog.test.tsx:10-70` | 3× рендер диалога с ловушкой фокуса | макс. теста 67 мс | нет | — |
| 21 | мелочь | `src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx:1-211` | 5× рендер формы отчёта (фото, `next/image`) | макс. теста 95 мс; файл 1.76 с | нет | — |
| 22 | мелочь | `src/components/piling/admin-sites/site-editor/__tests__/edit-site-dialog.test.tsx:1-100` | 1× рендер диалога редактирования объекта, 2 `waitFor` | макс. теста 122 мс | нет | — |
| 23 | мелочь | `src/components/piling/admin-reports/__tests__/report-detail-dialog.test.tsx` | 2× рендер диалога детали | макс. теста 81 мс | нет | — |
| 24 | мелочь | `src/components/piling/admin-users/__tests__/user-documents.test.tsx:1-67` | 4× рендер, 5 `waitFor`/`findBy` | макс. теста 75 мс | нет | — |
| 25 | мелочь | `src/components/piling/__tests__/login-page.test.tsx:70-199` | 7× `render(<LoginPage/>)`, `framer-motion` замокан; 5 динамических `await import` внутри тестов (`:80,96,123,157,167`) | макс. теста 63 мс | нет | Модули по динамическим импортам мелкие (`sonner`, `@/lib/store`) — риск низкий. |
| 26 | мелочь | `src/components/piling/monitoring/__tests__/equipment-tile-image-block.test.tsx:1-51` | 4× рендер, 5 `waitFor`/`findBy` | макс. теста 47 мс | нет | — |
| 27 | мелочь | `src/components/piling/feedback-center.test.tsx:68` | рендер + SSE-поток (в happy-dom его нет, эмулируется) | макс. теста 86 мс | нет | — |
| 28 | мелочь | `src/components/piling/icons/__tests__/piling-icon.test.tsx:1-50` | 4× рендер иконок, `next/image` | макс. теста 133 мс | нет | — |
| 29 | мелочь | `src/components/piling/admin-equipment/detail/__tests__/equipment-maintenance-sort.test.ts:1-73` | граф 71 файл (грузовик/ТО-модуль) | макс. теста 2 мс; `Duration` файла 2.63 с | нет | Вся стоимость — импорт. |
| 30 | мелочь | `src/app/api/__tests__/api-routes.test.ts:63-129` | обход **всех** файлов роутов с диска + 6 динамических `await import` (`authorization-service`, `rate-limiter`) внутри тестов | макс. теста 171 мс, сумма 295 мс | нет | Импорты мелкие, но файл читает весь `src/app/api` — на медленном диске ночью (бэкап, антивирус) это IO-чувствительно. |
| 31 | мелочь | `src/core/observability/__tests__/health-tracker.test.ts:125-395` | **18** динамических `await import` внутри тестов + `@aws-sdk` в графе | сумма тестов невелика (макс. не в топе) | нет | Модуль показывался «мёртвым» из-за путаницы кэша/состояния Redis — важный для регрессий файл; по времени пока безопасен. |
| 32 | мелочь | `src/core/infrastructure/__tests__/leader-election.test.ts:44,69` | 2 динамических импорта внутри тестов | — | нет | — |
| 33 | мелочь | `src/workers/__tests__/pdf-worker.test.ts:60,86,98,123,125` | динамические импорты `@/workers/pdf-worker`, `@/lib/pdf-generator`, `bullmq` внутри тестов | макс. теста 104 мс; файл 1.11 с | нет | Тот же профиль, что #1, но граф 39 файлов вместо 153 — риск на порядок ниже. |
| 34 | мелочь | `src/workers/unified-worker/__tests__/sentry.test.ts:70-173` | 4× `vi.resetModules()` + динамические импорты планировщиков, `@sentry/nextjs` | макс. теста 345 мс | нет | — |
| 35 | мелочь | `src/workers/unified-worker/__tests__/idempotency-cleanup-scheduler.test.ts:57-107` | `resetModules` + динамические импорты | файл 1.9 с, тесты мелкие | нет | — |
| 36 | мелочь | `src/components/piling/__tests__/use-feedback-feed.test.tsx:50-100` | `vi.resetModules()` + динамический импорт хука, фейковые таймеры | файл 1.89 с, тесты мелкие | нет | — |
| 37 | мелочь | `src/lib/__tests__/auth.test.ts:48-208` | 7 динамических импортов `../auth` после `resetModules` | файл 1.93 с, макс. теста не в топе | нет | — |
| 38 | мелочь | `src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts:82` | динамический импорт транзакции готовности внутри теста; граф 128 файлов | `Duration` файла 3.86 с при 18 мс тестов | нет | — |
| 39 | мелочь | `src/app/api/readiness/shifts/__tests__/route.test.ts` | статический импорт роута готовности, граф 117 файлов | `Duration` файла 3.46 с при 48 мс тестов | нет | — |
| 40 | мелочь | `src/app/api/sites/all/__tests__/route.test.ts`, `src/app/api/metrics/__tests__/route.test.ts`, `src/app/api/settings/__tests__/route.test.ts`, `src/app/api/to/journal/__tests__/route.test.ts`, `src/app/api/users/__tests__/route.test.ts`, `src/app/api/auth/login/__tests__/route.test.ts` | статические импорты роутов: `withApi` → `@sentry` + `ioredis` + `bcryptjs` из `auth-service` | `Duration` файлов 2.4–3.0 с при 7–27 мс тестов | нет | Таких файлов в наборе больше двадцати; шаблон один — тяжесть в сборе, не в тестах. |

### Топ-10 файлов, которым явный таймаут нужнее всего

Порядок — по оценке «вероятность ложного падения × ущерб». Все строки без таймаута в теле теста.

| место | файл | почему первым |
|---|---|---|
| 1 | `src/services/auth/__tests__/auth-service-credentials.test.ts` | единственный, где в теле тестов крутится настоящий CPU-тяжёлый bcrypt cost 12 |
| 2 | `tests/integration/tech-readiness-shifts.spec.ts` (и 3 соседа) | `beforeAll` под hookTimeout 10 с: `CREATE DATABASE` + полный DDL |
| 3 | `src/components/piling/admin-dictionaries/__tests__/admin-dictionaries.test.tsx` | 18 `waitFor/findBy` при RTL-лимите 1000 мс |
| 4 | `src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx` | 16 `waitFor/findBy` |
| 5 | `src/components/piling/report-form/__tests__/use-report-form.length.test.ts` | 10 последовательных `waitFor` в цепочке |
| 6 | `src/services/reports/__tests__/daily-summary.test.ts` | самый долгий одиночный тест (455 мс) из неохраняемых |
| 7 | `src/components/piling/__tests__/workspace-settings.test.tsx` | 9 `waitFor/findBy`, сценарий из QA-находки |
| 8 | `src/components/piling/to/readiness/screens/fleet-screen.test.tsx` | 10 рендеров крупного экрана |
| 9 | `src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx` | рендер дашборда целиком |
| 10 | `src/components/piling/admin-users/__tests__/admin-users.test.tsx` | 2 теста, 43 файла графа, `Duration` 2.67 с |

Плюс отдельной строкой (не тест, а хук): `beforeAll` в `tests/integration/tech-readiness-{shifts,work-permits,projection}.spec.ts` и `tests/integration/tenant-transaction-pool.spec.ts` — всем четырём нужен явный `hookTimeout` или второй аргумент хука.

## Общее решение (предложение, решение за Claude)

**Вариант A. `testTimeout` и `hookTimeout` глобально в `vitest.config.ts`.**

```ts
test: {
  testTimeout: 30_000,
  hookTimeout: 60_000,   // beforeAll интеграционных спеков создаёт БД
}
```

Плюсы: одна строка закрывает весь класс «успел бы, но не уложился»; ровно тот же приём, что уже применён точечно в `pdf-generator.test.ts`, `to-module-shell.test.tsx`, `auth-api.spec.ts` и первом тесте `unified-worker.test.ts` — то есть ничего нового, просто перестаём повторять одно и то же в 9 местах.
Минусы: глобальное значение прячет реальные зависания (тест, который действительно зациклился, будет висеть 30 с вместо 5 — на 276 файлах это заметно удлиняет разбор); маскирует деградацию импорт-графа (файлы из #14/#39/#40 станут ещё незаметнее); от #4 (`asyncUtilTimeout: 1000`) не помогает вообще.

**Вариант B. Отдельный проект с увеличенным таймаутом только для тяжёлых файлов.** Vitest 5 умеет `test.projects[]`, каждый со своим `include` и своими `testTimeout`/`hookTimeout`/`fileParallelism`. Плюсы: 5 с остаются честным лимитом для 200+ лёгких файлов, тяжёлые получают 30 с; заодно их можно пустить с `fileParallelism: false` или снизить им `maxWorkers`, чтобы 20-секундные pdfkit-импорты не выжирали ядра у остальных. Минусы: список «тяжёлых» придётся поддерживать руками, и он будет протухать; конфиг становится заметно сложнее; у проекта сейчас **нет** `projects` вообще, то есть это новая конструкция в кодовой базе.

**Вариант C (рекомендую как обязательный минимум в любом случае). `configure({ asyncUtilTimeout })` в `src/test/setup.ts`.**

```ts
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 10_000 });
```

Плюсы: закрывает самый частый и самый обманчивый класс падений (находка #4); одна строка; ничего не удлиняет при успешном прогоне (таймаут — это лимит, а не ожидание); не требует вести список файлов.
Минусы: сообщение об ошибке при реальной поломке будет приходить на 9 с позже; влияет и на «правильные» падения — их придётся чуть дольше ждать.

**Вариант D. Снизить конкуренцию, а не поднять лимит.** `maxWorkers: '50%'` или `fileParallelism: false` для тяжёлых файлов. На этой машине 12 ядер, и `maxWorkersCount` в витсте по умолчанию равен `availableParallelism()` (`node_modules/vitest/dist/chunks/index.DzobfTyw.js:7481`) — то есть `vitest run` поднимает 12 форков, а ночью рядом идёт QA. Это прямо бьёт по #1 и #14. Плюсы: лечит причину, а не симптом, и не прячет зависания. Минусы: прогон дольше; на CI с другим числом ядер эффект иной.

**Чего делать не стоит:** чинить «мёртвый узел» в графе воркеров. Комментарий на `unified-worker.test.ts:202-207` фиксирует замер: прогон завершается всегда, event loop отзывчив, это очередь на трансформах, а не дедлок.

Порядок, который я бы предложил: C (сразу, дёшево) → D (дешёво, лечит причину) → точечные таймауты из топ-10 → и только если после этого флейки останутся, A или B.

## Не проверено

- **Холодный кэш Vite как отдельная гипотеза.** Первый прогон дал на `pdf-generator` 1944 мс на тест и на `to-module-shell` 1576 мс, повторный (тёплый) — 626 мс и 806 мс. Похоже на стоимость первой сборки `node_modules/.vite`, но я это **не проверял**: чистить кэш запрещено правилом «не менять существующие файлы». Если у Claude есть возможность — `rm -rf node_modules/.vite && vitest run <файл>` подтвердит или опровергнет за один прогон.
- **Замеры сделаны на простаивающей машине** (12 ядер, loadavg 0, 7.4 ГБ свободной памяти из 20). Множитель «под ночной нагрузкой» я **не измерял**; все оценки вида «×3–×10» выводятся из единственного доступного замера в самом репозитории (`unified-worker.test.ts:203-204`: 376 мс → 8.4 с) и являются оценкой, а не фактом. Полный `vitest run` я не запускал — по условию задачи.
- **Ограничен ли импорт-граф каким-либо таймаутом** в фазе сбора — не проверено. Строка `Duration 5.66s` из #14 относится ко всему файлу, но мне не удалось подтвердить, что при 30-секундном импорте витст не упадёт по-другому (например, по таймауту RPC воркера).
- **Числа `Duration` для интеграционных спеков** (`tests/integration/**`) получены из вывода JSON-репортера и не содержат длительности хуков — витст их не отдаёт. Оценка стоимости `beforeAll` (≈3–5 с) сделана вычитанием, а не измерена напрямую.
- **`tests/chaos/**` и `tests/e2e-archive/**`** — исключены из `include` в `vitest.config.ts:46-47` (исключены `tests/e2e/**` и `tests/chaos/**`), поэтому не смотрел.
- **Замороженные по `AGENTS.md` §1 области намеренно пропущены**, хотя статически они выглядят как худшие кандидаты и я не могу гарантировать, что они не флейкуют: `src/components/piling/operator-mobile/v10/__tests__/operator-v10-port.test.tsx` (369 строк, 14 `waitFor/findBy`, 6 рендеров), `operator-v10-flow.test.tsx` (11), `src/components/piling/operator-v5/__tests__/operator-v5-app.test.tsx` (12), `src/components/orion/__tests__/orion-site.test.tsx`, `operator-v2` (`operator-shift-v2.test.tsx`, `shift-flow.test.ts`). Все — без явных таймаутов. Решение по ним за владельцем/Claude.
- **Полный список замеренных файлов (92)** и 26 «мелочей», не попавших в таблицу (файлы с `Duration` 1.7–3.5 с и суммой тестов <100 мс, то есть чистый сбор), лежит в приложении ниже. Ни одного теста ≥1.5 с среди них нет.

## Приложение — остальные замеры (без разбора, только путь и время)

Формат: `путь` — макс. длительность одного теста (сумма тестов; `Duration` файла).

```
src/app/api/reports/all/__tests__/route.test.ts — 13 мс (13; 2.41 с)
src/app/api/reports/export/__tests__/route.test.ts — 6 мс (11; 2.72 с)
src/app/api/reports/delete/__tests__/route.test.ts — 116 мс (131; 3.73 с)
src/app/api/reports/my/__tests__/route.test.ts — 15 мс (15; 2.37 с)
src/app/api/reports/period/__tests__/route.test.ts — 16 мс (16; 2.49 с)
src/app/api/reports/period/__tests__/period-summary.test.ts — 2 мс (3; 1.76 с)
src/app/api/reports/single-pdf/__tests__/route.test.ts — 38 мс (38; 2.73 с)
src/app/api/reports/edit/__tests__/route.test.ts — без выраженного пика (2.7 с файл)
src/app/api/sites/create/__tests__/route.test.ts — 7 мс (19; 3.5 с)
src/app/api/sites/[id]/assign/__tests__/route.test.ts — файл 3.4 с
src/app/api/sites/[id]/hierarchy/__tests__/route.test.ts — файл 3.4 с
src/app/api/equipment/__tests__/route.test.ts — 21 мс (23; 3.47 с)
src/app/api/equipment/[id]/__tests__/route.test.ts — 16 мс (23; 3.7 с)
src/app/api/health/deep/__tests__/route.test.ts — 8 мс (17; 1.87 с)
src/app/api/readiness/bootstrap/__tests__/route.test.ts — 9 мс (14; 3.4 с)
src/app/api/readiness/shifts/[id]/request-acceptance/__tests__/route.test.ts — файл 3.3 с
src/app/api/maintenance/kpi/__tests__/route.test.ts — файл 2.7 с
src/app/api/pile-passports/__tests__/route.test.ts — файл 3.0 с
src/app/(app)/admin/__tests__/layout.test.tsx — 8 мс (8; 1.13 с)
src/app/(app)/(readiness-admin)/__tests__/layout.test.tsx — 8 мс (8; 1.10 с)
src/core/__tests__/api-wrapper.test.ts — 9 мс (43; 2.94 с)
src/core/media/__tests__/content-magic-bytes.test.ts — 2 мс (2; 1.97 с)
src/core/media/__tests__/build-media-key.test.ts — 5 мс (1.35 с)
src/core/media/__tests__/extension-injection.test.ts — 6 мс (1.30 с)
src/core/media/__tests__/confirm-upload-validation.test.ts — 28 мс (16 тестов; 1.18 с)
src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts — 3 мс (5; 3.35 с)
src/modules/readiness/application/__tests__/bootstrap-query.test.ts — 31 мс (50; 2.33 с)
src/modules/reports/application/commands/__tests__/report-command-service.test.ts — 32 мс (66; 2.28 с)
src/modules/reports/application/queries/__tests__/report-query.service.test.ts — 29 мс (60; 2.03 с)
src/modules/reports/application/queries/__tests__/export-reports-csv.test.ts — 42 мс (18 тестов; 1.24 с)
src/modules/reports/application/queries/__tests__/pile-passport.service.test.ts — 49 мс (1.22 с)
src/services/reports/__tests__/report-history-service.test.ts — 4 мс (1.88 с)
src/services/users/__tests__/user-service.test.ts — 4 мс (1.82 с)
src/components/piling/__tests__/dashboard-kpis.test.ts — 2 мс (1.80 с)
src/components/piling/icons/__tests__/role-navigation.test.ts — 5 мс (1.79 с)
src/components/piling/report-form/__tests__/report-sent-screen.test.tsx — 72 мс (2.32 с)
tests/contract/auth-api.spec.ts — 2020 мс (тест с 30 с), файл 3.87 с
tests/contract/layout-template.spec.ts — файл 2.05 с
tests/contract/monitoring-template.spec.ts — файл 2.01 с
tests/contract/page-layout.spec.ts — файл 1.80 с
tests/contract/sync-api.spec.ts — файл 1.75 с
tests/contract/tech-readiness-api.spec.ts — 13 тестов пропущены (0/13), файл 1.79 с
tests/contract/tech-readiness-bootstrap.spec.ts — файл 2.03 с
tests/contract/telemetry-ingest.spec.ts — файл 1.84 с
tests/contract/tenant-settings.spec.ts — файл 1.89 с
tests/integration/tenant-isolation.spec.ts — 10 тестов, файл 1.80 с
tests/integration/authorization-boundaries.spec.ts — 86 тестов, файл 1.84 с
tests/integration/tech-readiness-projection.spec.ts — 185 мс, файл 2.79 с
tests/integration/tech-readiness-work-permits.spec.ts — 302 мс, файл 3.70 с
tests/integration/tenant-transaction-pool.spec.ts — файл 2.45 с
tests/integration/rls-tenant-enforcement.spec.ts — файл 2.33 с
tests/integration/tenant-dictionary-migration.spec.ts — файл 2.09 с
tests/integration/tenant-dictionaries-schema.spec.ts — файл 1.72 с
tests/integration/outbox-projection.spec.ts — файл 1.90 с
tests/integration/tech-readiness-write-pipeline.spec.ts — все 6 тестов пропущены, файл 1.80 с
```

Отдельно, для полноты: `tests/contract/tech-readiness-api.spec.ts` и `tests/integration/tech-readiness-write-pipeline.spec.ts` в этих прогонах **молча пропустили** тесты (0/13 и 0/6) — это гейт по базе, о котором предупреждает `AGENTS.md` §5. Пропуски видны только в JSON-репортере: обычный вывод показывает «green».
