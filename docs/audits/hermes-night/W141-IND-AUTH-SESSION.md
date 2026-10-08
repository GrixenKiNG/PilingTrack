# W141 — вход, сессии и защита от атак (независимый аудит)

Аудируемая версия: `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01a264ffae97e3eaa7fea7582d90bf657d`
(`git rev-parse HEAD` от 08.10.2026). Отчёт только на чтение; код не менялся.
Все пути ниже — от корня аудируемого дерева `D:/PillingR/wt-audit-0f53`.
Значения паролей, токенов и секретов в отчёте не приводятся — только места и типы.

## Итог

- Найдено **17** замечаний: **критично — 0, важно — 5, мелочь — 12**.
- Что подтверждено положительно: пароль сверяется только через `bcryptjs.compare`
  с 12 раундами, формат без соли SHA-256 снят и неизвестный хеш не пускает, но тратит
  то же время (выравниватель) — `src/services/auth/auth-service.ts:44-50`;
  при неверном логине и при блокировке текст ответа **одинаков** и не зависит от
  существования учётной записи (`src/app/api/auth/login/route.ts:81`, `:66`);
  cookie ставится в одном месте с `HttpOnly`/`SameSite=Lax`/`Secure`/`Path=/`
  (`src/services/auth/session-service.ts:279-291`); выход **отзывает** jti на сервере,
  а при недоступном Redis честно отдаёт 503, а не «успех» (`src/app/api/auth/logout/route.ts:19-21`);
  смена пароля, смена роли и блокировка повышают `sessionVersion`, и он сверяется
  на каждом запросе (`src/lib/auth.ts:105`) и в раскладках (`src/lib/page-session.ts:63`);
  сравнение секретов вебхука, метрик и ключа устройства — через `timingSafeEqual`
  (`src/app/api/alerts/webhook/route.ts:71-74`, `src/app/api/metrics/route.ts:28-31`,
  `src/services/telemetry/device-key-service.ts:136-138`); в `src/services/auth/**` и
  `src/core/security/**` нет `as any`.
- Топ-5 по значимости:
  1. **Пер-IP лимит входа схлопывается в один общий бакет на всё развёртывание**
     при незаданном `TRUST_PROXY` и **никогда не сбрасывается на успешном входе**:
     после 20 попыток за 15 мин вход закрывается всем на 30 минут
     (`src/lib/rate-limiter.ts:478-505`, `:40-44`; `src/services/auth/auth-service.ts:79-82`, `:136-138`).
  2. **Отзыв сессии живёт только в Redis и на выходе `sessionVersion` не растёт**:
     если `REDIS_URL` не задан/недоступен, отозвать сессию нельзя вообще (выход — 503),
     украденная cookie остаётся валидной до 12 ч (`src/services/auth/session-service.ts:106-169`, `:255-263`;
     `src/app/api/auth/logout/route.ts:17-23`).
  3. **Подпись токена зависит от `NODE_ENV`**: вне строго `production` секрет
     подстановочный и общеизвестный (`src/services/auth/session-service.ts:65-83`);
     токен с любой ролью можно подделать (`src/instrumentation.ts:46` требует
     `SESSION_SECRET` только при `NODE_ENV === 'production'`).
  4. **Кэш разобранного пользователя — переменная модуля, а не `globalThis`**
     (`src/lib/auth.ts:44-45`): отозванный/заблокированный токен отдаётся из кэша
     другой сборки до 5 с.
  5. **Хранилище отзыва заводит второе Redis-соединение** в обход `getStateRedisClient()`
     (`src/services/auth/session-service.ts:106-122`): сбой этого соединения навсегда
     глушит отзыв в процессе, и в `/api/health` это не видно.

## Методика

Инструменты: `read_file`, `search_files` (оба — по дереву `D:/PillingR/wt-audit-0f53`),
`git rev-parse HEAD`. Кода и проверок §6 AGENTS.md не запускал (задача на чтение).

1. `find`/`search_files` по каталогам `src/services/auth/`, `src/core/security/`,
   `src/app/api/auth/`, `src/lib/` (файлы `rate-limiter.ts`, `csrf-protection.ts`,
   `auth.ts`, `page-session.ts`, `redis-cache.ts`).
2. Прочитаны целиком: `auth-service.ts`, `session-service.ts`, `authorization-service.ts`,
   `resource-access-service.ts`, `routes login/logout/me`, `lib/auth.ts`, `lib/page-session.ts`,
   `lib/rate-limiter.ts`, `lib/csrf-protection.ts`, `lib/redis-cache.ts`, `core/api-wrapper.ts`,
   `core/security/identity-role.ts`, `services/users/user-service.ts`,
   `app/api/alerts/webhook/route.ts`, `app/api/metrics/route.ts`,
   `services/telemetry/device-key-service.ts`, `instrumentation.ts`, `services/audit/audit-service.ts`.
3. Поиски: `sessionVersion`, `revokeSessionToken|hashPassword|timingSafeEqual`,
   `user.update|isActive: false|sessionVersion: { increment`, `auth.pin|pinHash`,
   `refreshSession|/api/auth/refresh|updateSession`, `SESSION_SECRET|TRUST_PROXY|ALERTMANAGER_WEBHOOK_TOKEN`,
   `timingSafeEqual|=== *token|=== *secret|=== *password`, `as any`, файлы `middleware.ts`.
4. Перечислены маршруты `src/app/api/auth/` (только `login`, `logout`, `me`; refresh нет)
   и все ветки записи пользователя (единственный писатель пароля/`isActive` — `updateUser`).
5. Прочитаны тесты-контракты: `auth-service-credentials.test.ts`,
   `auth-service-login-rate-limit.test.ts`, `login/__tests__/route.test.ts`,
   `csrf-protection.test.ts` — чтобы отличить «так задумано» от дефекта.
6. Первый проход сделан без чтения старых отчётов в `docs/audits/`; сравнение — только
   в разделе «Приложение: сравнение».

## Шаги входа, выхода и проверки сессии

| Шаг | Файл:строка | Защита | Статус |
|---|---|---|---|
| Приём `POST /api/auth/login` | `src/app/api/auth/login/route.ts:17-31` | `withApi` + `withCsrf` inline до разбора тела | ок |
| Валидация тела | `login/route.ts:34-45`; `src/lib/validation-schemas.ts:29-31` | `loginSchema` (email ≤255, password 1..100) | ок |
| Лимит с одного адреса | `src/services/auth/auth-service.ts:79-82`; `rate-limiter.ts:40-44` | `LOGIN_IP_RATE_LIMIT` 20/15 мин, блок 30 мин | риск (ключ схлопывается, не сбрасывается) |
| Лимит по аккаунту со всех адресов | `auth-service.ts:90-94`; `rate-limiter.ts:34-38` | `ACCOUNT_LOCKOUT_RATE_LIMIT` 10/15 мин, блок 15 мин | ок (осознанный DoS) |
| Лимит почта+IP | `auth-service.ts:100-105`; `rate-limiter.ts:19-23` | `AUTH_RATE_LIMIT` 5/15 мин, блок 30 мин | ок |
| Поиск пользователя | `auth-service.ts:109-123` | `withIdentityRole` (RLS-обход только на `User`), `select` без лишних полей | ок |
| Неизвестный / неактивный | `auth-service.ts:125-128` | всегда один `bcrypt.compare` с выравнивателем | ок |
| Проверка пароля | `auth-service.ts:44-50`, `:130-134` | `bcryptjs.compare`; принимается только `$2…` (12 раундов) | ок |
| Сброс счётчиков на успехе | `auth-service.ts:136-138` | `reset(login:<mail>:<ip>)`, `reset(login-acct:<mail>)` | частично (IP-бакет не сброшен) |
| Выдача токена | `auth-service.ts:145-149`; `session-service.ts:190-211` | jose `SignJWT` HS256, `jti` 128 бит, TTL 12 ч | ок |
| Установка cookie | `session-service.ts:279-291` | `httpOnly`, `sameSite=lax`, `secure` в проде, `path=/`, `maxAge=TTL` | ок (без `__Host-`) |
| Ответ при отказе | `login/route.ts:72-82`; `:56-70` | единый текст `'Неверный email или пароль'`; 429 привязан к почте, не к факту существования | ок |
| Выход | `src/app/api/auth/logout/route.ts:12-36`; `session-service.ts:255-263` | `requireAuth` + `withMutation` (CSRF+лимит) + запись `revoked-jti:<jti>` | ок, но 503 при Redis down |
| Проверка сессии (API) | `src/lib/auth.ts:158-212`, `resolveSessionUser:68-146` | `verifySessionToken` + `isActive` + `sessionVersion` | ок |
| Проверка сессии (раскладки) | `src/lib/page-session.ts:40-75` | те же сверки, порядок «тенант из токена → строка» | ок |
| Обновление сессии (refresh) | — | маршрута нет (`src/app/api/auth/` = login/logout/me) | нет механизма |
| Отзыв при смене пароля/блокировке | `src/services/users/user-service.ts:230-233` | `sessionVersion: { increment: 1 }` | ок |
| Отзыв при смене роли | `user-service.ts:244-246` | `sessionVersion: { increment: 1 }` | ок |
| Сравнение секретов (вебхук/метрики/устройство) | `alerts/webhook/route.ts:71-74`; `metrics/route.ts:28-31`; `telemetry/device-key-service.ts:136-138` | `timingSafeEqual` (с предпроверкой длины) | ок |

## Находки

| ID | серьёзность | path:line | проблема | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| A-1 | важно | `src/lib/rate-limiter.ts:478-505`, `:40-44`; `src/services/auth/auth-service.ts:79-82`, `:136-138`; `src/app/api/auth/login/route.ts:52` | Пер-IP бакет `login-ip:<id>`: при `TRUST_PROXY !== 'true'` `getRateLimitIdentifier` возвращает `host-<Host>`, то есть один общий ключ на всё развёртывание. Бакет инкрементируется на каждой попытке и **не сбрасывается на успешном входе** (сбрасываются только `login:<mail>:<ip>` и `login-acct:<mail>`, тест это фиксирует — `auth-service-credentials.test.ts:113-122`). | За обратным прокси без `TRUST_PROXY=true` 20 любых попыток входа за 15 мин (в т.ч. успешных, от разных людей на смене) закрывают вход **всем** на 30 минут. Проверка «успех сбрасывает только аккаунт-бакеты» подтверждена тестом. Значение `TRUST_PROXY` в проде не читал (см. «Не проверено») — сценарий условен по конфигу. | Не схлопывать ключ (`getRateLimitIdentifier` без `TRUST_PROXY` — вернуть уникальный per-request отпечаток или отказать в лимите), либо сбрасывать IP-бакет на успехе для владельца адреса; либо явно требовать `TRUST_PROXY`. |
| A-2 | важно | `src/services/auth/session-service.ts:106-169`, `:255-263`; `src/app/api/auth/logout/route.ts:17-23`; `src/lib/rate-limiter.ts:117-156` | Отзыв сессии целиком зависит от Redis с `REDIS_URL`: при отсутствии переменной `getClient` навсегда ставит `initFailed` (`:110-114`) и `isRevoked`→false, `revoke`→false. Тогда выход отвечает 503 (cookie не снимается) и отозвать сессию нечем; рост `sessionVersion` на выходе не делается. | Авария/незаданный Redis: украденная или потерянная cookie живёт до 12 ч, «выйти со всех устройств» нельзя. Честный 503 (не ложный успех) — плюс, но альтернативного механизма отзыва нет. Второй эффект: лимитер молча уходит в in-memory (`:184-192`). | Дублировать отзыв ростом `User.sessionVersion` на выходе (не зависит от Redis); при отсутствии Redis на старте — падать/предупреждать громко, а не глушить отзыв навсегда. |
| A-3 | важно | `src/services/auth/session-service.ts:65-83`; `src/instrumentation.ts:46` | `getSecretKey` берёт `SESSION_SECRET \|\| AUTH_SECRET`, а вне строго `NODE_ENV === 'production'` подставляет общеизвестную строку `dev-only-session-secret-change-me` (`:79`). `instrumentation.ts:46` бросает только при `NODE_ENV === 'production' && !SESSION_SECRET`. | Запуск собранного образа с незаданным/опечатанным `NODE_ENV` (напр. `Production` с заглавной): токены подписываются публичной строкой, cookie теряет `Secure` — подделка сессии с любой ролью и организацией. | Требовать `SESSION_SECRET` при любом `NODE_ENV !== 'test'` (или отдельным явным флагом `ALLOW_DEV_SESSION_SECRET`), а не по «не-production». |
| A-4 | важно | `src/lib/auth.ts:44-45`, `:133-136`, `:153-156` | `authUserCache`/`authUserInFlight` — переменные модуля, а не `globalThis` (в проекте для этого синглтоны кладут в `globalThis`, напр. `core/security/tenant-context.ts`). `clearAuthUserCacheEntry` чистит запись только в своём процессе. | После выхода/блокировки/смены роли отозванный токен ещё до 5 с (`AUTH_USER_CACHE_TTL_MS`) отдаётся из кэша **другой** сборки. Наблюдаемо как «страница ещё открыта после выхода». | Перенести кэш в `globalThis` по образцу `tenant-context.ts`. |
| A-5 | важно | `src/services/auth/session-service.ts:106-122` | Хранилище отзыва заводит **своё** соединение `new Redis(process.env.REDIS_URL)` вместо общего `getStateRedisClient()` (`src/lib/redis-cache.ts:136-139`); синглтон `revocationStore` (тоже не `globalThis`, `:172`) — на каждый инстанс модуля своё соединение. | Дублирование пулов; сбой именно этого соединения глушит отзыв, а `/api/health` смотрит другое соединение и показывает «здорово». | Использовать `getStateRedisClient()` (он уже гарантирует инстанс `REDIS_URL`) и держать стор на `globalThis`. |
| A-6 | мелочь | `src/services/auth/session-service.ts:8`, `:207`, `:287`; `src/app/api/auth/` | TTL фиксированный — ровно 12 ч от выдачи, продления нет, маршрута refresh нет. | Смена длиннее 12 ч выкидывает пользователя на `/login` посреди работы; окно украденного токена тоже ровно 12 ч. | Решить продуктово: предупреждение у конца срока либо sliding-renewal с записью `jti`. |
| A-7 | мелочь | `src/services/auth/session-service.ts:7`, `:279-291` | Имя cookie `pt-session` без `__Host-`/`__Secure-`; `Domain` не задаётся, но поддомен может выставить свою cookie с `Domain` родителя. | Подмена/фиксация cookie при первом поддомене (`app.…` + `www.…`) — сервер читает первую из `request.cookies.get(...)`. Все условия для `__Host-` (`Secure`, `Path=/`, без `Domain`) уже выполнены. | Переименовать в `__Host-pt-session`. |
| A-8 | мелочь | `src/services/auth/session-service.ts:265-277` | Токен принимается и из `Authorization: Bearer`, причём cookie-проверки (CSRF) к такому клиенту не применяются. | Токен, попавший в лог/скрипт/URL, предъявляется с любого не-браузерного клиента без CSRF. | Зафиксировать в комментарии назначение Bearer (машинные каналы) либо ограничить его отдельным признаком. |
| A-9 | мелочь | `src/services/auth/auth-service.ts:84-94` | Блокировка аккаунта глобальна по почте (10 попыток/15 мин, блок 15 мин) и срабатывает до сверки пароля; ключ строится по почте независимо от существования учётки. | Знающий чужую почту может нарочно запереть машиниста на 15 минут (lockout-DoS). Владелец принял осознанно (комментарий `:84-89`, тест `auth-service-login-rate-limit.test.ts:12-16`) — фиксирую как остаточный риск. | Оставить по решению владельца; при желании — временно не считать чужие неудачи, если владелец недавно входил успешно. |
| A-10 | мелочь | `src/lib/rate-limiter.ts:108-109`, `:184-192`, `:259-317` | При недоступном Redis лимитер уходит в in-memory `Map`, локальную для процесса. | На развёртывании из нескольких инстансов без Redis перебор ограничивается только пер-инстанс, то есть слабее заявленного. | Документировать деградацию или общий счётчик не только через Redis. |
| A-11 | мелочь | `src/lib/csrf-protection.ts:86`, `:101-109` | Проверка CSRF сравнивает `host` из `Origin`/`Referer` с заголовком `host` запроса. | За прокси, переписывающим `Host`, законные мутации получат 403. Значения прокси не читал — сценарий условен. | Сравнивать с ожидаемым доменом приложения (`NEXT_PUBLIC_APP_URL`) либо явно учитывать прокси. |
| A-12 | мелочь | `src/app/api/auth/logout/route.ts:15`, `:19-21` | Выход сначала зовёт `requireAuth`; при уже недействительной сессии вернёт 401 и cookie не снимает. При сбое Redis — 503 и тоже без снятия cookie. | На общем терминале «выйти» не срабатывает, cookie остаётся; пользователь может решить, что вышел. | На 401/503 явно чистить cookie (`clearSessionCookie`) — локальная cookie не секрет безопасности. |
| A-13 | мелочь | `src/services/audit/audit-service.ts:342-363`; `prisma/schema.prisma:99,103`; `scripts/test-pilingtrack.sh:32,39,43,51` | Хвосты удалённого ПИН-входа: мёртвые описания событий `auth.pin.*`, поля `User.pin`/`pinLookup` в схеме, а дымовой скрипт строит вход на несуществующем `POST /api/auth/pin` и на отсутствующем `python3`. | Ни одного `recordAuditEvent({action:'auth.pin...'})` в коде нет — справочник журнала врёт. Скрипт `test-pilingtrack.sh` на исправном приложении даёт «НЕУДАЧА» на входе (ложный сигнал «система сломана»). | Убрать мёртвые описания и скрипт/переписать его на `POST /api/auth/login`; поля схемы — отдельной миграцией (вне этой задачи). |
| A-14 | мелочь | `src/app/api/auth/login/route.ts:62,78,90`; `src/services/audit/audit-service.ts:955` | События входа/неудачи кладут e-mail в `metadata` и в лог, а запись аудита `await`-ится до ответа. | PII (e-mail) остаётся в ленте и логах; медленная БД задерживает ответ входа. Не секрет, но приватность/латентность. | Маскировать e-mail в metadata или вынести запись аудита из критического пути ответа. |
| A-15 | мелочь | `src/services/auth/session-service.ts:29-61`; `src/lib/auth.ts:86-89` | Принимаются токены версии 1 наравне с 2; v1 не несёт `tenantId`, поэтому организация берётся из строки БД (доп. чтение под RLS). | Переходный период затянут: пока v1 принимается, инвариант «тенант из токена до первого чтения» для части живых токенов не держится. Документировано в коде (`:31-39`). | Убрать `1` из `ACCEPTED_SESSION_TOKEN_VERSIONS` отдельным изменением после того, как старые токены истекут. |
| A-16 | мелочь | `src/services/auth/session-service.ts:217-229`, `:252-253` | `verifyTokenSignature` не проверяет `sub`/`jti`/`iat` на непустоту и не проверяет `iss`/`aud`; токен без `jti` отозвать нельзя. | Валидная подпись без `jti` (напр. из очень старого релиза) не попадает в список отзыва до истечения. Практический риск низкий. | Требовать непустой `sub` и `jti` при приёме. |
| A-17 | мелочь | `src/lib/rate-limiter.ts:114` | Конструктор лимитера заводит `setInterval(...)` на 5 минут без очистки; синглтон не на `globalThis`. | На каждый инстанс модуля — свой таймер и своя in-memory карта; в dev/HMR множатся. Не безопасность, но утечка аккуратности. | Держать синглтон на `globalThis` и снимать интервал при закрытии. |

## Не проверено

- **Значения окружения.** `.env*`, `docker-compose*`, `Dockerfile*`, `TRUST_PROXY`,
  `REDIS_URL`, `SESSION_SECRET` не читал (AGENTS.md §1). Поэтому находки A-1
  (схлопывание IP-ключа), A-2 (наличие Redis), A-3 (реальный `NODE_ENV`) условны по
  конфигу и требуют проверки на стенде/проде.
- **Runtime-проверок не выполнял:** `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`,
  `npx playwright test --list`, `npm run build` не запускались (задача на чтение).
  Тесты-контракты только прочитаны, не перезапускались.
- **Фактическая дублируемость модульных инстансов** `lib/auth` и `session-service` в
  прод-сборке Next.js не измерялась: выводы A-4/A-5/A-17 опираются на конвенцию проекта
  (`tenant-context.ts`) и комментарии о нескольких сборках, а не на замер.
- **Прод-БД и Redis** не проверялись: доступен ли Redis и режим `noeviction`,
  остались ли значения в `User.pin/pinLookup` — доступа нет.
- **Поведение браузеров** (наличие `Origin`/`Sec-Fetch-Site` для `POST /api/auth/logout`
  и для GET-переходов) не воспроизводил — рассуждения о `SameSite=Lax` из спецификации.
- **Клиентская сторона входа** (`src/components/piling/login-page.tsx`,
  `src/store`, `src/lib/api.ts`) прочитана выборочно; полного разбора отображения
  ошибок входа и хранения состояния в этом отчёте нет.
- **Полное покрытие тестами** `session-service.ts` не считал (только точечно прочитал
  `__tests__/session-service.test.ts` из списка).

## Приложение: сравнение

Сравнение сделано после первого прохода, с отчётом `docs/audits/hermes-night/R64-session-security.md`
(аудит `wt-night`, 22 замечания: важно 6, мелочь 16). По нему: **устранено** —
F1 (отзыв «мягко» проваливался): теперь `revoke` возвращает признак записи, а выход на
`false` отдаёт 503 (`session-service.ts:156-168`, `logout/route.ts:19-21`) — это A-2
в остаточной части; F7 (login CSRF): вход больше не полностью освобождён, `withCsrf`
вызывается до разбора тела (`csrf-protection.ts:41-43`, `login/route.ts:27-28`).
**Осталось без изменений** — F4 (кэш `lib/auth` не на `globalThis`, у меня A-4),
F18 (второе Redis-соединение, у меня A-5), F8 (имя cookie без `__Host-`, у меня A-7),
F9 (TTL 12 ч, нет refresh — A-6), F10 (Bearer — A-8), F19 (`NODE_ENV`-зависимый секрет,
у меня A-3), F14/15/16/17 (ПИН-хвосты, у меня A-13), F20 (выход не растит
`sessionVersion` — разобрано в A-2). **Новое, чего не было в R64:** A-1 (схлопывание
пер-IP ключа входа и отсутствие его сброса на успехе) — это остаётся главной находкой
этого прохода. Замечания R64 F2/F3 (побочный эффект на GET `/api/reports/pdf*`),
F5 (защита `(app)`-страниц только на клиенте), F11–F13, F21–F22 вне предмета W141
(вход/сессии), не перепроверял.
