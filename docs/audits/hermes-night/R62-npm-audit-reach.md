# R62 — npm audit: достижимость `deepmerge-ts` и `mysql2` в образах PilingTrack

Повод: `npm audit` показывает 4 уязвимости **high**, две из них — `deepmerge-ts <8.0.0`
(через `@prisma/config` → `prisma`) и `mysql2 <=3.23.0` (через `prisma`); единственный
предлагаемый «фикс» — `npm audit fix --force`, который откатывает `prisma` 7.10.0 → 6.19.3
(мажор назад, несовместимо с уже применёнными миграциями). Задача — решить не «что показывает
сканер», а **доходит ли уязвимый код до боевых образов и исполняется ли он в рантайме**.

Смотрел только чтение: `package.json`, `package-lock.json`, `Dockerfile*`,
`docker-compose*.yml`, `prisma.config.ts`, `prisma/schema.prisma`, `src/lib/db.ts`,
`.dockerignore`, содержимое `node_modules/prisma` и `node_modules/@prisma/config`,
артефакты сборки `.next`. Репозиторий не изменялся, `.env*` не открывались.
Frozen-зоны (operator-экраны, ORION) не затрагивались.

## Итог

- **критично — 0**, **важно — 2**, **мелочь — 5** (все 7 ниже, приложений нет).
- **Главная находка:** `prisma` объявлен `devDependency` (`package.json:146`), но npm держит
  его **в прод-дереве**: `@prisma/client@7.10.0` объявляет `prisma` опциональным peer-ом, и в
  lock-файле у `prisma`, `mysql2`, `deepmerge-ts`, `@prisma/config` **нет флага `dev`**
  (`package-lock.json:12618,11697,8405,2916`; у `vitest` он есть — `package-lock.json` devDep-таблица).
  Это доказано машинно: `npm ls --omit=dev --all` печатает `@prisma/client → prisma@7.10.0 →
  @prisma/config@7.10.0 → deepmerge-ts@7.1.5` и `mysql2@3.15.3`. Следствие: `npm prune --omit=dev`
  в `Dockerfile.workers:53` уязвимые пакеты **не удаляет**, и они уезжают в образ воркеров
  (`Dockerfile.workers:71`), хотя воркеры их никогда не грузят. При этом вывод `docs/audit.md:194`
  («в рантайме не грузится») машинно подтверждён, а строку 195 того же документа
  («в прод-образ не попадает») нельзя распространять на весь CLI-подграф: в образе воркеров
  он есть.
- **Образ приложения (`Dockerfile` target `runner`) уязвимые пакеты не содержит.** Он собирается
  без `npm ci` и без prune: копируются только `.next/standalone` (`Dockerfile:95`),
  `node_modules/@prisma` (`Dockerfile:103`) и `src/generated` (`Dockerfile:104`).
  Ни один из 384 файлов трассировки `.nft.json` не ссылается на `node_modules/mysql2`,
  `node_modules/deepmerge-ts` или `node_modules/@prisma/config` — трассировка их не берёт
  (`@prisma/client` и `prisma` внесены Next в `serverExternalPackages`,
  `node_modules/next/dist/lib/server-external-packages.jsonc:16,80`). Оговорка: сам
  `@prisma/config` в app-образ попадает — но не через трассировку, а через COPY scope-каталога
  `@prisma` (`Dockerfile:103`), и там он неработоспособен, т.к. его `deepmerge-ts` не скопирован
  (см. находку 3 и строку 3 матрицы).
- **`mysql2` в рантайме недостижим.** В CLI он подключается лениво и только для провайдера
  `mysql`: `mysql:{adapter:"mysql",async createExecutor(e){let{createPool:r}=await import("mysql2/promise")…}}`
  (`node_modules/prisma/build/cli.js:5575`); проект — `provider = "postgresql"` (`prisma/schema.prisma:7`),
  доступ через `@prisma/adapter-pg` (`src/lib/db.ts:13,98`). MySQL в проекте нет.
- **`deepmerge-ts` исполняется ровно в одном месте** — миграционный контейнер при загрузке
  `prisma.config.ts` (конфиг → `prisma/config` → `@prisma/config` → ленивый
  `await import("deepmerge-ts")`, `node_modules/@prisma/config/dist/index.js:621`;
  запуск — `docker-compose.yml:29-32`, `npx prisma migrate deploy`). Данные для слияния —
  собственный файл репозитория, не пользовательский ввод: для CVE нужен циклический объект,
  который через конфиг не приходит.
- **Одна строка:** не срочно — **можно ждать обновления prisma**; `npm audit fix --force`
  по-прежнему запускать нельзя.

## Методика (воспроизводимо)

1. Дерево зависимостей из lock, а не из головы:
   `node -e "const l=require('./package-lock.json').packages; …"` — вывести `deepmerge-ts`,
   `mysql2`, `@prisma/config`, `prisma`, их `dependencies`/`peerDependencies`/`peerDependenciesMeta`
   и флаги `dev`/`optional`; отдельно — «кто от кого зависит» (обход всех `packages[*].dependencies`).
2. **Ключевая проверка прод-дерева (read-only):** `npm ls --omit=dev --all | grep -n "prisma\|mysql2\|deepmerge-ts"`
   → `@prisma/client@7.10.0 → prisma@7.10.0 → @prisma/config@7.10.0 → deepmerge-ts@7.1.5`,
   `mysql2@3.15.3` (строки вывода 213-215, 240, 394). Это то же дерево, которое реифицирует
   `npm prune --omit=dev`.
3. Состав образов — по тексту стадий: `Dockerfile:4-119` (deps → builder → migrate → runner),
   `Dockerfile.workers:23-99`, `deploy/Dockerfile.prod:14-84`, `Dockerfile.quick:1-33`;
   какой Dockerfile и target у какого сервиса — `docker-compose.yml:23-27,60-64,149-153` и
   `scripts/deploy-prod.sh:30-40` (единственный боевой сборщик: `docker build -f <file> --target <target>`).
4. Трассировка рантайма Next: `find .next -name '*.nft.json' | wc -l` → 384;
   `grep -rl --include=*.nft.json -e 'node_modules/mysql2' -e 'node_modules/deepmerge-ts' -e 'node_modules/@prisma/config' .next` → 0 файлов.
5. Достижимость в коде: `grep -rn "mysql2|deepmerge-ts|@prisma/config"` по всему репо (совпадения
   только в `docs/` и `package-lock.json`), `grep -rn "prisma migrate|npx prisma" src/` → нет,
   `grep -rn "@prisma/studio-core|@prisma/dev" src/` → нет.
6. Контекст ленивых импортов вынут из минифицированных файлов точечно:
   `grep -o ".\{0,220\}import(\"mysql2/promise\").\{0,160\}" node_modules/prisma/build/cli.js`
   и `node -e`-поиск номера строки (`cli.js:5575`, `@prisma/config/dist/index.js:621`).
7. Проверка «нет ли ещё одного Dockerfile в игре»: `grep -rn "Dockerfile.quick|Dockerfile.prod"`
   по репо (только `docs/archive/**`), список сервисов `grep -n "^  [a-z].*:$" docker-compose.yml`.

## Матрица: пакет → путь → образ → рантайм → риск → что делать

| пакет | путь зависимости | в каком образе | достижим ли в рантайме | риск | что сделать |
|---|---|---|---|---|---|
| `deepmerge-ts` 7.1.5 (<8.0.0) | `prisma@7.10.0` (devDep, но в прод-дереве через optional peer `@prisma/client`) → `@prisma/config@7.10.0` → `deepmerge-ts@7.1.5` (`package-lock.json:2916-2924,8405`) | **app — нет** (трассировка nft его не берёт); **workers — да** (`npm prune --omit=dev` его сохраняет, `Dockerfile.workers:53,71`); **migrate — да** (полный `npm ci`, `Dockerfile:15,61`) | только в migrate: `prisma migrate deploy` → `prisma.config.ts` → `@prisma/config` → `await import("deepmerge-ts")` (`@prisma/config/dist/index.js:621`). Вход — свой конфиг репозитория | **низкий** (нужен циклический объект в конфиге; внешнего ввода нет) | ничего срочного; ждать релиза Prisma с `deepmerge-ts>=8`. Проверить кандидата: `npm audit --dry-run` / `npm view prisma version` (сеть). `npm audit fix --force` — нет |
| `mysql2` 3.15.3 (<=3.23.0) | `prisma@7.10.0` → `mysql2@3.15.3` (`package-lock.json:12618-12630,11697`) | **app — нет**; **workers — да** (то же прод-дерево); **migrate — да** | нет: ленивый `await import("mysql2/promise")` только в ветке провайдера `mysql` (`node_modules/prisma/build/cli.js:5575`), а провайдер проекта — `postgresql` (`prisma/schema.prisma:7`), драйвер — `@prisma/adapter-pg` (`src/lib/db.ts:13,98`) | **отсутствует** (нет ни MySQL-сервера, ни MySQL-пути) | ничего. При желании — узкий `overrides`/удаление после prune, но это не про безопасность |
| `@prisma/config` 7.10.0 (родитель) | `prisma` → `@prisma/config` (`package-lock.json:12618,2916`) | app — **да, физически** (`Dockerfile:103` копирует весь scope `@prisma`), но **работоспособного** `@prisma/config` там нет: его `deepmerge-ts` в образ не попадает | нет (ноль импортов `prisma/config` вне `prisma.config.ts`) | **низкий**, но это скрытая мина: `require` упал бы с `MODULE_NOT_FOUND` | сузить `COPY node_modules/@prisma` до нужных подпакетов (см. находку 3) |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | что сделать |
|---|---|---|---|---|---|
| 1 | важно | `package.json:146`; `package-lock.json:12618,11697,8405,2916`; `Dockerfile.workers:53,71` | `prisma` объявлен devDependency, но находится **в прод-дереве** (нет `dev`-флага в lock; peer `@prisma/client` → `prisma`), поэтому `npm prune --omit=dev` его и весь CLI-подграф не удаляет | Боевой образ воркеров несёт `prisma` (41 МБ), `@prisma/studio-core` (43 МБ), `@prisma/engines` (22 МБ), `@prisma/dev` (19 МБ), `mysql2` (0,8 МБ), `deepmerge-ts` — ~110-130 МБ на 30-ГБ VPS, где каждый гигабайт уже приводил к «no space left» (`docs/runbooks/013-prod-timers.md:27`, `deploy-2026-05-17.md:77`). Плюс `npm audit` в проде будет вечно показывать эти 4 high: отличить «реально в проде» от «только в migrate» по сканеру нельзя | После `npm run db:generate` добавить в `Dockerfile.workers` точечное удаление CLI-подграфа (рядом с `next/@next/sharp`): `node_modules/prisma @prisma/studio-core @prisma/engines @prisma/dev @prisma/config node_modules/mysql2 node_modules/deepmerge-ts`. Импортов в `src/` у них нет (проверено), воркеры prisma CLI не запускают (`Dockerfile.workers:99` → `tsx src/workers/unified-worker.ts`). Правку делать только с проверкой `docker build` — файл `Dockerfile*` мне закрыт |
| 2 | важно | `Dockerfile:54-68`; `docker-compose.yml:23-32`; `node_modules/@prisma/config/dist/index.js:621` | migrate-образ — **единственное** место, где уязвимый код есть и действительно исполняется: в нём полный `node_modules` (`Dockerfile:15,61`), а команда сервиса — `npx prisma migrate deploy`, загружающая `prisma.config.ts` → `@prisma/config` → `deepmerge-ts` | Это меняет приоритет: «высокая» уязвимость не декоративная, а срабатывающая — но в контейнере, который живёт ~30 с при деплое, с входом из собственного конфига. Материала для эксплуатации у атакующего нет: конфиг — файл репозитория, ветка про циклы не умеет получать объект снаружи | Принять риск и не гасить сканер откатом Prisma. Пересматривать при каждом `docker compose build migrate`; зафиксировать в `docs/audit.md` строку «исполняется только в migrate», чтобы следующий ревьюер не переоткрывал |
| 3 | мелочь | `Dockerfile:100-104` | `COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma` тащит в app-образ **весь scope**: `studio-core` (~43 МБ), `engines` (~22 МБ), `dev` (~19 МБ), `query-plan-executor` (~5 МБ), `config` (48 КБ) — размеры по локальной установке (Windows, `du -sk`). Рантайму нужны `client`, `client-runtime-utils`, `adapter-pg`, `driver-adapter-utils`, `debug` | Двойной эффект: (а) ~85 МБ лишнего в минимальном образе; (б) `@prisma/config` лежит в образе без своего `deepmerge-ts`, т.е. это рабочий отказ при первом же случайном импорте `prisma/config` — отладка «почему MODULE_NOT_FOUND в проде» займёт часы | Копировать только нужные подпакеты (`@prisma/client @prisma/client-runtime-utils @prisma/adapter-pg @prisma/driver-adapter-utils @prisma/debug`), проверив сборкой. `Dockerfile*` — вне моих прав; замечание для владельца |
| 4 | мелочь | `node_modules/@prisma/config/dist/index.js:621` | Слияние конфига сделано лениво: `const { deepmerge } = await import("deepmerge-ts")` | Точка достижимости ровно одна и хорошо ограничена — понимание этого и есть ответ «можно ждать»: пока Prisma не обновит `@prisma/config`, ничего не изменится, а `overrides: { "deepmerge-ts": "^8" }` рискует сломать загрузку конфига (в `@prisma/config` версия прибита точно `7.1.5`, `package-lock.json:2924`) | Не форсировать override «на всякий случай». Если когда-нибудь понадобится — проверять на `prisma migrate deploy` в migrate-контейнере, не на локальном |
| 5 | мелочь | `node_modules/prisma/build/cli.js:5575`; `prisma/schema.prisma:7`; `src/lib/db.ts:13,98` | `mysql2` подключается динамически и только в ветке `mysql` карты провайдеров; проект — PostgreSQL (`datasource db { provider = "postgresql" }`), доступ через `PrismaPg` | Подтверждает вывод `docs/audit.md:194` машинно: эксплуатировать нечего — нужен либо MySQL-провайдер, либо подключение к чужому MySQL-серверу, чего в проекте нет ни в коде, ни в compose (`DATABASE_URL_POSTGRES`, `docker-compose.yml:79`) | Ничего не делать; при появлении MySQL-адаптера (например, для чужих баз) — переоценить приоритет вверх |
| 6 | мелочь | `Dockerfile.quick:7,25-27` | Второй Dockerfile не используется: ни compose-файл, ни скрипт, ни ранбук, ни CI на `Dockerfile.quick` не ссылается (поиск по репо: `Dockerfile.prod` встречается только в `docs/archive/**`). При этом он делает `npm ci` **без** `--ignore-scripts` (строка 7) — в отличие от `Dockerfile:11-15`, где от этого отказались намеренно (supply-chain), — а его runner (строки 25-27) не копирует ни `node_modules/@prisma`, ни `src/generated`, без которых текущий рантайм падает с «Cannot find module '@prisma/client-runtime-utils'» (`Dockerfile:100-104`) | Ловушка для аудита: файл выглядит как «второй способ собрать прод», хотя сегодня сборка по нему даёт неработающий образ и по пути выполняет `postinstall` зависимостей. Любая сверка «что уедет в образ» по нему даст неверный ответ (нет ни prune, ни точечных COPY) | Не удалял (решение владельца): шапка «не используется, не собирать» либо удаление. Заметка, не правка |
| 7 | мелочь | `.next/standalone/node_modules` (симлинк → `D:\PillingR\my-project\node_modules`); `.next/BUILD_ID` от 26.09.2026 | Локальный артефакт сборки в этом worktree не самостоятелен: `node_modules` внутри `.next/standalone` — **симлинк на дерево соседнего worktree**, поэтому «проверка образа» глазами показывает `mysql2` и `deepmerge-ts` внутри standalone | Методическая ловушка: именно так можно «доказать», что уязвимый пакет в образе, хотя в реальной Docker-сборке `node_modules` трассируется (`COPY . .` + `.dockerignore` исключает `.next` и `node_modules`, `.dockerignore:6-7`) | При проверках состава образа опираться на `.nft.json`/`docker build`, не на локальный `.next`. Ничего в репозитории не менял (`.next/` в `.gitignore:3`) |

## Не проверено

- **Есть ли уже релиз Prisma 7.x с исправленной `@prisma/config`.** Сети нет: `npm view prisma version --offline`
  → `ENOTCACHED` (packument в кэше отсутствует). Косвенно: в `package.json:146` диапазон `^7.8.0`,
  установлено `7.10.0` — значит для перехода на исправленный 7.x правка манифеста не нужна,
  достаточно обновить lock (`npm update prisma`), и `npm audit fix --force` не понадобится.
- **Реальный состав образов.** `docker build`/`npm prune` не запускались (в этой сессии Docker-контекст
  не поднимался, установка запрещена). Вывод «`npm prune --omit=dev` сохраняет CLI-подграф» —
  косвенный, из `npm ls --omit=dev --all` (то же дерево реифицирует prune). Точный размер образов
  и итоговый список файлов — только сборкой.
- **Сам `npm audit` не перепроверял** (нужен реестр). Число «4 high» взято из текста задачи и совпадает
  с записью `docs/audit.md:181-197` от 15.09.2026.
- **`scripts/deploy-prod.sh` читал только фрагментами** (строки 20-42, 60-70) — целиком файл вне задачи.
- **Не проверял, не подтягивает ли runtime воркеров prisma CLI косвенно** через `tsx`-резолв
  (в `src/` вызовов `npx prisma` нет, но полный граф импортов `unified-worker` не разбирал).
- Содержимое `.next/standalone/.env` **не открывал** (по AGENTS.md `.env*` не читаются);
  важно лишь, что `.dockerignore:16-18` исключает `.env*` из контекста сборки, т.е. в Docker-образ
  этот файл не попадает.
