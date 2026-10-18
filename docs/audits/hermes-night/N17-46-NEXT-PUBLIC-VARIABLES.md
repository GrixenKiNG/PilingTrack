# N17-46-NEXT-PUBLIC-VARIABLES: Переменные NEXT_PUBLIC_ — не попадает ли секрет в браузер

**Версия:** `c7fe2a28e8fbb65f311c393d55df1be9e8b2cf36` (ветка `hermes/code-1011`, git worktree `D:/PillingR/wt-night-code`).
**Тип:** независимый аудит, только чтение. Код приложения не менялся, создан только этот отчёт.

## Итог

- В коде найдено **3** переменные `NEXT_PUBLIC_`: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL`. Ни одна не похожа на ключ, токен, пароль или адрес внутреннего сервиса — это публичные URL и булев флаг.
- **В клиентский бандл реально попадает только одна** — `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` (`src/components/piling/to/to-module.tsx:1,128-129`, файл с `'use client'`), значение — булев флаг UI. Секрета в браузер не уходит.
- Остальные две читаются только в серверном коде (`src/proxy.ts`, `src/app/sitemap.ts`, `src/app/orion/page.tsx`) — в браузер не встраиваются.
- Серверные секреты (`SESSION_SECRET`, `DEVICE_KEY_LOOKUP_SECRET`, `PIN_LOOKUP_SECRET`, `ENCRYPTION_KEY*`, `DATABASE_URL`) в клиентских файлах **не читаются**: пересечение 284 клиентских файлов и 82 файлов с `process.env` дало ровно один обычный клиентский файл — `to-module.tsx`.
- Находки по серьёзности: **критично 0, важно 2, мелочь 5**.
- Топ-5: (1) `NEXT_PUBLIC_APP_URL` управляет белым списком CORS без валидации (`src/proxy.ts:31-32`); (2) ни одна `NEXT_PUBLIC_*` не передана как build-arg в `Dockerfile`/compose → в прод-сборке они `undefined`; (3) флаг `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` виден в бандле; (4) Sentry DSN зашит в клиентский файл вместо `NEXT_PUBLIC_SENTRY_DSN`; (5) `process.env.NODE_ENV` читается в `instrumentation-client.ts` (разрешено, не секрет).
- Статусы: таблица переменных — **ПРОЙДЕНО**; гипотезы отмечены явно («ГИПОТЕЗА»). Реальные значения прод-переменных не читались (`.env*` вне доступа по AGENTS.md §1).

## Методика

Команды воспроизводимы, выполнялись из `D:/PillingR/wt-night-code` (bash):

1. Версия: `git rev-parse HEAD` → `c7fe2a28e8fbb65f311c393d55df1be9e8b2cf36`; `git branch --show-current` → `hermes/code-1011`.
2. Поиск переменных (как в задании): `rg -n 'NEXT_PUBLIC_' src next.config.ts docker-compose*.yml Dockerfile*` → 6 строк в 4 файлах (см. таблицу).
3. Полный обратный поиск по репозиторию (без `.env*`, без заморожённых зон в смысле правок): `rg -n 'NEXT_PUBLIC_' --glob '!node_modules' --glob '!.next' --glob '!.git' --glob '!*.env*' .` → те же 3 имени; прочие совпадения — только в `docs/**` (прошлые аудиты) и `*.md`.
4. Поиск потребителей `process.env`: `rg -l 'process\.env' src` → 82 файла.
5. Поиск клиентских файлов: `rg -l '^[\x27"]use client[\x27"]' src` (файлы с директивой в первых 400 байтах) → 284 файла. Пересечение двух списков вычислено скриптом на Node (Python в среде нет) — итог: `src/components/piling/to/to-module.tsx`.
6. Проверка других каналов инлайна: `next.config.ts` (блок `env`, `publicRuntimeConfig`), `rg -n 'NEXT_PUBLIC_' e2e tests scripts public package.json *.config.*` (0 совпадений), `rg -n 'process\.env\.[A-Za-z_]+' src/instrumentation-client.ts`.
7. Точечное чтение файлов-потребителей: `src/proxy.ts` (15-36), `src/app/sitemap.ts` (1-21), `src/app/orion/page.tsx` (1-30), `src/components/piling/to/to-module.tsx` (1-40, 110-149), `src/components/piling/to/__tests__/to-module-shell.test.tsx` (303-314), `src/instrumentation-client.ts` (1-40), `next.config.ts` (1-178).
8. Проверка проброса в сборку: `rg -n 'NEXT_PUBLIC_|ARG |ENV ' Dockerfile Dockerfile.workers Dockerfile.quick deploy/Dockerfile.prod docker-compose*.yml` → ни одного `NEXT_PUBLIC_`.

## Таблица переменных

| переменная | где используется (path:line) | клиентский ли | что за значение | риск |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `src/proxy.ts:31-32` | нет (proxy/Edge, серверная сторона) | Публичный адрес приложения; добавляется в белый список CORS как доверенный origin | Секрета нет. Риск — от него зависит CORS-политика, но валидации значения нет (нах. №1). В браузер не встраивается, т.к. ссылок в клиентском коде нет |
| `NEXT_PUBLIC_SITE_URL` | `src/app/sitemap.ts:10`; `src/app/orion/page.tsx:10,12` | нет (серверные файлы: `sitemap` и `metadata` страницы ORION) | Публичный адрес сайта; дефолт `https://orionpiling.ru` | Секрета нет. ORION — замороженная зона, только фиксация (нах. №4) |
| `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` | `src/components/piling/to/to-module.tsx:1,128-129`; тест `src/components/piling/to/__tests__/to-module-shell.test.tsx:309` | **да** — файл с `'use client'`, значение инлайнится в клиентский чанк | Булев флаг: оболочка `/admin/to` в режиме production shell, если значение не равно строке `'false'` | Секрета нет. Значение любого пользователя видно в бандле; флаг по умолчанию включён и не проброшен в сборку (нах. №2, №3) |

Дополнительно (не `NEXT_PUBLIC_`, но тот же механизм инлайна): `next.config.ts:21-23` `env: { APP_VERSION: ... }` — `APP_VERSION` подставляется в скомпилированный код; чтений в клиентских файлах не найдено (только `src/app/api/health/route.ts:52`, `src/app/api/metrics/route.ts:95`, `src/core/observability/health-checks.ts:182`, `src/core/observability/health-tracker/aggregate.ts:120`). Не секрет (build SHA).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/proxy.ts:31-32` | `NEXT_PUBLIC_APP_URL` добавляется в белый список CORS **без проверки схемы и хоста**: `if (process.env.NEXT_PUBLIC_APP_URL) origins.push(process.env.NEXT_PUBLIC_APP_URL)`. Значение подставляется как есть, сравнение в `isOriginAllowed` идёт по точному совпадению или по шаблону `*.` (`src/proxy.ts:46-55`). Статус: ПРОЙДЕНО (факт добавления и отсутствие валидации видны в коде). Что реальное прод-значение корректно — ГИПОТЕЗА (`.env*` не читал). | У `Access-Control-Allow-Credentials: true` (`src/proxy.ts` далее по файлу, подтверждается прошлыми аудитами, напр. `docs/audits/hermes-night/R64-session-security.md:112`). Если в переменную попадёт значение с ошибкой (лишний origin, `*`, чужой домен), белый список расширится, и межсайтовые запросы с сессией начнут проходить. Не утечка секрета, но публичная (запекаемая) переменная управляет политикой безопасности без валидации. | Валидировать через `new URL()`, требовать `https:` и не пускать `*`; иначе `logger.warn` и не добавлять. Настройку CORS держать в серверном `CORS_ALLOWED_ORIGINS`, а не в `NEXT_PUBLIC_*`. |
| 2 | важно | `Dockerfile:33-34,84-85`; `docker-compose.yml` (0 совпадений `NEXT_PUBLIC_`) | Ни одна `NEXT_PUBLIC_*` не передана как build-arg. Next инлайнит `NEXT_PUBLIC_*` **на сборке**; в прод-образе они окажутся пустыми. Статус: ПРОЙДЕНО (проверено: в `Dockerfile`/`Dockerfile.workers`/`Dockerfile.quick`/`deploy/Dockerfile.prod`/compose только `APP_VERSION` как `ARG/ENV`). | В проде: `NEXT_PUBLIC_APP_URL` = `undefined` → origin из него в CORS не добавится; `NEXT_PUBLIC_SITE_URL` = дефолт (`https://orionpiling.ru`); `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` = включён. Изменить их без пересборки нельзя. Это не про утечку секрета, а про то, что публичные значения вообще не доходят до бандла. | Если значения нужны — добавить `ARG`+`ENV` в builder-стадию и передавать через `build.args`; иначе осознанно оставить дефолты. |
| 3 | мелочь | `src/components/piling/to/to-module.tsx:1,128-129` | `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` — **единственная** `NEXT_PUBLIC_` в клиентском бандле (файл `'use client'`, чтение на верхнем уровне модуля). Статус: ПРОЙДЕНО. | Любой посетитель видит значение флага в чанке. Значение — булев переключатель UI, секрета нет; риск ограничен раскрытием внутреннего названия флага. Дизайн `NEXT_PUBLIC_` для флага корректен. | Оставить; при желании показать флаг через серверный проп. |
| 4 | мелочь | `src/app/sitemap.ts:10`; `src/app/orion/page.tsx:12` | `NEXT_PUBLIC_SITE_URL` используется только в серверных файлах; дефолт — боевой домен `https://orionpiling.ru`. Статус: ПРОЙДЕНО. | Секрета нет. При переносе на новый домен без этой переменной карта сайта и canonical укажут старый домен (перекликается с `docs/audits/hermes-night/W108-HARDCODED-HOSTS.md:43`). `src/app/orion/**` — замороженная зона, здесь только фиксация. | Не трогать зону; для `sitemap.ts` держать домен в одном месте. |
| 5 | мелочь | `src/instrumentation-client.ts:9` | В **клиентском** файле Sentry DSN зашит строкой, а не прочитан из `NEXT_PUBLIC_SENTRY_DSN`. Статус: ПРОЙДЕНО (строка в коде). Значение — публичный DSN Sentry (по дизайну не секрет). | DSN виден в браузерном бандле и в сетевых запросах. Это публичный ключ, но жёсткий адрес SaaS-хоста в бандле и необходимость пересборки при смене проекта. Тот же DSN лежит в `sentry.server.config.ts:9` и `sentry.edge.config.ts:10` (вне `src/`, серверные). | Читать из `process.env.NEXT_PUBLIC_SENTRY_DSN` (пробросить build-arg), чтобы менять без правки кода. Не срочно. |
| 6 | мелочь | `src/instrumentation-client.ts:10` | Клиентский файл читает `process.env.NODE_ENV` — формально `process.env` без префикса `NEXT_PUBLIC_`. Статус: ПРОЙДЕНО. | Next сам инлайнит `NODE_ENV`; это не секрет (значения только `production`/`development`/`test`). Утечки нет; строка приведена для полноты проверки «не читается ли `process.env` без `NEXT_PUBLIC_`». | Оставить. |
| 7 | мелочь | `next.config.ts:21-23` | Блок `env` инлайнит `APP_VERSION` в скомпилированный код (в т.ч. туда, где он упомянут). Статус: ПРОЙДЕНО (чтения найдены только в серверных файлах: `src/app/api/health/route.ts:52`, `src/app/api/metrics/route.ts:95`, `src/core/observability/health-checks.ts:182`, `src/core/observability/health-tracker/aggregate.ts:120`). | `APP_VERSION` — build SHA, не секрет. В клиентский бандл не попадает, т.к. клиентских чтений нет. Механизм `env` в `next.config.ts` — ещё один канал инлайна, который стоит держать под контролем. | Оставить; следить, чтобы в `env` не добавлялись секреты. |

Общий вывод по вопросу задания: **секрет в браузер через `NEXT_PUBLIC_` не уходит**. Кандидатов вида `*_KEY/_TOKEN/_SECRET/_PASSWORD` среди `NEXT_PUBLIC_` в коде нет; серверные секреты в клиентских компонентах не читаются.

## Не проверено

- **Файлы `.env*` не открывались** (запрет AGENTS.md §1 «No secrets» и правило задания). Поэтому: (а) реальные значения `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` в окружении не подтверждены; (б) если в `.env.example`/`.env.production.example`/`.env.docker.example` (существуют, найдены `glob`) объявлена ещё какая-то `NEXT_PUBLIC_*`, которой нет в коде, она в этом отчёте не учтена. Проверить можно только с разрешением на чтение этих файлов (либо `rg '^NEXT_PUBLIC_'` по ним без вывода значений).
- **Содержимое собранного клиентского бандла не проверялось** (`npm run build` не выполнялся, `.next` не инспектировался). Вывод «в бандл попадает только флаг» получен статически (директива `'use client'` + ссылки в коде), а не grep’ом по артефактам сборки.
- **Поведение Next.js 16 / webpack при инлайне `NEXT_PUBLIC_*`, отсутствующих в build-args** (нах. №2) — по документации Next переменные инлайнятся на сборке; точный результат для этой прод-сборки (`next build --webpack`) не воспроизводился. ГИПОТЕЗА.
- **Клиентские файлы вне `src/`** (например, если бы были в `public/` или корне) не анализировались на `process.env` — проверялся только `src/` (по заданию). Обратные поиски `rg` по `e2e tests scripts public package.json *.config.*` дали 0 совпадений `NEXT_PUBLIC_`.
- **Пересечение «клиентский файл × process.env»** вычислялось эвристикой (директива `'use client'` в первых 400 байтах файла) — это стандартное расположение директивы, но файлы, где `'use client'` стоит не в начале (невалидно для Next), могли бы быть пропущены.
