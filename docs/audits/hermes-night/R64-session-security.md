# R64 — Сессии, cookie `pt-session`, отзыв, CSRF и хвосты ПИН-входа

Отчёт только на чтение. Изменённых файлов нет. Все утверждения ниже — открытые
строки; где проверки не было, это сказано явно в разделе «Не проверено».

## Итог

- Найдено **22** замечания: **критично — 0**, **важно — 6**, **мелочь — 16**.
- Что подтверждено положительно: cookie `pt-session` ставится в одном месте и с
  полным набором флагов (`HttpOnly`, `SameSite=Lax`, `Secure` в проде, `Path=/`,
  `Max-Age` = TTL); выход **отзывает сессию на сервере** (список отозванных jti),
  а не только стирает cookie; смена пароля, смена роли и деактивация повышают
  `sessionVersion`, и он сверяется в каждом запросе (`lib/auth.ts:105`),
  в серверных раскладках (`lib/page-session.ts:63`) и перед выдачей ответа из
  кэша (`core/api-wrapper.ts:86-89`).
- Топ-5 по значимости:
  1. **Отзыв сессии «мягко» проваливается** при недоступности Redis: выход
     возвращает `{success:true}`, а запись в список отзыва не сделана
     (`services/auth/session-service.ts:155-166`, `:249-257`) — токен живёт до 12 ч.
  2. **Побочный эффект на GET**: `GET /api/reports/pdf?...` с датами запускает
     генерацию и постановку PDF в очередь (`app/api/reports/pdf/route.ts:169,179-182`),
     а GET не проходит CSRF (`lib/csrf-protection.ts:52-55`) при `SameSite=Lax`
     (`session-service.ts:279`) → запуск от имени жертвы переходом верхнего уровня.
     То же у `GET /api/reports/single-pdf` (`:137,146-148`).
  3. **Кэш разобранного пользователя (5 с) объявлен переменной модуля**
     (`lib/auth.ts:44`), тогда как в проекте для этого принято класть синглтоны в
     `globalThis` (`core/security/tenant-context.ts:30-47`) — выход и отзыв по
     `sessionVersion` до 5 с не действуют в других сборках.
  4. **Страницы `(app)` вне `/admin`, `(safety)`, `(readiness-admin)` защищены
     только клиентом** (`app/(app)/layout.tsx:291-343`): сервер отдаёт каркас без
     проверки сессии. Данных там сейчас нет (проверено: ни одна страница не читает
     БД), но любой будущий серверный компонент на этих путях отдаст данные анониму.
  5. **Скрипт дымовых проверок нерабочий**: `scripts/test-pilingtrack.sh:32-52`
     строит всю авторизацию на удалённом `POST /api/auth/pin` — на исправном
     приложении он показывает отказ.

## Методика

Поиск и чтение (все пути — от корня `D:\PillingR\wt-night`):

1. `search_files` по `pt-session`, `sessionVersion`, `PIN_LOOKUP_SECRET`,
   `withMutation`, `verifySessionToken|readSessionToken|revokeSessionToken`,
   `createSessionToken|attachSessionCookie`, `user.update`, `globalThis`,
   `WebSocketServer`, `middleware.ts`, `Access-Control-Allow-Origin`.
2. Прочитаны целиком: `src/services/auth/session-service.ts`,
   `src/services/auth/auth-service.ts`, `src/lib/auth.ts`, `src/lib/page-session.ts`,
   `src/lib/require-page-ability.ts`, `src/lib/csrf-protection.ts`,
   `src/core/api-wrapper.ts`, `src/app/api/auth/login|logout|me/route.ts`,
   `src/app/api/alerts/webhook/route.ts`, `src/proxy.ts`,
   `src/app/(app)/layout.tsx`, `src/app/page.tsx`,
   `src/app/api/readiness/_shared/route-adapter.ts`.
3. Сплошной машинный обход **всех 141** `src/app/api/**/route.ts` (node-скрипт,
   без записи в репозиторий): для каждого экспортированного HTTP-обработчика
   выведены метод и обёртка (`withApi` / `withMutation` / `withReadinessCommand` /
   ни одной), признак inline `withCsrf`, признак `requireAuth`. Отдельно —
   поиск GET-обработчиков с признаками записи (`.create(`, `.update(`, `enqueue`,
   `$executeRaw`, `generatePeriodPdf`) в теле обработчика.
4. Проверки отсутствия: `grep -rn session src/workers/` (пусто — фоновых путей с
   сессией нет), `grep -rn "use server" src/` (пусто — серверных экшенов нет),
   `ls middleware.ts src/middleware.ts` (нет — точка входа `src/proxy.ts`),
   `grep -rn "pinLookup|pinHash|PIN" src/ scripts/ e2e/ prisma/`.
5. История: `git log --stat bb40d7ed` (коммит удаления ПИН-входа 27.09) — по нему
   сверено, что именно должно было исчезнуть.
6. Кода не менял, проверки §6 AGENTS.md (tsc/lint/test/build) не запускал:
   задача на чтение.

### Паспорт сессии (по строкам)

| Что | Где | Значение |
|---|---|---|
| Имя cookie | `src/services/auth/session-service.ts:7` | `pt-session` |
| Установка cookie | `src/services/auth/session-service.ts:274-286` (`attachSessionCookie`), вызывается из `src/services/auth/auth-service.ts:177-181` (`createAuthenticatedResponse` ← `src/app/api/auth/login/route.ts:83`) | единственное место выдачи |
| Флаги | `session-service.ts:275-283` | `httpOnly: true` (:278), `sameSite: 'lax'` (:279), `secure: NODE_ENV === 'production'` (:280), `path: '/'` (:281), `maxAge: SESSION_TTL_SECONDS` (:282); `Domain` не задаётся; `expires` не задаётся |
| Удаление cookie | `session-service.ts:288-298` (`clearSessionCookie`) | те же флаги, `maxAge: 0`; вызывается из `auth-service.ts:183-187` |
| Срок жизни | `session-service.ts:8` (`12 * 60 * 60`), `:204` (`setExpirationTime`), `:282` (`maxAge`) | 12 ч, отсчёт от выдачи токена |
| Продление | нет | токен перевыпускается только при входе (`auth-service.ts:179`); маршрута refresh нет (`src/app/api/auth/` содержит только `login`, `logout`, `me`) |
| Отзыв при выходе | `src/app/api/auth/logout/route.ts:17-21` → `session-service.ts:249-258` → `:155-166` | запись `revoked-jti:<jti>` в Redis, TTL = остаток до `exp` |
| Проверка отзыва | `session-service.ts:231-240` (`verifySessionToken`) → `lib/auth.ts:75` | на каждом запросе, до обращения к кэшу |
| `sessionVersion` | `lib/types` → `prisma/schema.prisma:108`; повышение: `src/services/users/user-service.ts:231-233` (пароль/деактивация), `:244-246` (роль) | сверка: `lib/auth.ts:105`, `lib/page-session.ts:63` |
| Проверка при каждом запросе | `lib/auth.ts:68-146` (`resolveSessionUser`, кэш 5 с), вызывается `requireAuth` (`:158`) из каждого маршрута и из `core/api-wrapper.ts:89` | роль берётся из строки БД, не из токена |
| Фоновые пути | `grep -rn session src/workers/` — пусто; `src/workers/unified-worker.ts` | сессий нет: воркеры и outbox работают системным актором, `sessionVersion` там не проверяется и нечего проверять |
| CSRF | `src/core/api-wrapper.ts:183-184` (`withMutation` → `withCsrf`), правила — `src/lib/csrf-protection.ts:42-117` | исключения: `:28-33` |

Обходы CSRF (полный разбор, а не выборка): из 107 изменяющих обработчиков
CSRF не применяется к шести — `POST /api/auth/login` (`route.ts:16`, путь в
исключениях `csrf-protection.ts:31`), `POST /api/telemetry/ingest:95`,
`PATCH /api/telemetry/ingest:138` (ключ устройства, `x-device-key`,
`telemetry/ingest/route.ts:60-63` — сессии нет), `POST /api/alerts/webhook:85`
(общий секрет, `:74-83`, сессии нет), `POST /api/orion/lead:55` (публичная
форма, замороженная зона). `POST /api/telemetry` (`:83-85`) и
`POST /api/telemetry/batch` (`:64-66`) обёрнуты `withApi`, но вызывают
`withCsrf` inline — проверка есть. `export const PATCH = POST` в
`app/api/feedback/events/route.ts:196` — не обход: это тот же обёрнутый
обработчик.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 1 | важно | `src/services/auth/session-service.ts:155-166`, `:249-257`; `src/app/api/auth/logout/route.ts:17-21` | Отзыв «мягко» проваливается: при недоступном Redis `revoke()` пишет только `logger.warn` («revocation NOT persisted», `:158`) и возвращает `void`, а `revokeSessionToken` всё равно отвечает `true` (`:256-257`). `isRevoked` в этом состоянии тоже возвращает `false` (`:140`, `:145` — пока `status !== 'ready'`). | Перезапуск/авария Redis (или окно холодного старта после деплоя): админ жмёт «Выйти», получает `{success:true}` и стирание cookie, но серверная сессия остаётся валидной до 12 ч. Украденная копия cookie продолжает работать, а журнал показывает успешный выход (`route.ts:24-31`). | Не считать выход успешным, если запись в список отзыва не удалась (5xx и явный текст), и/или на выходе повышать `User.sessionVersion` — тогда отзыв не зависит от Redis. Вариант «дёшево»: `revoke()` возвращает признак записи, `revokeSessionToken` его пробрасывает, маршрут на `false` отвечает 503. |
| 2 | важно | `src/app/api/reports/pdf/route.ts:169,179-182` → `:103` (`enqueuePdfGeneration`), `:120` (`generatePeriodPdf`) | GET-обработчик с побочным эффектом: при `dateFrom`+`dateTo` (или `sync=1`) запускает сбор данных, генерацию PDF и постановку задачи в очередь. CSRF к GET не применяется (`src/lib/csrf-protection.ts:52-55`), а cookie `SameSite=Lax` (`session-service.ts:279`) отправляется при переходе верхнего уровня. | Атакующая страница делает `window.location = '/api/reports/pdf?dateFrom=…&dateTo=…'` (или авто-submit формы GET) — браузер жертвы с валидной cookie запускает тяжёлую генерацию и забивает очередь BullMQ. Лимита мутаций нет (маршрут — `withApi`, `:221`). Право требуется только `reports.read_all` (`:231`), то есть диспетчер/админ уязвимы. | Побочный эффект — только POST (с CSRF и лимитом); на GET оставить статус/скачивание. Если GET обязателен (ссылка из письма) — отдельный узкий лимит на генерацию и/или одноразовый параметр-токен. |
| 3 | важно | `src/app/api/reports/single-pdf/route.ts:137,146-148` (`handleSyncGeneration`), `:152` | То же, что №2, для одного отчёта: `GET /api/reports/single-pdf?reportId=…` синхронно генерирует PDF. | Переход верхнего уровня по ссылке запускает генерацию от имени жертвы; синхронный путь держит воркер и CPU. | Как в №2. |
| 4 | важно | `src/lib/auth.ts:44-45` (кэш), `:133-136` (запись), `:153-156` (`clearAuthUserCacheEntry`) | `authUserCache`/`authUserInFlight` — переменные модуля, а не `globalThis`. В проекте для ровно этой причины синглтоны кладут в `globalThis`: `src/core/security/tenant-context.ts:30-47`, `src/core/security/tenant-rls.ts:31-33`, `src/lib/db.ts:31` («сборок несколько»). | После «Выйти» отозванный токен ещё до 5 с отдаётся из кэша **другой** сборки/экземпляра: выход стирает запись только у себя (`clearAuthUserCacheEntry`). То же окно — для отзыва по `sessionVersion` (смена роли/пароля/блокировка). Наблюдаемо как «после выхода страница ещё открыта» и «заблокированный пользователь успевает сделать запрос». | Перенести кэш в `globalThis` по образцу `tenant-context.ts`; заодно покрыть тестом. (Степень реального дублирования инстансов в прод-сборке не измерял — см. «Не проверено».) |
| 5 | важно | `src/app/(app)/layout.tsx:291-343` | Единственная защита страниц `(app)` вне `/admin`, `/(safety)`, `/(readiness-admin)` — клиентская: `'use client'` (`:1`), `probeSession()` (`:298-320`) и `router.replace('/login')` (`:339-343`). Сервер по этим адресам отдаёт HTML без проверки сессии. Для сравнения, `/admin/**` защищён на сервере: `src/lib/require-page-ability.ts:6-9` (`readPageSessionUser` + `can`) в раскладках `src/app/(app)/admin/*/layout.tsx`, `src/app/(app)/admin/page.tsx:6`. | Данных сейчас нет — проверил: ни одна страница в `src/app` не импортирует `@/lib/db` и не делает серверных выборок; `(app)/operator/page.tsx` и `(app)/assistant/page.tsx` только рендерят клиентские компоненты, остальные (`/report`, `/history`, `/inspections`, `/monitoring`) — `'use client'`. Но инвариант «страница отдаёт данные только после проверки сессии» держится на дисциплине автора: первое же серверное чтение на этих путях отдаст данные анониму. Ровно тот класс, что описан в `src/lib/page-session.ts:10-22` (инцидент 19.08.2026). | Либо сделать `src/app/(app)/layout.tsx` серверным с `readPageSessionUser`, либо добавить `requirePageAbility`/`readPageSessionUser` в страницы `(app)` вне админки. |
| 6 | важно | `scripts/test-pilingtrack.sh:32,39,43,47,51-52` | Весь раздел «Аутентификация» и все защищённые проверки после него построены на `POST /api/auth/pin`, удалённом коммитом `bb40d7ed` (27.09): в `src/app/api/auth/` только `login`, `logout`, `me`. Плюс разбор ответа через `python3` (`:40,44,48`), которого на машине нет. | Запуск дымового скрипта на исправном приложении даёт «НЕУДАЧА» на входе и далее по цепочке — ложный сигнал «система сломана», из-за чего реальная поломка перестанет замечаться (та же ловушка, что описана в AGENTS.md §4 про Playwright). | Переписать на `POST /api/auth/login` с паролем (`tests`-креды) и разбор через `node`; либо удалить скрипт, если он вытеснен `npm run test`. |
| 7 | мелочь | `src/lib/csrf-protection.ts:28-33` | `/api/auth/login` освобождён от CSRF. Для этого нет технической причины: проверка `withCsrf` (Origin/Sec-Fetch-Site/Referer) не требует cookie сессии и на входе работает так же, как везде (`:57-115`). Комментарий `:26-27` мотивирует исключение только для «неаутентифицированных точек входа». | Login CSRF: сторонний сайт POST-ом логинит браузер жертвы в аккаунт, который контролирует атакующий; жертва дальше ведёт отчёты в чужом аккаунте, а атакующий их читает. `SameSite=Lax` от этого не защищает — cookie жертвы при входе не участвует. | Убрать `/api/auth/login` из исключений (оставить `me`, `ready`, `health`) или явно записать в коде, почему Origin-проверка нежелательна. |
| 8 | мелочь | `src/services/auth/session-service.ts:274-286` | Имя cookie — `pt-session`, без префикса `__Host-`. `Domain` не задаётся (cookie host-only), но поддомен может выставить свою `pt-session` с `Domain` родителя, и браузер отправит обе. | Подмена/неоднозначность cookie (cookie shadowing) и фиксация сессии: сервер читает `request.cookies.get(...)` — первую по порядку, поведение зависит от браузера. Появляется при первом же поддомене (`app.example.com` + `www.example.com`). | `__Host-pt-session`: префикс требует `Secure`, `Path=/` и запрещает `Domain` — все три условия уже выполняются в проде. |
| 9 | мелочь | `src/services/auth/session-service.ts:8,204,282` | Сессия — ровно 12 ч от выдачи, продления нет; cookie `Max-Age` = TTL токена, `expires` не ставится. | Для смены длиннее 12 ч пользователь выкидывается на `/login` посреди работы (в 12 ч токен просто истекает — `verifyTokenSignature` вернёт null, `lib/auth.ts:75-78` → 401). Для украденного токена окно тоже ровно 12 ч. | Решить продуктово: либо абсолютный TTL + предупреждение у конца срока, либо sliding renewal (перевыпуск токена при активности с записью `jti` в состояние). |
| 10 | мелочь | `src/services/auth/session-service.ts:260-272` | Токен принимается не только из cookie, но и из `Authorization: Bearer` (`:266-269`). Cookie-проверки (CSRF) к таким клиентам не применяются, а токен — та же пользовательская сессия на 12 ч. | Токен, попавший в лог/скрипт/URL (например, `load-tests/generate-session.ts:36-39` печатает его в консоль), можно предъявить с любого не-браузерного клиента; CSRF-защита на него не распространяется. | Зафиксировать решение в комментарии: Bearer оставлен для машинных каналов (телеметрия/нагрузка) — или ограничить его приём отдельным признаком (например, только для `x-device-key`-маршрутов). |
| 11 | мелочь | `src/lib/api.ts:135-143`; `src/app/api/auth/logout/route.ts:12-21` | Клиент не смотрит на результат выхода: `logoutClient` очищает локальное состояние в `finally` независимо от ответа, а cookie — `HttpOnly` (`session-service.ts:278`), стереть её из JS нельзя. Маршрут на неудачу отдаёт 403 (CSRF) или 5xx, оставаясь с прежней cookie. | Ответ 403 (например, прокси съел `Origin`/`Sec-Fetch-Site`, или `Host` не совпал — `csrf-protection.ts:59,76`) или 500: пользователь видит «Выйти» выполненным, после перезагрузки снова в системе. На общем терминале это выглядит как «выход не работает» и ведёт к работе под чужой учёткой. | Считать выход выполненным только при `res.ok` (401 трактовать как «уже не авторизован»), иначе показать ошибку и оставить состояние сессии. |
| 12 | мелочь | `src/app/page.tsx:18-23` | Корневой редирект доверяет данным токена: `verifySessionToken` проверяет подпись и список отзыва (`session-service.ts:231-240`), но не `sessionVersion` и не `isActive` — эти сверки живут в `lib/auth.ts:105` и `lib/page-session.ts:63`. `roleHomeRoute(payload.role)` строится по роли из токена. | Пользователя понизили в роли или деактивировали, он открывает `/` → его отправляют на главную **прежней** роли, а оттуда раскладка (`readPageSessionUser`) отправляет на `/login`. Вместо «вы в другой роли» — выброс из системы, а при похожих ветках — тот самый цикл переходов, что разбирали в `page-session.ts:10-22` (инцидент 19.08.2026). | Использовать `readPageSessionUser()` и решать по данным БД (`roleHomeRoute(user.role)`), а токен — только для проверки подписи. |
| 13 | мелочь | `src/proxy.ts:19-33,219-222` | CORS с `Access-Control-Allow-Credentials: true` и списком, куда безусловно входят `http://localhost:3000` и `http://127.0.0.1:3000` (`:19` — без ветки по `NODE_ENV`), плюс поддержка шаблона `*.example.com` (`:48-53`). | Ответы GET можно читать с этих источников. Сегодня это не даёт доступа: `SameSite=Lax` не отправляет cookie при межсайтовом XHR. Но стоит кому-то добавить поддомен в `CORS_ALLOWED_ORIGINS` — и любой поддомен (в том числе скомпрометированный) читает данные с сессией: для same-site запроса cookie уйдёт. Значения `CORS_ALLOWED_ORIGINS`/`NEXT_PUBLIC_APP_URL` не читал (.env вне доступа) — **не проверено**, сценарий условный. | Убрать localhost-источники из прод-ветки (по `NODE_ENV`), не использовать wildcard-поддомены в списке с credentials. |
| 14 | мелочь | `src/services/audit/audit-service.ts:341-363` | Мёртвые карты событий `auth.pin.succeeded` / `auth.pin.failed` / `auth.pin.rate_limited`: ни одного `recordAuditEvent({action:'auth.pin…'})` в `src/` не осталось (проверено поиском), сам маршрут удалён `bb40d7ed`. | В справочнике журнала навсегда остаются формулировки о ПИН-входе; читатель журнала ищет вход, которого больше нет, и не понимает, был ли он выключен или сломан. | Удалить три записи (ничто на них не ссылается). |
| 15 | мелочь | `scripts/add-runtime.js:10`; `src/lib/__tests__/rate-limiter.test.ts:162`; `src/app/api/users/__tests__/route.test.ts:82-85`; `src/core/__tests__/api-wrapper.test.ts:228`; `src/core/security/identity-role.ts:12`; `scripts/identity-role-grants.sql:56,63`; `docker-compose.yml:102,189` | Хвосты удалённого ПИН-входа: скрипт до сих пор перечисляет несуществующий `src/app/api/auth/pin/route.ts` (`add-runtime.js:10`); тест rate-limiter использует `/api/auth/pin` как образец пути; тест маршрута пользователей шлёт `pin` в теле (поле вырезано схемой — `validation-schemas.ts:38-45`); фикстура Prisma ссылается на `pinLookup`; комментарии в `identity-role.ts:12` и `docker-compose.yml:102,189` перечисляют ПИН-поиск; SQL-гранты `pilingtrack_identity` всё ещё включают колонки `pin`,`pinLookup` (`GRANT SELECT/UPDATE`). | Хвосты вводят в заблуждение: документация и гранты описывают путь опознания, которого нет; лишние гранты на секретные колонки останутся и после их удаления. При этом `pin`-тест «зелёный» лишь потому, что zod молча вырезает неизвестные поля — он уже не проверяет то, о чём написано в комментарии. | Почистить перечисленные строки вместе с миграцией на удаление колонок; `identity-role-grants.sql` привести к фактическому набору полей. |
| 16 | мелочь | `prisma/schema.prisma:99,103`; `Dockerfile:26`; `.env.production.example:13` | Поля `User.pin` и `User.pinLookup` остались в схеме и в БД (удаление вынесено в отдельную миграцию — см. послание коммита `bb40d7ed`, `docs/deploy`). `PIN_LOOKUP_SECRET` по-прежнему описан как обязательный, но кодом не читается (подробно — R61, `docs/audits/hermes-night/R61-env-vars.md:26`). | В базе остаются секреты ПИН-кодов (хеши/HMAC-индексы) пользователей, которые больше не могут войти; секрет `PIN_LOOKUP_SECRET` генерируют, хранят и требуют при развёртывании ради ничего. | Отдельной миграцией удалить колонки и индексы (`User_pin_key`, `User_pinLookup_key` — `prisma/migrations/20260419190903_init/migration.sql:718,721`), затем убрать имя секрета из `Dockerfile`, `.env.production.example`, `docs/deployment.md:48`, `README.md:165`. |
| 17 | мелочь | `e2e/page-objects/login.page.ts:15-16,24-25,74-77` | В Page Object остались `pinInput`, `pinLoginButton` и `loginWithPin()`, которые нигде не вызываются, а кнопки с именем /pin/ на экране входа нет (вход — только пароль: `src/components/piling/login-page.tsx:17,133-143`). | Мёртвый код в тестовом слое выглядит как непокрытый сценарий: следующий читатель решит, что ПИН-вход существует, и напишет спек, который не соберётся. | Удалить три члена Page Object вместе с ПИН-хвостами (тогда `npx playwright test --list` не изменится — проверить до и после). |
| 18 | мелочь | `src/services/auth/session-service.ts:105-131` | Хранилище отзыва заводит **второе** соединение к тому же инстансу состояния (`new Redis(process.env.REDIS_URL)`) вместо общего `getStateRedisClient()` (`src/lib/redis-cache.ts:136-139`). | Дублирование пула соединений и ветка «второе соединение не поднялось → `initFailed` → отзыв навсегда выключен в этом процессе» (`:110-113,126-130`), не видная в health: `/api/health` смотрит другое соединение. | Использовать `getStateRedisClient()` (он уже гарантирует инстанс `REDIS_URL` и общий пул). |
| 19 | мелочь | `src/services/auth/session-service.ts:66-83,280` | И `Secure` cookie, и dev-подстановка секрета зависят только от `NODE_ENV`. `NODE_ENV=production` приходит из образа (`Dockerfile:22,86`), а не из Compose (`docker-compose.yml:72,159` задаёт его дублирующе). | Если образ когда-нибудь запустят без `NODE_ENV` (ручной запуск, стенд, отладка), cookie перестанет быть `Secure`, а токены начнут подписываться публично известной строкой `dev-only-session-secret-change-me` (`:79`) — подделку токена с любой ролью это открывает полностью. | Жёстко требовать `SESSION_SECRET` при `NODE_ENV !== 'test'`, либо отдельным флагом (`ALLOW_DEV_SESSION_SECRET`), а не по «не-production». |
| 20 | мелочь | `src/app/api/auth/logout/route.ts:12-21`; `src/services/users/user-service.ts:231-233,244-246` | Выход отзывает только текущий `jti` и **не** повышает `sessionVersion`. Отдельного «выйти на всех устройствах» нет; «завершить все сессии пользователя» администратор может только деактивацией/сменой роли/сбросом пароля. | Потерянный телефон: смена пароля отзывает все сессии (правильно), но просто «Выйти» с другого устройства не помогает — сессия на потерянном жива до 12 ч. Нет и журнальной записи о «выходе со всех». | Добавить в карточку пользователя действие «завершить все сессии» (бамп `sessionVersion`) — отдельная задача, не в этом отчёте. |
| 21 | мелочь | `src/app/api/alerts/webhook/route.ts:85-88`; `src/app/api/orion/lead/route.ts:55`; `src/app/api/telemetry/ingest/route.ts:95,138` | Четыре изменяющих маршрута вне `withMutation`. Все четыре — вне сессии: shared-secret (`alerts/webhook`), ключ устройства (`telemetry/ingest`), публичная форма (frozen `orion/lead`). | Не дефект, а осознанные исключения: CSRF там нечем защищать, потому что нет cookie-сессии. Фиксирую, чтобы следующий аудит не открывал их заново и чтобы они не стали образцом для новых маршрутов. | Добавить в шапки этих файлов одну строку: «обёртка пропущена намеренно, сессии нет, проверка — <механизм>». |
| 22 | мелочь | `load-tests/generate-session.ts:13-16,26,38` | Утилита выдаёт валидную сессию для первого активного пользователя **без пароля** (нужны БД и `SESSION_SECRET`); `createSessionToken` вызван без `await` (печатает `[object Promise]`), подсказка говорит про cookie `session=`, тогда как имя — `pt-session` (`session-service.ts:7`). | Сама по себе доступа не даёт (нужен секрет), но это готовый обход пароля в репозитории: попав в образ/на стенд, она позволяет подделать сессию любого пользователя. Плюс утилита нерабочая (повтор находки R58, `docs/audits/hermes-night/R58-load-tests.md:48`). | Добавить `await` и правильное имя cookie либо удалить утилиту; исключить `load-tests/` из образа. |

## Не проверено

- **Значения окружения** — `.env`, `.env.production.example` (кроме факта наличия
  строки `PIN_LOOKUP_SECRET`, подтверждённого R61), а также `CORS_ALLOWED_ORIGINS`,
  `NEXT_PUBLIC_APP_URL`, `MULTI_TENANT_MODE`, `TRUST_PROXY`: файлы и значения вне
  доступа по AGENTS.md §1. Поэтому длина/уникальность `SESSION_SECRET` и реальный
  состав CORS-списка в проде не подтверждены (находка №13 условна).
- **Фактическая дублируемость модульных инстансов `lib/auth`** в прод-сборке
  Next.js не измерялась: вывод №4 опирается на конвенцию проекта
  (`tenant-context.ts:30-47`) и на комментарии о нескольких сборках, а не на
  замер. Надо воспроизвести (два обращения через разные маршруты после выхода).
- **Прод-БД и Redis не проверялись**: остались ли значения в `User.pin/pinLookup`,
  доступен ли Redis и режим `noeviction` — нет доступа, не подключался.
- **Runtime-проверок не выполнял вообще**: `npx tsc --noEmit`, `npm run lint`,
  `npm run test:unit`, `npx playwright test --list`, `npm run build` не
  запускались — это отчёт на чтение, кода я не менял. Все заявления — из
  прочитанных строк.
- **WS-сервер**: `src/core/realtime` в этом worktree отсутствует целиком
  (`ls src/core/` — только `api-wrapper.ts`, `cache`, `security`, …), хотя
  `docs/audits/codex-security-review-2026-09-24.md:135-137` описывает одноразовую
  WS-аутентификацию и отсутствие перепроверки прав. Проверить нечего; если WS
  вернётся, вопрос «sessionVersion на живом соединении» придётся закрывать заново.
- **Поведение в браузере** (наличие/отсутствие `Origin` и `Sec-Fetch-Site` в
  разных браузерах для `POST /api/auth/logout` и для GET-перехода) не
  воспроизводил — рассуждения о `SameSite=Lax` основаны на спецификации и на
  комментариях тестов `src/lib/__tests__/csrf-protection.test.ts:92-120`.
- **Юнит-тесты сессий** (`src/services/auth/__tests__/session-service.test.ts`)
  прочитаны выборочно; полного анализа покрытия (что именно не проверено тестами)
  в этом отчёте нет.
