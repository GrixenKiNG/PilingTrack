# N17-39-API-CACHE-HEADERS: заголовки кэша на маршрутах с личными данными

Версия кода (`git rev-parse HEAD`): `cb53cd9b498f5082bca109d4fdd6d169649dbda3`.
Ветка: `hermes/code-1011`. Рабочая папка фактически — `D:/PillingR/wt-night-code` (в тексте задания названа `wt-night-code-code`; такой папки в окружении нет, работа шла в текущей).
Только чтение: код приложения не менялся, единственный созданный файл — этот отчёт. Next.js 16.4.0, Prisma 7.8, сборка `next build --webpack` (`package.json:8,96`).

## Итог

- **Критичных находок нет. Важных — 0. Мелочей — 18. Отдельно 12 проверенных-исправных (ПРОЙДЕНО) и 2 гипотезы.**
- На вопрос (1): **ни один** маршрут с личными данными не отдаёт заголовок, разрешающий браузеру/прокси/Caddy сохранить ответ (`max-age`, `s-maxage`, `public`, `revalidate`). Явный запрет стоит лишь на 4 маршрутах, и только 1 из них персональный (`operator/knowledge-attempt`).
- На вопрос (2): почти все персональные GET-маршруты идут **без явного `Cache-Control`**. Защита держится на дефолте Next (GET route handler не кэшируется) и на том, что Caddy не кэширует.
- На вопрос (3): `Vary` не ставится нигде (0 совпадений в `src/`); ответы зависят от cookie-сессии. Серверный кэш ответов ключ **содержит** пользователя (хеш токена + `x-acting-as`) — течи между сессиями в коде не найдено.
- На вопрос (4): service worker отсутствует (PWA снят 2026-05-24) — на клиенте чистить нечего; `logoutClient`/`store.logout` очищают стор. Серверный кэш ответов при выходе не сбрасывается (ключ — токен, поэтому не течёт).
- На вопрос (5): тест на заголовки кэша ровно один — `health/deep`; e2e `headers.spec.ts` кэш не проверяет.
- Топ-5: (1) в `withApi` централизованно нет `Cache-Control: private, no-store`/`Vary: Cookie` (`src/core/api-wrapper.ts:86-106`); (2) скачивания персональных данных без запрета кэша, в отличие от `readiness/export` (`reports/export:70-84`, `reports/pdf:144-146`, `reports/single-pdf:271-280`); (3) `ETag` на наряде без `Cache-Control` (`readiness/work-permits/[id]/route.ts:25-27`); (4) серверный кэш персональных списков 10–30 с (`users:35-37`, `reports/all:28-36`, `reports/my:24-26`); (5) отсутствие тестов.

## Методика

Всё сделано в текущей папке `D:/PillingR/wt-night-code`, без запуска приложения (сборке нужны env и БД).

1. Версия/ветка: `git rev-parse HEAD`, `git branch --show-current`.
2. Поиск заголовков кэша: ripgrep по `Cache-Control|cache-control|s-maxage|stale-while-revalidate|max-age|no-store|no-cache|export const dynamic|export const revalidate|export const fetchCache|force-static|force-dynamic|dynamicParams|force-cache|unstable_cache|revalidatePath|revalidateTag` в `src/app/**` (в т.ч. `.tsx`) и `src/core/**`. Результат: явные заголовки кэша — `health/deep:64`, `feedback/stream:67`, `readiness/export:162`, `operator/knowledge-attempt:13`; `export const dynamic` — только `src/app/layout.tsx:15`.
3. Серверный кэш: ripgrep `cache: true|cacheTTL|domain:` по `src/app/api`, чтение `src/core/api-wrapper.ts`, `src/core/cache/response-cache.ts`, `src/lib/cache-strategies.ts`.
4. Конфиги (только чтение): `next.config.ts` (секция `headers()`), `src/proxy.ts`, `Caddyfile`, `deploy/Caddyfile.prod`.
5. Дефолт фреймворка: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:51`; проверка, что в `node_modules/next/dist/server/route-modules/app-route/module.js` нет установки `Cache-Control`; `node_modules/next/dist/server/lib/cache-control.js`.
6. Выход и клиентский кэш: `src/lib/api.ts` (`authFetch`, `logoutClient`), `src/lib/store.ts` (`logout`), `src/app/api/auth/logout/route.ts`; поиск service worker (`glob public/sw.js`, `**/service-worker*` — пусто; `next.config.ts:114-116`).
7. Тесты: ripgrep `Cache-Control|no-store` по `*.test.ts`; чтение `src/app/api/health/deep/__tests__/route.test.ts`, `e2e/qa-ac/headers.spec.ts`.

Существующие отчёты `AU35-S4-PWA-SERVICE-WORKER.md`, `AU187-S4-QUERY-CACHE-INVALIDATION.md`, `N17-33-READINESS-BOOTSTRAP-EXPOSURE.md` прочитаны после собственных проверок — выводы совпадают; перепроверка кода сделана независимо.

## Находки

### Таблица 1. Маршруты с личными данными: заголовок и риск

Фактический заголовок — то, что задаёт код; при отсутствии — Next не добавляет кэширующих заголовков к динамическому GET route handler (ПРОЙДЕНО, см. находку 23). «Риск утечки» — реальный сценарий, а не наличие заголовка.

| маршрут (GET, если не указано) | заголовок ответа (код) | персональные данные | риск утечки между пользователями | файл:строка |
| --- | --- | --- | --- | --- |
| `/api/auth/me` | нет | профиль: email, имя, роль, телефон | низкий: нет кол-ва данных для кэша, `cache:false` | `src/app/api/auth/me/route.ts:45-47` |
| `/api/operator/shift` | нет | состояние смены своей бригады | низкий | `src/app/api/operator/shift/route.ts:23-25` |
| `/api/operator/mobile/state` | нет | смена оператора + погода + координаты | низкий | `src/app/api/operator/mobile/state/route.ts:66-68` |
| `/api/operator/knowledge-attempt` | `no-store` | ПИН-код оператора / проверка знаний | нет (запрет кэша) | `src/app/api/operator/knowledge-attempt/route.ts:13` |
| `/api/reports/my` | нет (серверный кэш 10 с по сессии) | свои отчёты | низкий: ключ = токен сессии | `src/app/api/reports/my/route.ts:24-26` |
| `/api/reports/all` | нет (серверный кэш 10 с) | все отчёты (имена, простои, метры) | низкий | `src/app/api/reports/all/route.ts:28-36` |
| `/api/reports/recent` | нет | свежие отчёты | низкий | `src/app/api/reports/recent/route.ts:25-27` |
| `/api/reports/period` | нет | отчёты за период | низкий | `src/app/api/reports/period/route.ts:57-59` |
| `/api/reports/[id]/history` | нет | история правок отчёта | низкий | `src/app/api/reports/[id]/history/route.ts:17-18` |
| `/api/reports/export` | нет (`Content-Disposition: attachment`) | CSV/XLSX всех отчётов | низкий; ср. `readiness/export` с `no-store` | `src/app/api/reports/export/route.ts:70-84` |
| `/api/reports/pdf` (GET/POST) | нет | PDF с отчётами | низкий | `src/app/api/reports/pdf/route.ts:144-146` |
| `/api/reports/single-pdf` | нет | PDF одного отчёта | низкий | `src/app/api/reports/single-pdf/route.ts:271-280` |
| `/api/readiness/work-permits` | нет | наряды (кто выдал/получил) | низкий | `src/app/api/readiness/work-permits/route.ts:55-57` |
| `/api/readiness/work-permits/[id]` | `ETag` + **нет** `Cache-Control` | наряд с версией/подписями | низкий, но ответ storable (см. находку 5) | `src/app/api/readiness/work-permits/[id]/route.ts:25-27` |
| `/api/readiness/shifts` | нет | смены | низкий | `src/app/api/readiness/shifts/route.ts:39-42` |
| `/api/safety/my-clearance` | нет | свой допуск и инструктажи | низкий | `src/app/api/safety/my-clearance/route.ts:28-34` |
| `/api/users` | нет (серверный кэш 30 с) | список сотрудников (телефон) | низкий | `src/app/api/users/route.ts:35-37` |
| `/api/crews/my` | нет | своя бригада | низкий | `src/app/api/crews/my/route.ts:26-28` |
| `/api/user-documents/control` | нет | документы работников (медосмотры) | низкий | `src/app/api/user-documents/control/route.ts:28-38` |
| `/api/media/[id]/download` | нет | подписанная ссылка на фото (TTL 3600 с) | низкий: ссылка истекает | `src/app/api/media/[id]/download/route.ts:66-74` |
| `/api/feedback/events` | нет (серверный кэш 10 с) | лента с именами авторов | низкий | `src/app/api/feedback/events/route.ts:72-75` |
| `/api/readiness/export` | `no-store` | CSV готовности | нет (запрет кэша) | `src/app/api/readiness/export/route.ts:157-168` |
| `/api/health/deep` | `no-store, must-revalidate` | нет персональных | нет | `src/app/api/health/deep/route.ts:63-64` |
| `/api/feedback/stream` (SSE) | `no-cache, no-transform` | нет персональных | нет | `src/app/api/feedback/stream/route.ts:65-67` |

### Таблица 2. Уровень прокси/конфига

| уровень | что задаёт | персональный риск | файл:строка |
| --- | --- | --- | --- |
| `next.config.ts` `headers()` | только `X-XSS-Protection`/`X-DNS-Prefetch-Control` и CSP/`X-Frame-Options` для PDF; `Cache-Control` для `/api/*` не задаётся | не задаёт кэш — полагается на дефолт фреймворка | `next.config.ts:87-118` |
| `src/proxy.ts` (middleware) | security-заголовки, CORS, tenant; ни `Cache-Control`, ни `Vary` | нет явного запрета кэша на API-ответах | `src/proxy.ts:62-75,198-229` |
| `deploy/Caddyfile.prod` | только `reverse_proxy 127.0.0.1:3000`, без `cache`/`header` | Caddy ответы не кэширует (ПРОЙДЕНО) | `deploy/Caddyfile.prod:51-54` |
| `src/app/layout.tsx` | `export const dynamic = 'force-dynamic'` | покрывает HTML-страницы, **не** route-хендлеры | `src/app/layout.tsx:15` |
| серверный кэш ответов | in-memory, ключ `endpoint`+`params`+`userId`(хеш токена+`x-acting-as`) | между сессиями не течёт (ПРОЙДЕНО) | `src/core/api-wrapper.ts:44-50,86-103` |
| service worker | отсутствует (PWA снят) | на клиенте кэш-стратегий нет | `next.config.ts:114-116` |

### Таблица 3. Находки

| # | severity | статус | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | мелочь | ПРОЙДЕНО | `src/core/api-wrapper.ts:86-106,144-145` | Аутентифицированные GET идут без `Cache-Control` и без `Vary`: заголовок только возвращается (`return response`), ничего не добавляется | Сейчас защиты хватает: Next не кэширует dynamic GET, Caddy не кэширует. Но если между браузером и приложением появится кэширующий прокси/CDN (или CSR-прокси в организации), ответ с личными данными будет сохраняться по URL без `Vary: Cookie`. Единственная точка исправления | Проставлять `Cache-Control: private, no-store` и `Vary: Cookie, Authorization` после `requireAuth` в `withApi` (одно место, как `recordHttpRequest`) |
| 2 | мелочь | ПРОЙДЕНО | `src/app/api/reports/export/route.ts:70-84` | Выгрузка всех отчётов (CSV/XLSX) не ставит `Cache-Control`, в отличие от `readiness/export` | Скачивание — самый крупный массив личных данных (имена, простои, метры). `Content-Disposition: attachment` не запрещает промежуточному кэшу сохранить ответ по URL. Несогласованность с `readiness/export:162` выглядит как недосмотр | Добавить `'Cache-Control': 'no-store'` в оба ответа |
| 3 | мелочь | ПРОЙДЕНО | `src/app/api/reports/pdf/route.ts:144-146` | PDF-отчёт без `Cache-Control` | То же: персональный PDF, нет запрета кэша | `'Cache-Control': 'no-store'` |
| 4 | мелочь | ПРОЙДЕНО | `src/app/api/reports/single-pdf/route.ts:271-280` | PDF одного отчёта без `Cache-Control` (файл отдаётся через `inline`/`attachment`) | Персональный PDF без запрета кэша | `'Cache-Control': 'no-store'` |
| 5 | мелочь | ПРОЙДЕНО | `src/app/api/readiness/work-permits/[id]/route.ts:25-27` | Ответ наряда помечен `ETag` (`"work-permit-${id}-v${version}"`) при отсутствии `Cache-Control` | Наличие `ETag` делает ответ формально storable: браузер сохранит тело и будет ревалидировать. Реальной течи нет (ревалидация снова проходит `requireAuth`), но явный `no-store` убрал бы сохранение персонального ответа | Добавить `Cache-Control: no-store`; `ETag` оставить для условных запросов, если он нужен |
| 6 | мелочь | ПРОЙДЕНО | `src/app/api/users/route.ts:35-37` | Серверный кэш ответа 30 с на список сотрудников; HTTP-заголовка нет | Ключ включает хеш сессии (`api-wrapper.ts:95-100`), поэтому чужие данные не отдаются. Но запись живёт 30 с и переживает выход пользователя (не сбрасывается) | Либо оставить (per-session), либо добавить `Cache-Control: private, no-store` |
| 7 | мелочь | ПРОЙДЕНО | `src/app/api/reports/all/route.ts:36` | Серверный кэш 10 с на все отчёты | То же, per-session; при выходе запись не чистится, но токен уникален | Добавить централизованный `no-store` (находка 1) закрывает и это |
| 8 | мелочь | ПРОЙДЕНО | `src/app/api/reports/my/route.ts:26` | Серверный кэш 10 с на свои отчёты | Per-session; не течёт, но нет HTTP-запрета кэша | Централизованный `no-store` |
| 9 | мелочь | ПРОЙДЕНО | `src/app/api/feedback/events/route.ts:75` | Серверный кэш 10 с на ленту с именами | Per-session; риск низкий | Централизованный `no-store` |
| 10 | мелочь | ПРОЙДЕНО | `src/app/api/operator/shift/route.ts:23-25`; `src/app/api/operator/mobile/state/route.ts:66-68` | Состояние смены (личные факты оператора) без HTTP-заголовков кэша | Нет серверного кэша (`cache` не включён) и нет заголовка. На общем планшете сменщиков браузер не должен переиспользовать ответ — но полагаться на дефолт в auth-пути плохо | Централизованный `no-store` |
| 11 | мелочь | ПРОЙДЕНО | `src/app/api/safety/my-clearance/route.ts:28-34` | Личный допуск/инструктажи без заголовков кэша | Факты медосмотра и инструктажей — персональные | Централизованный `no-store` |
| 12 | мелочь | ПРОЙДЕНО | `src/app/api/user-documents/control/route.ts:28-38` | Документы работников без заголовков кэша | Персональные документы (сроки медосмотров) | Централизованный `no-store` |
| 13 | мелочь | ПРОЙДЕНО | `src/app/api/reports/recent/route.ts:25-27`; `src/app/api/reports/period/route.ts:57-59`; `src/app/api/reports/[id]/history/route.ts:17-18` | Отчёты/история без заголовков кэша | Персональные данные отчётов | Централизованный `no-store` |
| 14 | мелочь | ПРОЙДЕНО | `src/app/api/readiness/work-permits/route.ts:55-57`; `src/app/api/readiness/shifts/route.ts:39-42` | Наряды и смены без заголовков кэша | Персональные данные нарядов/смен | Централизованный `no-store` |
| 15 | мелочь | ПРОЙДЕНО | `src/app/api/crews/my/route.ts:26-28` | Своя бригада без заголовков кэша | Персональный состав бригады | Централизованный `no-store` |
| 16 | мелочь | ПРОЙДЕНО | `src/app/api/media/[id]/download/route.ts:66-74` | Ответ с подписанной ссылкой на фото без заголовков кэша | Ссылка живёт 3600 с; сама ссылка утечёт лишь через кэш/лог, риск низкий | `Cache-Control: no-store` |
| 17 | мелочь | ПРОЙДЕНО | `src/app/api/auth/logout/route.ts:18-23`; `src/core/cache/response-cache.ts:246-265` | Выход чистит `authUserCache` (`clearAuthUserCacheEntry`), но **не** серверный кэш ответов (`getResponseCache`) | Запись кэша ответов для старого токена висит до `TTL+staleWhileRevalidate` (до ~120 с). Течи нет (ключ — уникальный токен, `requireAuth` при ревалидации отвергает отозванный), но мусор остаётся | На выходе звать `getResponseCache(domain).invalidate(...)` по scope сессии, либо не кэшировать персональные маршруты |
| 18 | мелочь | ПРОЙДЕНО | `src/app/api/health/deep/__tests__/route.test.ts:219-222`; `e2e/qa-ac/headers.spec.ts:13-19` | Заголовки кэша почти не покрыты тестами: единственный — `health/deep`; e2e-спек проверяет security-заголовки, кэш не смотрит | Регрессия (кто-то снимет `no-store`) не поймается тестом | Добавить в тест `withApi` проверку `Cache-Control`/`Vary` после фикса находки 1 |
| 19 | — | ПРОЙДЕНО | `src/app/api/operator/knowledge-attempt/route.ts:13` | ПИН-статус/проверка знаний отдаются с `Cache-Control: no-store` | Корректно: самый чувствительный личный маршрут закрыт | — |
| 20 | — | ПРОЙДЕНО | `src/app/api/readiness/export/route.ts:157-168` | CSV готовности отдаётся с `cache-control: no-store` | Корректно | — |
| 21 | — | ПРОЙДЕНО | `deploy/Caddyfile.prod:51-54` | Caddy только проксирует, директива `cache`/`header Cache-Control` отсутствует | Caddy ответы не кэширует → прокси-теч из-за Caddy невозможен | — |
| 22 | — | ПРОЙДЕНО | `src/core/api-wrapper.ts:44-50,95-103` | Ключ серверного кэша содержит пользователя (sha256 хеш токена сессии + `x-acting-as`), теряется только при отсутствии токена (тогда общий 401) | Ответ, зависящий от пользователя, кэшируется per-session — «ключ без пользователя» не подтверждён | — |
| 23 | — | ПРОЙДЕНО | `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:51`; `node_modules/next/dist/server/route-modules/app-route/module.js` | Next 16 не добавляет `Cache-Control` к dynamic GET route handler (кэш — опция `export const dynamic='force-static'`, в проекте не используется) | Дефолт фреймворка не сохраняет ответ → сегодня авто-течи нет | — |
| 24 | — | ПРОЙДЕНО | `next.config.ts:114-116`; glob `public/sw.js`/`**/service-worker*` — пусто | Service worker и manifest отсутствуют (PWA снят 2026-05-24) | На вопрос (4): клиентского кэша, который надо чистить при выходе, нет | — |
| 25 | — | ПРОЙДЕНО | `src/lib/api.ts:184-216`; `src/lib/store.ts:105-113` | `logoutClient` отзывает сессию, `store.logout` обнуляет `currentUser`/`actingAs`/`selectedSiteId` | Смена пользователя на общем устройстве не оставляет прошлого пользователя в сторе | — |
| 26 | ГИПОТЕЗА | НЕ ПРОВЕРЕНО | `src/lib/api.ts:77-84` | `authFetch` не задаёт `cache:'no-store'` для GET | Браузер, вероятно, не кэширует JSON без свежести, но это не проверялось на реальных заголовках; могло бы проявляться как редкая устарелость между вкладками | Задать `cache:'no-store'` в чтениях либо централизованный `no-store` на маршрутах |
| 27 | мелочь | ПРОЙДЕНО | `src/app/layout.tsx:15` | `force-dynamic` объявлен в корневом layout — он управляет страницами, но не `route.ts` | Не покрывает API; можно ошибочно решить, что API «тоже no-store» | Полагаться на централизованный заголовок, а не на layout |
| 28 | ГИПОТЕЗА | НЕ ПРОВЕРЕНО | `src/proxy.ts:198-229` | `Vary` не устанавливается ни в proxy, ни в маршрутах (0 совпадений `Vary` в `src/`) | Точное поведение дефолтного `Vary` Next для route handler и поведение браузера/прокси в рантайме не проверялось | Явно ставить `Vary: Cookie, Authorization` на персональные ответы |

Итого с учётом обеих таблиц: персональных маршрутов без запрета кэша — 15+ (находки 1–16), явные `no-store` — 3 персональных (`knowledge-attempt`, `readiness/export`) и 1 служебный (`health/deep`).

## Не проверено

- **Реальные HTTP-заголовки ответов в рантайме.** Вывод об отсутствии `Cache-Control`/`Vary` сделан по коду и документации Next (`15-route-handlers.md:51`, `cache-control.js`, `app-route/module.js`), без `npm run build`/запуска сервера: сборке нужны env и БД. Как проверить: поднять образ и `curl -sI http://localhost:3000/api/users` / `/api/operator/shift` / `/api/reports/single-pdf?...` → смотреть `Cache-Control`, `Vary`, `ETag`.
- **Наличие кэширующего прокси/CDN перед приложением.** В репозитории есть только Caddy (без кэша), но что стоит перед ним в проде (провайдер, CDN, корпоративный прокси) — неизвестно, доступа к серверу нет. Именно от этого зависит реальность находок 1–4.
- **Эвристическое кэширование браузером** ответов без `Cache-Control`/`Last-Modified` (находка 26) — в браузере не воспроизводилось.
- **Число реплик приложения** (от него зависит, виден ли серверный кэш ответов между процессами; сейчас `deploy/Caddyfile.prod:51-54` проксирует на один `127.0.0.1:3000`, но это не доказательство одного контейнера). `docker-compose*`/`Dockerfile*` не читались как security-critical (AGENTS.md §1).
- **Полный перебор всех ~170 route-хендлеров** не делался: проверены запрошенные категории (смена, отчёты, наряды, профиль, ПИН) и все маршруты с явными кэш-заголовками/`cache:true`. Остальные GET-хендлеры не отдают личных данных (справочники, аналитика, телеметрия) либо покрыты находкой 1.
- **`x-acting-as` как ключ кэша**: значение — недоверенный заголовок; предполагается, что `requireAuth` не даёт подставить чужую роль (`api-wrapper.ts:34-38`). Проверка самой логики `requireAuth` — вне области этого аудита (`src/services/auth/**` — security-critical).
- Замороженные экраны (`src/components/piling/operator*`, ORION) читались только для контекста; клиентский `cache:'no-store'` в `operator-mobile/api.ts:371-372` отмечен, правок не требует.
