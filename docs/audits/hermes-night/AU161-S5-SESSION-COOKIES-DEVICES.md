# AU161-S5 — Сессии: несколько устройств и выход

Версия для аудита: `git rev-parse HEAD` = `5d63984de337a858bc5ee98d91531cec528a3342` (ветка `hermes/q4-0926`).
Только чтение, код приложения не менялся (создан один файл — этот отчёт).
Frozen-зоны (оператор, ORION) не затрагивались.

## Итог

Сессии в PilingTrack — это stateless JWT-куки (`pt-session`, HS256, `jose`), без таблицы сессий и без учёта устройств. Каждый успешный вход выдаёт новый токен со своим случайным `jti`; ограничения на число одновременных сессий/устройств нет, срок жизни фиксирован — 12 часов, без продления и refresh-токена.

Отзыв обеспечивается двумя независимыми механизмами: (1) `sessionVersion` в БД — сильный, срабатывает при смене пароля, блокировке (`isActive=false`) и смене роли, проверяется на КАЖДОМ запросе; (2) denylist `jti` в Redis (REDIS_URL) — используется только обычным выходом, и он **fail-open**: при недоступности Redis отозванный токен снова принимается до конца 12 ч.

Отдельного «выхода со всех устройств» и смены собственного пароля нет: пользователь не может сам отозвать сессии на других устройствах. Единственный способ — действие администратора (блокировка либо смена пароля/роли через `PUT /api/users`), которое увеличивает `sessionVersion` и гасит все токены пользователя.

Числа: unit-тесты по теме (17 файлов) — 206 passed, 0 skipped (команда в «Методике»); Playwright — 291 тест в 27 файлах. Старый WS-путь (`src/core/realtime/**`, находка B5) удалён из репозитория — `src/core/realtime` больше не существует, поэтому «дыра» с непроверенным `sessionVersion` в реальном времени перестала быть актуальной.

Находки: критично — 0; важно — 2; мелочь — 5. Топ-5:
1. (важно) Нет self-service «выйти со всех устройств» и смены своего пароля — пользователь не может сам отозвать чужие сессии.
2. (важно) Обычный выход опирается только на Redis-denylist, который fail-open: при недоступном Redis выход не отзывает токен (до 12 ч).
3. (мелочь) `authUserCache` в `src/lib/auth.ts` пишется, но нигде не читается — заявленного 5-секундного кеша нет.
4. (мелочь) Нет модели сессий/устройств и лимита числа сессий — нет и источника данных для списка активных сессий.
5. (мелочь) Корневая страница `src/app/page.tsx` маршрутизирует по роли из токена, не перепроверяя `sessionVersion`/`isActive`.

## Методика

- Записи: `git rev-parse HEAD`; поиск по репозиторию (`rg`/`search_files`) по `sessionVersion`, `revoke`, `logout`, `refreshToken`, `pin`, `authUserCache`, `createSessionToken`, `verifySessionToken`, `getStateRedisClient`.
- Прочитанные файлы (все открыты, не по памяти): `src/services/auth/session-service.ts`, `src/services/auth/auth-service.ts`, `src/lib/auth.ts`, `src/lib/page-session.ts`, `src/services/users/user-service.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/users/route.ts`, `src/core/api-wrapper.ts`, `src/lib/csrf-protection.ts`, `src/app/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/admin/layout.tsx`, `src/app/(app)/(readiness-admin)/layout.tsx`, `src/app/(app)/(safety)/layout.tsx`, `src/lib/api.ts`, `src/lib/store.ts`, `prisma/schema.prisma` (модель `User`), `prisma/migrations/20260622010000_user_session_version/migration.sql`, тесты в `src/services/auth/__tests__/*`, `src/lib/__tests__/auth.test.ts`, `src/services/users/__tests__/user-service.test.ts`, `src/app/api/auth/login/__tests__/route.test.ts`, `tests/contract/auth-api.spec.ts`.
- Проверки (каждая реально выполнена, без пайпа в tail/head для кодов выхода):
  - `node node_modules/vitest/vitest.mjs run src/services/auth/__tests__ src/lib/__tests__/auth.test.ts src/services/users/__tests__/user-service.test.ts src/app/api/auth "src/app/(app)/admin/__tests__/layout.test.tsx" "src/app/(app)/(readiness-admin)/__tests__/layout.test.tsx" src/components/piling/admin-users/__tests__` → exit 0, `Test Files 17 passed (17)`, `Tests 206 passed (206)`.
  - `npx playwright test --list` → `Total: 291 tests in 27 files`.
  - `grep -rn "authUserCache.get|authUserCache\.set|authUserCache.delete" src/` → `.get(` отсутствует (только set/delete).
  - `ls src/core/realtime` → `No such file or directory`.

## Таблица: сценарий → поведение → тест

| Сценарий | Файл:строка | Поведение в коде | Тест |
|---|---|---|---|
| Сколько сессий допускается | `src/services/auth/session-service.ts:190` (`createSessionToken`) | Неограниченно: каждый вход минтит новый токен со своим `jti` (`session-service.ts:192`), таблицы сессий нет. Ровно одна точка выдачи токена — login (`src/app/api/auth/login/route.ts:93` → `src/services/auth/auth-service.ts:145`). | `src/services/auth/__tests__/session-service.test.ts:55` (валидный JWT), `:200` (jti) |
| Срок жизни сессии | `src/services/auth/session-service.ts:8` | `SESSION_TTL_SECONDS = 60*60*12` (12 ч), фиксирован; refresh-эндпоинта и `refreshToken` в `src/` нет. | — |
| Несколько устройств | `prisma/schema.prisma:93` (модель `User`), список моделей | Модели сессии/устройства нет; куки на каждом устройстве независимы, вход на одном не гасит другой. | — |
| Выход (одно устройство) | `src/app/api/auth/logout/route.ts:12`, `src/services/auth/session-service.ts:255` (`revokeSessionToken`) | Отзывается только `jti` текущего токена (`revoked-jti:<jti>` в Redis, `session-service.ts:163`); кука чистится. | `src/services/auth/__tests__/session-service.test.ts:206,238,258` |
| Честность выхода при сбое Redis | `src/app/api/auth/logout/route.ts:19-21` | Если отзыв не записан — 503 и кука НЕ чистится («сеанс остаётся активным»). | `src/services/auth/__tests__/session-service.test.ts:258` |
| Выход со всех устройств (пользователем) | — | Эндпоинта/UI нет; только `POST /api/auth/logout` (текущий токен). Сам пользователь отозвать остальные сессии не может. | — |
| Отзыв при смене пароля | `src/services/users/user-service.ts:235-238` | `data.sessionVersion = { increment: 1 }` при `input.password`; проверка `src/lib/auth.ts:105`. Только админский путь `PUT /api/users` (`src/app/api/users/route.ts:89`). | `src/services/users/__tests__/user-service.test.ts:349` |
| Отзыв при блокировке | `src/services/users/user-service.ts:234-238` | `isActive=false` повышает `sessionVersion`; плюс проверка `!user.isActive` (`src/lib/auth.ts:105`, `src/lib/page-session.ts:63`). Последнего админа заблокировать нельзя (`user-service.ts:265-289`). | `src/services/users/__tests__/user-service.test.ts:339` |
| Отзыв при смене роли | `src/services/users/user-service.ts:249-251` | Смена роли повышает `sessionVersion` — все сессии пользователя гасятся. | `src/services/users/__tests__/user-service.test.ts:359` |
| `sessionVersion` — где хранится/читается/пишется | `prisma/schema.prisma:108`; `session-service.ts:198` (`sv` в токене); `src/lib/auth.ts:105`; `src/lib/page-session.ts:63` | Поле `User.sessionVersion` (default 0); пишется в токен как `sv`; сравнивается на каждом API-запросе и в серверных раскладках. | `src/lib/__tests__/auth.test.ts:101` (устаревшая версия → 401), `:58` (перепроверка) |
| Проверка в серверных раскладках | `src/app/(app)/admin/layout.tsx:8`, `src/app/(app)/(readiness-admin)/layout.tsx:10`, `src/app/(app)/(safety)/layout.tsx:20` | Все через `readPageSessionUser()` → отзыв `sessionVersion`/`isActive` в раскладке. | `src/app/(app)/admin/__tests__/layout.test.tsx:49`, `src/app/(app)/(readiness-admin)/__tests__/layout.test.tsx` |
| Даунгрейд/блокировка в бою | `src/lib/page-session.ts:59-65` | Комментарий и код: без проверки выключенный пользователь видел бы оболочку раздела до истечения токена. | `src/app/(app)/admin/__tests__/layout.test.tsx:59` |
| Реальный выход в браузере | `src/lib/api.ts:136` (`logoutClient`), `src/lib/store.ts:105` (`logout`) | UI «Выйти» → `POST /api/auth/logout`; клиентский стор чистит пользователя и `actingAs`. | `tests/contract/auth-api.spec.ts:86` |
| Что делает «выход» на стороне клиента при 401 | `src/lib/api.ts:57-70` | На любой 401 клиент сам вызывает `/api/auth/logout` и сбрасывает стор. | — |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/auth/logout/route.ts:12`; отсутствуют эндпоинты self-service | Нет ни эндпоинта, ни UI «выйти со всех устройств», и нет смены собственного пароля. Пользователь может завершить только текущую сессию; отозвать сессии на других устройствах он не может. | «Потерял/украли телефон»: сотрудник не в состоянии помочь себе сам, пока администратор не заблокирует учётку или не сменит пароль (`user-service.ts:236-238`). Для оператора/помощника (не-привилегированные роли) это единственный путь. | Добавить self-service действие «завершить все сеансы» = `sessionVersion++` для самого себя (и, опционально, свой эндпоинт смены пароля, тоже с инкрементом). |
| 2 | важно | `src/services/auth/session-service.ts:86-94,134-154`; `src/app/api/auth/logout/route.ts:17-23` | Denylist `jti` в Redis работает fail-open: при недоступности Redis `isRevoked` возвращает `false`, и уже отозванный выходом токен снова принимается до естественного истечения. Отзыв записывается лишь при доступном Redis. | Сбой/недоступность state-Redis → выход (или отзыв по jti) фактически не действует, окно — до 12 ч (`SESSION_TTL_SECONDS`, `session-service.ts:8`). Ослабляется тем, что выход возвращает 503 и куку не чистит, а `sessionVersion` (БД) — надёжный механизм для пароля/блокировки. | Осознанное решение, но его стоит зафиксировать явно; при строгом требовании — fail-closed для `isRevoked` на критичных путях либо короткий TTL в комбинации с проверкой `sessionVersion`. |
| 3 | мелочь | `src/lib/auth.ts:44-66,133,153-156` | `authUserCache` — Map, в которую пишут (`:133`) и чистят, но НИКОГДА не читают: `authUserCache.get` нет нигде в `src/`. Заявленный в комментариях 5-секундный кеш (`:41`, `:148-152`) не существует; каждый запрос делает `verifySessionToken` (Redis) + `findUnique` (БД). | Вводящий в заблуждение комментарий («другие процессы подхватят денилист в своё окно кеша») и мёртвый код (TTL/размер/`pruneAuthUserCache`). Не уязвимость — отзываемый токен отсекается сразу, — но код описывает не то, что делает. | Убрать `authUserCache`/`pruneAuthUserCache`/`clearAuthUserCacheEntry` либо, если кеш нужен, добавить чтение с ключом и осознанной инвалидацией по `sessionVersion`. |
| 4 | мелочь | `prisma/schema.prisma:93` (нет модели сессии); `src/services/auth/session-service.ts:190-211` | Нет модели сессий/устройств и нет ограничения числа сессий: бесконечное число активных токенов, у каждого — до 12 ч. Учётных устройств/точек входа не видно. | Нет источника данных ни для «списка активных сессий», ни для «выйти со всех устройств»; нельзя ни увидеть, ни ограничить параллельные входы. Итог — находка №1 неразрешима без этой модели. | Если функция нужна: ввести таблицу сессий (или хотя бы per-token метаданные) и лимит; пока — задокументировать как принятое ограничение. |
| 5 | мелочь | `src/app/page.tsx:18-23` | Корневая страница редиректит по `payload.role` из токена, проверяя только подпись и denylist (`verifySessionToken`), без проверки `sessionVersion`/`isActive`. | Заблокированный/понижённый пользователь кратко получает редирект на домашний маршрут СТАРОЙ роли; доступ не выдаётся (раскладка раздела перепроверит и уведёт на `/login`), но это лишний переход по устаревшему утверждению. | Использовать `readPageSessionUser()` (сессия перепроверяется в БД) до вычисления `roleHomeRoute`. |
| 6 | мелочь | `src/services/auth/session-service.ts:110-122` | Denylist-хранилище держит СВОЙ клиент Redis напрямую из `process.env.REDIS_URL` (+ `keyPrefix`), а не через общий `getStateRedisClient()` из `src/lib/redis-cache` (которым пользуются лидер-элекция, пульс воркеров, health). | Два Redis в проекте: `REDIS_URL` — state, `REDIS_URL_CACHE` — кэш. Сейчас инстанс выбран верно (state), но при переименовании/переезде state-инстанса правку нужно вносить в двух местах; модульный синглтон не на `globalThis`. | Использовать `getStateRedisClient()` из `@/lib/redis-cache` — единый state-клиент и единая точка конфигурации. |
| 7 | мелочь | `src/services/audit/audit-service.ts:387-402` | Есть типы событий `auth.pin.succeeded/failed/rate_limited`, но эндпоинта входа по PIN нет (нет `/api/auth/pin` среди `route.ts`; путь упоминается только в тесте `src/lib/__tests__/rate-limiter.test.ts:162`). | Мёртвые описания аудита создают впечатление работающего PIN-входа. Поведение безопасности не задевает, но вводит в заблуждение при разборе логов. | Удалить неиспользуемые типы событий либо вернуть маршрут PIN (тогда — с тем же `sessionVersion`-контролем). |

## Что не проверено

- **Не проверено** на живом стенде (нет доступа к БД/Redis/прод): фактическая длительность окна отзыва при недоступном Redis, реальные значения `sessionVersion` и поведение нескольких процессов Next.js. Всё выше выведено из кода и unit-тестов.
- **Не проверено**: покрывает ли `requireAuth` КАЖДЫЙ маршрут `src/app/api/**` — `withApi`/`withMutation` (`src/core/api-wrapper.ts`) сами аутентификацию не требуют; полноценный обход всех ~135 `route.ts` на наличие `requireAuth` в теле обработчика не делался (вне рамок задачи про сессии).
- **Не проверено** (ГИПОТЕЗА): действительно ли PIN-вход когда-либо использовался или маршрут удалён совсем; текстовый поиск маршрута не нашёл, но историю коммитов по PIN не разбирал.
- **Не проверено**: интеграционные/e2e-тесты на многопользовательские/многоустройственные сценарии сессий — `npx playwright test --list` даёт 291 тест в 27 файлах, но заточенных под отзыв `sessionVersion` e2e-спеков не найдено (только unit). Прогон Playwright не запускался (нет гарантии окружения) — считался только список.
- **Не проверено**: поведение при `MULTI_TENANT_MODE` > single и в multi-replica-развёртывании (in-process карты `authUserInFlight` живут в одном процессе).
- Не читались (по условию задачи): существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy`.
