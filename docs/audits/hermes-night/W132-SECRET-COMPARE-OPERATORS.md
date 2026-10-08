# W132 — Сравнение токенов и секретов оператором `===`

Дата: 2026-10-08. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`). Метод: только чтение — ни один файл кода не изменён, тесты/сборка не запускались.
Область: `src/**` (рабочий код; найденные вхождения в `__tests__`/`*.test.ts` помечены отдельно). Замороженные зоны (экран оператора, ORION) не аудировались — правило 3 задачи и AGENTS.md §1. Секреты из `.env*` не читались (AGENTS.md §1).

## Итог

* Правило «сверка секретов — через `crypto.timingSafeEqual`» **соблюдено**: `===`/`!==`/`==`/`!=` на значении-секрете в рабочем коде **не найдено**.
* Разбивка по значимости: **критично — 0, важно — 0, мелочь — 5**. Все пять — не эксплуатация, а замечания по устойчивости/сопровождению.
* Все места сверки секретов в проде уже безопасны: общий секрет вебхука и scrape-токен — `constantTimeEquals` (`timingSafeEqual`), ключ устройства — `timingSafeEqual` поверх HMAC-хеша, пароли — `bcrypt.compare`, сессия и токен попытки — проверка подписи JWT (`jose`).
* В `src/services/auth/`, `src/core/security/`, `src/lib/csrf-protection.ts` сравнения секретов через `===` **нет** (проверено отдельно, см. «Методика»). CSRF здесь построен на Origin/Referer/Sec-Fetch-Site, а не на одноразовом токене — сверять строку нечего.
* Все найденные `===`/`!==` рядом с именами `*token*`, `*secret*`, `*hash*`, `*code*`, `*csrf*` оказались одно из: проверкой на `null`/`undefined`, сверкой не-секретного номера (версия сессии, версия банка вопросов), сравнением текста ошибки на клиенте или сравнением хеша целостности — по времени ответа секрет из них не извлекается.
* Смежные находки: тест-реестр `api/__tests__/route-guards.test.ts:153` и комментарии требуют `constantTimeEquals` у вебхука — эти ожидания выполняются; в комментариях `metrics/route.ts:26-27` и `alerts/webhook/route.ts:70` есть док-дрейф (ссылка на несуществующий `auth-service.ts`).

Топ-5 по значимости:
1. `src/app/api/metrics/route.ts:29`, `src/app/api/alerts/webhook/route.ts:72`, `src/services/telemetry/device-key-service.ts:138` — `constantTimeEquals`/`timingSafeEqual` при разной длине выходит **до** константного сравнения: наружу утекает только длина секрета (она фиксирована и не секретна). Мелочь, но помечено.
2. `src/app/api/alerts/webhook/route.ts:71` и `src/app/api/metrics/route.ts:28` — две независимые копии `constantTimeEquals` (DRY): исправление в одной не попадёт в другую.
3. `src/modules/readiness/infrastructure/audit/verify-chain.ts:38,51,65` — `!==` на хешах цепочки аудита; хеш не секрет, но при будущем переходе на HMAC-подпись сравнение обязано стать константным.
4. `src/core/infrastructure/leader-election.ts:28-29` — владелец аренды сравнивается `==` внутри Lua на Redis; токен — случайный `hostname-pid-UUID`, канал по времени не измерим.
5. Док-дрейф: комментарии `metrics/route.ts:26-27` и `alerts/webhook/route.ts:70` ссылаются на `auth-service.ts's constantTimeEquals`, которого в этом файле уже нет.

## Методика

Поиск вёлся `search_files` (rg) по `src/**`. Регулярки без lookaround (rg здесь их не поддерживает), alternation упорядочена так, что `===`/`!==` матчатся раньше `==`/`!=`. Номера строк — из фактических чтений файлов (`read_file`, `grep -n`), не из одного грепа.

```bash
# 1. Секретные имена слева/справа от оператора
#    (token|secret|apikey|signature|csrf|nonce|otp|password|hash|code)
#    шаблон:  [A-Za-z0-9_+(]*(token|...)\s*(===|!==|==|!=)   и обратный порядок
# 2. Только двойное равенство (без тройного):   [^=!<>]==[^=]
# 3. Только нестрогое неравенство:              [^=!<>]!=[^=]
# 4. Методы: (token|...)/[A-Za-z0-9_]*\.(localeCompare|includes)\(
# 5. Пароли/хеши:  bcrypt|compare\(|scrypt|argon2
# 6. Уже безопасные сверки:  timingSafeEqual|constantTimeEquals|secureCompare
# 7. Непосредственная сверка env-секрета: process\.env\.[A-Z0-9_]+[^;]*(===|!==|==|!=)
# 8. Заголовки: (authorization|bearer|x-device-key|cron)[^;]*(===|!==|==|!=)
```

Дополнительно открыты и прочитаны целиком ключевые файлы: `src/lib/csrf-protection.ts`, `src/services/auth/auth-service.ts`, `src/services/auth/session-service.ts`, `src/services/auth/authorization-service.ts`, `src/services/auth/resource-access-service.ts`, `src/core/security/encryption.ts`, `src/core/security/idempotency.ts`, `src/core/security/identity-role.ts`, `src/core/security/tenant-context.ts`, `src/core/security/tenant-enforcement.ts`, `src/core/security/tenant-rls.ts`, `src/core/api-wrapper.ts`, `src/lib/auth.ts`, `src/lib/rate-limiter.ts`, `src/services/telemetry/device-key-service.ts`, `src/app/api/alerts/webhook/route.ts`, `src/app/api/metrics/route.ts`, `src/app/api/telemetry/ingest/route.ts`, `src/modules/operator-mobile/application/knowledge-attempt.ts`, `src/modules/readiness/infrastructure/audit/verify-chain.ts`, `src/core/infrastructure/leader-election.ts`. По каждому — проверено, что рядом с оператором стоит именно секрет (а не `null`-проверка, тип-чек или номер версии).

Результаты команд-«маркеров» (для повторяемости):
- `process.env.[A-Z_]+ == ...` → **0** совпадений на секретах (только флаги вида `NODE_ENV === 'production'`, `LOG_* === 'true'`).
- `(authorization|bearer|x-device-key|cron) ... ===` → **0**.
- `timingSafeEqual|constantTimeEquals` → 4 рабочие точки: `alerts/webhook`, `metrics`, `device-key-service` (и определение константы в двух местах).

## Находки

### Высокий риск

Пусто. Ни одного `===`/`!==`/`==`/`!=` на значении-секрете в рабочем коде не найдено. В частности, в `src/services/auth/**` и `src/core/security/**` сверок секретов через обычный оператор нет: сессия проверяется подписью JWT (`session-service.ts:217-229`), пароль — `bcrypt.compare` (`auth-service.ts:26-27,44-49`), ключ устройства — `timingSafeEqual` (`device-key-service.ts:136-138`).

### Средний риск

Пусто (промаркеренные выше места — отдельные строки без раннего выхода или вообще без сверки секрета).

### Мелочь

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | мелочь | `src/app/api/metrics/route.ts:29`, `src/app/api/alerts/webhook/route.ts:72`, `src/services/telemetry/device-key-service.ts:138` | `constantTimeEquals` выходит по `a.length !== b.length` **до** `timingSafeEqual` | Наружу (по времени) утекает только **длина** эталонного секрета. Для фиксированных служебных токенов это не секрет, но это единственный остаточный тайминг-канал в этих функциях | Сравнивать HMAC обеих сторон (`HMAC(secret, a) === HMAC(secret, b)`) или добивать вход до фиксированной длины; либо оставить как есть с явной пометкой «length leak by design» |
| 2 | мелочь | `src/app/api/alerts/webhook/route.ts:71-74` и `src/app/api/metrics/route.ts:28-31` | Дублирование `constantTimeEquals` в двух файлах | Правку (напр. устранение length-leak из п.1) надо помнить в двух местах; в комментариях обоих файлов ссылка на `auth-service.ts's constantTimeEquals`, которого там нет | Вынести одну реализацию в общий `src/lib/*` и импортировать; поправить комментарии |
| 3 | мелочь | `src/modules/readiness/infrastructure/audit/verify-chain.ts:38,51,65` | `!==` на хешах цепочки аудита (`prevHash`, `event.hash`, `headHash`) | Хеш — не секрет, и атакующий с правом записи в БД читает его и так, поэтому сейчас риска нет. Но если проверка целостности станет криптографической (HMAC-подпись событий), сравнение обязано быть константным | Оставить, но добавить комментарий-пометку на случай перехода на подписанную цепочку |
| 4 | мелочь | `src/core/infrastructure/leader-election.ts:28-29` (`==` в Lua), `:178,184,253` | Владелец аренды сравнивается `==`/`===` (Redis Lua и Node) | Токен — `hostname()-pid-randomUUID` (`leader-election.ts:24-26`), не пользовательский секрет и не сетевой канал; по времени не измерим | Оставить; при желании — пометить комментарием, что это идентификатор владельца, а не секрет |
| 5 | мелочь | `src/app/api/metrics/route.ts:26-27`, `src/app/api/alerts/webhook/route.ts:70` (и тест `src/app/api/__tests__/route-guards.test.ts:153`) | Комментарии/тест ссылаются на `constantTimeEquals` из `auth-service.ts`, которого там нет (удалён вместе с веткой SHA-256) | Вводит в заблуждение следующего аудитора: «образец» не находится | Поправить комментарии на существующий источник (напр. `device-key-service.ts`) либо вынести общую функцию (см. п.2) |

### Проверено и безопасно (не риск)

| path:line | Что сравнивается | Почему безопасно |
|---|---|---|
| `src/app/api/alerts/webhook/route.ts:71-74,83-84` | Bearer/`?token=` против `ALERTMANAGER_WEBHOOK_TOKEN` | `constantTimeEquals` (timingSafeEqual); при незаданном секрете — отказ (`:78`) |
| `src/app/api/metrics/route.ts:28-31,44,49` | Bearer против `METRICS_SCRAPE_TOKEN` | `constantTimeEquals`; без совпадения — фолбэк на сессию, не «пропуск» |
| `src/services/telemetry/device-key-service.ts:114,120-138` | Ключ устройства | Поиск по HMAC-хешу + `timingSafeEqual`; короткие ключи отсекаются по длине |
| `src/services/auth/auth-service.ts:26-27,30-32,44-49` | Пароль против хеша | `bcrypt.compare` — «безопасно по библиотеке» (правило 4); неизвестный формат хеша тратит время эквивалентно (`:48`) |
| `src/services/auth/session-service.ts:217-229` | Токен сессии (JWT HS256) | `jose.jwtVerify` проверяет подпись и claims; `ACCEPTED_SESSION_TOKEN_VERSIONS.includes(payload.v)` (`:222`) — членство числа-версии, не секрет |
| `src/lib/auth.ts:105` | `(payload.sv ?? 0) !== user.sessionVersion` | Номер версии сессии после проверенной подписи JWT; не секрет, по времени не атакуется |
| `src/modules/operator-mobile/application/knowledge-attempt.ts:20-27` | Claims `attemptToken` (`tenantId`, `audience`, `bankVersion`) | Токен-попытки — HS256 JWT; `jwtVerify` (`:22`) проверяет подпись до `!==` на claims; `!==` идёт по уже аутентифицированным не-секретным полям |
| `src/core/security/encryption.ts:155-209` | Целостность шифротекста | AES-256-GCM auth-tag — проверка внутри `decipher.final`; строкового сравнения секретов нет |
| `src/core/security/identity-role.ts:32-42` | Имя роли из `DB_IDENTITY_ROLE` | Регексп-проверка имени роли (защита от подстановки в `SET LOCAL ROLE`), не сверка секрета |
| `src/services/auth/authorization-service.ts:138-194`, `src/services/auth/resource-access-service.ts:48-80` | Роли и id пользователей/владельцев/тенантов | Сверяются идентификаторы и роли, не секреты; тайминг не даёт секрета |
| `src/core/security/tenant-context.ts:78,101`, `src/core/security/tenant-rls.ts:62,149,181` | `tenantId`, признак контекста | Сравнение тенантов/типов — не секреты |
| `src/core/api-wrapper.ts:53-55,89,124` | Prisma-коды, `readSessionToken(request) === null` | Проверка на `null` и код ошибки; не сверка секрета |
| `src/app/api/telegram/configs/route.ts:124`, `src/services/telegram/telegram-config-service.ts:121` | `data.botToken !== undefined` | Проверка «поле передано», а не сравнение значения токена |
| `src/components/piling/admin-users/user-dialogs.tsx:94,249` | `password !== ''` | Проверка «форма изменена» против пустой строки, не сверка секрета |
| `src/components/piling/admin-crews/crew-messages.ts:36`, `admin-sites/use-site-mutations.ts:59`, `inspections/inspection-api-error.ts:45`, `layout-editor/use-layout-template.ts:54`, `operator-mobile/api.ts:232` | `message.startsWith('CSRF validation failed')` | Разбор текста серверной ошибки на клиенте, не секрет; `operator-mobile` — замороженная зона |

## Не проверено

- **PIN-код машиниста**: в реестре аудита есть события `auth.pin.succeeded/failed/rate_limited` (`src/services/audit/audit-service.ts:342-355`) и упоминания полей `pin`/`pinLookup` (`src/modules/crews/...:112-113`, `src/modules/readiness/domain/audit/mask.ts:8`), но **кода сверки PIN в `src/` не найдено** (нет роутов `/api/auth/pin` и вызовов `verifyPin`). Возможно, вход по ПИН ещё не реализован — сверку проверять нечего.
- **Замороженные зоны** (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) — по правилу 3 не аудировались как область; в отчёт попало только упоминание клиентской проверки текста CSRF в `operator-mobile`.
- **Сторонние библиотеки** (`jose`, `bcryptjs`, `ioredis`, `@aws-sdk/*`) — принимается на веру, что внутри они делают константную сверку подписей/хешей; их исходники не читались.
- **Значения секретов** (`ALERTMANAGER_WEBHOOK_TOKEN`, `METRICS_SCRAPE_TOKEN`, `SESSION_SECRET`, `DEVICE_KEY_LOOKUP_SECRET` и т. д.) не читались и не сравнивались с эталоном — только проверено, что код сверяет их без утечки по времени. Длина/энтропия секретов не оценивалась.
- **`e2e/`, `scripts/`, `prisma/`** вне области (`src/`), не проверялись; сравнения секретов в скриптах деплоя/сида не анализировались.
- **Telegram webhook** (`secret_token` / `X-Telegram-Bot-Api-Secret-Token`) в коде отсутствует — сверки нет; если вебхук Telegram будет добавлен, эту точку нужно покрыть.
- **Тесты/сборка** (`tsc`, `lint`, `test:unit`, `playwright --list`, `build`) не запускались — задача чисто читающая, кода не менялось.
