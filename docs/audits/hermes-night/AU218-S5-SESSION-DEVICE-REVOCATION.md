# AU218-S5 — Отзыв сессий и устройств

Аудит только для чтения. Код приложения не изменялся.
Версия (git rev-parse HEAD): `89ddcfc7829cc7f9e76d8353244c1d0b3604fac4`, ветка `hermes/q4-0926`.
Существующие отчёты в `docs/audits/` не читались. Секреты не печатались.
Статусы: ПРОЙДЕНО — есть тест/команда с зелёным результатом; ГИПОТЕЗА — вывод по чтению кода без прогона; НЕ ПРОВЕРЕНО — нет доступа/данных.

## Итог

Всего 8 находок: критично — 0, важно — 3, мелочь — 5.

Механизм отзыва двухслойный и в целом рабочий:
1) одна сессия — по `jti` в Redis-денилисте (`src/services/auth/session-service.ts:255`);
2) все сессии пользователя — по `sessionVersion` (поле `sv` в токене сверяется со строкой БД на каждом пути: `src/lib/auth.ts:105`, `src/lib/page-session.ts:63`). Счётчик растёт при блокировке, смене пароля и смене роли (`src/services/users/user-service.ts:236-250`).

Топ-5:
1. (важно) Денилист отказывает «fail-open»: при недоступном/непрогретом Redis отозванный токен принимается до 12 ч (`session-service.ts:141,146,152`).
2. (важно) Отзыв одной сессии идёт через собственный ioredis-клиент вместо `getStateRedisClient()`, хотя `redis-cache.ts:132` прямо указывает на этот список как на потребителя состояния (`session-service.ts:110,117`).
3. (важно) Нет явного действия «отозвать все сессии пользователя»: сброс возможен только косвенно — сменой роли/пароля/блокировкой (`user-service.ts:236,250`).
4. (мелочь) 5-секундный кэш сессии по токену откладывает применение отзыва в том же процессе (`src/lib/auth.ts:41,133`).
5. (мелочь) Токен без `jti` не отзывается и не проверяется по денилисту (`session-service.ts:238,257`); версия 1 формата ещё принимается (`session-service.ts:39`).

## Методика

- `git rev-parse HEAD` → версия выше.
- `rg`/`grep` по `src/services/auth`, `src/lib`, `src/app/api`, `src/app/(app)`, `e2e`, `tests`:
  `sessionVersion`, `revokeSessionToken`, `revoked-jti`, `isRevoked`, `clearSessionCookie`,
  `verifySessionToken`, `verifyTokenSignature`, `SESSION_COOKIE_NAME`, `readPageSessionUser`, `jwtVerify`.
- Полностью прочитаны: `src/services/auth/session-service.ts` (305 строк), `src/services/auth/auth-service.ts`,
  `src/lib/auth.ts`, `src/lib/page-session.ts`, `src/lib/redis-cache.ts`, `src/app/api/auth/logout/route.ts`,
  `src/app/api/auth/login/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/page.tsx`,
  `src/app/api/users/route.ts`, `src/services/users/user-service.ts` (выборочно), `src/app/(app)/layout.tsx`.
- Тесты: `node node_modules/vitest/vitest.mjs run src/services/auth src/lib/__tests__/auth.test.ts src/app/api/auth`
  → `Test Files 9 passed (9)`, `Tests 97 passed (97)`, exit 0.
- Проверялось, что отзыв не обходится: перечислены ВСЕ места, читающие токен
  (`readSessionToken`/`verifySessionToken`/`verifyTokenSignature`) — см. находки.

## Проверка механизма отзыва (таблица по коду)

| Действие | Файл:строка | Что отзывается | Тест |
|---|---|---|---|
| Выход — одна сессия | `src/app/api/auth/logout/route.ts:19` | `jti` этой сессии попадает в денилист | `src/app/api/auth/logout/__tests__/route.test.ts` — ПРОЙДЕНО |
| Запись отзыва | `src/services/auth/session-service.ts:255-262` → `:163` | ключ `revoked-jti:<jti>` c TTL = остаток `exp` | `src/services/auth/__tests__/session-service.test.ts:206,238,258` — ПРОЙДЕНО (memory-store) |
| Проверка денилиста | `src/services/auth/session-service.ts:238` | отозванный `jti` → токен отклонён | `session-service.test.ts:206` — ПРОЙДЕНО |
| Все сессии — блокировка `isActive:false` | `src/services/users/user-service.ts:236-237` | `sessionVersion++` → все старые токены недействительны | `src/services/users/__tests__/user-service.test.ts:339` — ПРОЙДЕНО |
| Все сессии — смена пароля | `src/services/users/user-service.ts:235-237` | `sessionVersion++` (атомарно с записью `password`) | `user-service.test.ts:349` — ПРОЙДЕНО |
| Все сессии — смена роли | `src/services/users/user-service.ts:249-250` | `sessionVersion++` | `user-service.test.ts:359` — ПРОЙДЕНО |
| Контроль `sv` на API | `src/lib/auth.ts:105` | несовпадение `sv`/`sessionVersion` → 401 | `src/lib/__tests__/auth.test.ts:58,101` — ПРОЙДЕНО |
| Контроль `sv` на страницах | `src/lib/page-session.ts:63` | несовпадение или `isActive:false` → `/login` | `src/app/(app)/admin/__tests__/layout.test.tsx:49,57` — ПРОЙДЕНО |
| Удаление пользователя | `src/services/users/user-service.ts:330,356` | строки нет → `findUnique` = null → 401 | теста именно на отзыв сессии удалённого нет — НЕ ПРОВЕРЕНО |

Устройства как сущности в коде нет: отзыв идёт только по токену (`jti`) и по `sessionVersion`, отдельного реестра устройств/сессий нет (ГИПОТЕЗА-подтверждено поиском `rg` — таблицы сессий в схеме не найдено).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/services/auth/session-service.ts:141,146,152` | Денилист работает fail-open: `isRevoked` возвращает `false`, если Redis недоступен, ещё не `ready`, или GET упал | Redis лёг/рестартовал без персистентности → украденный или «вышедший» токен принимается до конца `exp` (≤ 12 ч, `SESSION_TTL_SECONDS` :8). При этом выход честно отвечает 503 (`logout/route.ts:20`), но уже выданный отзыв перестаёт действовать | Держать `noeviction`-инстанс состояния и включить персистентность; на отказ Redis — метрика/алерт; при желании fail-closed хотя бы для списка отзыва |
| 2 | важно | `src/services/auth/session-service.ts:110,117` | Отзыв сессий использует свой `new Redis(process.env.REDIS_URL)`, а не `getStateRedisClient()` из `src/lib/redis-cache.ts:136`; в комментарии `redis-cache.ts:132` этот список назван потребителем состояния | Если в окружении задан только `REDIS_URL_CACHE`, а `REDIS_URL` пуст, клиент отзыва = null → отзыв никогда не пишется (выход всегда 503) и `isRevoked` всегда false. Свой клиент не проходит через `redisCircuitBreaker` (`redis-cache.ts:36`) | Использовать `getStateRedisClient()` вместо собственного клиента |
| 3 | важно | `src/services/users/user-service.ts:236,250` | Нет явного действия «отозвать все сессии пользователя». `sessionVersion++` только как побочный эффект смены пароля/роли/блокировки | Подозрение на кражу токена без намерения менять пароль/роль/доступ: у админа нет способа разлогинить пользователя, не меняя его состояние | Команда «Завершить все сеансы» = `sessionVersion: { increment: 1 }` без иных полей + запись в аудит |
| 4 | мелочь | `src/lib/auth.ts:41,44,133` | 5-секундный кэш аутентификации ключом по токену; проверка `sv` идёт только при промахе кэша. `clearAuthUserCacheEntry` (:153) чистит лишь текущий процесс | После блокировки/смены роли запросы того же пользователя в этом процессе до 5 с обслуживаются из кэша; в других процессах — свой кэш | Оставлять как есть (граница осознанно малая и описана в `:148-151`); при ужесточении — сократить TTL или инвалидировать по `sub` |
| 5 | мелочь | `src/services/auth/session-service.ts:257` и `:39` | Токен без `jti` не отзывается (`revokeSessionToken` → `false`), при этом версия 1 формата ещё принимается (`ACCEPTED_SESSION_TOKEN_VERSIONS:39`) | Для legacy v1-токена без `jti` нажатие «Выйти» даст 503 «сеанс остаётся активным», хотя пользователь ждёт выхода. Отзыв таких токенов возможен только по `sv`. ГИПОТЕЗА: были ли у v1-токенов `jti` — не проверено (историчный код выпуска не читался) | Убедиться, что все v1-токены имеют `jti`; иначе убрать 1 из списка принятых версий по истечении 12 ч |
| 6 | мелочь | `src/services/auth/session-service.ts:238` | Проверка денилиста включается только при наличии `jti` (`if (payload.jti && ...)`). Токен без `jti` денилист обходит | См. #5: для токена без `jti` единственный барьер отзыва — `sv` в `lib/auth.ts`/`page-session.ts` | После вывода v1 (#5) барьер неактуален; явно документировать инвариант «все токены несут jti» |
| 7 | мелочь | `src/app/page.tsx:18` | Корневая страница решает по `verifySessionToken` (подпись + денилист) без чтения строки пользователя: `sv`/`isActive` не сверяются | Отозванного по `sv` пользователя `/` уводит на его домашний маршрут вместо `/login`; целевая раскладка затем перенаправит — эскалации нет, но лишний переход | Использовать `readPageSessionUser()` для решения о редиректе |
| 8 | мелочь / ГИПОТЕЗА | `src/services/auth/session-service.ts:156-168` + `src/lib/redis-cache.ts:136` | Долговечность денилиста не гарантирована на уровне кода: ключи — обычный `SET EX`, без реплики; персистентность Redis — вопрос конфигурации | Рестарт state-Redis без RDB/AOF → все `revoked-jti:*` теряются, отозванные токены оживают до `exp`. Настройки Redis (`.env*`, `docker-compose*`) не читались — НЕ ПРОВЕРЕНО | Проверить наличие AOF/RDB на state-инстансе; недоступность персистентности компенсировать fail-closed или коротким TTL |

## Что не проверено

- Реальный `RedisRevocationStore` в тестах не выполняется: `session-service.test.ts:32-38` подменяет хранилище на memory-store («Tests run without Redis»). Живой путь `SET/GET` в Redis модульно НЕ ПРОВЕРЕН.
- Содержимое `.env*`, `docker-compose*`, `Dockerfile*` не читалось (запрет AGENTS.md) → нельзя подтвердить, какой `REDIS_URL`/`REDIS_URL_CACHE` задан на бою и включена ли персистентность Redis. Находки #1, #2, #8 на этом основании помечены ГИПОТЕЗА/НЕ ПРОВЕРЕНО.
- Наличие `jti` у исторических токенов версии 1 — НЕ ПРОВЕРЕНО (код прежних выпусков не читался).
- Интеграционного/e2e-теста, который реально отзывает сессию и убеждается, что доступ пропал (через Redis и через `sv`), не найдено: `rg` по `e2e`, `tests` не показал сценария «revoke → доступ закрыт». Полный прогон `npm run test:unit`/Playwright по этому файлу не выполнялся.
- Проверка отзыва на WebSocket/worker-путях не выполнялась (не найдено отдельного аутентификатора сессии; `jwtVerify` вне `services/auth` есть только в `src/modules/operator-mobile/application/knowledge-attempt.ts` — иной тип токена, привязан к `operatorId`, не сессия).
