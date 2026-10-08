# AU26-S5-SESSIONS-LOGIN — Сессии и вход: срок, отзыв, блокировка, лимиты

Версия: `git rev-parse HEAD` → `048cee1883b8eb2c6bb2724e6e38b411b873c645` (branch `hermes/q4-0926`).
Независимый проход. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не открывались. `src/services/auth/**`, `src/lib/rate-limiter.ts` читались только.

## Итог

- Находок: **17**. По severity: критично — **1**, важно — **7**, мелочь — **9**.
- **Критично:** `scripts/reset-passwords.ts` хранит открытые пароли учёток прямо в репозитории (в т.ч. `sas02@rambler.ru` / `sas02password`), запускается без запрета на прод и принудительно ставит `isActive: true`.
- **Важно:** мёртвый кэш `authUserCache` в `src/lib/auth.ts` (никогда не читается — каждый запрос бьёт в Redis и БД); без `TRUST_PROXY=true` счётчик входа — один общий на весь домен (`rate-limiter.ts`), это ловушка «вход заблокируется сразу всем»; успешный вход не сбрасывает IP-бакет; глобальный лок аккаунта по e-mail (10/15 мин); выход отдаёт 503 и не чистит куку при истёкшем/уже отозванном токене; CLI-сброс пароля не меняет `sessionVersion`; отзыв fail-open.
- Топ-5 по влиянию: №1 (пароли в репо), №4 (общий IP-бакет входа), №3 (мёртвый кэш), №7 (выход 503), №6 (лок аккаунта по e-mail).
- Механика сессии в остальном выстроена здраво: HttpOnly+SameSite=Lax+Secure(prod), проверка `isActive`/`sessionVersion`/тенанта на каждом запросе, инвалидация сессий при блокировке/смене пароля через API — это ПРОЙДЕНО.

## Методика

Всё воспроизводится этими командами (из `D:\PillingR\wt-night`):

```bash
git rev-parse HEAD                     # 048cee18...
ls src/services/auth src/app/api/auth  # session-service.ts auth-service.ts authorization-service.ts resource-access-service.ts | login/ logout/ me/
grep -rn "sessionVersion" src          # кто повышает версию сессии
grep -rn "authUserCache" src/lib/auth.ts
grep -rn "RATE_LIMIT_BYPASS|LOGIN_IP_RATE_LIMIT|ACCOUNT_LOCKOUT" src
grep -rn "TRUST_PROXY" .
grep -rln "password" src/app/api --include=route.ts   # только login и users
ls scripts | grep password
node <scratch>/pwcheck.cjs             # проверка хешей из fix-passwords.sql через bcryptjs
```

Читались целиком (с номерами строк): `src/services/auth/session-service.ts`, `src/services/auth/auth-service.ts`, `src/lib/auth.ts`, `src/lib/rate-limiter.ts`, `src/lib/page-session.ts`, `src/lib/csrf-protection.ts`, `src/core/api-wrapper.ts`, `src/lib/redis-cache.ts`, `src/app/api/auth/{login,logout,me}/route.ts`, `src/app/api/users/route.ts`, `src/app/page.tsx`, `src/components/piling/login-page.tsx`, `src/lib/api.ts` (фрагмент), `scripts/reset-passwords.ts`, `scripts/reset-one-password.ts`, `prisma/seed.ts` (фрагменты), `scripts/fix-passwords.sql`.

## Разбор по пунктам задания

| Пункт | Вывод | Статус | Файл:строка |
| --- | --- | --- | --- |
| Срок жизни токена | JWT `exp` = 12 ч от выдачи (`SESSION_TTL_SECONDS = 60*60*12`), без продления/скольжения | ПРОЙДЕНО | src/services/auth/session-service.ts:8, 207 |
| Срок жизни куки | `maxAge` = те же 12 ч, кука постоянная (не session-cookie) | ПРОЙДЕНО | src/services/auth/session-service.ts:287 |
| Флаги куки | `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV==='production'`, `path: '/'`; префикса `__Host-` нет | ПРОЙДЕНО | src/services/auth/session-service.ts:279-291 |
| Выход (logout) | POST → отзыв jti в Redis-денлисте + очистка куки; **при «токен уже недействителен» отдаёт 503 и куку НЕ чистит** (см. №7) | ПРОЙДЕНО / важно | src/app/api/auth/logout/route.ts:17-23 |
| Отзыв токена | Денлист `revoked-jti:<jti>` в инстансе состояния (`REDIS_URL`), TTL = остаток жизни токена; **fail-open** при недоступности Redis (см. №8) | ПРОЙДЕНО / важно | src/services/auth/session-service.ts:110-122, 134-169, 255-263 |
| Блокировка пользователя | `updateUser` при `isActive:false` делает `sessionVersion {increment:1}` → следующий запрос с той же сессией получает 401 немедленно (не по сроку) | ПРОЙДЕНО | src/services/users/user-service.ts:236-238; src/lib/auth.ts:105 |
| Удаление пользователя | Строка удаляется → `findUnique` вернёт `null` → 401 немедленно; удаление запрещено, если есть отчёты/объекты/бригады — «заблокируйте его» | ПРОЙДЕНО | src/services/users/user-service.ts:330-353; src/lib/auth.ts:105 |
| Смена пароля (в приложении) | Через `PUT /api/users` `data.password` + `sessionVersion++` → прочие сессии отзываются | ПРОЙДЕНО | src/services/users/user-service.ts:235-238; src/app/api/users/route.ts:107-118 |
| Смена пароля (CLI) | Скрипты сброса пароля НЕ меняют `sessionVersion` → старая сессия живёт до 12 ч | важно | scripts/reset-passwords.ts:37-43; scripts/reset-one-password.ts:38-43 |
| Смена роли | Повышает `sessionVersion` → все сессии пользователя пересоздаются | ПРОЙДЕНО | src/services/users/user-service.ts:249-251 |
| Лимиты входа: ключи/окна | 3 бакета: `login-ip:<ip|host>` 20/15 мин (блок 30 мин), `login-acct:<email>` 10/15 мин (блок 15 мин), `login:<email>:<ip>` 5/15 мин (блок 30 мин) | ПРОЙДЕНО | src/lib/rate-limiter.ts:19-44; src/services/auth/auth-service.ts:79-105 |
| Лимиты: сброс | При успешном входе сбрасываются только `accountKey` и `lockoutKey`; `login-ip` не сбрасывается | важно | src/services/auth/auth-service.ts:136-137 |
| Восстановление доступа | Пользовательского сброса/восстановления пароля нет: в `api/auth` только login/logout/me; `password` встречается лишь в login и users. Путь — админ через `PUT /api/users` либо CLI-скрипт на сервере | важно | ls src/app/api/auth; grep password src/app/api --include=route.ts |
| Вход с общего устройства | Кука постоянная (12 ч), закрытие браузера не разлогинивает; списка/завершения «других сессий» нет; при повторном входе старый токен не отзывается | мелочь | src/services/auth/session-service.ts:287, 190-211 |
| Защита от перебора/спуфинга IP | Доверие `x-forwarded-for` только при `TRUST_PROXY=true`; без него ключ = `host-<Host>` (общий бакет) | мелочь / ГИПОТЕЗА (состояние прод-окружения) | src/lib/rate-limiter.ts:478-505 |
| Проверка сессии на страницах | `readPageSessionUser` повторяет проверки `isActive`+`sessionVersion`+тенант и защищает от круга редиректов | ПРОЙДЕНО | src/lib/page-session.ts:40-74 |
| CSRF на вход | `withCsrf` вызывается вручную в login; для `/api/auth/login` разрешены запросы без браузерных заголовков (иначе login CSRF) | ПРОЙДЕНО | src/app/api/auth/login/route.ts:27-28; src/lib/csrf-protection.ts:41-43, 120 |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| 1 | критично | scripts/reset-passwords.ts:18-31 | В репозитории лежат открытые пароли учёток, включая правдоподобно-боевую `sas02@rambler.ru` / `sas02password`; скрипт без production-guard (`:4-16`), при запуске перезаписывает пароли и ставит `isActive: true` (`:37-43`) | Любой с доступом к репо (и к историю git) знает пароль этой учётки; запуск на бою разблокирует и перепишет пароли всему списку. Реален ли аккаунт на бою — не проверено (в прод не ходил) | Удалить скрипт; если он нужен для дев-сидов — брать пароли из env/генерировать, добавить guard `NODE_ENV==='production' → exit` |
| 2 | важно | scripts/reset-passwords.ts:37-43; scripts/reset-one-password.ts:38-43 | Сброс пароля через скрипт не повышает `sessionVersion` | После смены пароля украденная/старая сессия продолжает работать до 12 ч — сброс пароля не «выкидывает» злоумышленника | В `data` добавить `sessionVersion: { increment: 1 }` (как в `user-service.ts:236-238`) |
| 3 | важно | src/lib/auth.ts:44, 133 (и весь файл) | `authUserCache` только записывается (`:133`), удаляется (`:77,106,116,154`) и чистится (`pruneAuthUserCache`), но **никогда не читается** — `grep authUserCache` не даёт ни одного `.get(`; константа не экспортируется | «5-секундный кэш» из комментариев `:148-156` и `:125-127` не существует: каждый `requireAuth` = verify JWT + Redis `GET revoked-jti` + `SELECT` пользователя. Нагрузка на БД/Redis на каждый API-запрос. Работает только дедуп параллельных запросов (`authUserInFlight`, `:69`) | Либо читать кэш в начале `resolveSessionUser`, либо удалить кэш и комментарии; проверить, что отзыв остаётся немедленным |
| 4 | важно | src/lib/rate-limiter.ts:478-505 + src/services/auth/auth-service.ts:79 (+ src/app/api/auth/login/route.ts:52) | Без `TRUST_PROXY=true` `getRateLimitIdentifier` возвращает `host-<Host>` → bucket `login-ip:host-…` один на весь домен | 20 попыток за 15 мин от кого угодно (или нормальные входы всех) → блок 30 мин **всем**: вход парализует предприятие. `scripts/validate-env.ts:133-136` сам пишет: «вход заблокируется сразу всем». Обратный риск: при `TRUST_PROXY=true` и открытом порте атакующий подделывает `x-forwarded-for` и получает безлимит ведер | Задать проверенный `TRUST_PROXY=true` при закрытом снаружи порте; для входа добавить в ключ ещё и e-mail (как в `mut:`-обёртке `api-wrapper.ts:186-201`) |
| 5 | важно | src/services/auth/auth-service.ts:79-82, 136-137 | Бакет `login-ip:<id>` не сбрасывается при успешном входе (сброс только `accountKey` и `lockoutKey`) — успешные входы тратят лимит 20/15 мин | Утренняя смена: бригада входит с одного IP (офис/NAT) — после 20 входов (включая успешные и опечатки) IP закрывается на 30 мин для всех | Сбрасывать IP-бакет при успешном входе либо считать только неудачные попытки |
| 6 | важно | src/services/auth/auth-service.ts:90-94 + src/lib/rate-limiter.ts:34-38 | Глобальный лок аккаунта по «голому» e-mail: `login-acct:<email>`, 10/15 мин, блок 15 мин — срабатывает до поиска пользователя и не зависит от IP | Посторонний, знающий e-mail единственного администратора, 10 запросами блокирует ему вход на 15 мин (DoS). Решение владельца 28.09.2026, но риск остаётся. Дополнительно: комментарий `:96-99` утверждает, что ключ scoped email+IP — коду `:90` это не соответствует | Осознанный выбор — оставить, но знать риск; уточнить комментарий; опционально сделать лок только по паре email+IP |
| 7 | важно | src/app/api/auth/logout/route.ts:18-23 + src/services/auth/session-service.ts:255-263 | `revokeSessionToken` возвращает `false` и когда токен **уже** недействителен (истёк, нет `jti`), и когда отказ записи в Redis. Маршрут в обоих случаях отдаёт 503 и куку не чистит | «Выход» с истёкшей/неразбираемой кукой всегда 503, кука остаётся в браузере (`logoutClient` по 503 локальный стейт не сбрасывает, `src/lib/api.ts:142-146`). Человек не может завершить сеанс кнопкой | Различать: недействительный токен → всё равно `clearSessionCookie()` + 200; 503 только когда денлист реально не записан |
| 8 | важно | src/services/auth/session-service.ts:141-154, 156-169 | Отзыв по принципу fail-open: при недоступности Redis (или `status !== 'ready'`) `isRevoked` → `false`, `revoke` → `false` | Вышедший или отозванный (после кражи) токен остаётся валиден до 12 ч. Документировано как осознанное на одном Redis, но окно реально есть | Смягчить: короткий TTL/ротация; индикатор недоступности денлиста в health; рассмотреть fail-closed для logout-пути |
| 9 | важно | ls src/app/api/auth; grep password src/app/api --include=route.ts | Нет пользовательской смены пароля и нет самостоятельного восстановления доступа | Единственный администратор забыл пароль — восстановление только через сервер (CLI-скрипт) или другого админа; полевой сотрудник не может сменить пароль сам | Добавить self-service смену пароля (со старой сессией) и описать процесс восстановления у одиночного админа |
| 10 | мелочь | src/services/auth/session-service.ts:287, 190-211 | Кука постоянная (12 ч), нет «выхода при закрытии», нет списка/отзыва других сессий; повторный вход не отзывает старый токен | Общий планшет на объекте: следующий человек застаёт чужую активную сессию, если предыдущий не нажал «Выход» | Явный «выход» на устройстве; опционально список активных сессий и «завершить все» |
| 11 | мелочь | src/services/auth/session-service.ts:284, 299 | `secure` включается только при `NODE_ENV === 'production'` | Если на боевой площадке `NODE_ENV` не `production`, кука уходит без `Secure` (по TLS-прокси — по HTTP-схеме внутри). Состояние окружения не проверено (`.env` читать запрещено) | Проверять наличие HTTPS/прокси, а не только `NODE_ENV`; префикс `__Host-` |
| 12 | мелочь | src/services/auth/session-service.ts:39, 84-85 | Принимаются токены версии 1 (без `tenantId`); сам комментарий `:84-85` пишет, что порядок работает «пока политики в режиме аудита», а `page-session.ts:20-22` говорит, что fail-closed включён с 19.08.2026 | Мёртвый путь: v1-токены (12 ч) давно истекли; новая выдача идёт с `v:2` (`:29`). Цена — путаница в коде | Убрать `1` из `ACCEPTED_SESSION_TOKEN_VERSIONS` следующим выкладочным изменением |
| 13 | мелочь | src/app/page.tsx:18-23 | Корневой редирект доверяет `payload.role` без проверки `isActive`/`sessionVersion` (денлист `verifySessionToken` проверяется) | Заблокированный/пониженный пользователь на долю секунды попадает на «домашний» маршрут роли, пока layout (`page-session.ts`) не отправит на `/login` | Проверять ту же свежесть через `readPageSessionUser` и до редиректа |
| 14 | мелочь | src/services/auth/auth-service.ts:145-149 (через `toSessionUser` :52-68, `session-service.ts:198`) | В тело ответа логина уходит `sessionVersion` | Клиенту этот счётчик не нужен; лишнее поле в контракте | Не включать `sessionVersion` в ответ |
| 15 | мелочь | src/lib/rate-limiter.ts:72, 88 (Redis) vs 287 (in-memory); 184-192 | Поведение лимита различается: Redis продлевает TTL счётчика на каждой попытке (скользящее окно), in-memory считает фиксированное окно от первой попытки; при недоступности Redis лимит становится per-process | Перезапуск/масштабирование ослабляет защиту от перебора; окна ведут себя непредсказуемо при отказе Redis | Унифицировать окна; для защиты от перебора иметь аварийный локальный лимит с явным поведением |
| 16 | мелочь | scripts/fix-passwords.sql:4-14 | «Хеши» — заглушки: проверено `node`+`bcryptjs`, `compareSync('admin123', hash) === false`, `compareSync('operator123', hash) === false`. В комментариях при этом писаны пароли | Скрипт ничего не чинит, но публикует пароли | Удалить или сгенерировать настоящие хеши и guard |
| 17 | мелочь | prisma/seed.ts:140-145, 35-38 | Фиксированные пароли dev-учёток (`admin123`, `operator123`, `sas02password` …), защита — только `assertNotProduction` (`NODE_ENV === 'production'`) | Если `NODE_ENV` на площадке не `production`, `npm run db:seed` создаст админа с известным паролем. Состояние окружения не проверено | Дополнительный guard по хосту/имени БД (как в `reset-one-password.ts:21-28`), пароли — только из env |

## Не проверено

- **Состояние боевого окружения** (`TRUST_PROXY`, `NODE_ENV`, `SESSION_SECRET`, `REDIS_URL`/`REDIS_URL_CACHE`, реальность учётки `sas02@rambler.ru`): читать `.env*` и ходить на прод запрещено правилами. Выводы №1, №4, №11, №17 опираются только на код.
- **Поведение Redis-денлиста в бою** (что «состояние» действительно `noeviction`, а не тот же инстанс, что кэш): следует из комментариев `redis-cache.ts:122-139` и `session-service.ts:86-94`, но живой конфигурации я не видел.
- **Тесты не запускались намеренно**: задача read-only и без прогона проверок §6 (tsc/lint/test/build требует окружения и `.env`, который запрещён). Поведение описывается по коду и существующим спекам, но сами спеки я не исполнял.
- **Кража токена и фактическая недоступность Redis** — сценарии не воспроизводились, только чтение кода.
- **`authorization-service.ts`/`resource-access-service.ts`** — просмотрены по касательной (не входят в пункты задания); отдельного разбора прав не делал.
- **Возможное пересечение с ранее закрытыми находками**: в `docs/audits/hermes-night/` есть отчёты про секреты и по rate-limit (видны по именам файлов), но читать их запрещено — совпадения не сверял.
