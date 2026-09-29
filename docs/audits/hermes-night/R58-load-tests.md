# R58 — Нагрузочные сценарии: инвентарь, «живой/мёртвый», предложение одного актуального сценария

Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`. Задача read-only: ни один существующий файл не изменён, создан только этот отчёт. Замороженные зоны (варианты экрана оператора, ORION) не открывались.

Повод — пункт F-18 независимого аудита и запись P-1 в `docs/audit.md:275` («k6-сценарии лежат, регулярных прогонов нет»).

## Итог

В репозитории 20 файлов, претендующих на нагрузочные сценарии: 5 в `load-tests/`, 5 в `performance/k6/`, 4 в `scripts/`, 1 в `tests/chaos/`, плюс `performance/scenarios/e2e-load-integration.ts`, `load-tests/event-storm.ts`, `load-tests/slo-monitor.ts`, `load-tests/generate-session.ts`, `scripts/redis-stress-test.js`, `agents/backend/api-concurrency-performance.ts`. Полностью работоспособного — ровно один (`scripts/redis-stress-test.js`, и тот про Redis, а не про маршруты). Остальные сломаны минимум по одной из четырёх причин: удалённые маршруты, схема авторизации, CSRF, пароли.

Счёт по важности: **критично — 6, важно — 7, мелочь — 11** (всего 24).

Главное: **все сценарии, бьющие `/api/sync*`, мёртвы** — подсистема sync v3 удалена 24.05.2026 (коммит `2ef48772`), каталога `src/app/api/sync/` не существует. Это 5 файлов `load-tests/` плюс части `scripts/load-test.js`, `performance/k6/report.test.js`, `performance/k6/spike.test.js`, `load-tests/stress-test.js`.

Топ-5:
1. 5 файлов `load-tests/*` бьют удалённые `/api/sync/v2`, `/api/sync`, `/api/sync/batch`, `/api/sync/updates` — мёртвы целиком (см. №1).
2. Весь `performance/k6/*` авторизуется заголовком `Authorization: Bearer`, а логин отдаёт только cookie `pt-session` и тело `{user}` — 401 на всех защищённых запросах (№3).
3. Пароли в k6 по умолчанию `'0000'/'1234'` против сидовых `operator123/admin123` — логин не проходит (№4).
4. Ни один сценарий не запускается ни в CI, ни в deploy (`.github/workflows/ci.yml`, `deploy.yml` — шагов k6 нет) (№6).
5. Профиль нагрузки (1000 VU, 500–800 RPS) не соответствует боевому (1 организация, 10–20 машинистов); нет ни одного сценария на дашборды админки и на пик смены (№10, №11, №12).

## Методика

Что смотрел и как воспроизвести:

- Инвентарь: `find load-tests performance chaos tests scripts -type f`, затем `ls -1 load-tests performance/k6 scripts/*load* scripts/*stress*`. Поиск инструментов: `search_files pattern='k6|artillery|autocannon|vegeta|locust|wrk'` по `*.{json,js,mjs,cjs,ts,yml,yaml,sh,md}` — artillery/autocannon/locust не найдены нигде, весь нагрузочный стек это k6 + node-скрипты.
- Прочитаны целиком: `load-tests/{README.md,load-http.js,load-http-quick.js,load-http-batch.js,load-http-aggressive.js,load-combined.js,stress-test.js,event-storm.ts,slo-monitor.ts,generate-session.ts}`, `performance/{README.md,k6/login.test.js,k6/report.test.js,k6/smoke.test.js,k6/spike.test.js,k6/soak.test.js,scenarios/e2e-load-integration.ts}`, `scripts/{load-test.js,quick-load-test.js,stress-test-100.js,redis-stress-test.js}`, `tests/chaos/circuit-breaker.test.js`, `agents/backend/api-concurrency-performance.ts`.
- Живость маршрутов: `find src/app/api -name route.ts | sort` (139 файлов; каталога `sync` нет). Поиск по коду: `grep -rn "api/sync" src --include=*.ts --include=*.tsx` — 0 совпадений. Извлечение всех путей из сценариев: `grep -rhoE "/api/[a-zA-Z0-9/_-]+" load-tests performance scripts/load-test.js scripts/quick-load-test.js scripts/stress-test-100.js | sort | uniq -c`.
- Проверка на удаление маршрутов: `git log --oneline --diff-filter=D -- 'src/app/api/sync/*'` → `2ef48772 chore(offline): retire sync v3 — delete dead offline subsystem` (24.05.2026); `git show --stat 2ef48772` подтверждает удаление «`src/app/api/sync/` (all 6 routes)».
- Авторизация: `src/app/api/auth/login/route.ts:83` → `createAuthenticatedResponse`; `src/services/auth/auth-service.ts:295-299` (тело `{ user }` + `attachSessionCookie`); `src/services/auth/session-service.ts:7` (`SESSION_COOKIE_NAME = 'pt-session'`), `:260-261` (`readSessionToken` — только cookie), `:187` (`createSessionToken` — async).
- CSRF: `src/core/api-wrapper.ts:177-183` (`withMutation` → `withCsrf`), `src/lib/csrf-protection.ts:28-34,43-118` (исключения только для login/pin/me/health/ready; POST без Origin/Referer/Sec-Fetch-Site → 403).
- Маршруты-кандидаты проверены на обёртку/кеш: `grep -nE "withApi|withMutation|requireAuth|cache" src/app/api/{sites/all,crews/all,dictionary/all,reports/my,reports/upsert,equipment,auth/me,admin/analytics/overview,reports/all,monitoring/fleet}/route.ts`.
- CI: прочитаны `.github/workflows/ci.yml` (336 строк, jobs unit/schema-validation/e2e — шага k6 нет) и `deploy.yml` (только SSH-ребилд + health). `package.json` содержит `test:load`, `test:load:smoke`, `test:load:stress`, `test:redis:stress`, но ни один из них не входит в `verify`.
- Порт стенда: `grep -rn "3100"` → `playwright.manual.config.ts:9 baseURL: 'http://127.0.0.1:3100'`; документации о том, чем именно поднимается стенд на 3100, в репозитории не нашёл (см. «Не проверено»).

## Сценарий | маршруты | живой/мёртвый | что починить

| # | сценарий (path) | маршруты | живой? | что починить / вердикт |
|---|---|---|---|---|
| 1 | `load-tests/load-http.js:153,194` | POST `/api/sync/v2`, GET `/api/sync/updates` | **мёртвый** | Маршрутов нет (удалены `2ef48772`). Удалить файл либо переписать на `/api/reports/upsert` + `/api/reports/my` |
| 2 | `load-tests/load-http-quick.js:76,85` | POST `/api/sync`, GET `/api/sync/updates` | **мёртвый** | То же; плюс `SESSION_TOKEN` по умолчанию пуст (`:33`) |
| 3 | `load-tests/load-http-batch.js:93` | POST `/api/sync/batch` | **мёртвый** | Батч-эндпоинта нет вообще; удалить |
| 4 | `load-tests/load-http-aggressive.js:92,103` | POST `/api/sync`, GET `/api/sync/updates` | **мёртвый** | То же, что №1 |
| 5 | `load-tests/load-combined.js:91,103` | POST `/api/sync`, GET `/api/sync/updates` | **мёртвый** | То же, что №1 |
| 6 | `load-tests/stress-test.js:116-207` | `/api/sites/all`, `/api/crews/all`, `/api/dictionary/all`, `/api/reports/my`, `/api/sync/updates`, `/api/health` | **частично** | Маршруты живы кроме sync; авторизация `Bearer` (`:118`) и пароли `test-password-1` (`:66-70`) не работают |
| 7 | `load-tests/event-storm.ts:195` | Redis pub/sub канал `realtime:events` | **мёртвый** | Потребителя канала нет (`grep realtime:events src` — 0); WS-сценарий удалён (`load-tests/README.md:32`) |
| 8 | `load-tests/slo-monitor.ts:102,122,138` | `/api/ready`, `/api/dictionary/all`, WS `:3001` | **частично** | HTTP-пробы живы; WS-проба и SLO «WS connections ≥ 900» (`:169`) недостижимы — сервера на 3001 нет |
| 9 | `load-tests/generate-session.ts:26,38` | — (выдаёт cookie для k6) | **мёртвый** | `createSessionToken` async, вызван без `await`; предлагает cookie `session=`, а имя — `pt-session` |
| 10 | `performance/k6/login.test.js:24-28,60` | `/api/health`, `/api/auth/login`, `/api/auth/me` | **частично** (маршруты живы) | Пароли `'1234'/'2222'/'0000'/'1111'/'3333'` не совпадают с сидом (`admin123/operator123/…`) → 401 |
| 11 | `performance/k6/report.test.js:137,155,174` | `/api/auth/login`, `/api/auth/me`, POST `/api/reports/upsert`, GET `/api/reports/my`, GET `/api/sync/updates` | **частично** | Убрать sync; cookie вместо `Bearer` (`:131`); POST без CSRF → 403; пароль `0000` |
| 12 | `performance/k6/smoke.test.js:36-37,63` | `/api/health`, `/api/reports/my` | **частично** (маршруты живы) | Авторизация `Bearer` (`:52`) + пароль `0000` → 401 |
| 13 | `performance/k6/spike.test.js:68,80,85` | `/api/reports/my`, POST `/api/reports/upsert`, GET `/api/sync/updates` | **частично** | Убрать sync; `Bearer`; POST без CSRF; пароль `0000` |
| 14 | `performance/k6/soak.test.js:62-69` | `/api/health`, `/api/ready`, `/api/reports/my`, `/api/sites/all`, `/api/crews/all`, `/api/dictionary/all` | **маршруты живы** | Только авторизация: `Bearer` (`:58`) + пароль `0000` (`:42`) |
| 15 | `performance/scenarios/e2e-load-integration.ts:93` | `/login`, `/dashboard`, `/reports` + спавн k6 | **частично** | `npx k6 run ... report.test.js` — k6 не npx-пакет, и report.test.js мёртв → фаза 2 всегда «завершается» по таймауту (3 мин) |
| 16 | `scripts/load-test.js:73,88,96,106` | `/api/health`, `/api/sites`, `/api/dictionary/all`, `/api/reports/my`, `/api/sync/updates`, POST `/api/sync` | **частично** | Убрать sync; `:47` читает `body.token`, а тело `{user}`; POST без CSRF |
| 17 | `scripts/quick-load-test.js:16-21,93` | `/api/sites/all`, `/api/crews/all`, `/api/dictionary/all`, `/api/equipment` | **маршруты живы** | Cookie взят верно (`:100`); но пользователя `loadtest@piling.ru` в сиде нет → 401 |
| 18 | `scripts/stress-test-100.js:14-19,27` | те же 4 | **маршруты живы** | Та же проблема с `loadtest@piling.ru` |
| 19 | `scripts/redis-stress-test.js:20` | — (Redis напрямую, `ioredis`) | **живой** при наличии `ioredis` | Зависимости `ioredis` в `package.json` нет — не запустится без установки |
| 20 | `tests/chaos/circuit-breaker.test.js:121,164` | `/api/auth/login`, POST+GET `/api/crews` | **частично** | Cookie взят верно, пароль `admin123` верен (`:58`); POST без CSRF-заголовка → 403, а проверка ждёт 200/503 |
| 21 | `agents/backend/api-concurrency-performance.ts` | — | не сценарий | Это статический анализатор (эвристики по regex), а не нагрузочный тест; в инвентарь включён ошибочно самим репозиторием |

## Находки

| # | severity | path:line | проблема | чем грозит | что сделать |
|---|---|---|---|---|---|
| 1 | критично | `load-tests/load-http.js:153,194`; `load-http-quick.js:76,85`; `load-http-batch.js:93`; `load-http-aggressive.js:92,103`; `load-combined.js:91,103` | Все 5 сценариев бьют `/api/sync*`; каталога `src/app/api/sync/` нет, удалён `2ef48772` (24.05.2026) | 100% сценариев `load-tests/` дают 404; если кто-то поверит их порогам `http_req_failed<0.05`, он ничего не проверит | Удалить либо переписать на живые `/api/reports/upsert` и `/api/reports/my` |
| 2 | критично | `scripts/load-test.js:96,106` | `syncPull`/`syncPush` бьют удалённые `/api/sync/updates` и `/api/sync` | Команда `npm run test:load` (главная точка входа) частично мёртвая и всё равно печатает «успех» | Убрать sync-функции |
| 3 | критично | `performance/k6/report.test.js:131`; `smoke.test.js:52`; `spike.test.js:60`; `soak.test.js:58`; `stress-test.js:118` | Авторизация заголовком `Authorization: Bearer <token>`, а сервер читает только cookie `pt-session` (`session-service.ts:260-261`) и Bearer не поддерживает (`src/lib/auth.ts:162`) | Все защищённые запросы k6 → 401; тест меряет задержку отказа, а не API | Передавать `Cookie: pt-session=<token>` (как в `quick-load-test.js:100`) |
| 4 | критично | `performance/k6/login.test.js:24-28`; `report.test.js:59`; `smoke.test.js:37`; `spike.test.js:44`; `soak.test.js:42` | Пароли по умолчанию `'1234'/'2222'/'0000'/'1111'/'3333'`, тогда как сид ставит `admin123/dispatch123/operator123/helper123` (`prisma/seed.ts:140-145`) | Логин не проходит ни в одном k6-сценарии; без `__ENV.*_PASSWORD` они неработоспособны | Привести значения к сиду или брать из env с проверкой |
| 5 | критично | `.github/workflows/ci.yml:14-336`; `deploy.yml:24-100`; `package.json` (scripts) | Нагрузочных прогонов нет ни в CI, ни при деплое; `test:load*` не входит в `npm run verify` | Регрессия производительности ловится только руками; P-1 (`docs/audit.md:273-277`) не закрыт | Отдельный (неблокирующий) job с одним сценарием на PR/ночь |
| 6 | критично | `scripts/quick-load-test.js:93`; `stress-test-100.js:27` | Логин под `loadtest@piling.ru` / `loadtest123` — такого пользователя в сиде нет (`prisma/seed.ts:139-153`) | Cookie не выдаётся → 100% запросов 401, а скрипт печатает метрики и «PASS» по порогам | Использовать `operator@piling.ru`/`operator123` |
| 7 | важно | `performance/k6/report.test.js:137`; `spike.test.js:80`; `scripts/load-test.js:106`; `tests/chaos/circuit-breaker.test.js:121` | POST-мутации шлют только `Content-Type`; `withMutation` вызывает `withCsrf`, которая без `Origin`/`Referer`/`Sec-Fetch-Site` возвращает 403 (`csrf-protection.ts:109-116`) | Все проверки записи (upsert отчёта, создание бригады) получают 403 и выглядят как «ошибка сервера» | Добавить `Origin: <BASE_URL>` (и/или `Sec-Fetch-Site: same-origin`) |
| 8 | важно | `scripts/load-test.js:47` | Читает `body.token` из ответа логина, но логин отдаёт `{ user }` без токена (`auth-service.ts:296`) | `authToken` всегда пуст → защищённые GET-ы 401 | Брать cookie из `Set-Cookie` (как `quick-load-test.js:100`) |
| 9 | важно | `load-tests/generate-session.ts:9,26,38` | `createSessionToken` — `async` (`session-service.ts:187`), вызван без `await`; напечатанная подсказка предлагает cookie `session=`, реальное имя `pt-session` (`session-service.ts:7`) | Утилита выдаёт `[object Promise]`; любой, кто пойдёт по её подсказке, получит нерабочий токен | `await` + имя `pt-session`; либо удалить утилиту |
| 10 | важно | `load-tests/README.md:72-78`; `performance/README.md:105-111` | Профиль нагрузки (1000 VU, 500–800 RPS, capacity 4–8 vCPU) не соответствует бою: 1 организация, 10–20 машинистов | Чинят не тот масштаб; выводы о capacity неприменимы | Пересчитать профиль под реальный (20–30 VU на пике) |
| 11 | важно | (нет файла) — кандидаты: `src/app/api/admin/analytics/overview/route.ts:148`, `src/app/api/reports/all/route.ts:13`, `src/app/api/monitoring/fleet/route.ts:21`, `src/app/api/admin/equipment-analytics/route.ts:9` | Ни один сценарий не нагружает дашборды админки/диспетчера | Именно эти тяжёлые агрегаты тормозят в рабочий день, а их не мерят | Добавить в сценарий долю чтения аналитики |
| 12 | важно | `src/app/api/reports/upsert/route.ts:16` — единственная живая запись отчёта | Нет сценария «пик смены»: одновременная отправка отчётов. Батч-эндпоинта (`/api/sync/batch`) больше нет | Пиковая одновременная запись 10–20 отчётов не воспроизводится вообще | Смоделировать бурст POST `/api/reports/upsert` (см. раздел ниже) |
| 13 | важно | `load-tests/README.md:32`; `performance/k6/spike.test.js:5-8`; `performance/README.md:110` | Сценарии «офлайн-очередь / синхронизация после восстановления сети» описывают подсистему, удалённую вместе с sync v3 | Вводят в заблуждение при чтении README; очередь мёртвого кода в бэклоге | Убрать офлайн/синк из описаний |
| 14 | мелочь | `load-tests/event-storm.ts:195` | Публикация в канал `realtime:events`, потребителя в `src/` нет (0 совпадений) | Скрипт печатает «успешную» нагрузку Redis, ничего не проверяя | Удалить либо переподключить к реальному получателю |
| 15 | мелочь | `load-tests/slo-monitor.ts:138,169` | Проба WS по `http://localhost:3001` и SLO «WS connections ≥ 900» — сервера нет | SLO всегда красный → монитор обесценен | Убрать WS-пробу и SLO |
| 16 | мелочь | `scripts/redis-stress-test.js:20` | `require('ioredis')`, но `ioredis` нет в `package.json` | Скрипт падает на первом require | Указать зависимость или удалить скрипт |
| 17 | мелочь | `performance/scenarios/e2e-load-integration.ts:93` | Спавнит `npx k6 run …` (k6 не ставится через npx как пакет) и `report.test.js` (мёртв) | Фаза 2 всегда «успешно» уходит в таймаут 3 мин | Заменить команду или удалить сценарий |
| 18 | мелочь | `load-tests/README.md:32` (упоминание WS); `tests/chaos/circuit-breaker.test.js:12` (`load-spike.test.js`) | Ссылки на несуществующие файлы (`load-ws.js`, `load-ws-quick.js`, `load-spike.test.js`) | Мёртвые ссылки в документации и заголовке теста | Убрать |
| 19 | мелочь | `load-test-results.json:1` (в корне, в git с `c62bae87`) | Закоммичен артефакт прогона k6 с чужими числами | Выдаётся за результат проверки; не воспроизводим | Удалить из репозитория |
| 20 | мелочь | `load-tests/README.md:80-86` | Таблица «Файлы» перечисляет 3 из 10 файлов каталога | Остальные сценарии невидимы читателю | Актуализировать |
| 21 | мелочь | `load-tests/load-http-quick.js:31`; `load-http-aggressive.js:47`; `load-http-batch.js:41` | `BASE_URL` по умолчанию `http://localhost:3000`, а стенд — 3100 (`playwright.manual.config.ts:9`) | Сценарии не запускаются на стенде «из коробки» | Сделать `BASE_URL` явным параметром стенда |
| 22 | мелочь | `load-tests/load-http-quick.js:26`; `load-http-batch.js:36`; `load-http-aggressive.js:41` | Порог `http_req_failed < 0.05` (5%) маскирует системные 401/403 | Тест «зелёный» при полном отказе авторизации | Снизить до `< 0.01` |
| 23 | мелочь | `performance/README.md:213-221` | KPI «p95 273 ms @ 30 VU», «покрытие 99.2% (248/250)» без источника прогона | Не перепроверяемо, устаревает молча | Убрать или привязать к артефакту прогона |
| 24 | мелочь | `performance/README.md:156-176` | Описан CI-пайплайн с smoke/nightly/weekly k6 — в `.github/workflows/ci.yml` этого нет | Документация обещает то, чего нет | Синхронизировать с реальным CI |

## Предложение: ОДИН минимальный актуальный сценарий (стенд `localhost:3100`)

Ничего не выдумано — все маршруты ниже существуют и открыты (`withApi`/`withMutation` + `requireAuth`): `src/app/api/auth/login/route.ts:16` (в CSRF-исключениях, `csrf-protection.ts:31`), `src/app/api/reports/my/route.ts:13`, `src/app/api/crews/all/route.ts:17`, `src/app/api/dictionary/all/route.ts:9`, `src/app/api/equipment/route.ts:12` (кеш 60 с), `src/app/api/reports/upsert/route.ts:16`.

Профиль: 1 организация, 10–20 машинистов → **20 VU**; пик смены — одновременная отправка отчётов и чтение списка «мои отчёты».

Три группы (сумма весов 100%), think-time 1–3 с:
- 65 % — GET `/api/reports/my` (экран машиниста после смены);
- 25 % — GET `/api/dictionary/all` и GET `/api/crews/all` и GET `/api/equipment` (справочники, часть кеширована);
- 10 % — POST `/api/reports/upsert` (отправка отчёта; `Cookie: pt-session=…` + заголовок `Origin: http://localhost:3100` и `Idempotency-Key`, иначе CSRF даст 403).

`setup()`: один `POST /api/auth/login` (`operator@piling.ru` / `operator123`), токен взять из `Set-Cookie` (cookie `pt-session`), не из тела — тело `{user}`.
Профиль: `ramping-vus` — 30 с до 20 VU → 2 мин удержания → 10 с до 0.
Критерий: **p95 < 500 мс**, p99 < 1000 мс, `http_req_failed` < 1 %.

Почему именно так: 20 VU честно отражают 10–20 машинистов; `/api/reports/my` и `/api/reports/upsert` — это реальные «начало/конец смены»; дашборды админки в этот минимальный сценарий сознательно не включены (их стоит добавить вторым шагом, см. №11). Офлайн-очередь смоделировать нельзя — подсистемы нет (№13).

## Не проверено

- Ничего из сценариев не запускалось: k6 в этом окружении не установлен, БД/сессия под стенд не поднимались. Все выводы о «живой/мёртвый» сделаны по коду маршрутов и обёрток, а не по фактическому прогону.
- Чем именно поднимается локальный стенд на `localhost:3100` — в репозитории не нашёл (единственная ссылка — `playwright.manual.config.ts:9`). Порты 3100 у Loki (`docker-compose.observability.yml:74`) — совпадение, не тот сервис. Считаю, что стенд существует в окружении владельца; в коде его конфигурации нет.
- Пользователь `loadtest@piling.ru` мог существовать в промежуточных состояниях прод-БД; проверено только отсутствие в `prisma/seed.ts`. Прод-БД не читалась.
- Реальный боевой профиль (число одновременных машинистов, пиковые RPS, сколько запросов на отчёт) взят из текста задачи и `docs/audit.md`, а не из метрик боевого Prometheus — доступа к проду нет.
- `agents/backend/api-concurrency-performance.ts` прочитан, но его эвристики/выводы не перепроверялись — это не нагрузочный сценарий.
- Сценарии из замороженных зон (экран оператора, ORION) не искались и не оценивались.
