# AU88-S5-ORIGIN-COOKIE-CSRF: CORS, Origin, cookies и CSRF — покрытие

Версия: `git rev-parse HEAD` = `87a971ee84228e606876aa9d42a1630614578788` (ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`). На момент чтения в дереве был один незакоммиченный файл — `AGENTS.md` (не мой).

Область: только чтение. Рассмотрены `src/lib/csrf-protection.ts`, `src/core/api-wrapper.ts`, `src/proxy.ts`, куки в `src/services/auth/session-service.ts` и `src/app/api/auth/**`. Замороженные зоны (варианты экрана оператора, сайт ORION) не разбирались; маршрут `/api/orion/lead` упомянут только как строка в списке исключений CSRF.

## Итог

Числа из команд (см. «Методика»): 141 файл `route.ts`; 109 изменяющих методы обработчиков (POST/PUT/PATCH/DELETE); 101 из них закрыт полной обёрткой (`withMutation` / `withReadinessCommand`), 3 — ручным вызовом `withCsrf`, 5 — без CSRF.

1. Критичных находок нет. Итоги по важности: **критично — 0, важно — 4, мелочь — 6, «пройдено/подтверждено» — 5**.
2. CSRF-защита по факту одна: `withCsrf` внутри `withMutation` (`src/core/api-wrapper.ts:183`). Полноценный «замок» есть у 101 из 109 изменяющих обработчиков; ещё 3 закрыты вручную, 4 — сознательные исключения (не браузерные входы), 1 — псевдоним метода.
3. **Главное:** `withCsrf` не проверяет ничего, кроме заголовков Origin/Referer/Sec-Fetch-Site/Host (`src/lib/csrf-protection.ts:67-125`). CSRF-токена в приложении нет вовсе. Отказ реализован корректно (запрос без браузерных заголовков режется, строка 120), но вся защита держится на том, что браузер эти заголовки прислал.
4. Плюс к этому кука сессии `pt-session` — `HttpOnly`, `SameSite=Lax`, `Path=/`, 12 ч (`src/services/auth/session-service.ts:280-288`), поэтому кросс-сайтовый POST куку и так не принесёт. `Secure` включается только при `NODE_ENV=production` (строка 285), а Dockerfile выставляет его (`Dockerfile:86`) — в проде флаг есть.
5. CORS в приложении есть и отражает Origin с `Access-Control-Allow-Credentials: true` (`src/proxy.ts:206,211,220-221`). В список разрешённых Origin **безусловно** входят `http://localhost:3000` и `http://127.0.0.1:3000` (строка 19) — это и в проде тоже (находка №1).

## Методика

Что и как смотрел (повторяемо):

- `git rev-parse HEAD` — версия; `find src/app/api -name route.ts | wc -l` — 141 файл.
- Прочитаны целиком: `src/lib/csrf-protection.ts`, `src/core/api-wrapper.ts`, `src/proxy.ts`, `src/lib/auth.ts`, `src/services/auth/session-service.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/alerts/webhook/route.ts`, `src/app/api/telemetry/route.ts` (фрагмент), `src/app/api/telemetry/batch/route.ts` (фрагмент), `src/app/api/telemetry/ingest/route.ts` (хвост), `src/app/api/readiness/_shared/route-adapter.ts`, `src/lib/page-session.ts`, `src/app/page.tsx`, `src/app/api/__tests__/api-routes.test.ts`, `src/app/api/__tests__/route-guards.test.ts`, `next.config.ts`, `deploy/Caddyfile.prod`, `Dockerfile`.
- Инвентаризация изменяющих методов: node-скрипт (только чтение) по 141 `route.ts` — искал `export const {POST,PUT,PATCH,DELETE} =` / `export async function {…}(`, классифицировал по обёртке.
- Проверка «есть ли изменяющие GET»: node-скрипт вырезал тело каждого GET-обработчика (от объявления до следующего `export`) и искал `db.` + `create/update/upsert/delete/createMany/updateMany/deleteMany` — совпадений 0.
- `search_files` по `src`: `'use server'` (0 совпадений), `document.cookie` (0), `next/headers` (2 файла, оба только читают куку), `Access-Control|sec-fetch|credentials:|headers.get('origin'|referer')`.
- Тесты-сторожа прочитаны как источник контракта, но **не запускались** (только чтение, см. «Что не проверено»).

## Находки

Легенда статусов: ПРОЙДЕНО — проверено, всё в порядке; ГИПОТЕЗА — вывод из чтения кода, эксплуатация не воспроизводилась; НЕ ПРОВЕРЕНО — названное не смотрел.

| # | Важность | Файл:строка | Проблема | Сценарий / почему важно | Что сделать |
|---|---|---|---|---|---|
| 1 | важно | `src/proxy.ts:19` (+`:206,211,220-221`) | В список CORS-Origin **безусловно** добавлены `http://localhost:3000` и `http://127.0.0.1:3000` — без проверки `NODE_ENV`. Ответы для разрешённого Origin отдают `Access-Control-Allow-Origin: <origin>` и `Access-Control-Allow-Credentials: true`. | В проде любой процесс на машине сотрудника, слушающий порт 3000, попадает в белый список CORS и может читать ответы `/api/*` кросс-доменно. **ГИПОТЕЗА**: на практике ослаблено тем, что кука `SameSite=Lax` (session-service.ts:284) не поедет в кросс-сайтовом fetch, а Caddy ставит `Cross-Origin-Resource-Policy: same-origin` (`deploy/Caddyfile.prod:42`). | Добавлять localhost-Origin только при `NODE_ENV === 'development'`. |
| 2 | важно | `src/core/api-wrapper.ts:183` | CSRF живёт только внутри `withMutation`/`withReadinessCommand`. Runtime-гарантии нет: маршрут с `withApi` или голый `export async function POST` молча теряет и CSRF, и лимит. | Два живых маршрута именно такие: `src/app/api/alerts/webhook/route.ts:88` и `src/app/api/orion/lead/route.ts:55`. Оба защищены иначе (общий секрет / лимит по IP), но новый маршрут легко напишут так же. | Явно: изменяющие маршруты — только через `withMutation` (как и записано в AGENTS.md). Контроль — тестами-сторожами (`api-routes.test.ts:745-757`, `route-guards.test.ts:229-231`), они и есть единственный барьер. |
| 3 | важно | `src/lib/csrf-protection.ts:41-43`, `src/app/api/auth/login/route.ts:27-28` | Для `/api/auth/login` разрешён POST **вовсе без** Origin/Referer/Sec-Fetch-Site (список `CSRF_HEADERLESS_ALLOWED_PATHS`). | Это сознательная правка против login CSRF (Codex out55 F09). **ГИПОТЕЗА**: кросс-сайтовая форма в старом браузере, который не шлёт ни Origin, ни Referer, ни Sec-Fetch-Site, снова откроет подмену сессии. Современные браузеры шлют `Sec-Fetch-Site: cross-site` и режутся на строке 74. | Оставить как есть (нужно скриптам смоука), но помнить: это единственная дыра «без заголовков». |
| 4 | важно | `src/core/api-wrapper.ts:201` vs `src/app/api/telemetry/route.ts:83-92`, `src/app/api/telemetry/batch/route.ts:64-72` | Два телеметрийных POST закрыты `withApi` + ручным `withCsrf`, то есть **не** получают общий `mut:source:<ip>` лимит из обёртки; у них свой лимит `telemetry:<ip>` (500/мин), ключ другой. | Порог 1800/мин по всем мутациям источника на эти маршруты не распространяется — лимитная защита «на всё сразу» их не покрывает (CSRF при этом есть). | Перевести оба на `withMutation(..., { rateLimit })`, как помечено в `api-routes.test.ts:234-237`. |
| 5 | мелочь | `src/lib/csrf-protection.ts:28-32` | `CSRF_EXEMPT_PATHS` содержит `/api/ready`, `/api/health`, `/api/auth/me`, но `withCsrf` и так не проверяет не-изменяющие методы (строка 63), а эти пути имеют только GET (`src/app/api/ready/route.ts:27`, `src/app/api/health/route.ts:24`, `src/app/api/auth/me/route.ts:17`). | Список сегодня ни на что не влияет — мёртвые записи, создают ложное ощущение ослабления. | Удалить список либо оставить с пометкой «устарел». |
| 6 | мелочь | `src/proxy.ts:206,220` | Ответы с отражённым `Access-Control-Allow-Origin` не содержат `Vary: Origin`. | **ГИПОТЕЗА**: при добавлении кеширующего прокси/CDN ответ, снятый для одного Origin, может уйти другому. Сейчас кеша в Caddy нет (`deploy/Caddyfile.prod` — только `reverse_proxy`), серверный кеш `withApi` кэширует ответ обработчика, а не заголовки прокси. | Добавить `Vary: Origin`, если CORS-отражение остаётся. |
| 7 | мелочь | `src/proxy.ts:96` и `:130-132` | `enforceTenant` берёт `x-tenant-id` из **запроса клиента** и кладёт его в **ответ** (`response.headers.set`), хотя комментарий обещает «pass tenant context to downstream handlers». В `NextResponse.next()` без проброса request-заголовков до обработчика это не дойдёт. | В мультитенантном режиме клиентский `X-Tenant-ID` разрешён `Access-Control-Allow-Headers` (строка 208). **ГИПОТЕЗА**: заголовок до обработчиков не доезжает, поэтому реального влияния, вероятно, нет; но и заявленный проброс не работает. | Либо прокидывать тенанта через request-заголовки (`NextResponse.next({ request: { headers } })`), либо поправить комментарий. |
| 8 | мелочь | `src/services/auth/session-service.ts:279-291` | Флаги куки `pt-session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `maxAge` 12 ч, `Secure` — только при `NODE_ENV==='production'` (строка 285). Нет префикса `__Host-`. | В проде всё нужное стоит (Dockerfile:86). **ГИПОТЕЗА**: при запуске образа с иным `NODE_ENV` кука пойдёт без `Secure`. `SameSite=Lax` (а не `Strict`) — осознанный компромисс, для POST-мутаций достаточно. | Не менять без нужды; при желании — `__Host-` префикс и `SameSite=Strict`. |
| 9 | мелочь | `src/lib/csrf-protection.ts:83-98` | Сравнение идёт `new URL(origin).host !== host`. `X-Forwarded-Host` не учитывается. | Перед приложением Caddy (Host не переписывает) сравнение верное. **ГИПОТЕЗА**: за прокси, меняющим Host на внутренний, все мутации начнут падать 403. | При появлении такого прокси — учитывать `X-Forwarded-Host` из доверенного источника. |
| 10 | мелочь | `src/proxy.ts:38-55` | Для шаблонов вида `*.example.com` (`:48-53`) проверяется только hostname, схема и порт Origin не проверяются. | `http://` (не https) поддомен из шаблона тоже пройдёт, если шаблон задан волей в `CORS_ALLOWED_ORIGINS`. Сейчас переменная в дефолте пуста. | Сравнивать полный origin, а не только hostname. |

### Подтверждённое (ПРОЙДЕНО)

| # | Что проверено | Файл:строка | Вывод |
|---|---|---|---|
| П1 | Порядок в `withMutation`: CSRF → общий лимит по источнику → лимит по маршруту → обработчик | `src/core/api-wrapper.ts:183-221` | ПРОЙДЕНО. CSRF выполняется раньше бизнес-логики, `validated`-схема не задействована. |
| П2 | Запрос без Origin, Referer и Sec-Fetch-Site режется 403 | `src/lib/csrf-protection.ts:120-125` | ПРОЙДЕНО. Единственное послабление — `/api/auth/login` (находка №3). |
| П3 | `Sec-Fetch-Site` строже обычного: разрешены только `same-origin` и `none`, `cross-site` и `same-site` режутся | `src/lib/csrf-protection.ts:46,73-80` | ПРОЙДЕНО. Кросс-поддоменный вызов тоже отклоняется. |
| П4 | Нет Server Actions и HTML-форм с кукой: `'use server'` — 0 совпадений, `document.cookie` — 0 | поиск по `src` | ПРОЙДЕНО. CSRF нужен только на API; у HTML-ветки прокси (`src/proxy.ts:231-244`) защищать нечего кроме CSP. |
| П5 | Изменяющих GET нет: тело каждого GET-обработчика проверено на `db.*create/update/upsert/delete*` | `src/app/api/**/route.ts` | ПРОЙДЕНО (эвристика, см. оговорку ниже). Состояние через GET не меняется. |

### Таблица «маршрут/группа → защита»

| Маршрут или группа | Защита | Исключение | Файл:строка | Риск |
|---|---|---|---|---|
| 101 изменяющий обработчик (`withMutation` / `withReadinessCommand`) | CSRF + лимит по источнику + лимит по маршруту | нет | `src/core/api-wrapper.ts:178-222`; обёртка readiness — `src/app/api/readiness/_shared/route-adapter.ts:13-30` | низкий |
| `POST /api/auth/login` | ручной `withCsrf`; запросы без браузерных заголовков пропускаются | `CSRF_HEADERLESS_ALLOWED_PATHS` | `src/lib/csrf-protection.ts:41-43`; `src/app/api/auth/login/route.ts:27-28` | важно (№3) |
| `POST /api/telemetry`, `POST /api/telemetry/batch` | ручной `withCsrf` + свой лимит `telemetry:<ip>` | лимит обёртки не применяется | `src/app/api/telemetry/route.ts:83-92`; `src/app/api/telemetry/batch/route.ts:64-72` | важно (№4) |
| `POST/PATCH /api/telemetry/ingest` | ключ устройства `X-Device-Key` + лимит | `CSRF_EXEMPT_METHODS` (не браузер) | `src/app/api/telemetry/ingest/route.ts:60-89,95,141`; `src/app/api/__tests__/api-routes.test.ts:222-223` | низкий |
| `POST /api/alerts/webhook` | общий секрет `Authorization: Bearer` (constant-time) | `CSRF_EXEMPT_METHODS`; голый обработчик | `src/app/api/alerts/webhook/route.ts:79-91`; `api-routes.test.ts:221` | низкий |
| `POST /api/orion/lead` (заморожен, вне разбора) | лимит по IP + ловушка для ботов | `CSRF_EXEMPT_METHODS`; голый обработчик | `src/app/api/orion/lead/route.ts:55`; `api-routes.test.ts:220` | не разбиралось |
| Все `GET` | CSRF не применяется (проверяются только `POST/PUT/PATCH/DELETE`) | — | `src/lib/csrf-protection.ts:62-65` | низкий (изменяющих GET не найдено) |
| `OPTIONS /api/*` (CORS-preflight) | `proxy` отдаёт 204 с ACAO для разрешённого Origin | сам обработчик не вызывается | `src/proxy.ts:203-215` | низкий |
| Все ответы `/api/*` | CORS-заголовки при разрешённом Origin, `Allow-Credentials: true` | localhost-Origin разрешён всегда | `src/proxy.ts:15-36,199-228` | важно (№1) |
| Кука `pt-session` | `HttpOnly`, `SameSite=Lax`, `Path=/`, 12 ч, `Secure` в проде | — | `src/services/auth/session-service.ts:7-8,279-291` | низкий |

## Что не проверено

- **Тесты не запускались.** Все числа выше — из чтения и node-скриптов, не из `vitest`. Утверждения тестов-сторожей (`api-routes.test.ts:736-757`, `route-guards.test.ts:229-231`) приняты как контракт, но их фактическое прохождение на этой версии не подтверждено.
- **Эксплуатация не воспроизводилась.** Находки №1, №3, №6, №7, №9 — ГИПОТЕЗЫ: выведены из чтения кода, ни один сценарий не запускался ни на dev-, ни на боевом контуре (боевой доступ запрещён).
- **Значения env не смотрел.** `CORS_ALLOWED_ORIGINS`, `ALLOWED_DEV_ORIGIN`, `NEXT_PUBLIC_APP_URL`, `NODE_ENV` в проде не читались (`.env*` запрещены). Реальный прод-список разрешённых Origin не подтверждён — только дефолты из `src/proxy.ts:19,31`.
- **Роль Caddy проверена только по файлу** `deploy/Caddyfile.prod`; что на сервере конфиг совпадает с файлом (это заявлено в его шапке) — не проверялось.
- **Полнота эвристики по GET.** Проверка «изменяющих GET» ищет `db.` и обычные глаголы Prisma; вызовы через сервисы/`$executeRaw`/SQL не ловились. Совпадений — 0, но это не доказательство отсутствия.
- **Замороженные зоны** (экраны оператора, ORION) и весь `src/components/**` не разбирались; в частности, как именно клиент отправляет мутации за пределами `src/lib/api.ts` — не проверялось.
- **Мультитенантный режим** (`MULTI_TENANT_MODE=true`, `TENANT_DOMAIN`) не включён и не тестировался; вывод по `enforceTenant` (№7) — из чтения кода.
