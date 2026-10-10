# AU180-S7-DOCKER-IMAGE-SIZE-LAYERS — Образы Docker: размер и слои

Версия кода: `git rev-parse HEAD` = **ad2110c682f5adccb001805c88398bb5d1a6e566** (ветка `hermes/q4-0926`).
Аудит только на чтение: код приложения не менялся, создан только этот отчёт.

Область: `Dockerfile` и `Dockerfile.workers`. Смежное (только как контекст): `.dockerignore`,
`docker-compose.yml`, `next.config.ts`, `package.json`, `scripts/deploy-prod.sh`, тесты образа воркеров.

Числа сняты с локальных образов, собранных на этой машине (новейшие: теги `e6aef7a4`,
сборка 2026-10-10 18:11–18:19 MSK). Набор слоёв в `docker history` совпадает со строками
`COPY`/`RUN` текущих Dockerfile, но образы собраны не из `HEAD` — прямой причинной привязки
«HEAD → эти цифры» нет (см. «Что не проверено»).

## Итог

- Просмотрено: 2 Dockerfile (218 строк), `.dockerignore` (111 строк), compose, history трёх образов, содержимое двух образов через `docker run`.
- Находок: **22**: «важно» — **11**, «мелочь» — **9**, «ГИПОТЕЗА» — **2** (статус отдельного уровня важности не имеет, указан в колонке).
- Образы: `pilingtrack-app` **891 МБ**, `pilingtrack-workers` **1.29 ГБ**, `pilingtrack-migrate` **1.88 ГБ**; базовый `node:22-alpine` ≈ **177 МБ** (по слоям history).
- Топ-5 по потерям места:
  1. `Dockerfile.workers:53` — после `npm prune --omit=dev` в образе воркеров остаётся **733 МБ** `node_modules`, из которых ~**177 МБ** — пакеты сайта/сборки, недостижимые из графа воркера (lucide-react 45.4M, @sentry 89.2M, es-toolkit 17.8M, recharts 9.6M, framer-motion 7.0M и др.).
  2. `Dockerfile:103` — слой `@prisma` **175 МБ**, внутри `@prisma/studio-core` **42.2 МБ** (это Prisma Studio, дев-инструмент) и `@prisma/client/runtime` **71.1 МБ** wasm-компиляторов для mysql/sqlserver/sqlite/cockroachdb, хотя используется только postgresql.
  3. `Dockerfile:104` / `Dockerfile.workers:72` — в оба образа уезжает **21.2 МБ** `query_engine-windows.dll.node` (Windows-бинарник в Linux-образе), при этом ссылок на него в сгенерированном клиенте `0`.
  4. `Dockerfile:107` — `RUN apk add wget` стоит ПОСЛЕ больших `COPY`: любая правка исходников заново гоняет этот слой (сброс кэша).
  5. `Dockerfile.workers:72` — копируется весь `src` (**71.4 МБ**, включая `src/app` 2.9M, `src/components` 6.0M, тесты), хотя граф воркера — 138 файлов / 248 КБ в `src/workers`.

## Методика

- `git rev-parse HEAD`, `git status`, `git log -1 -- Dockerfile Dockerfile.workers .dockerignore`.
- Полные тексты: `Dockerfile` (119 стр.), `Dockerfile.workers` (99 стр.), `.dockerignore` (111 стр.),
  `Dockerfile.quick`, `deploy/Dockerfile.prod`, `scripts/Dockerfile.backup`, `package.json`,
  `next.config.ts`, `scripts/copy-standalone-assets.js`, `scripts/patch-postgres-client.js`,
  `scripts/deploy-prod.sh`.
- Кто использует образы: `search_files` по `dockerfile:`/`target:` в `docker-compose*.yml` —
  образы app/migrate/workers собирает только `docker-compose.yml` (строки 26–27, 63–64, 158–159).
- Размеры и слои (команды, без `--rm`, имена контейнеров `audit_*`):
  - `docker images --format '{{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}\t{{.ID}}'`;
  - `docker history --no-trunc --format '{{.Size}}\t{{.CreatedBy}}' pilingtrack-app:e6aef7a4` (и `...workers`, `...migrate:b6f51541`);
  - `docker run --name audit_* --entrypoint sh <image> -c 'du -sh ... ; ls ... ; npm ls ... ; find /app/src/generated ...'`.
- Граф импортов воркера: read-only скрипт (в scratch, не в репозитории) повторяет обход
  `no-next-in-workers.test.ts` от входа `src/workers/unified-worker.ts`, собирает внешние пакеты.
  Результат: **138 файлов, 9 внешних пакетов**: `@aws-sdk/client-s3`, `@prisma/adapter-pg`,
  `@sentry/node`, `ajv`, `ajv-formats`, `bullmq`, `dotenv`, `ioredis`, `pdfkit`.
- Проверка «мёртвого» Windows-бинарника: `grep -c "query_engine-windows.dll.node" src/generated/postgres-client/index.js src/generated/postgres-client/edge.js` → `0`.
- Проверка, кто тянет devDeps в образ воркеров: `npm ls --omit=dev typescript prisma playwright-core tailwindcss` внутри образа.

Снимок размеров образа app (`docker run ... du -sh /app/*`): `node_modules` 249.1M, `src` 57.2M
(`src/generated` 57.1M), `public` 22.4M, `prisma` 1.1M, `server.js` 12K. Снимок workers:
`node_modules` 733.4M, `src` 71.4M, `public` 2.6M, `prisma` 1.1M.

## Таблица слоёв

### Dockerfile (app `e6aef7a4`)

| # | Слой (снизу вверх) | Файл:строка | Размер слоя | Замечание |
| --- | --- | --- | --- | --- |
| 1 | base `node:22-alpine` | Dockerfile:4,20,54,73 | ≈177 МБ | Фиксированная база; см. находку 21 |
| 2 | `addgroup/adduser nextjs` | Dockerfile:77 | 41 КБ | ок |
| 3 | `apk add wget` | Dockerfile:107 | 3.44 МБ | стоит после COPY — сброс кэша (находка 4) |
| 4 | `COPY .next/standalone ./` | Dockerfile:95 | 206 МБ | включает `.next/server` 27.5M + трассированный node_modules |
| 5 | `COPY .next/static` | Dockerfile:96 | 6.93 МБ | ок |
| 6 | `COPY public` | Dockerfile:97 | 23.4 МБ | включает `public/orion` 11M (заморожено) |
| 7 | `COPY prisma` | Dockerfile:98 | 1.21 МБ | нужен ли рантайму — не проверено |
| 8 | `COPY node_modules/@prisma` | Dockerfile:103 | 175 МБ | studio-core 42.2M + client/runtime 71.1M (находки 2,3) |
| 9 | `COPY src/generated` | Dockerfile:104 | 59.9 МБ | в т.ч. Windows DLL 20.2M (находка 1) |

### Dockerfile.workers (`e6aef7a4`)

| # | Слой | Файл:строка | Размер слоя | Замечание |
| --- | --- | --- | --- | --- |
| 1 | base `node:22-alpine` | Dockerfile.workers:23,34,59 | ≈177 МБ | см. находку 21 |
| 2 | `apk add curl tini openssl` | Dockerfile.workers:63 | 12.4 МБ | стоит ДО COPY — кэш ок |
| 3 | `addgroup/adduser` | Dockerfile.workers:66 | 41 КБ | ок |
| 4 | `COPY node_modules` | Dockerfile.workers:71 | 769 МБ | `du` 733.4M (находки 10,11,13) |
| 5 | `COPY src` | Dockerfile.workers:72 | 74.9 МБ | весь исходник (находка 12 + 1) |
| 6 | `COPY prisma` | Dockerfile.workers:73 | 1.21 МБ | ок |
| 7 | `COPY public/fonts` | Dockerfile.workers:77 | 2.77 МБ | точечно — образец правильного подхода |
| 8 | `chown /app` | Dockerfile.workers:82 | 8 КБ | ок (замена `chown -R`) |

### Dockerfile migrate (`b6f51541`)

| # | Слой | Файл:строка | Размер слоя | Замечание |
| --- | --- | --- | --- | --- |
| 1 | base + `apk add openssl` | Dockerfile:54,56 | ≈184 МБ | ок |
| 2 | `COPY node_modules` (full deps) | Dockerfile:61 | 1.27 ГБ | devDeps целиком (находка 14) |
| 3 | `COPY prisma` + конфиг | Dockerfile:62,65 | 1.23 МБ | ок |
| 4 | `npx prisma generate` | Dockerfile:68 | 67.4 МБ | ок |

## Находки

| # | Severity | path:line | Проблема | Почему важно / сценарий | Что сделать |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `/Dockerfile:104` и `/Dockerfile.workers:72` (файл `src/generated/postgres-client/query_engine-windows.dll.node`) | В оба Linux-образа уезжает Windows-бинарник движка **20.2 МБ** (на диске 21.2 МБ). `grep -c` даёт **0** ссылок в `index.js` и `edge.js` (патч `scripts/patch-postgres-client.js:28` их удаляет). В образе воркера файл ещё и устаревший (Apr 21) при перегенерированном linux-движке (Oct 10). | Мёртвый вес ×2 образа + риск, что трейс/сканер считает это «рабочим» движком. | Исключить платформенные движки, не совпадающие с целевой: чистить `src/generated` перед `COPY`, либо `.dockerignore`/шаг `rm` Windows-файла. |
| 2 | важно | `/Dockerfile:103` (содержимое `node_modules/@prisma`) | Слой `@prisma` — **175 МБ**; внутри `@prisma/studio-core` **42.2 МБ** (это Prisma Studio — интерактивный дев-инструмент), `@prisma/engines` 23.8M, `@prisma/dev` 18.4M, `@prisma/fetch-engine` 2.8M. Рантайм приложения Studio не использует. | ~42 МБ на app; в воркерах та же ветка (см. 10). | Не копировать `@prisma/studio-core` (и, вероятно, `@prisma/dev`) в runner; либо prisma-graded install для рантайма. |
| 3 | важно | `/Dockerfile:103` (`node_modules/@prisma/client/runtime`) | `runtime` = **71.1 МБ**, почти целиком `query_compiler_*wasm-base64` для **mysql, sqlserver, sqlite, cockroachdb, postgresql**. Проект использует только postgresql (`DATABASE_PROVIDER=postgres`). | ~58 МБ неиспользуемых wasm на образ. | Ограничить провайдер (single-provider generate) или вычищать лишние wasm при сборке. |
| 4 | важно | `/Dockerfile:107` | `RUN apk add --no-cache wget` расположен **после** тяжёлых `COPY` (строки 95–104). | Любая правка исходников/ассетов меняет вышележащий слой → этот `apk` слой пересобирается, кэш Docker бьётся на самом дешёвом шаге. | Перенести установку OS-пакетов ДО копирования артефактов (рядом с `Dockerfile:77`). |
| 5 | важно | `/Dockerfile:37` + `/Dockerfile:40` | `COPY . .` целиком, и только потом `npx prisma generate`; любое изменение любого исходника инвалидирует generate. Плюс `prisma generate` выполняется **дважды** за сборку: строка 40 и внутри `npm run build` (`package.json:8` → `db:generate`). | +время сборки; повторная генерация клиента — чистые накладные расходы и лишний слой. | Копировать `prisma/` и конфиг до `COPY . .`, генерацию — до копирования исходников; убрать дубль generate. |
| 6 | важно | `/Dockerfile.workers:53` | После `npm prune --omit=dev` в образе воркеров осталось **733.4 МБ** `node_modules`, включая пакеты, недостижимые из графа воркера: `lucide-react` 45.4M, `@sentry` (весь scope) 89.2M, `es-toolkit` 17.8M, `recharts` 9.6M, `framer-motion` 7.0M, `react-dom` 7.8M, `@reduxjs` 6.3M, `@visx` 4.3M, `@radix-ui` 3.5M, `elkjs` 7.7M. Граф воркера — 138 файлов, только 9 внешних пакетов (см. «Методика»). | Образ воркеров (1.29 ГБ) больше образа app (891 МБ) — вопреки заявленной цели «воркеры легче». На VPS 30 ГБ это десятки МБ на каждый деплой и на каждый откатный образ. | Ставить рантайм-зависимости воркера явно (отдельный список/prune по графу), а не полным деревом prod-deps сайта. |
| 7 | ГИПОТЕЗА | `/Dockerfile.workers:53` (причина) | Оставшиеся big-packages тянутся каскадом `@prisma/client@7.10.0 → prisma@7.10.0 → @prisma/studio-core → react-dom/@radix-ui/elkjs`. Проверено `npm ls --omit=dev` внутри образа. | Объясняет, почему простой `npm prune` не помогает: UI-пакеты приходят как prod-транзитивные от prisma CLI. | Тот же вывод, что в 6: изолировать рантайм-набор воркера от CLI-транзитивов. |
| 8 | важно | `/Dockerfile.workers:54` | Удаляются `next`, `@next`, `@img`, `sharp`, но их **hoisted**-зависимости остаются: `webpack` 12.7M, `@babel` 10.2M, `@esbuild` 10.9M. `next` в образе отсутствует (проверено `ls`), а его сборочный тулчейн — нет. | ~34 МБ сборочного тулчейна Next в рантайме воркеров. | Явно удалять тулчейн Next (`webpack`, `@babel`, `@esbuild`, `terser`, `@webassemblyjs`) либо собирать дерево точнее. |
| 9 | ГИПОТЕЗА | `/Dockerfile:95` | Standalone-набор app содержит сборочные пакеты: `webpack` 11.4M, `@esbuild` 10.9M, `terser` 1.1M, `caniuse-lite` 2.4M, `acorn`, `@webassemblyjs`. | ~26 МБ в рантайме app, если они реально не требуются. Рантайм-использование не проверялось. | Проверить трассировку (`outputFileTracingExcludes` в `next.config.ts:50`) и при подтверждении исключить. |
| 10 | важно | `/Dockerfile.workers:71` | В `node_modules` воркеров дублируется та же дорогая `@prisma`-ветка, что и в app: **166.7 МБ** на scope, включая `@prisma/studio-core`, `@prisma/client/runtime` (wasm всех СУБД). | Те же ~100 МБ, что в находках 2–3, только в образе воркеров. | См. 2–3. |
| 11 | важно | `/Dockerfile.workers:72` | Копируется **весь** `src` — **71.4 МБ**, из них `src/generated` 57.1M, а также `src/app` 2.9M, `src/components` 6.0M, `src/modules` 3.0M, `src/services` 0.77M, `src/test`, `src/__tests__`, `src/proxy.ts`, `src/instrumentation.ts`. Воркеру нужны `src/generated` + граф `src/workers` (248 КБ) и его зависимости. | ~13 МБ лишнего исходника сайта (страницы/компоненты) в образе воркеров. | Копировать только `src/generated` и граф воркера, либо собирать воркер в bundle. |
| 12 | мелочь | `/Dockerfile.workers:40` + `/Dockerfile.workers:43` + `/Dockerfile.workers:48` | `db:generate` пишет клиент в `src/generated`, поэтому `COPY src` обязан идти до генерации, и любое изменение любого файла `src` инвалидирует шаг генерации. | Сброс кэша на дешёвом шаге, ускоряемо. | При выносе клиента в отдельный каталог — копировать `src` после generate. |
| 13 | мелочь | `/Dockerfile.workers:53` (`node_modules/prisma`, `node_modules/typescript`) | В образе воркеров остаются `prisma` CLI **40.2 МБ** и `typescript` **23.6 МБ**. Причина — `@prisma/client → prisma → @prisma/dev → valibot → typescript` (`npm ls` внутри образа). `vitest`, `eslint`, `jsdom`, `happy-dom` при этом удалены. | ~64 МБ dev-инструментов (CLI генератора, компилятор) в рантайме воркеров. | См. 6–7. |
| 14 | важно | `/Dockerfile:54` (`migrate`) | Стадия `migrate` копирует полный `node_modules` из `deps` (**слой 1.27 ГБ**, образ **1.88 ГБ**) — со всеми devDeps, `next`, `@prisma/studio-core`. Сервису нужен только `prisma` CLI + `tsx` + сгенерированный клиент. | Самый большой образ в проекте — почти 2 ГБ ради `prisma migrate deploy`; на VPS это заметная доля диска на каждый деплой. | Собрать отдельное тонкое дерево для migrate (install только нужного/prune), либо вынести в лёгкий sidecar. |
| 15 | мелочь | `/Dockerfile:98` | В runner копируется `/app/prisma` (1.2 МБ) с миграциями и `schema.prisma`. Рантайм приложения миграции не выполняет (это делает сервис `migrate`, `docker-compose.yml:23–27`). | Небольшой лишний вес; возможная путаница «кто владеет схемой». | Проверить, читает ли рантайм `schema.prisma` (не проверено) — если нет, не копировать. |
| 16 | мелочь | `/Dockerfile:8` | `apk add --no-cache libc6-compat python3 make g++` в стадии `deps`, при этом `npm ci --ignore-scripts` (строка 15) отключает сборочные скрипты — нативный компилятор/интерпретатор не запускаются. | `python3`/`make`/`g++` не нужны: замедляют и утяжеляют промежуточную стадию `deps` (в финальный образ не попадают). | Убрать `python3 make g++` (оставить `libc6-compat`), если сборка проходит без них. |
| 17 | мелочь | `/.dockerignore` (нет строки для `*.tsbuildinfo`) | `tsconfig.tsbuildinfo` (**1.0 МБ**) не исключён и уезжает в контекст сборки через `COPY . .` (`Dockerfile:37`). | Лишний мегабайт в контексте + его изменение инвалидирует слой `COPY . .`. | Добавить `*.tsbuildinfo` (или `tsconfig.tsbuildinfo`) в `.dockerignore`. |
| 18 | мелочь | `/.dockerignore:44–59` | Не исключены каталоги `reports/`, `chaos/`, `performance/`, `load-tests/`, `observability/`, `security/`, `messages/`, `deploy/`, `config/` (суммарно ≈0.3 МБ по `du`). | Вклад в контекст мал, но `examples`, `docs`, `scripts` уже исключены — списки несогласованы. Отдельные из этих папок могут разрастись. | Дополнить `.dockerignore` по образцу уже исключённых дев-каталогов. |
| 19 | мелочь | `/Dockerfile.workers:14–17` | Комментарий-обоснование («образ воркеров 0.76 ГБ против 2.46 ГБ; app 0.76 ГБ») не соответствует факту: app **891 МБ**, workers **1.29 ГБ**. | Вводящие в заблуждение числа: воркеры сейчас **больше** app, а не легче. | Обновить комментарий реальными числами (`docker images`), убрать устаревший ориентир 0.76 ГБ. |
| 20 | мелочь | `/Dockerfile.quick`, `/deploy/Dockerfile.prod`, `/scripts/Dockerfile.backup` | Ни один из них не используется сборкой: `search_files` по `dockerfile:`/`target:` в `docker-compose*.yml`, `scripts/deploy-prod.sh`, `scripts/staging-local.sh` ссылается только на `Dockerfile` и `Dockerfile.workers`. `Dockerfile.quick` к тому же глушит ошибки (`|| true`, `|| echo`), а `deploy/Dockerfile.prod` делает `npm prune --production` и `chown -R` (дублирующий слой, чего явно избегает `Dockerfile.workers:69–70`). | Мёртвые файлы сборки: могут быть запущены по ошибке и дать незамеченный мусорный образ («сборка прошла» при `|| true`). | Проверить отсутствие ссылок (сделано) и либо удалить, либо явно пометить как неиспользуемые. Правки не вносил (задача read-only; `Dockerfile*` — security-critical, AGENTS.md §1). |
| 21 | мелочь | `/Dockerfile:4`, `/Dockerfile.workers:23`, `/Dockerfile:73` | Базовый `node:22-alpine` ≈ **177 МБ** (слои history: 162+9.08+5.48 МБ) — ~20% образа app и ~14% образа воркеров. | Фиксированный пол снизу для всех трёх образов. | Для воркеров/миграций можно рассмотреть более тонкую базу; для app — только при отсутствии зависимостей от Node-инструментов. |
| 22 | мелочь | `/Dockerfile:38`, `/Dockerfile.workers:44` | `COPY . .` / `COPY src ./src` идят **до** `.dockerignore`-исключений «черновиков ОРИОН» — сами страницы исключены (`/.dockerignore:109–111`), но `public/orion` (**11 МБ**) остаётся и копируется в app (`Dockerfile:97`). | ORION — замороженная зона (AGENTS.md §1); вес не критичен, но это подтверждает, что тяжёлые ассеты сайта в образе. | Решение владельца (зона заморожена) — не трогаю, фиксирую факт. |

## Что не проверено

- **Свежая сборка из HEAD не запускалась.** Все цифры — с уже существующих локальных образов `e6aef7a4` (2026-10-10 18:11–18:19 MSK). Структура слоёв совпадает со строками текущих Dockerfile, но байт-в-байт соответствие `HEAD → эти образы` не подтверждено. Полный `docker build` (нужен сетевой доступ и время) не выполнялся.
- **Точный размер контекста сборки не измерен**: `docker build` не запускался, `du` по каталогам — только косвенная оценка (находки 17–18).
- **Рантайм-необходимость пакетов из находок 8–9 (`webpack`, `@esbuild`, `terser`, `caniuse-lite`) не подтверждена**: не проверял, тянет ли их серверный рантайм Next 16 в standalone. Возможно, часть нужна.
- **Найдённые 9 пакетов графа воркера — только статические прямые импорты**; транзитивные зависимости этих 9 пакетов не обходились, поэтому «мёртвые» пакеты определены по признаку «не в прямом графе + не транзитивны от 9», без полного транзитивного доказательства.
- **Нужен ли образу app файл `/app/prisma`** (находка 15) в рантайме — не проверял (нет запуска приложения из образа).
- **Безопасно ли удаление `@prisma/studio-core`/лишних wasm** — не проверял: приложение из усечённого дерева не запускалось.
- **Причины различий размеров `docker images` (891 МБ) и суммы слоёв history (~648 МБ)** не разбирал.
- Проверки из AGENTS.md §6 (`npx tsc`, `npm run lint`, `npm run test:unit`, `npm run build`) **не выполнялись**: задача read-only, код не менялся; к тому же они не относятся к размеру образов.
- Отчётные числа «≈177 МБ базы» — сумма трёх слоёв history базового образа, `docker images node:22-alpine` локально не тегирован (собирался BuildKit по дайджесту).
