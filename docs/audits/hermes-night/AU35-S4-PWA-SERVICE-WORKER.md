# AU35-S4-PWA-SERVICE-WORKER: PWA и сервис-воркер — что кэшируется и как обновляется

Рабочая папка: `D:\PillingR\wt-night` (git worktree).
Версия кода: `git rev-parse HEAD` = `e2dcfe2d9187e86f70f3ed02f0660e1335486b2d` (ветка `hermes/q4-0926`).
Next.js 16.3.6 (`node -e "require('next/package.json').version"`), сборка `next build --webpack` (package.json).

## Итог

Сервис-воркера и PWA-manifest в продукте **нет** — они сняты осознанно 2026-05-24 (`next.config.ts:114-116`). Значит нет: офлайн-оболочки, cache-first/network-first стратегий, «обновления версии SW», авто-очистки Cache Storage при смене пользователя и офлайн-страницы. Браузер кэширует только статику `/_next/static/*` (immutable, имена с хешем — корректно) и то, что разрешат заголовки по умолчанию Next.
Кэширование в проекте живёт на трёх других уровнях: (1) HTTP-заголовки задаёт лишь Next по умолчанию — в `src/proxy.ts` и `next.config.ts` явного `Cache-Control` нет, явно он выставлен только в 3 API-маршрутах; (2) серверный in-memory кэш ответов (`src/core/cache/response-cache.ts`, TTL 10-60с + stale-while-revalidate 60с) для 12 GET-маршрутов; (3) клиентское состояние в localStorage (zustand persist + офлайн-очередь команд машиниста).
Ключевой остаточный риск: при обрыве сети работа возможна только через офлайн-очередь `operator-mobile` (localStorage); навигация/перезагрузка страницы офлайн отдаёт страницу браузера.
Всё найденное — уровня «мелочь»/«инфо»: критичных и «важно»-подтверждённых дефектов PWA/кэша нет. Итог по строкам таблицы: критично — 0, важно — 1 (серверный кэш при >1 реплике), мелочь — 5, инфо — 3.
Топ-5 по значимости: (1) офлайн = только очередь команд, `next.config.ts:114-116`; (2) серверный кэш per-process без сброса при выходе, `response-cache.ts:111-120`; (3) аутентифицированные API без явного `Cache-Control`, `api-wrapper.ts:144-145`; (4) устаревшая вкладка после деплоя без авто-обновления, `(app)/error.tsx:39-45`; (5) «полу-PWA» иконки без manifest/SW, `layout.tsx:66-98`.
Статусы: «нет сервис-воркера / нет manifest / нет next-pwa» — ПРОЙДЕНО; поведение дефолтных заголовков Next в рантайме и число реплик приложения — НЕ ПРОВЕРЕНО (см. одноимённый раздел).

## Методика (воспроизводимо)

Все команды выполнялись из корня `D:\PillingR\wt-night`. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

1. Версия и состояние:
   `git rev-parse HEAD` → `e2dcfe2d9187e86f70f3ed02f0660e1335486b2d`; `git branch --show-current` → `hermes/q4-0926`.
2. Поиск сервис-воркера и PWA-manifest (весь репозиторий, кроме `node_modules/.next/.git`):
   `find . -path ./node_modules -prune -o -name "sw*.js" -print` → только `./scripts/switch-db.js`.
   `find . -path ./node_modules -prune -o -name "manifest*.json" -print` → только `public/orion/specs/manifest.json` (это каталог спецификаций техники, не web-manifest) и его копия в `.next/standalone`.
   `grep -rniI --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.gitnexus "serviceworker\|navigator.serviceworker\|sw\.js\|next-pwa\|workbox\|registerSW" .` → в `src/` и `public/` совпадений НЕТ; совпадения только в `agents/**` (аудит-скрипты), `tests/manual-test-runner*.js` (браузерные проверки), `docs/archive/**` (история), `.claude/skills/**`, `node_modules/next/**`.
3. Зависимости: `node -e "…package.json deps…"` → среди `dependencies`/`devDependencies` нет `next-pwa`, `workbox-*`, `service-worker`.
4. Заголовки кэша в приложении: `search_files` по `Cache-Control|no-store|s-maxage|max-age|stale-while-revalidate|revalidate` в `src/` → явные `Cache-Control` только в трёх местах (см. таблицу). Прочитаны `next.config.ts` (секция `headers()`), `src/proxy.ts`, `deploy/Caddyfile.prod`.
5. Слой кэша приложения: прочитаны `src/core/api-wrapper.ts`, `src/core/cache/response-cache.ts`; `grep -rniI "cache:\s*true" src/app/api` → 12 маршрутов; `grep -rniI "localStorage\|indexedDB\|caches\." src` → клиентские хранилища.
6. Выход и смена пользователя: `src/app/api/auth/logout/route.ts`, `src/lib/api.ts` (`logoutClient`, `authFetch`), `src/lib/store.ts` (persist).
7. Устаревшая вкладка/ошибки загрузки: `src/app/(app)/error.tsx`, `src/app/global-error.tsx`, поиск `ChunkLoadError|location.reload|APP_VERSION`.
8. Поведение дефолтов Next 16: `context7` (`/vercel/next.js`) — «GET Route Handlers больше не кэшируются по умолчанию» (док. версии 15+); дефолтный заголовок статики `public, max-age=31536000, immutable` найден в `node_modules/next/dist/**` (`grep -rhoI`).

## Находки

Сервис-воркер и manifest: ПРОЙДЕНО (отсутствуют). Ниже — что кэшируется и остаточные риски. Каждый `path:line` открыт и проверен.

### Таблица 1. Что кэшируется / стратегия

| Ресурс | Стратегия | Файл:строка | Риск устаревшего ответа |
| --- | --- | --- | --- |
| Сервис-воркер (HTML/API/ассеты) | отсутствует | `next.config.ts:114-116` (комментарий о снятии PWA) | нет SW → нет кэш-стратегий и офлайн-оболочки |
| PWA-manifest (`/manifest.json`) | отсутствует | `src/app/layout.tsx:79-98` (в `metadata` нет поля `manifest`); файла `public/manifest.json` нет | установка как PWA невозможна |
| `/_next/static/*` (JS/CSS/шрифты, имена с хешем) | immutable, cache-first (браузер) | дефолт Next, найден в `node_modules/next/dist` (`public, max-age=31536000, immutable`) | отсутствует: имя меняется при изменении файла |
| HTML-страницы | no-store/не кэшируется: каждая страница рендерится по запросу | `src/app/layout.tsx:15` (`export const dynamic = 'force-dynamic'`) | отсутствует; страница всегда свежая (и nonce CSP пересчитывается) |
| API GET (по умолчанию) | динамический (не кэшируется Next) | `src/core/api-wrapper.ts:62-147`; поведение Next подтверждено через context7 | низкий; явного `Cache-Control` нет — см. находку 3 |
| `/api/health/deep` | `no-store, must-revalidate` | `src/app/api/health/deep/route.ts:64` | отсутствует (осознанно) |
| `/api/feedback/stream` (SSE) | `no-cache, no-transform` | `src/app/api/feedback/stream/route.ts:67` | отсутствует |
| `/api/operator/knowledge-attempt` | `no-store` | `src/app/api/operator/knowledge-attempt/route.ts:13` | отсутствует |
| 12 GET-маршрутов (sites, crews, equipment, reports, users, telegram, monitoring, feedback) | серверный in-memory кэш, TTL 10-60с + SWR 60с | `src/core/cache/response-cache.ts:42-46,111-120,148-153`; маршруты: `src/app/api/sites/route.ts:25`, `src/app/api/crews/route.ts:33`, `src/app/api/equipment/route.ts:28`, `src/app/api/reports/all/route.ts:36`, `src/app/api/users/route.ts:37` и др. | до TTL+60с может отдаваться прошлый снимок — см. находку 2 |
| Состояние пользователя (клиент) | localStorage (zustand persist), ключ `piling-track-storage` | `src/lib/store.ts:173-183` | при выходе сбрасывается (`store.ts:105-113`) |
| Офлайн-очередь команд машиниста | localStorage, ключ `pilingtrack.operator.queue.v1` | `src/components/piling/operator-mobile/offline-queue.ts:29` | записи прошлого сменщика ждут своего владельца (`offline-queue.ts:37-43`) — ПРОЙДЕНО |

### Таблица 2. Находки

| # | severity | path:line | Проблема | Сценарий / чем важно | Что сделать |
| --- | --- | --- | --- | --- | --- |
| 1 | мелочь | `next.config.ts:114-116` | Офлайн-оболочки нет: PWA снят, SW отсутствует | Оператор в кабине теряет сеть и нажимает «обновить» — получает страницу браузера «нет подключения», а не приложение. Уцелевает только уже открытый экран и офлайн-очередь (`offline-queue.ts:29`). Это осознанное решение, но офлайн-навигация отсутствует как класс. | Признать штатным; при требовании офлайн-навигации — отдельная задача с реальным SW (вне PWA-scope) |
| 2 | важно (при >1 реплике) | `src/core/cache/response-cache.ts:111-120,246-265`; `src/core/api-wrapper.ts:86-103` | Кэш ответов — in-memory `Map` в процессе; `invalidate()` при мутации сбрасывает только тот процесс, что обработал запись; выход пользователя кэш НЕ сбрасывает (ключ — хеш токена сессии, запись живёт до TTL+SWR, до ~120с) | Если приложение запущено в нескольких репликах, чтение с реплики B отдаёт данные до 120с после изменения на реплике A. На одной реплике (текущее развёртывание, `127.0.0.1:3000`) риска почти нет. Точное число реплик — НЕ ПРОВЕРЕНО | Либо зафиксировать одну реплику как контракт, либо вынести кэш в общий Redis (уже есть `getRedisClient`/`getStateRedisClient`) |
| 3 | мелочь | `src/core/api-wrapper.ts:144-145` (и весь `withApi`/`withMutation`) | Для аутентифицированных GET-ответов централизованно не ставится `Cache-Control`; явно он задан только в 3 маршрутах (см. табл.1) | Планшет на установке общий на сменщиков (`store.ts:174-181`, `offline-queue.ts:37-43`). Если браузер/прокси применит эвристическое кэширование к GET-ответу без заголовков, следующий сменщик может увидеть чужие данные. Вероятность низкая (Next 16 GET-хендлеры по умолчанию динамические, context7), но полагаться на дефолт в auth-пути — плохая практика | Проставлять `Cache-Control: private, no-store` для ответов после `requireAuth` в `withApi` (одно место, как `recordHttpRequest`) |
| 4 | мелочь | `src/app/(app)/error.tsx:39-45`; `src/app/global-error.tsx:41-54` | Нет проверки версии и авто-обновления после деплоя: устаревшая вкладка продолжает использовать старый JS | После выката держащаяся открытой вкладка при клиентском переходе может запросить чанк, чьё хеш-имя исчезло → ошибка → пользователь видит только «Повторить»/«Обновить» (`error.tsx:39-45`, `global-error.tsx:41-54`). Механизма «версия сборки изменилась — перезагрузиться» в коде нет (поиск `ChunkLoadError|location.reload|APP_VERSION` по `src/`) | Пока не критично; при частых деплоях — слушать `APP_VERSION` из layout и предлагать «Обновить» |
| 5 | мелочь | `src/app/layout.tsx:66-98` | «Полу-PWA»: есть `themeColor`, `viewportFit: 'cover'`, `apple-touch-icon`, но нет manifest и нет мета `apple-mobile-web-app-capable` | На iPhone «Добавить на экран» создаст ярлык, открывающийся в Safari (без автономного режима и без офлайна) — ожидание «устанавливаемого приложения» не выполняется. Косметика/ожидания, не сбой | Либо добавить `appleWebApp.capable` в `metadata`, либо убрать PWA-упоминания из комментариев `layout.tsx:71-76` |
| 6 | инфо (ПРОЙДЕНО) | `src/lib/store.ts:105-113`; `src/app/api/auth/logout/route.ts:19-23` | Смена пользователя на клиенте очищена: `logout()` обнуляет `currentUser/actingAs/selectedSiteId`, сервер отзывает сессию и запись кэша аутентификации | Смена сменщика на общем устройстве не оставляет прошлого пользователя в сторе. Это корректно | — |
| 7 | инфо (ПРОЙДЕНО) | `src/core/api-wrapper.ts:88` | `_ts` в query-строке отключает серверный кэш ответа (`!request.nextUrl.searchParams.has('_ts')`) | Клиент может осознанно обойти кэш; это механизм инвалидации, а не уязвимость | — |
| 8 | инфо | `node_modules/next/dist` (дефолт Next) | `/_next/static/*` → `Cache-Control: public, max-age=31536000, immutable` | Риск устаревания отсутствует: имена файлов хешированы по содержимому | — |

## Не проверено

- Точные HTTP-заголовки в реальном ответе (в т.ч. дефолтный `Cache-Control` для dynamic GET route handler и для HTML при `force-dynamic`). Вывод основан на коде и документации Next, без запуска `npm run build`/сервера: сборке нужны env-переменные и БД, которых в этой сессии нет. Как проверить: поднять прод-образ и `curl -sI http://localhost:3000/api/sites` / `curl -sI http://localhost:3000/` → смотреть `Cache-Control`.
- Число реплик приложения в проде и, как следствие, реальность риска находки 2 (кэш `response-cache.ts` не является общим между процессами). `docker-compose*`/`Dockerfile*` не читались как security-critical (AGENTS.md §1); `deploy/Caddyfile.prod:51-54` проксирует на один `127.0.0.1:3000`, что косвенно указывает на один процесс, но это не доказательство числа контейнеров.
- Поведение браузерного эвристического кэширования на общем планшете (находка 3) — не воспроизводилось в браузере.
- Есть ли в проде на сервере дополнительные заголовки кэширования, кроме `deploy/Caddyfile.prod` (например, на стороне CDN/прокси перед Caddy) — не проверено, доступа к серверу нет.
- Работа в офлайне очереди `operator-mobile` (`offline-queue.ts`) детально не аудировалась — это замороженная область (`src/components/piling/operator*`, AGENTS.md §1).
