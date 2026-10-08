# W125 — Из чего строятся ключи лимита запросов

Опись (без правок кода): как формируется ключ корзины лимита, откуда берётся IP,
что делает `TRUST_PROXY`, и можно ли обойти защиту входа подменой заголовка.
Прод стоит за Caddy (`deploy/Caddyfile.prod`), порт приложения связан с
`127.0.0.1:3000` (`docker-compose.prod.yml:24-25`).

## Итог

- Всего находок: 14 — критично 1, важно 6, мелочь 6, info 1.
- Топ-5:
  1. `src/lib/rate-limiter.ts:481` — при `TRUST_PROXY=true` в ключ идёт **первый
     (левый) узел `x-forwarded-for`**. Слева стоит наш Caddy, но конфиг
     (`deploy/Caddyfile.prod`) не настраивает доверие к заголовкам
     (`trusted_proxies` нет нигде в репозитории) — надо убедиться, что Caddy
     отбрасывает присланный клиентом XFF, а не дописывает реальный адрес справа.
  2. `src/lib/rate-limiter.ts:504` — без `TRUST_PROXY` ключ = `host-<Host>`, а
     заголовок `Host` тоже клиентский → ротация `Host` тоже плодит корзины.
  3. `docker-compose.prod.yml:23-40` не пробрасывает `TRUST_PROXY`; базовый
     `docker-compose.yml:123` даёт `${TRUST_PROXY:-}` (пусто) → при деплое только
     с prod-overlay переменная пустая, ключ общий на домен.
  4. `src/services/auth/auth-service.ts:79,100` — ведра входа по IP и по
     `login:{email}:{ip}` обходятся подделкой XFF; единственный оставшийся
     ограничитель — аккаунтный `login-acct:{email}` (`:91`, 10 попыток/15 мин).
  5. `src/app/api/orion/lead/route.ts:56` — ключ лимита — голый
     `getRateLimitIdentifier(request)` без префикса маршрута → общая корзина
     `rl:<ip>` и общий блок-ключ с маршрутами телеметрии (у них пороги разные).
- Ответ на главный вопрос: **лимит входа обходится подменой заголовка — «да, но с
  оговоркой»**: при `TRUST_PROXY=true` счётчики по IP и `login:{email}:{ip}`
  обходятся, если Caddy не отбрасывает клиентский XFF (не проверено — конфиг
  Caddy на сервере вне репозитория); счётчик `login-acct:{email}` (только почта)
  от IP не зависит и остаётся как последний тормоз.

## Методика

- Прочитаны целиком: `src/lib/rate-limiter.ts` (515 строк),
  `src/core/api-wrapper.ts`, `src/services/auth/auth-service.ts`,
  `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`,
  `src/app/api/auth/me/route.ts`, `src/app/api/orion/lead/route.ts`,
  `src/app/api/telemetry/route.ts`, `src/app/api/telemetry/ingest/route.ts`
  (фрагм.), `docker-compose.yml`, `docker-compose.prod.yml` (фрагм.),
  `.env.example`, `deploy/Caddyfile.prod`, `Caddyfile`,
  `scripts/validate-env.ts` (фрагм.), `scripts/test-day-stand.cjs` (фрагм.),
  `src/lib/__tests__/rate-limiter.test.ts`.
- Поиск по `src/` и всему репозиторию: `x-forwarded-for`, `x-real-ip`,
  `TRUST_PROXY`, `getClientIp`, `request.ip`, `getRateLimitIdentifier`,
  `getTenantRateLimitIdentifier`, `resolveClientIp`, `createRateLimitMiddleware`,
  `rateLimiter`, `trusted_proxies`, `refresh`, `pin`.
- Перечень маршрутов: `ls src/app/api/auth/` (остались `login`, `logout`, `me`);
  `src/app/api/**/route.ts` (81 файл).
- Ключевые точки формирования ключа: единственная функция IP —
  `resolveClientIp` (`rate-limiter.ts:478-488`); все ключи образуются в
  вызывающих через `rateLimiter.check(...)`.

## Таблица маршрутов

| Маршрут | Ключ лимита | Откуда IP | Подделываемо | Риск |
|---|---|---|---|---|
| `POST /api/auth/login` | `login-ip:{ip}` (`auth-service.ts:79`), `login-acct:{email}` (`:91`), `login:{email}:{ip}` (`:100`) | `getRateLimitIdentifier` (`login/route.ts:52`) → `resolveClientIp` | да (XFF при TRUST_PROXY; Host при пустом) | обход счётчиков по IP и по паре почта+IP; аккаунтный держит 10/15 мин |
| `POST /api/auth/logout` | `mut:source:{ip}` + `mut:{route}:{sha256(sess)}:{ip}` (`api-wrapper.ts:201,212`) | тот же `getRateLimitIdentifier` (`:196`) | да | низкий (вход уже защищён отдельно) |
| `GET /api/auth/me` | лимита нет (только сессия) | — | — | info |
| `POST /api/orion/lead` (публ. форма) | `getRateLimitIdentifier(request)` без префикса (`lead/route.ts:56`), порог 5/10 мин | тот же | да | обход флуда заявок; общая корзина с телеметрией |
| `POST /api/telemetry` | `telemetry:{ip}` (`route.ts:91`) | тот же | да | средний |
| `POST/PATCH /api/telemetry/ingest` | `telemetry:ingest:{ip}` (`ingest/route.ts:102,147`) | тот же | да | средний |
| `POST /api/telemetry/batch` | `telemetry:{ip}` (`batch/route.ts:71`) | тот же | да | средний |
| `GET /api/reports/pdf`, `single-pdf` | `pdf:get:{user.id}` (`route.ts:244`, `:218`) | userId из сессии | нет | безопасно |
| `GET /api/pile-passports/export` | `pile-export:get:{user.id}` (`route.ts:51`) | userId из сессии | нет | безопасно |
| все `withMutation` маршруты | `mut:source:{ip}` (1800/мин) + `mut:{route}:{sess}:{ip}` (100/мин) | тот же | да | при пустом TRUST_PROXY общий source-бакет → DoS |

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/lib/rate-limiter.ts:479-481` | При `TRUST_PROXY=true` ключ = `x-forwarded-for`.split(',')[0] — **левый** узел цепочки | Если Caddy дописывает реальный адрес клиента справа от присланного злоумышленником значения (а не заменяет заголовок), левый узел подконтролен клиенту: `X-Forwarded-For: 1.2.3.4` на каждой попытке → новое ведро → обход перебора входа | Доверять только адресу, добавленному нашим прокси; брать не первый, а адрес на фиксированной позиции с конца, либо явно стрипать входящий XFF в Caddy (`header_up -X-Forwarded-For` перед `header_up X-Forwarded-For`); настроить `trusted_proxies` |
| 2 | важно | `src/lib/rate-limiter.ts:504` | Без `TRUST_PROXY` fallback-ключ = `host-${Host}`, а `Host` — клиентский заголовок | Там, где приложение доступно напрямую (дев/стейдж, забытый порт), ротация `Host` даёт новую корзину на каждый запрос и обнуляет лимит | Не включать клиентский `Host` в ключ; использовать константу процесса или падать при недоступности IP |
| 3 | важно | `docker-compose.prod.yml:23-40` + `docker-compose.yml:123` | Prod-overlay не задаёт `TRUST_PROXY`; базовый compose даёт `${TRUST_PROXY:-}` = пусто | Деплой «`docker compose -f docker-compose.yml -f docker-compose.prod.yml`» без переменной в окружении → `TRUST_PROXY` пуст → ключ `host-<домен>`, 21-й вход за 15 мин блокирует вход всем (SEC-10/R61, уже случалось на бою) | Пробросить `TRUST_PROXY` в prod-overlay или в `.env` сервера и проверить фактическое значение в контейнере |
| 4 | важно | `src/services/auth/auth-service.ts:79,100` | Ведра входа `login-ip:{ip}` и `login:{email}:{ip}` строятся из IP | При обходе подделки XFF (см. #1) обе корзины сбрасываются; перебор одной учётки за 15 мин ограничен только `login-acct:{email}` (10 попыток) | Опираться на не-IP факторы (аккаунт, устройство) для критичных порогов; ужесточить аккаунтный лимит |
| 5 | важно | `src/services/auth/auth-service.ts:91` | `login-acct:{email}` — единственный ключ, не зависящий от IP | Это и есть фактический потолок перебора: 10 попыток на почту / 15 мин даже при подделке всех IP-ключей. Если и его подделать нельзя, скорость подбора ограничена 960/сутки на аккаунт | Задокументировать как основной барьер; рассмотреть экспоненциальную задержку/капчу |
| 6 | важно | `src/app/api/orion/lead/route.ts:56` | Ключ — голый `getRateLimitIdentifier(request)`, без префикса маршрута | Redis-ключ `rl:<ip>` и блок `rl:blocked:<ip>` общие с телеметрией, а пороги разные (5/10 мин против 1000/60 с): пять заявок с адреса глушат приём телеметрии и наоборот (подтверждает W80) | Префикс маршрута в ключе (`lead:{ip}`) — тот же приём, что уже применён в телеметрии |
| 7 | важно | `src/lib/rate-limiter.ts:482-483` | Ветка `x-real-ip` | Caddy по умолчанию не выставляет `X-Real-IP`; заголовок дойдёт только если клиент прислал его сам (или прокси настроен иначе) → тот же класс подделки, что XFF | Не читать произвольный заголовок без подтверждения, что его ставит доверенный прокси |
| 8 | важно | `src/app/api/telemetry/route.ts:91`, `batch/route.ts:71` | Префикс `telemetry:{ip}` совпадает у двух маршрутов с разными порогами | Один и тот же Redis-ключ и блок-ключ у разных лимитов → взаимное влияние партиций | Уникальный префикс на маршрут |
| 9 | мелочь | `src/lib/rate-limiter.ts:511-515` | `getTenantRateLimitIdentifier` включает клиентский `x-tenant-id` | Функция сейчас **мертва** (вызовы только в тесте, в `src/` нет), но если её применить на pre-auth маршруте — ротация `x-tenant-id` плодит корзины | Не использовать этот ключ до аутентификации; удалить или пометить |
| 10 | мелочь | `scripts/test-day-stand.cjs:11` | Стенд жёстко задаёт `TRUST_PROXY:'true'` | E2E-стенд всегда доверяет заголовку и не воспроизводит прод-режим «переменная пуста» — баг SEC-10 тестами не ловится | Добавить прогон/проверку с пустым `TRUST_PROXY` |
| 11 | мелочь | `.env.example` (25 строк) | Нет `TRUST_PROXY` (и `REDIS_URL_CACHE`) | Админ не знает о переменной → тихо выключенная защита разделения по IP | Добавить строку с пояснением |
| 12 | мелочь | `scripts/validate-env.ts:124-136` | О пустом `TRUST_PROXY` — только предупреждение при сборке, не ошибка | Сборка проходит; на бою никто не смотрит лог сборки → переменная остаётся пустой | Считать ошибкой в prod-профиле либо выводить в health/status |
| 13 | мелочь | `src/app/api/auth/` (только `login`,`logout`,`me`) | Маршрута обновления токена/refresh нет | Нечего лимитировать по refresh; сессия обновляется cookie (см. session-service) — отдельной точки входа нет | — |
| 14 | info | `src/app/api/reports/pdf/route.ts:244`, `single-pdf/route.ts:218`, `pile-passports/export/route.ts:51` | Ключ по `user.id` из сессии | Положительный пример: ключ не из заголовка, подделать нельзя | Оставить как эталон |

## Вывод по главному вопросу

**Обходится ли лимит входа подменой заголовка — «да, с оговоркой».**

Обоснование (одна строка): при `TRUST_PROXY=true` и билде ключей из первого узла
`x-forwarded-for` (`rate-limiter.ts:481`) счётчики `login-ip:*` и
`login:*:{email}:{ip}` обходят ротацией заголовка, если Caddy не отбрасывает
присланный клиентом XFF; не зависит от IP только `login-acct:{email}`
(`auth-service.ts:91`, 10 попыток/15 мин) — это и есть фактический барьер.

## Не проверено

- **Поведение Caddy с входящим `X-Forwarded-For`** (заменяет/дописывает) и версия
  Caddy на сервере — репозиторий не содержит серверного конфига Caddy и не
  фиксирует версию; `trusted_proxies` в `deploy/Caddyfile.prod` не задан. От
  этого зависит, действительно ли левый узел подконтролен клиенту (находка #1).
  Локально проверить нельзя: Caddy и прод-DB/прод-контур недоступны (AGENTS.md §1).
- **Фактическое значение `TRUST_PROXY` в проде** — из кода/compose/документов
  следует, что оно должно быть `true` (`docs/audit.md:51`, `docker-compose.yml:117-123`),
  но подтвердить в контейнере без доступа к серверу нельзя.
- **Эффект ротации `Host`** зависит от того, как Caddy маршрутизирует запросы с
  чужим `Host` (доменный матчер) — на сервере не проверялось.
- **Наличие иных внешних фронтов** (nginx, Cloudflare) перед Caddy — вне репозитория.
- Тесты `src/lib/__tests__/rate-limiter.test.ts` **не запускались** (задача
  read-only; поведение читалось по коду, не измерено).
