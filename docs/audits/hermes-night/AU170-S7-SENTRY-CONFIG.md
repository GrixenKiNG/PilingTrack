# AU170-S7-SENTRY-CONFIG: Sentry — конфигурация и данные

Версия (git rev-parse HEAD): `acf1df7a31bf54b06f1cd6be061c064ac2673dd8`
Ветка: `hermes/q4-0926`. Дата аудита: 2026-10-10. Только чтение, файлы приложения не менялись.

## Итог

Найдено 16 пунктов: критично — 1, важно — 5, мелочь/инфо — 10.
Ошибки приложения уходят в Sentry через три конфига (`sentry.server.config.ts`,
`sentry.edge.config.ts`, `src/instrumentation-client.ts`) и отдельный модуль воркера
(`src/workers/unified-worker/sentry.ts`). Политика PII добросовестная: везде
`sendDefaultPii: false`, `enableLogs: false`, `setUser` не вызывается нигде; в тег идёт только
`domain`+путь без query (`src/core/api-wrapper.ts:129`).

Топ-5:
1. DSN зашит в код в 3 файлах и содержит буквальный `...` — не похоже на валидный ключ
   (`sentry.server.config.ts:8`, `sentry.edge.config.ts:9`, `src/instrumentation-client.ts:8`).
2. Воркер инициализируется из `SENTRY_DSN`, приложение — из зашитой строки: два разных
   источника одного факта (`src/workers/unified-worker/sentry.ts:24,31` vs `sentry.server.config.ts:8`).
3. Воркер не задаёт `environment` → на стенде (staging) его события уходят как `production`
   (`src/workers/unified-worker/sentry.ts:30`), тогда как app читает `SENTRY_ENVIRONMENT`.
4. `/api/system` показывает `sentry.configured=false` на бою: проверяет `SENTRY_DSN`, которого
   в контейнере `app` нет (`src/services/system/system-service.ts:63`, `docker-compose.yml:206` — только у воркеров).
5. `beforeSend`/`beforeBreadcrumb` нет нигде: текст исключения (в т.ч. из Prisma/сторонних
   библиотек) уходит как есть, кастомной чистки нет — держится только на `sendDefaultPii: false`.

## Методика

Что искал и как (повторяемо):
- `rg -l 'sentry'` по всему репо → 4 файла-конфига + модуль воркера; `rg '@sentry' --files`.
- `rg 'instrumentation'` → `src/instrumentation.ts`, `src/instrumentation-client.ts`.
- `sed -n '8p' sentry.server.config.ts | cat -A` — байтовый контроль значения DSN (есть ли реально `...`).
- `rg 'beforeSend|beforeBreadcrumb|setUser|setContext|captureException|Sentry\.' src` — точки отправки.
- `rg 'SENTRY_DSN|SENTRY_AUTH_TOKEN|SENTRY_RELEASE|SENTRY_ENVIRONMENT|SENTRY_ORG|SENTRY_PROJECT'` по `*.ts,*.tsx,*.yml,*.example`.
- `git log --oneline -S '3954e5' -- sentry.server.config.ts` — когда значение появилось.
- Проверка поведения SDK: `node_modules/@sentry/nextjs/build/cjs/server/index.js:98`,
  `node_modules/@sentry/core/build/cjs/constants.js` (`DEFAULT_ENVIRONMENT="production"`).
- Ручной разбор артефакта сборки `.next/static/chunks/main-app-*.js` — что реально попадает в бандл.

Таблица параметров (что отправляется и с какими настройками):

| параметр | значение | файл:строка | статус | риск |
|---|---|---|---|---|
| dsn (server) | `https://3954e5...dff0@o…ingest.de.sentry.io/4511443960332368` (буквальный `...`) | D:\PillingR\wt-night\sentry.server.config.ts:8 | ПРОЙДЕНО (факт документа); ГИПОТЕЗА (последствие) | критично |
| dsn (edge) | тот же | D:\PillingR\wt-night\sentry.edge.config.ts:9 | ПРОЙДЕНО | критично |
| dsn (client) | тот же, попадает в бандл браузера | D:\PillingR\wt-night\src\instrumentation-client.ts:8 | ПРОЙДЕНО (виден в .next/static/chunks/main-app-*.js) | важно |
| dsn (worker) | `process.env.SENTRY_DSN` | D:\PillingR\wt-night\src\workers\unified-worker\sentry.ts:24,31 | ПРОЙДЕНО | важно |
| enabled | `NODE_ENV === 'production'` (все 4 конфига) | sentry.server.config.ts:11; sentry.edge.config.ts:10; instrumentation-client.ts:9; workers/unified-worker/sentry.ts:32 | ПРОЙДЕНО | важно |
| environment | не задан явно; SDK: `SENTRY_ENVIRONMENT → NODE_ENV` | `node_modules/@sentry/nextjs/build/cjs/server/index.js:98` | ПРОЙДЕНО | важно |
| environment (worker) | не задан вовсе; воркер — `@sentry/node`, не nextjs | D:\PillingR\wt-night\src\workers\unified-worker\sentry.ts:30-36 | ПРОЙДЕНО | важно |
| tracesSampleRate (server/edge/worker) | 0.1 | sentry.server.config.ts:14; sentry.edge.config.ts:11; workers/unified-worker/sentry.ts:33 | ПРОЙДЕНО | мелочь |
| tracesSampleRate (client) | не задан; BrowserTracing вырезан из интеграций | D:\PillingR\wt-night\src\instrumentation-client.ts:23 | ПРОЙДЕНО | информ. |
| sendDefaultPii | false (все 4 конфига) | sentry.server.config.ts:17; sentry.edge.config.ts:12; instrumentation-client.ts:24; workers/unified-worker/sentry.ts:34 | ПРОЙДЕНО | информ. (плюс) |
| enableLogs | false (все 4 конфига) | sentry.server.config.ts:20; sentry.edge.config.ts:13; instrumentation-client.ts:25; workers/unified-worker/sentry.ts:35 | ПРОЙДЕНО | информ. |
| beforeSend / beforeBreadcrumb | отсутствуют | — (нет совпадений по `src` и корню) | ПРОЙДЕНО (нет) | важно |
| ignoreErrors | 4 regex, только на клиенте | D:\PillingR\wt-night\src\instrumentation-client.ts:28-33 | ПРОЙДЕНО | мелочь |
| tunnelRoute | `/_relay` | D:\PillingR\wt-night\next.config.ts:150 | ПРОЙДЕНО | информ. |
| sourcemaps.disable | `!SENTRY_AUTH_TOKEN` | D:\PillingR\wt-night\next.config.ts:154 | ПРОЙДЕНО | мелочь |
| deleteSourcemapsAfterUpload | true | D:\PillingR\wt-night\next.config.ts:158 | ПРОЙДЕНО | мелочь |
| release | `SENTRY_RELEASE` / `pilingtrack@<версия>` | D:\PillingR\wt-night\next.config.ts:163-171 | ПРОЙДЕНО | мелочь |
| widenClientFileUpload | true | D:\PillingR\wt-night\next.config.ts:132 | ПРОЙДЕНО | информ. |
| treeshake.removeDebugLogging | true | D:\PillingR\wt-night\next.config.ts:175 | ПРОЙДЕНО | информ. |
| silent | `!CI` | D:\PillingR\wt-night\next.config.ts:128 | ПРОЙДЕНО | мелочь |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | D:\PillingR\wt-night\sentry.server.config.ts:8 | DSN зашит строкой и содержит буквальный `...` в публичном ключе (`3954e5...dff0`). Ключ Sentry — 32 hex-символа, точки в нём недопустимы. | Факт (байты подтверждены `cat -A`) — да; следствие (SDK отклонит события 401 «invalid auth» и приложение не будет репортить ошибки вообще) — ГИПОТЕЗА, проверить без сети нельзя. Если это не артефакт редактирования, весь error-tracking молчит. | Убрать ключ из кода; передавать DSN через env (`SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`) и один раз проверить smoke-событие в проекте. |
| 2 | критично | D:\PillingR\wt-night\sentry.edge.config.ts:9; D:\PillingR\wt-night\src\instrumentation-client.ts:8 | Тот же невалидный DSN продублирован в edge- и клиентском конфиге; на клиенте он попадает в бандл (`.next/static/chunks/main-app-*.js`, литерал `dsn:"https://3954e5...dff0@…"`). | Те же последствия для edge-функций и всех браузерных ошибок; дублирование значения в трёх местах делает правку хрупкой. | Один источник DSN (env) на все рантаймы. |
| 3 | важно | D:\PillingR\wt-night\src\workers\unified-worker\sentry.ts:24,31 | Воркер: без `SENTRY_DSN` init не выполняется (SDK — no-op, `enabled` не влияет). При этом приложение DSN из env не читает. | Расхождение источников: если `SENTRY_DSN` не проброшен в контейнер `workers` (в `docker-compose.yml:206` он `:-` пустой по умолчанию), ошибки outbox/pdf/планировщиков уходят только в лог и теряются. Задать ли `SENTRY_DSN` в проде — НЕ ПРОВЕРЕНО (файл `.env` не читался по правилам). | Считать воркер и app одним источником DSN; выводить `logger.warn`, когда `SENTRY_DSN` пуст в `NODE_ENV=production`. |
| 4 | важно | D:\PillingR\wt-night\src\workers\unified-worker\sentry.ts:30-36 | Ручной `Sentry.init` воркера не задаёт `environment` и `release`. `@sentry/node` не читает `SENTRY_ENVIRONMENT` (в отличие от `@sentry/nextjs`), значит `DEFAULT_ENVIRONMENT="production"`. | На стенде (`docker-compose.staging.yml:36,44` ставит `SENTRY_ENVIRONMENT=staging`) ошибки app отделяются в `staging`, а ошибки воркеров одного и того же стенда падают в `production` того же проекта Sentry — стендовый шум портит прод-ленту и отпугивание по окружению не работает. | Добавить в init воркера `environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV` и `release` из того же источника, что у app. |
| 5 | важно | D:\PillingR\wt-night\src\services\system\system-service.ts:63 | `/api/system` считает `sentry.configured = Boolean(SENTRY_DSN || SENTRY_AUTH_TOKEN)`, но `app` не использует эти переменные (DSN зашит, `SENTRY_AUTH_TOKEN` — только build-time). В `docker-compose.yml` у сервиса `app` переменной `SENTRY_DSN` нет (только у `workers`, строка 206). | Диагностика врёт: на бою `/api/system` покажет «Sentry не настроен», хотя ошибки приложения уходят (или наоборот, при пустом `SENTRY_DSN` покажет `false`, скрыв реальную проблему #3). Владелец/дежурный принимает решение по недостоверному признаку. | Признак должен отражать фактическую инициализацию SDK (например, `Sentry.getClient() !== undefined`), а не наличие env-переменных, которых приложение не читает. |
| 6 | важно | (нет строки) — `src/**`, корень | `beforeSend` и `beforeBreadcrumb` не заданы ни в одном конфиге. | Текст исключения уходит как есть: сообщения Prisma называют таблицы/поля, ошибки сторонних библиотек могут содержать пользовательские значения; в breadcrumb браузера попадают URL (path без query — это плюс, вызовы fetch). Единственный барьер — `sendDefaultPii: false`, который чистит лишь стандартные поля (IP, cookies, заголовки). Кастомной редакции «своих» данных нет. | Добавить `beforeSend`, срезающий `event.extra`/`breadcrumbs.data` и локальные абсолютные пути; либо `scrubData`. |
| 7 | важно | D:\PillingR\wt-night\src\core\api-wrapper.ts:129 | Серверные 500 в `withApi` отправляются с `captureException(error, { tags: { domain, route: pathname } })` — тег `route` без query (это хорошо), но текст `error` не фильтруется. | Совпадает с #6: тела запросов и персональные данные из сообщений исключений могут попасть в Sentry. Отдельный риск — не ошибка обёртки, а отсутствие фильтра. | См. #6; при желании — резать длину сообщения перед отправкой. |
| 8 | важно | D:\PillingR\wt-night\sentry.server.config.ts:11; D:\PillingR\wt-night\sentry.edge.config.ts:10; D:\PillingR\wt-night\src\instrumentation-client.ts:9; D:\PillingR\wt-night\src\workers\unified-worker\sentry.ts:32 | `enabled: NODE_ENV === 'production'` во всех четырёх точках инициализации. | 1) Локальная разработка и тесты намеренно молчат (комментарий `sentry.server.config.ts:10` — это плюс). 2) Но и любой НЕ-прод рантайм, где `NODE_ENV` не равен ровно `'production'`, не репортит вовсе. В связке с #4 стенд и бой делят один проект Sentry без гарантированного разделения по окружению на стороне воркера. | Явный `environment` + отдельный DSN/проект для стенда; `enabled` по наличию DSN, а не по `NODE_ENV`. |
| 9 | мелочь | D:\PillingR\wt-night\src\instrumentation-client.ts:28-33 | `ignoreErrors` (chrome-extension, Network Error, chunk load, ResizeObserver) заданы только для браузера; у сервера/edge фильтров нет. | Сервер шумит сам: `Network Error`/chunk-ошибки там не возникают, но `ignoreErrors` для серверных шумов (например, обрыв соединения с БД/Redis, штатные `ECONNRESET`) не настроен — лента забивается повторами. | Добавить серверный набор `ignoreErrors` по факту шума. |
| 10 | мелочь | D:\PillingR\wt-night\src\instrumentation-client.ts:23 | Интеграция `BrowserTracing` вырезана, `tracesSampleRate` на клиенте не задан; замеры производительности в браузере выключены (комментарий 12.09.2026, падение LCP-обработчика SDK). | Намеренно; побочно — клиентские транзакции не собираются вовсе, распределённые по браузеру трейсы недоступны. | Оставить как есть до фикса в SDK; при возврате — снять фильтр интеграций и задать `tracesSampleRate`. |
| 11 | мелочь | D:\PillingR\wt-night\next.config.ts:154,158 | `sourcemaps.disable = !SENTRY_AUTH_TOKEN`; `deleteSourcemapsAfterUpload: true` выполняется только когда загрузка состоялась. | При отсутствии токена карты не загружены (читаемых стеков нет — это ожидаемо), но и не удалены. Публичной утечки, скорее всего, нет, т.к. `productionBrowserSourceMaps` не включён и Next карты не эмитит — ГИПОТЕЗА, не проверял фактический вывод сборки. | Убедиться, что в `standalone`-выводе нет `*.js.map` при пустом токене. |
| 12 | мелочь | D:\PillingR\wt-night\next.config.ts:128 | `silent: !process.env.CI` — молчание плагина включено вне CI. | Локально/на сервере при сборке без CI-переменной возможные проблемы загрузки карт и создания release печататься не будут. Мелочь, не влияет на рантайм. | Оставить; при разборе инцидентов сборки учитывать, что лог плагина подавлен. |
| 13 | мелочь | D:\PillingR\wt-night\next.config.ts:163-171 | `release` берётся из `SENTRY_RELEASE` либо `pilingtrack@${npm_package_version}`; в просмотренном клиентском чанке `globalThis.SENTRY_RELEASE=void 0`. | Если release не проставляется, привязка ошибок к релизу и аплоад карт расходятся. ГИПОТЕЗА: nextjs-сервер читает `_sentryRelease` из инъекции плагина (`node_modules/@sentry/nextjs/build/cjs/server/index.js:99`), поэтому в реальной сборке release может быть корректным — не проверено на прод-сборке. | На бою задать `SENTRY_RELEASE` явно (SHA деплоя) — тогда значение детерминировано. |
| 14 | информ. | D:\PillingR\wt-night\src\workers\unified-worker\*.ts (idempotency-cleanup-scheduler.ts:25, pdf.ts:3, pm-scheduler.ts:8, projection-rebuild-scheduler.ts:16, readiness-scheduler.ts:14, sentry.ts:16) | Все файлы воркера импортируют `@sentry/node`, а не `@sentry/nextjs`. | Правильно: образ `Dockerfile.workers` удаляет `node_modules/next` (строки 53-54), и `@sentry/nextjs` уронил бы воркер на импорте `next/constants` (комментарий `sentry.ts:5-11`). Держать так. | — |
| 15 | информ. | D:\PillingR\wt-night\src\proxy.ts:250-259 | Матчер прокси покрывает `/_relay` (не исключён), но ветка для не-`/api` возвращает `NextResponse.next()` — туннель не перехватывается. | Опасение из комментария `next.config.ts:148-149` («если proxy когда-нибудь закоротит этот путь») на текущем коде не реализовано: POST на туннель доходит до rewrite Sentry. ПРОЙДЕНО для этой версии. | Оставить тест-страж: POST `/_relay` не отвечает HTML/200 от страницы. |
| 16 | информ. | D:\PillingR\wt-night\src\workers\unified-worker\__tests__\sentry.test.ts:94-109 | Тест проверяет no-op без `SENTRY_DSN` и вызов init с ним, но не проверяет `environment`/`release`/`tracesSampleRate` в `init`. | Пробел покрытия ровно на находке #4: отсутствие `environment` у воркера тестом не ловится. | Добавить в тест проверку аргументов `init` (в т.ч. `environment`). |

## Приложение: остальные точки входа Sentry (path:line, сверх таблицы)

Отправка исключений (все — без обрезки текста, см. #6):

- src\app\error.tsx:21 — `Sentry.captureException(error)`
- src\app\global-error.tsx:17 — `Sentry.captureException(error)`
- src\app\(app)\error.tsx:23 — `Sentry.captureException(error)`
- src\components\piling\app-error-boundary.tsx:60 — `captureException(error, { extra: { componentStack } })`
- src\components\piling\to\readiness\boundaries\active-view-error-boundary.tsx:30 — то же
- src\core\api-wrapper.ts:129 — см. #7
- src\instrumentation.ts:8 — `onRequestError = Sentry.captureRequestError`
- src\instrumentation-client.ts:36 — `onRouterTransitionStart = Sentry.captureRouterTransitionStart`
- src\workers\unified-worker\readiness-scheduler.ts:49, projection-rebuild-scheduler.ts:39, pm-scheduler.ts:63,90, pdf.ts:103, idempotency-cleanup-scheduler.ts:44 — `captureException(error, { tags: { task } })`
- setUser / setContext / setTag / addBreadcrumb — не найдены нигде в `src` (значит, учётные данные пользователя к событиям не привязываются: это плюс для 152-ФЗ).

## Не проверено

1. Реальное поведение невалидного DSN с `...` (401/дроп) — нет доступа к Sentry и в сеть: ГИПОТЕЗА. Не исключено, что строку так подготовили для аудита, а на бою ключ иной — но в репозитории (включая initial commit `0616a7c7`) значение именно с `...`, другого источника DSN приложение не читает.
2. Задан ли `SENTRY_DSN` в прод-`workers` и пуст ли он — файл `.env` не читался (ограничение AGENTS.md §1). От этого зависит, работает ли воркерный Sentry (#3).
3. Что реально попадает в `event.request` и `breadcrumbs` на сервере (тела, headers) — не воспроизводил отправку события; суждение об отсутствии кастомной чистки (#6) основано на чтении кода, а не на дампе события.
4. Эмпирическая проверка release/`_sentryRelease` на прод-сборке (#13) — не собирал образ.
5. Наличие `*.js.map` в standalone-выводе при пустом `SENTRY_AUTH_TOKEN` (#11).
6. Содержимое существующих отчётов `docs/audits/**` (в т.ч. `AU95-S7-SENTRY-DATA.md`, `AU123`, `AU19`) не читалось — запрещено условием; возможны пересечения.
