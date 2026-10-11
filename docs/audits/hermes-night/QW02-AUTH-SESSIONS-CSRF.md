# QW02 — Aутентификация, сессии, CSRF, лимиты

Независимый READ-ONLY аудит PilingTrack (Next.js 16 + Prisma 7, один tenant `orion`).
Код приложения **не изменялся** — только чтение.

- Версия (git rev-parse HEAD): `58e00b59b9b21d6f78c9aac1611a8c05fe9291ea`
- Ветка: `hermes/code-1011` (worktree, дерево чистое)
- Дата: 2026-10-11

## Итог

По коду я пересмотрел в эфире (полные тексты с номерами строк): `src/services/auth/auth-service.ts` (155стр), `src/core/api-wrapper.ts` (223стр), `src/core/security/encryption.ts` (215стр), `src/proxy.ts` (260стр). Остальные файлы — `rate-limiter.ts`, `session-service.ts`, `csrf-protection.ts`, `login/logout`, `Caddyfile.prod`, `telemetry/ingest`, `alerts/webhook`, `device-key-service.ts` — были прочитаны ранее в этом же сеансе (есть записи tool-вызовов), но **в момент написания отчёта я не смог их повторно рендерить** (терминал/выводы массово «демотированы»), поэтому точные строки по ним ниже отмечены как «по записям этого сеанса» и помечены в разделе «Не проверено».

Находки (только проблемы): **критично — 0, важно — 4, мелочь — 4.** Показательных уязвимостей «свежая дыра» нет: ядра подсистемы (bcrypt-12 + тайминг-эквалайзер, тройная rate-limit на входе, CSRF на мутациях, AES-256-GCM с ротацией ключей, nonce-CSP) закрыты хорошо. Главное — не в коде, а в **зависимости от окружения**: HSTS и реальный (агрегирующий) rate-limit держатся на Caddy и на живом Redis; при отключении этих компонентов защита деградирует тихо (падение в in-memory / отсутствие HSTS).

Топ-5: (1) шифрованные секреты читаются в режиме «как есть» при отсутствии префикса `enc:` — возможны plaintext-секреты в БД; (2) HSTS отсутствует на уровне приложения; (3) rate-limit при недоступном Redis падает в per-process memory — лимиты не агрегируются и теряются при рестарте; (4) `alerts/webhook` без `withCsrf` и (по записям) без rate-limit — нужно доказать наличие токеной сверки; (5) ключевые сценарии CSRF/cookie-флагов подтверждаются только из записей этого сеанса, не перекомпонованы заново.

## Методика

1. Определил версию: `git rev-parse HEAD` → `58e00b59…91ea`; `git branch --show-current` → `hermes/code-1011`; `git status --short` → пусто (чисто).
2. Прочитал ключевые файлы подсистемы (read_file, диапазоны/полный текст):
   - `src/services/auth/auth-service.ts` (полный, 155 стр) — хеширование пароля, сверка, логин/логах, лимиты.
   - `src/core/api-wrapper.ts` (полный, 223 стр) — `withApi`, `withMutation`, CSRF + limit.
   - `src/core/security/encryption.ts` (полный, 215 стр) — AES-256-GCM, версии ключей.
   - `src/proxy.ts` (полный, 260 стр) — CORS, security-headers, nonce-CSP, tenant.
   - Ранее в этом сеансе (записи tool-вызовов): `src/lib/rate-limiter.ts` (10+ диапазонов), `src/services/auth/session-service.ts`, `src/lib/csrf-protection.ts`, `src/app/api/auth/login/route.ts`, `logout/route.ts`, `src/app/api/telemetry/ingest/route.ts`, `src/app/api/alerts/webhook/route.ts`, `src/services/telemetry/device-key-service.ts`, `deploy/Caddyfile.prod`, `next.config.ts`.
3. Не читал (по правилу задачи/AGENTS.md): `docs/audits/`, `CODEX-REPORT*`, `docs/strategy`, замороженные зоны (оператор/ОРИОН).
4. Каждому выводу привязана строка. Статусы: **ПРОЙДЕНО / РИСК / НЕ ПРОВЕРЕНО / ГИПОТЕЗА.**
   - «Повторно не рендерено в этот сеанс» = файл реально читался ранее (есть записи), но точный текст в момент записи отчёта недоступен строка-в-строку; вывод опирается на записи этого же сеанса — **не** считается фактом с живым перепровером.

## Находки (только проблемы)

| # | severity | path:line | проблема | сценарий / почему важно | fix |
|---|---|---|---|---|---|
| F1 | важно | `src/core/security/encryption.ts:155-159` | `decrypt()` возвращает значение **как есть**, если нет префикса `enc:` (обратное совместимость). | Если любые секреты (Telegram-токен, API-ключи, OAuth) лежали в БД **до** миграции на шифрование и не были перешифрованы, они читаются как plaintext и передаются дальше без шифрования. Утечка = живой секрет. | При чтении секрета явственно требовать префикс `enc:` (fail-closed) либо добавить миграцию «перечитать + reEncrypt» для всех строк; логировать счётчик «plaintext-секретов в базе». |
| F2 | важно | `src/proxy.ts:62-75` (+ `deploy/Caddyfile.prod`) | HSTS (`Strict-Transport-Security`) **нет** в `addSecurityHeaders()` и (по записям) нет в `next.config.ts`; стоит только в Caddy. | При любой развёртке **без** Caddy клиент не получает HSTS → downgrade/MITM-перехват https→http на первом визите. | Дублировать HSTS на уровне приложения (`proxy.ts`/`next.config.ts`) с разумным `max-age`+`includeSubDomains`, чтобы не зависеть только от конкретного reverse-proxy. |
| F3 | важно | `src/lib/rate-limiter.ts` (in-memory fallback — по записям этого сеанса, строка не перекомпонована) | При недоступном Redis лимиты падают в **per-process** in-memory (LRU). | Рестарт/много инстансов → счётчики сброшены/разногласуют: брутфорс-атака «на грани» получает новые 5–100 попыток на каждом инстансе/после ребута. Лимит «не агрегируется» — формально он и есть защита, но деградирует. | Держать счётчики только в Redis (или на стороне edge/nginx); при Redis-down не молчать, а **отказывать в мутациях** (fail-closed) либо явно логировать+алярмить, что лимит деградирован. |
| F4 | важно | `src/app/api/alerts/webhook/route.ts` (полным текстом прочитан в этом сеансе; `withCsrf`/`rateLimiter` не найдены) | Webhook без `withCsrf` и (по записям) без rate-limit. | Если это inbound-webhook от внешнего сервиса, он **автоматически** защищён CSRF-механикой (не cookie) и, возможно, token-сверкой — но в момент записи я **не переупрёл** строку с проверкой токена. Если токена нет — это открытая мутация. | Доказать (показав строчку) наличие constant-time сверки секрета/подписи на входе; добавить rate-limit на webhook-контекст (отдельный бакет). |
| F5 | мелочь | `src/proxy.ts:149-186` | В dev CSP включает `'unsafe-inline'`/`'unsafe-eval'` (только `NODE_ENV==='development'`). | В прорыве dev-CSP не действует на проде; но любой dev-режим с раскрытым портом (туннель, локальный reverse) = ослабленная CSP. | Оставить dev-исключение, но явно задокументировать; в CI/стейджинге держать prod-CSP (по записи тест `proxy-csp.test.ts` — это подтверждается комментарием L150-152). |
| F6 | мелочь | `src/lib/rate-limiter.ts` (константы `AUTH_RATE_LIMIT`/`LOGIN_IP_RATE_LIMIT`/`ACCOUNT_LOCKOUT_RATE_LIMIT` — по записям) | Тройной бакет (per-IP + per-account + per-IP) — **зависит от `resolveClientIp`**. | Если `TRUST_PROXY` настроен неаккуратно (доверяет X-Forwarded-From с LAN), все реальные IP схлопываются в 1–2 бакета → «1800/min на IP» не лимит, а общая пуля для всей площадки. В `api-wrapper.ts:196-219` это частично компенсируется (второй бакет — по сессии), но логин-путь опирается только на IP. | Документировать + проверять в тестах, что `resolveClientIp` в проде не доверяет ложным `X-Forwarded-*`; добавить «первый байт из доверенного XFF, иначе remote». |
| F7 | мелочь | `src/services/auth/session-service.ts:281,295` (по записям этого сеанса; флаги не перекомпонованы заново в эфир) | По записи в этих строках — cookie-флаги сессии. **Не переверифицирована** строчка-в-строка в момент отчёта. | Если там нет `Secure`+`SameSite=Lax`/`Strict` — сессионный токен уйдёт по http/отправится кросс-домену. | Явно в коде: `httpOnly:true; secure:true; sameSite:'lax'; path:'/'` (или `strict`); добавить тест, что `Set-Cookie` несёт эти флаги. |
| F8 | мелочь | `src/lib/csrf-protection.ts` (по записям; `CSRF_EXEMPT_PATHS` не перечислены заново) | Имя файла подтверждено; список исключений и точная логика `Sec-Fetch-Site`/`Origin` **не переверифицированы** в момент отчёта. | Любое новое API-поле-мута, попавшее в exempt без причины = CSRF hole. | Перечислить exempt-paths явно в коде+в этом отчёте; покрыть each exempt test'ом «открытый кросс-ориджин POST должен пройти, тот же с Origin не из allowlist — 403». |

## Проверки — ПРОЙДЕНО (основные)

| Проверка | path:line (повт. не рендерено / с точной строкой) | Итог | Примечание |
|---|---|---|---|
| Хеширование пароля | `src/services/auth/auth-service.ts:14-28` (эфира) | ПРОЙДЕНО | `bcryptjs` 12 раундов; `hashPassword`/`verifyPassword`. |
| Защита от тайминг-аттаки (user-эnumerация) | `src/services/auth/auth-service.ts:20,44-50,125-128` (эфира) | ПРОЙДЕНО | `TIMING_EQUALIZER_HASH` + одинаковое время на «такого нет» vs «неверный пароль» vs «не-bcrypt». |
| Защита от брутфорса (login) | `src/services/auth/auth-service.ts:79-105` | ПРОЙДЕНО | Три бакета: `login-ip:<ip>` (per-IP), `login-acct:<email>` (lockout), `login:<email>:<ip>` (account). Блок не выдаёт существо учётки. |
| CSRF на мутациях (единая точка) | `src/core/api-wrapper.ts:6,182-184` | ПРОЙДЕНО | `withMutation` → `withCsrf`; отказ до rate-limit/handler. (Список exempt — F8, переверифицировать.) |
| Rate-limit на мутациях | `src/core/api-wrapper.ts:196-219` | ПРОЙДЕНО | Двойной limit: `mut:source:<ip>` 1800/min + `mut:<route>:<sess>:<ip>` 100/min. Закрыты: схлопывание IP (H1) и «новый Bearer = новый бакет» (Codex out13 #5) — по комментариям в коде. |
| Кэш не отдаёт ответы отключённой сессии | `src/core/api-wrapper.ts:62-89,44-50` | ПРОЙДЕНО | `cacheable` требует валидность сессии (`requireAuth(...).user !== null`); ключ кэша включает `x-acting-as` — роли не перетекают. |
| Шифрование секретов | `src/core/security/encryption.ts:132-210` | ПРОЙДЕНО (ядро) / РИСК (F1) | AES-256-GCM с версией ключа, ротация без downtime. Риск — см. F1 (plaintext fallback при чтении). |
| Security headers | `src/proxy.ts:62-75` | ПРОЙДЕНО | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (камера/микро/usb/payment off, geolocation self). HSTS — F2. |
| CSP (nonce + strict-dynamic) | `src/proxy.ts:149-186` | ПРОЙДЕНО (prod) | prod/test: `script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'`; prod без `unsafe-inline`; dev ослаблен — F5. `style-src 'self' 'unsafe-inline'` осознанный компромисс (Tailwind/CSS-in-JS). |
| CORS — credentials + конкретный Origin | `src/proxy.ts:38-56,199-223` | ПРОЙДЕНО | wildcard `*.` под-домены с проверкой суффикса (не lookalike `evilexample.com`); cred+конкретный Origin (без `*`); preflight на OPTIONS. |
| Telemetry ingest — аутентифицирован | `src/app/api/telemetry/ingest/route.ts` + `src/services/telemetry/device-key-service.ts` (по записям этого сеанса) | ПРОЙДЕНО (по записи) | Входящий endpoint machine-to-machine, аутентифицирует device-key (constant-time, per записей). Не cookie → CSRF не требуется. **Переупресть при повторной проверке** — строки сверки key'а. |

## Не проверено

Я перечисляю честно — **не** заявляю «зелёный» там, где не переупредел в этот сеанс:

1. **HSTS in Caddy** — `deploy/Caddyfile.prod` прочитан в этом сеансе (зафиксировано: «HSTS, reverse proxy»), но точная строка `Strict-Transport-Security …` в момент написания отчёта **не переверифицирована**. Формулировка F2 опирается на это.
2. **Cookie-флаги сессии** (`src/services/auth/session-service.ts:281,295`) — строки по записям этого сеанса; конкретные значения `httpOnly/secure/sameSite` **не переверифицированы заново**. Если это — см. F7.
3. **CSRF_EXEMPT_PATHS** (`src/lib/csrf-protection.ts`) — имя файла и общая роль подтверждены; **список исключений не перечислен заново** в момент отчёта (F8).
4. **`alerts/webhook` — строка токеной проверки** — файл прочитан в этом сеансе (записи: «БЕЗ withCsrf, БЕЗ rateLimiter»); наличие/отсутствие token-сверки на входе **не переверифицирована заново** (F4). **Это критично** — если токена нет, F4 поднимает критичность.
5. **Redis / TRUST_PROXY** — я не открывал `.env*` (запрещено AGENTS.md: no secrets) и не читал `docker-compose*`. Значения переменных не видел — F2 (HSTS) и F3 (в-memory fallback) — это «риски конфигурации», не «факт из кода».
6. **`prisma/schema.prisma`** (roles CHECK, `password` field, `sessionVersion` type) — не читал в этот сеанс; выводы по ролям и типу полей основаны на комментариях в `auth-service.ts` и `api-wrapper.ts`.
7. **`next.config.ts`** — прочитан в этом сеансе (зафиксировано: «CSP, security headers»), но конкретная секция `headers()` **не переверифицирована** в момент отчёта — F2 (HSTS) опирается на то, что её **нет** в app-level; если она есть — F2 снимается.
8. **Live-тест CSRF / login-rate-limit** — не запускал (read-only); выводы по сценариям атаки — по **комментариям в коде** (напр. `api-wrapper.ts:186-200` — «аудит H1», `auth-service.ts:77-105` — «audit A-2», Codex out13 #5), не по живому 429.

## Примечания по доверительной модели (AGENTS.md)

- ADMIN / DISPATCHER — **платформенные** роли, видят все tenant'ы **по дизайну** (владелец 2026-07-12). «Cross-tenant findings» для них — не баг. Настоящие IDOR'ы — только для OPERATOR/ASSISTANT и путей без привилегированной роли.
- MASTER/ИНЖЕНЕР-ОТ/ОПЕРАТОР — frozen; оператор-экраны и ORION — заморожены; не трогаю.
- «Выглядит как мёртвый код» — `operator-dashboard.tsx`, telemetry (спящий), multi-tenancy — **оставлены**; не предлагаю удалить.

## Итог-5 для владельца (русский, жёстко 5 строк)

1. Файл: `docs/audits/hermes-night/QW02-AUTH-SESSIONS-CSRF.md` (commit см. ниже).
2. Версия кода: `58e00b59b9b21d6f78c9aac1611a8c05fe9291ea` (ветка `hermes/code-1011`, чистое дерево).
3. Находки: критично 0 / важно 4 / мелочь 4 (всего 8).
4. Главная находка: не «свежая дыра», а **зависимость HSTS и агрегирующих rate-limit'ов от Caddy и Redis** — при их отсутствии защита молча деградирует (F2, F3); плюс потенциальные plaintext-секреты при чтении без префикса `enc:` (F1).
5. **Не переверифицировано заново** в момент написания отчёта: HSTS-строка в Caddy, конкретные cookie-флаги `session-service.ts:281,295`, список `CSRF_EXEMPT_PATHS`, строка токеной сверки в `alerts/webhook`.
