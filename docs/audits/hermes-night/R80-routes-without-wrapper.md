# R80 — маршруты src/app/api без обёртки: CSRF, лимит, сессия

## Итог

Проверены все **141** файла `src/app/api/**/route.ts` — метод за методом, **202** экспортируемых
обработчика, из них **109** изменяющих (POST/PUT/PATCH/DELETE).
Выводов два: правило проекта соблюдается, но ровно там, где его **не проверяет** тест-контракт
(`src/app/api/__tests__/api-routes.test.ts`), накопились отклонения.

- **критично: 0.** Изменяющий маршрут без CSRF и без сессии не найден. Ни один GET не меняет состояние
  (проверено статически по телу обработчика, список глаголов — в «Методике»).
- **важно: 4.** (1) Ручной лимит телеметрии/формы ORION ключуется голым IP без имени маршрута: четыре
  маршрута делят одну корзину и один блок-ключ, а пороги у них разные (1000/60 с и 5/600 с).
  (2) Три маршрута телеметрии изменяют данные через `withApi` с ручным CSRF/лимитом вместо `withMutation`.
  (3–4) Тест-контракт маршрутов проверяет личность **по файлу**, а CSRF — по методу, и считает `withCsrf`
  достаточным доказательством защиты; лимиты не проверяет вообще.
- **мелочь: 10.** Все — осознанные отклонения с обоснованием (вебхук Alertmanager, ключ устройства, пробы
  живости, SSE-поток), плюс два места, где отклонения нет, но обёртки выглядят подозрительно.

Топ-5 по риску (подробно в «Находках»):
1. `telemetry/route.ts:88-89` + `telemetry/batch/route.ts:68-69` + `telemetry/ingest/route.ts:99,141` +
   `orion/lead/route.ts:56` — общий ключ лимита `rl:<ip>`: 5 заявок с публичной формы ORION закрывают на
   30 минут приём телеметрии с того же адреса, и наоборот; при `TRUST_PROXY` ≠ `true` корзина одна на всех.
2. `telemetry/route.ts:83`, `telemetry/batch/route.ts:64`, `telemetry/ingest/route.ts:95,138` — изменяющие
   методы через `withApi`: лимит обёртки (per-route ключ, `mut:source:`) к ним не применяется.
3. `api-routes.test.ts:294-301` — проверка «есть проверка личности» идёт по файлу, а не по методу.
4. `api-routes.test.ts:174` — `withCsrf` в списке CSRF-защит, поэтому ручной вызов CSRF проходит контракт,
   минуя `withMutation`; лимит не проверяется ни одним тестом.
5. `telemetry/ingest/route.ts:95,138` — POST/PATCH без `withCsrf` вообще (обосновано: ключ устройства в
   заголовке, запись в списке исключений `api-routes.test.ts:203-204`).

## Методика

Что и как искалось (всё воспроизводимо на этой ветке, файлы не менялись):

1. **Полный обход.** Все 141 `route.ts` найдены обходом `src/app/api` (вне этой папки файлов `route.ts` нет —
   проверено обходом всего `src/`). Для каждого файла из каждой строки вида
   `export (const|async function|function) GET|POST|PUT|PATCH|DELETE` взята обёртка из правой части
   (`withApi` / `withMutation` / `withReadinessCommand` / псевдоним `PATCH = POST` / пусто) — Приложение А.
2. **Тело обработчика, а не файл.** Для каждой находки объявление метода срезано «от export до следующего
   export» (та же логика, что в тест-контракте) и внутри искались: `requireAuth`,
   `resolveReadinessRequestContext`, `authenticateDevice(ByKey)`, `withCsrf`, `rateLimiter.check`,
   `assertCan|assertRole|assertAnyRole|can(`, `capabilities.has`.
3. **Поиск «GET меняет состояние».** Тело каждого экспортированного GET просканировано регуляркой по
   глаголам записи и побочных эффектов: `create|createMany|update|updateMany|upsert|delete|deleteMany|
   $executeRaw|sendMessage|sendAlert|publish|invalidate*|record*|save*|insert|remove|mark*|revoke|approve|
   reject|sign|complete*|ingest|flush|touch|heartbeat|ensure*|rebuild|refresh|sync|register|emit|purge|
   cleanup|reset*|write*`. Совпадение одно — `cleanup()` в `feedback/stream` (таймер в памяти, не данные).
4. **Поиск ручного CSRF/лимита.** `grep` по `src/app/api` на `withCsrf(` и `rateLimiter.check(` — 5 мест,
   все в телеметрии + `orion/lead` + два GET-лимита PDF.
5. **Ключи лимитов.** `rateLimiter.check(` по всему `src/` (7 мест) и `getRateLimitIdentifier(request)`
   (7 мест) — сверено, какой ключ получается и по какой формуле (`rate-limiter.ts:208-209`, `:499-505`).
6. **Сверка с контрактом.** Открыт `src/app/api/__tests__/api-routes.test.ts` — там уже есть нормативные
   списки исключений (`PUBLIC_ROUTES:183`, `CSRF_EXEMPT_METHODS:199`, `NO_WRAPPER_METHODS:208`). Отклонения
   ниже — то, что этими списками **не** покрыто; каждое осознанное отклонение, найденное в коде, сверено
   со списком и с комментарием в файле.
7. **Проверка прав (п. 4 задачи).** 15 изменяющих обработчиков, в которых нет именованного
   `assertCan`/`assertRole` (только `requireAuth`, список — находка №14), открыты вручную: право
   проверяется сервисом, хелпером с другим именем (`assertCanAccessMedia*`) либо передачей `can(actor, …)`.

Ложный класс, который надо знать при повторном прогоне: 23 изменяющих метода в 29 файлах
`src/app/api/readiness/**` выглядят «без обёртки», если искать только `withApi`/`withMutation`. Они закрыты
`withReadinessCommand` (`src/app/api/readiness/_shared/route-adapter.ts:17`), а тот внутри — `withMutation`,
то есть CSRF и лимит на месте. Текстовый сканер без учёта адаптера даёт 23 ложные находки — проверено,
первый прогон их и дал.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как проверить эксплуатацию (без выполнения) | предлагаемое исправление |
|---|---|---|---|---|---|---|
| 1 | важно | `src/app/api/telemetry/route.ts:88-89`, `src/app/api/telemetry/batch/route.ts:68-69`, `src/app/api/telemetry/ingest/route.ts:99-100` и `:141-142`, `src/app/api/orion/lead/route.ts:56` | Ключ лимита — голый `getRateLimitIdentifier(request)` без имени маршрута (`rate-limiter.ts:499-505`), поэтому Redis-ключ `rl:<ip>` (`rate-limiter.ts:208-209`) **общий** для 4 маршрутов, а блок-ключ `rl:blocked:<ip>` — один; пороги при этом разные: телеметрия 1000/60 с (`telemetry/route.ts:43-47`), форма ORION 5/600 с (`orion/lead/route.ts:34-38`) | Один счётчик с разными порогами означает, что маршруты останавливают друг друга: 5 заявок с публичной формы ORION блокируют на 30 мин (`blockDurationMs`) приём телеметрии с того же адреса, а поток телеметрии — приём заявок. При `TRUST_PROXY` ≠ `true` ключ становится `host-<домен>` (`rate-limiter.ts:504`) — корзина одна на всех: любой анонимный посетитель останавливает и заявки, и телеметрию сразу всем. В остальных местах ключи префиксованы: `mut:<путь>:<сессия>:<ip>` (`api-wrapper.ts:212`), `login-ip:<ip>` (`auth-service.ts:109`), `pdf:get:<user>` (`reports/pdf/route.ts:244`) — то есть это отклонение от собственного правила проекта, а не стиль | Пользовательский сценарий: отправить 5 заявок подряд с одного IP и в течение следующих 30 минут обратиться к `/api/telemetry/ingest` — ожидать 429 с `Retry-After`. Внутренняя проверка без нагрузки: `redis-cli keys 'rl:*'` после одного запроса к каждому из маршрутов — один и тот же ключ без пути. Значение `TRUST_PROXY` в контейнере: `docker compose exec app printenv TRUST_PROXY` (по `docker-compose.yml:123` ожидается `true`) | Взять ключ с префиксом и путём: `telemetry:${request.nextUrl.pathname}:${ip}` и `lead:${ip}`; для телеметрии — либо `withMutation` с `{ rateLimit: … }` (опция уже есть, `api-wrapper.ts:22`), либо общий хелпер, чтобы ключ нельзя было задать голым |
| 2 | важно | `src/app/api/telemetry/route.ts:83-101`, `src/app/api/telemetry/batch/route.ts:64-75`, `src/app/api/telemetry/ingest/route.ts:95-106` и `:138-148` | Изменяющие методы (POST, POST, POST/PATCH) обёрнуты `withApi`, а CSRF и лимит продублированы внутри обработчика. Правило проекта: POST/PUT/PATCH/DELETE — `withMutation`, «CSRF и лимит внутри маршрута не дублируются» (AGENTS.md §3). Обёртка `withApi` (`api-wrapper.ts:62-147`) не даёт ни CSRF, ни лимита — защита есть только потому, что её вписали руками в двух файлах из трёх | Что теряется на деле: двухступенчатый лимит обёртки (`mut:source:` 1800/мин по IP плюс per-route ключ, `api-wrapper.ts:201-219`) к этим маршрутам не применяется; исключение из правила живёт, пока кто-то помнит про ручной вызов. Правка политики в `withMutation` эти три маршрута не затронет. Тест-контракт их пропускает, потому что считает `withCsrf` достаточной защитой (`api-routes.test.ts:174`) | Сравнить в файле: `withMutation` → внутри CSRF (`api-wrapper.ts:183-184`) и лимит (`:201-219`); в `telemetry/route.ts` те же действия повторены строками `84-85` и `88-101`. Проверка на регрессию: удалить строку `if (csrfCheck) return csrfCheck;` в копии — тест `api-routes.test.ts` останется зелёным (он увидит `withCsrf` в тексте), а защита исчезнет | `export const POST = withMutation(handler, { rateLimit: { maxAttempts: 1000, windowMs: 60_000, blockDurationMs: 60_000 } })` — опция `rateLimit` уже поддержана (`api-wrapper.ts:21-22`, применяется на `:213`); тогда ручные `withCsrf` и `rateLimiter.check` из обработчика убираются |
| 3 | важно | `src/app/api/__tests__/api-routes.test.ts:294-301` | Проверка «каждый маршрут либо проверяет личность, либо назван публичным» идёт по **файлу**: `.filter((r) => !AUTH_GATES.some((gate) => r.source.includes(gate)))`. Проверки CSRF (`:303-311`) и обёртки (`:313-319`) — по методу (`m.declaration`) | Дыра ровно в том классе ошибок, ради которого тест написан: стоит в файле с уже защищённым GET добавить второй метод (POST/PUT/DELETE) без `requireAuth` — файл остаётся «защищённым», тест зелёный, маршрут открыт. В комментарии к тесту (`:148-151`) этот случай описан для CSRF («place-presets: POST через withReadinessCommand, а DELETE не закрыт ничем — файл считался закрытым»), но для личности файловая проверка осталась | Прочитать `:294-301` рядом с `:303-311` (там `m.declaration`). Наблюдать на текущем дереве: ни один маршрут по этой проверке не падает, хотя `readiness/place-presets/route.ts:91` (DELETE) не содержит `requireAuth` внутри своего объявления — файл защищён только соседним методом. Регрессия: добавить в копии файла метод без проверки и прогнать `npm run test:unit` — тест не покраснеет | Проверять личность так же, как CSRF: по `m.declaration` (`sliceMethod` уже есть, `:239`), а список публичных перевести на ключи `путь#МЕТОД`, как в `CSRF_EXEMPT_METHODS` |
| 4 | важно | `src/app/api/__tests__/api-routes.test.ts:174` (`CSRF_GATES = ['withMutation','withReadinessCommand','withCsrf','withOperatorV3Command']`) | Ручной `withCsrf` засчитывается как полноценная защита изменяющего метода, а лимит запросов не проверяется ни одним тестом в проекте | Отсюда и живут находки №1–2: контракт «маршрут закрыт от межсайтового вызова» выполняется вызовом `withCsrf` в теле, а требование «даёт CSRF **и лимит**» (AGENTS.md §3) нигде не выражено. Формально «правило проверяется тестом», фактически проверяется только половина правила | Прочитать `:174` и `:303-311`: `withCsrf` в списке, лимита (`rateLimiter`/`rateLimit`) в списках нет вообще. Регрессия: в копии заменить в `telemetry/route.ts` `withApi` на `withMutation` и убрать ручные проверки — число падений в тест-файле не изменится | Либо запретить `withCsrf` в списке (изменяющий метод обязан быть на `withMutation`/`withReadinessCommand`, исключения — в `CSRF_EXEMPT_METHODS` с причиной), либо добавить проверку, что при ручной защите лимит тоже вызван |
| 5 | мелочь | `src/app/api/telemetry/ingest/route.ts:95` (POST) и `:138` (PATCH) | Изменяющие методы без `withCsrf` вообще; личность даёт ключ устройства в заголовке `X-Device-Key` (`:60-89`), обоснование записано в список исключений (`api-routes.test.ts:203-204`) | Отклонение осознанное и по существу верное: браузер с чужой страницы не может подставить свой заголовок без preflight, угонять нечего. Но это **единственное**, что держит маршрут: обёртки нет, лимита обёртки нет, а единственный лимит — общий с находкой №1 | `authenticateDevice` возвращает 401 без заголовка (`:65-74`) и 403 при неверном ключе (`:78-86`); проверить, что без заголовка запись не происходит, можно запросом без `X-Device-Key` (ожидать 401 и отсутствие строк в `telemetry_record`). CSRF здесь не воспроизводится (нет cookie-аутентификации) | Оставить как есть, но привести к `withMutation` с `{ rateLimit }` — тогда исключение уходит из списка, а лимит станет раздельным (см. №2) |
| 6 | мелочь | `src/app/api/auth/login/route.ts:16` (POST через `withApi`) | Изменяющий метод без `withMutation` — намеренно: CSRF-исключение (`src/lib/csrf-protection.ts:28-33` перечисляет `/api/auth/login`), лимит входа живёт в сервисе (`src/services/auth/auth-service.ts:109` `login-ip:<id>`, `:120` `login-acct:<email>`, `:130` `login:<email>:<id>`) | Нарушением не считаю: сессии ещё нет, угонять нечего; лимит строже общего (5/15 мин на аккаунт, 20/15 мин на IP, 10/15 мин блокировка аккаунта) и с корректными префиксами. Фиксирую, чтобы следующая проверка не открывала это заново | `csrf-protection.ts:48` — точное совпадение пути, значит исключение узкое; `auth-service.ts:109-131` — три ключа с префиксами. Проверка: 6 неверных входов подряд → 429 с `Retry-After` | Ничего не менять; при желании добавить в маршрут однострочный комментарий со ссылкой на `csrf-protection.ts:28-33` |
| 7 | мелочь | `src/app/api/alerts/webhook/route.ts:85-88` | POST без обёртки и **без какого-либо лимита частоты**: проверка токена (`:74-83`) и разбор JSON идут на каждый запрос; причина отсутствия обёртки записана в `api-routes.test.ts:209` | Токен сверяется в постоянном времени (`:69-72`), утечки нет, но неверный токен стоит серверу `timingSafeEqual` + `JSON.parse` без ограничения: поток запросов — бесплатная нагрузка и шум в логах/алертах. Ограничения по IP здесь нет ни одного | `curl -X POST <host>/api/alerts/webhook -H 'Authorization: Bearer xxx' -d '{}'` в цикле — 401 каждый раз, 429 не наступит никогда (в файле нет `rateLimiter`). Убедиться текстом: `search_files 'rateLimiter' src/app/api/alerts` → пусто | Лимит по IP до проверки токена (`rateLimiter.check('alerts-webhook:' + getRateLimitIdentifier(request), …)`), наружу — 429 |
| 8 | мелочь | `src/app/api/route.ts:10-14` | Публичный `GET /api` без проверки личности (обоснование только в тесте, `api-routes.test.ts:190`, в коде комментария нет) — и с побочным эффектом на импорте модуля: `registerAllEventHandlers()` и `registerReadinessProjectionHandler()` вызываются в теле модуля | Данных маршрут не касается (статус и жёстко вписанная версия `1.0.0`), утечки нет. Особенность: файл маршрута — обычный модуль, поэтому его импорт (в том числе сборкой/тестом) регистрирует обработчики событий в процессе. Это не действие по запросу, но единственный публичный маршрут с эффектом на импорте | `GET /api` без cookie → 200 со `{status,version,timestamp}`; в коде строки `10-11` выполняются при импорте, а не внутри обработчика `:13-15` | Добавить в код комментарий с причиной публичности (как у `health/route.ts:3-16`); регистрацию обработчиков переносить смысла нет — она идемпотентна (`:8-9`) |
| 9 | мелочь | `src/app/api/feedback/stream/route.ts:9`, `:13-18`, `:49-51` | GET без обёртки (причина — SSE: обёртка дождалась бы конца потока, записана в `api-routes.test.ts:210` и в коде `:13-16`); контекст тенанта открывается вручную, `requireAuth` вызывается **один раз** при открытии потока | Данных в потоке нет — только `connected` и heartbeat `sync` раз в 15 с (`:47-51`), утечки нет. Но сессия за время жизни потока не перепроверяется: отозванный или истёкший токен получает heartbeat до разрыва соединения. Практический вред близок к нулю (содержимого нет), остаточный риск — «живое» соединение после отзыва | Открыть поток, затем отозвать сессию (`/api/auth/logout` в другом окне) — события `sync` продолжат приходить до закрытия вкладки. В коде: проверка одна, в `:17`, внутри `start()` её нет | По желанию: перед `send('sync')` раз в N тиков проверять сессию или закрывать поток по таймауту (`MAX_STREAM_MS`) |
| 10 | мелочь | `src/app/api/reports/pdf/route.ts:244`, `src/app/api/reports/single-pdf/route.ts:218` | Ручной лимит `rateLimiter.check('pdf:get:' + user.id, PDF_GET_RATE_LIMIT)` внутри GET, обёрнутого `withApi` | **Отклонением не является**: `withApi` лимитов не даёт вовсе (`api-wrapper.ts:62-147`), значит дублирования нет, а ключ с префиксом и по пользователю. Фиксирую как проверенное, чтобы не искать заново | Прочитать `:243-247` в обоих файлах: комментарий объясняет, что лимит до валидации и до рендера; ключ `pdf:get:<userId>` | Ничего |
| 11 | мелочь | `src/app/api/feedback/events/route.ts:196` (`export const PATCH = POST;`) | Метод-псевдоним, объявления у него нет | Отклонением не является: CSRF и лимит наследуются от `POST` (`withMutation`, `:194`), а тест-контракт учитывает псевдонимы (`api-routes.test.ts:269-270`). Фиксирую как проверенное | Прочитать `:194` и `:196`; тест `:266-270` | Ничего |
| 12 | мелочь | `src/app/api/health/route.ts:24`, `src/app/api/health/deep/route.ts:34`, `src/app/api/liveness/route.ts:13`, `src/app/api/ready/route.ts:27`, `src/app/api/readiness/route.ts:26` | Пять публичных проб без обёртки (список `api-routes.test.ts:211-215`), состояние не меняют | Отклонения нет: состояние не меняется, ответы узкие. Поток запросов тоже не проблема — `getReadiness` кеширует результат на 5 с (`src/core/observability/health-checks.ts:29-32`), `health/deep` отдаёт данные не старше 30 с (`:32-38`). Единственное наблюдение: `readiness/route.ts` — устаревший синоним `/api/ready` с заголовком `Sunset` (`:34-38`), то есть две точки входа на одну пробу | `curl <host>/api/ready` без cookie → 200/503 со списком проверок и без `details` (`:19-24`); `curl <host>/api/readiness` → то же плюс `Deprecation: true` | Со временем убрать синоним (обещано заголовком `Sunset: Wed, 30 Sep 2026 21:00:00 GMT`, `readiness/route.ts:35`) |
| 13 | мелочь | `src/app/api/readiness/_shared/route-adapter.ts:13-29` (23 изменяющих метода из 37 в 29 файлах `src/app/api/readiness/**`) | Ложный класс для любого текстового сканера: методы выглядят «без обёртки», потому что завёрнуты в `withReadinessCommand`, а тот внутри — `withMutation` (`:17`) | Проблемы нет, но при повторном прогоне без учёта адаптера получается 23 ложные находки (первый прогон этой проверки дал именно их) | `grep -n 'withReadinessCommand' src/app/api/readiness/shifts/route.ts` → `:46` (POST) и `:63` (GET = `withApi`) | При автоматизации проверки — считать `withReadinessCommand` обёрткой, как это делает `api-routes.test.ts:174-177` |
| 14 | мелочь | `auth/logout/route.ts:12`, `briefings/[id]/sign/route.ts:19`, `media/route.ts:19`, `media/[id]/confirm/route.ts:8`, `media/[id]/route.ts:8`, `readiness/place-presets/route.ts:32`, `reports/upsert/route.ts:17`, `telemetry/ingest/route.ts:95,138`, `user-document-types/route.ts:41`, `user-document-types/[id]/route.ts:14,37`, `users/[id]/documents/route.ts:55`, `users/[id]/documents/[docId]/route.ts:27,56` | Пункт 4 задачи — «обработчик без проверки сессии/прав, если он не публичный по замыслу». Проверены все 202 метода (109 изменяющих): обработчика без **личности** нет, кроме публичных по замыслу (`auth/login`, `health`, `health/deep`, `liveness`, `ready`, `readiness`, `api/route.ts`, `alerts/webhook` — токен, `orion/lead` — публичная форма, `telemetry/ingest` — ключ устройства). Именованного `assertCan`/`assertRole` нет в 15 изменяющих обработчиках (перечислены в столбце path:line) — проверено чтением: `media*` использует хелпер с другим именем (`assertCanAccessMedia` `src/core/media/media-auth.ts:177`, `assertCanAccessMediaEntity`), `users/[id]/documents*` и `user-document-types*` передают актора в сервис (`assertCanRead`/`assertCanWrite` — `src/services/users/user-document-access.ts:20,26`, `:73` для справочника), `readiness/place-presets` POST пишет строку со своим `userId` (`:41-59`), `auth/logout` работает по своему токену (`:17-21`), `telemetry/ingest` — ключ устройства (`:108-110`). Прямые названные проверки в теле — примеры: `safety/equipment-permits/route.ts:46,87`, `readiness-rules/route.ts:25`, `equipment/[id]/documents/route.ts:32`, `reports/single-pdf/route.ts:80-82` | Схема одинаковая: маршрут отвечает за личность и форму данных, право — за операцию внутри сервиса (так и записано в комментариях `user-document-types/route.ts:11-15`, `users/[id]/documents/route.ts:22-28`, `user-documents/control/route.ts:10-14`). Важно для будущей проверки: на этом уровне «нет `assertCan`» ещё не значит «нет права» — искать надо в сервисе | Для каждого из 15 — открыть сервисную функцию из строки и убедиться, что флаг `mayRead`/`mayManage` проверяется. В этой работе так проверены `media*`, `users/[id]/documents*`, `user-document-types*`, `readiness/place-presets`, `auth/logout`; **не проверены** `briefings/[id]/sign` (`signBriefingRecord`) и `reports/upsert` (`report-command.service`) — см. «Не проверено» | Изменений не требуется; закрепить инвариант тестом «маршрут вне списка публичных обязан иметь проверку личности по методу» (см. №3) |

## Приложение А. Все 141 маршрута: метод → обёртка

Формат: `путь от src/app/api :: МЕТОД:строка=обёртка`. `RAW` — обработчик без обёртки,
`alias->POST` — метод-псевдоним. Список получен обходом каталога (см. «Методику», п. 1).

- admin/analytics/overview/route.ts :: GET:151=withApi
- admin/analytics/site-weekly-trend/route.ts :: GET:9=withApi
- admin/dlq/route.ts :: GET:16=withApi POST:66=withMutation
- admin/equipment-analytics/route.ts :: GET:9=withApi
- admin/incidents/route.ts :: GET:25=withApi POST:102=withMutation
- admin/projections/rebuild/route.ts :: POST:37=withMutation
- alerts/webhook/route.ts :: POST:85=RAW
- analytics/sites/route.ts :: GET:12=withApi
- assistant/command/route.ts :: POST:33=withMutation
- assistant/state/route.ts :: GET:16=withApi
- audit/route.ts :: GET:11=withApi
- auth/login/route.ts :: POST:16=withApi
- auth/logout/route.ts :: POST:12=withMutation
- auth/me/route.ts :: GET:17=withApi
- briefings/[id]/sign/route.ts :: POST:19=withMutation
- briefings/journal/route.ts :: GET:27=withApi
- briefings/route.ts :: POST:30=withMutation
- checklist-templates/[id]/route.ts :: GET:43=withApi PUT:63=withMutation DELETE:91=withMutation
- checklist-templates/route.ts :: GET:43=withApi POST:58=withMutation
- crews/[id]/route.ts :: GET:17=withApi PUT:34=withMutation DELETE:74=withMutation
- crews/all/route.ts :: GET:17=withApi
- crews/my/route.ts :: GET:13=withApi
- crews/route.ts :: GET:17=withApi POST:36=withMutation
- dictionary/all/route.ts :: GET:9=withApi
- dictionary/manage/route.ts :: GET:65=withApi POST:89=withMutation PATCH:104=withMutation DELETE:127=withMutation
- equipment/[id]/details/route.ts :: GET:20=withApi
- equipment/[id]/device-keys/route.ts :: POST:66=withMutation GET:98=withApi DELETE:128=withMutation
- equipment/[id]/documents/[docId]/route.ts :: PUT:31=withMutation DELETE:61=withMutation
- equipment/[id]/documents/route.ts :: POST:27=withMutation
- equipment/[id]/fuel/[entryId]/route.ts :: DELETE:14=withMutation
- equipment/[id]/fuel/route.ts :: GET:43=withApi POST:79=withMutation
- equipment/[id]/maintenance/[recordId]/route.ts :: PUT:41=withMutation DELETE:115=withMutation
- equipment/[id]/maintenance/route.ts :: GET:39=withApi POST:55=withMutation
- equipment/[id]/meter-readings/[readingId]/route.ts :: DELETE:13=withMutation
- equipment/[id]/meter-readings/route.ts :: GET:42=withApi POST:65=withMutation
- equipment/[id]/route.ts :: GET:45=withApi PUT:59=withMutation DELETE:130=withMutation
- equipment/route.ts :: GET:13=withApi POST:31=withMutation
- feedback/events/route.ts :: GET:57=withApi POST:77=withMutation PATCH:196=alias->POST
- feedback/stream/route.ts :: GET:9=RAW
- health/deep/route.ts :: GET:34=RAW
- health/route.ts :: GET:24=RAW
- inspections/[id]/complete/route.ts :: POST:17=withMutation
- inspections/[id]/route.ts :: GET:24=withApi PUT:46=withMutation
- inspections/route.ts :: GET:33=withApi POST:53=withMutation
- layout/[surfaceId]/route.ts :: GET:31=withApi PUT:51=withMutation DELETE:78=withMutation
- liveness/route.ts :: GET:13=RAW
- maintenance-plans/[id]/route.ts :: PATCH:29=withMutation DELETE:59=withMutation
- maintenance-plans/route.ts :: GET:27=withApi POST:51=withMutation
- maintenance-plans/run/route.ts :: POST:13=withMutation
- maintenance/[id]/accept/route.ts :: POST:14=withMutation
- maintenance/[id]/route.ts :: GET:11=withApi
- maintenance/assignees/route.ts :: GET:10=withApi
- maintenance/kpi/route.ts :: GET:40=withApi
- maintenance/route.ts :: GET:10=withApi
- media/[id]/confirm/route.ts :: POST:8=withMutation
- media/[id]/download/route.ts :: GET:10=withApi
- media/[id]/route.ts :: DELETE:8=withMutation
- media/download-batch/route.ts :: GET:31=withApi
- media/route.ts :: POST:19=withMutation GET:63=withApi
- metrics/route.ts :: GET:46=withApi
- monitoring/fleet/route.ts :: GET:21=withApi
- monitoring/template/route.ts :: GET:17=withApi PUT:25=withMutation
- notifications/telegram/test/route.ts :: POST:19=withMutation
- operator/knowledge-attempt/route.ts :: GET:6=withApi
- operator/mobile/command/route.ts :: POST:180=withMutation
- operator/mobile/state/route.ts :: GET:16=withApi
- operator/shift/route.ts :: GET:15=withApi
- orion/lead/route.ts :: POST:55=RAW
- pile-passports/[id]/decide/route.ts :: POST:19=withMutation
- pile-passports/export/route.ts :: GET:25=withApi
- pile-passports/route.ts :: GET:28=withApi
- readiness-rules/publish/route.ts :: POST:10=withMutation
- readiness-rules/route.ts :: GET:13=withApi PUT:21=withMutation
- readiness/access-matrix/route.ts :: PUT:31=withReadinessCommand POST:45=withReadinessCommand GET:55=withApi
- readiness/audit/route.ts :: GET:54=withApi
- readiness/bootstrap/route.ts :: GET:64=withApi
- readiness/current/route.ts :: GET:56=withApi
- readiness/defects/[id]/reject/route.ts :: POST:11=withReadinessCommand
- readiness/defects/[id]/resolve/route.ts :: POST:11=withReadinessCommand
- readiness/defects/[id]/triage/route.ts :: POST:11=withReadinessCommand
- readiness/defects/route.ts :: POST:67=withReadinessCommand GET:83=withApi
- readiness/export/route.ts :: GET:176=withApi
- readiness/handovers/[id]/accept/route.ts :: POST:10=withReadinessCommand
- readiness/handovers/[id]/rework/route.ts :: POST:9=withReadinessCommand
- readiness/handovers/[id]/route.ts :: GET:18=withApi
- readiness/history/route.ts :: GET:74=withApi
- readiness/permit-form-options/route.ts :: GET:83=withApi
- readiness/place-presets/route.ts :: POST:32=withReadinessCommand DELETE:91=withMutation
- readiness/route.ts :: GET:26=RAW
- readiness/shifts/[id]/cancel/route.ts :: POST:11=withReadinessCommand
- readiness/shifts/[id]/decline/route.ts :: POST:12=withReadinessCommand
- readiness/shifts/[id]/handover/route.ts :: POST:11=withReadinessCommand
- readiness/shifts/[id]/request-acceptance/route.ts :: POST:11=withReadinessCommand
- readiness/shifts/[id]/route.ts :: PATCH:26=withReadinessCommand GET:35=withApi
- readiness/shifts/[id]/start/route.ts :: POST:12=withReadinessCommand
- readiness/shifts/[id]/waiver/route.ts :: POST:15=withReadinessCommand
- readiness/shifts/route.ts :: POST:46=withReadinessCommand GET:63=withApi
- readiness/work-permits/[id]/approve/route.ts :: POST:11=withReadinessCommand
- readiness/work-permits/[id]/revoke/route.ts :: POST:11=withReadinessCommand
- readiness/work-permits/[id]/route.ts :: PATCH:34=withReadinessCommand GET:47=withApi
- readiness/work-permits/[id]/submit/route.ts :: POST:11=withReadinessCommand
- readiness/work-permits/route.ts :: POST:64=withReadinessCommand GET:73=withApi
- ready/route.ts :: GET:27=RAW
- reports/[id]/history/route.ts :: GET:9=withApi
- reports/admin-upsert/route.ts :: POST:17=withMutation
- reports/all/route.ts :: GET:13=withApi
- reports/delete/route.ts :: DELETE:41=withMutation
- reports/edit/route.ts :: GET:12=withApi
- reports/export/route.ts :: GET:16=withApi
- reports/my/route.ts :: GET:13=withApi
- reports/pdf/route.ts :: POST:73=withMutation GET:182=withApi
- reports/period/route.ts :: GET:30=withApi
- reports/recent/route.ts :: GET:16=withApi
- reports/single-pdf/route.ts :: POST:46=withMutation GET:150=withApi
- reports/upsert/route.ts :: POST:17=withMutation
- route.ts :: GET:13=withApi
- safety/clearance/route.ts :: GET:19=withApi
- safety/equipment-permits/[id]/route.ts :: DELETE:13=withMutation
- safety/equipment-permits/route.ts :: GET:31=withApi POST:64=withMutation
- safety/my-clearance/route.ts :: GET:18=withApi
- settings/route.ts :: GET:15=withApi PUT:23=withMutation
- sites/[id]/assign/route.ts :: POST:13=withMutation DELETE:36=withMutation
- sites/[id]/hierarchy/route.ts :: POST:49=withMutation DELETE:99=withMutation
- sites/[id]/route.ts :: GET:15=withApi PUT:31=withMutation DELETE:108=withMutation
- sites/all/route.ts :: GET:11=withApi
- sites/create/route.ts :: POST:14=withMutation
- sites/route.ts :: GET:11=withApi
- system/route.ts :: GET:11=withApi
- system/status/route.ts :: GET:24=withApi
- telegram/configs/route.ts :: GET:40=withApi POST:55=withMutation PUT:93=withMutation DELETE:131=withMutation
- telemetry/batch/route.ts :: POST:64=withApi
- telemetry/ingest/route.ts :: POST:95=withApi PATCH:138=withApi GET:335=withApi
- telemetry/route.ts :: POST:83=withApi GET:237=withApi
- to/journal/route.ts :: GET:11=withApi
- user-document-types/[id]/route.ts :: PATCH:14=withMutation DELETE:37=withMutation
- user-document-types/route.ts :: GET:16=withApi POST:41=withMutation
- user-documents/control/route.ts :: GET:15=withApi
- users/[id]/documents/[docId]/route.ts :: PUT:27=withMutation DELETE:56=withMutation
- users/[id]/documents/route.ts :: GET:34=withApi POST:55=withMutation
- users/route.ts :: GET:15=withApi POST:40=withMutation PUT:89=withMutation DELETE:123=withMutation
- weather/route.ts :: GET:40=withApi

## Не проверено

1. **Права внутри сервисов — выборочно.** Проверка «маршрут без `assertCan` не значит доступ без права»
   (находка №14) обоснована чтением 15 маршрутов и их вызовов, но не чтением всех сервисных функций
   `src/modules/**`. Не проверено: полные цепочки прав за `updateUserDocumentType`, `createUserDocument`,
   `conductBriefing`, `upsertEquipmentPermit`, `deleteEquipmentPermit`, `signBriefingRecord`,
   `report-command.service`, `loadSingleReportPdfContext`.
2. **Эксплуатация не воспроизводилась.** Ни один сценарий из столбца «как проверить» не выполнялся:
   приложения не запускались, БД и Redis не читались, прод не трогался (AGENTS.md §1). Все строки о ключах
   `rl:<ip>` и о поведении лимитов выведены из кода (`rate-limiter.ts:169-217`, `:478-505`) и
   документированных фактов (`docs/audit.md:51` — H1 закрыт ключом `mut:{route}:{session}:{ip}`,
   `TRUST_PROXY=true` на проде).
3. **Значение `TRUST_PROXY` на бою** взято из документации (`docker-compose.yml:123`, `docs/audit.md:51`,
   `scripts/validate-env.ts:128-135`), в самом контейнере не проверялось — прод-доступа нет.
4. **Гонки и порядок проверок.** Не проверялось, может ли запрос пройти лимит и не пройти CSRF или
   наоборот при одновременных запросах (для этого нужен запущенный Redis).
5. **Маршруты вне `src/app/api`** — их нет (обход всего `src/` дал 141 файл, все внутри `api`), но
   серверные экшены/`route`-подобные точки входа в `src/app/**` на предмет обёрток не проверялись: задача
   ограничена `src/app/api/**`.
6. **Тесты не запускались** (`npm run test:unit`, `npx playwright test --list`) — задача только на чтение,
   а её результат — отчёт, а не изменение кода; утверждения о зелёном/красном тест-контракте основаны на
   чтении `api-routes.test.ts` и перечислены как «регрессия: проверить вот так».
