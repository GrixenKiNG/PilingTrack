# W115 — Что попадает в образы Docker

Аудит только для чтения. Изменений в коде нет; образы не собирались. Диск прода — 30 ГБ и часто почти полный, поэтому цель — опись того, что реально уезжает в образ, а не оценка архитектуры.

## Итог

- Всего находок: **15**. По важности: **критично — 0**, **важно — 5**, **мелочь — 10**.
- Боевых Dockerfile три: `Dockerfile` (сервисы `app` и `migrate`), `Dockerfile.workers` (сервис `workers`), `.dockerignore` — один, в корне. Ещё два Dockerfile (`Dockerfile.quick`, `deploy/Dockerfile.prod`) и один (`scripts/Dockerfile.backup`) **нигде не собираются** — в образы не попадают.
- **Многоступенчатая сборка есть у всех**; `COPY . .` есть только в сборочных ступенях (`builder`), в финальные ступени (`runner`) копируются перечисленные пути. Многоступенчатость как таковая с лишним содержимым справляется.
- `node_modules` финального `app` — трассированный standalone (prod только). Дев-зависимости в финальном образе **есть только в `migrate`** (полный `npm ci` без `--omit=dev`, `Dockerfile:15,61`).
- **Топ-5:**
  1. `prisma/seed.ts` с фиксированными тестовыми паролями (`admin123` и др.) уезжает в `migrate`, `app` и `workers` (`Dockerfile:98`, `Dockerfile.workers:73`).
  2. `migrate` тянет полный dev-`node_modules` (typescript, vitest, playwright, prisma CLI и т.д.) — самый тяжёлый боевой образ на каждом деплое.
  3. Windows-движок Prisma (`query_engine-windows.dll.node`, 21 МБ) попадает в linux-образы `app` и `workers` (`Dockerfile:104`, `Dockerfile.workers:72`).
  4. `workers` копирует весь `src/` (70 МБ, из них 361 `*.test.ts` и 164 `__tests__`) в боевой образ.
  5. `app` и `workers` копируют весь `prisma/` (включая `seed-test-data.ts` и 505 КБ миграций), которые рантайму не нужны.

## Методика

1. Инвентаризация файлов: `search_files(target=files)` по `Dockerfile*` и `.dockerignore`; `ls -la` корня и `find deploy -type f`.
2. Прочитаны целиком: `Dockerfile`, `Dockerfile.quick`, `Dockerfile.workers`, `deploy/Dockerfile.prod`, `scripts/Dockerfile.backup`, `.dockerignore`.
3. Проверка, что реально собирается: `search_files` по `dockerfile:` в `*.yml` → только `docker-compose.yml:26,63` (`Dockerfile`, цели `migrate`/`runner`) и `:158` (`Dockerfile.workers`, цель `runner`). Ссылки на `scripts/deploy-prod.sh:37-44` (`dockerfile_of()`), `.github/workflows/deploy.yml:83` (`docker compose build`), `scripts/staging-local.sh:95`.
4. Проверка «мёртвых» Dockerfile: `search_files` по `Dockerfile.quick|Dockerfile.prod|Dockerfile.backup` по всему репо — совпадения только в `docs/archive/**` и старых отчётах, ни одного compose-файла/скрипта/CI.
5. Содержимое образа выведено по `COPY`-путям финальных ступеней и сверено с тем, что кладёт `next build` (`next.config.ts:6 output:"standalone"`, `outputFileTracingExcludes` `next.config.ts:50-74`).
6. Размеры контекста/артефактов: `du -sh` по `src/generated`, `src/*`, `public`, `prisma`, `docs`, `.gitnexus`, `coverage`, `.next/standalone`; `find` по `*.node`/`*.wasm`/`*.so.node` и `*.test.ts`.
7. Секреты в копируемых деревьях: `search_files` по `password|secret|token` в `prisma/`; чтение `prisma/seed.ts:139-153,155-166`; проверка, что `.env` вне контекста (`.dockerignore:16`).

### Опись Dockerfile

| Dockerfile | База | Многоступенчатый | Цель в проде | dev-зависимости в финале | `COPY . .` в финале | Что лишнее попадает |
|---|---|---|---|---|---|---|
| `Dockerfile` → цель `runner` (app) | node:22-alpine (`:73`) | да (`deps`/`builder`/`migrate`/`runner`, `:4,20,54,73`) | да (`docker-compose.yml:63`) | нет (standalone-трассировка) | нет | `public/` целиком (21 МБ, включая замороженный `public/orion/**` и `public/prototypes/operator-tabs`); весь `prisma/` (`:98`) → `seed.ts`, `seed-test-data.ts`, миграции 505 КБ; `src/generated` целиком (`:104`) → Windows-движок 21 МБ |
| `Dockerfile` → цель `migrate` | node:22-alpine (`:54`) | да | да (`docker-compose.yml:26`) | **да** — полный `npm ci` (`:15`) → `:61` | нет | всё production+dev дерево `node_modules` (typescript, vitest, playwright, prisma CLI, tailwind, eslint); `prisma/seed.ts`, `prisma/seed-test-data.ts` |
| `Dockerfile.workers` → цель `runner` (workers) | node:22-alpine (`:59`) | да (`deps`/`builder`/`runner`, `:23,34,59`) | да (`docker-compose.yml:158`) | нет (`npm prune --omit=dev` `:53`) | нет | весь `src/` 70 МБ (`:72`): 361 `*.test.ts`, 164 `__tests__`, `src/generated` (58 МБ, включая Windows-движок 21 МБ); весь `prisma/` (`:73`) → `seed.ts` с тест-паролями |
| `Dockerfile.quick` → `runner` | node:22-alpine (`:16`) | да (`builder`/`runner`, `:1,16`) | **нет** (никем не собирается) | нет | нет | план `npm ci` **без** `--ignore-scripts` (`:7`) — supply-chain; runner без `@prisma`/`src/generated` (`:25-27`) — образ неработоспособен; `2>/dev/null \|\| true` прячет отсутствие standalone |
| `deploy/Dockerfile.prod` → `runner` | node:22-alpine (`:48`) | да (`deps`/`builder`/`runner`, `:14,27,48`) | **нет** (только `docs/archive/**`) | нет (`npm prune --production` `:43`, но в builder) | нет | `chown -R nextjs:nodejs /app` (`:65`) — дублирующий слой (ср. комментарий `Dockerfile.workers:69-70`) |
| `scripts/Dockerfile.backup` | `postgres:16-alpine` (`:1`) | нет (одна ступень) | **нет** — прод-бэкап идёт через хостовый systemd (`deploy/systemd/pilingtrack-backup.service:14`) | нет | нет | ничего лишнего: `COPY scripts/backup.sh restore.sh` (`:12-13`); `.env` не копируется |

### Опись `.dockerignore` (единственный, корневой)

Из чек-листа задачи **все обязательные исключения на месте**: `.git` (`:2`), `.env*` (`:16`), `node_modules` (`:8`), `*.log` (`:62`), `coverage` (`:32`), `e2e` (`:33`), `docs` (`:55`), `.gitnexus` (`:85`), `.claude` (`:84`). Дополнительно исключены `.next`, `dist`, `build`, `out`, `test-results`, `playwright-report`, `scripts` (с точечными возвратами `:46-54`), `wal-archive`, `basebackups`, `_migration`, `design-previews`, `public/*concept*.html`, `public/*-preview.html`, `public/__*.html`.

Чего не хватает (все попадают в контекст сборки и в слой `COPY . .` ступени `builder`; в финальные образы не уезжают):

| Не исключено | Размер | Зачем нужно сборке |
|---|---|---|
| `tests/` | 341 КБ | не нужен (tsconfig `exclude:49`) |
| `agents/` | 312 КБ | не нужен (tsconfig `exclude:44`) |
| `observability/`, `performance/`, `chaos/`, `security/`, `reports/`, `load-tests/`, `deploy/`, `.github/`, `.githooks/` | ~0.5 МБ суммарно | не нужны |
| `tsconfig.tsbuildinfo` | ~1 МБ | не нужен |
| `lighthouserc.json`, `load-test-results.json`, `playwright.*.config.ts` | ~10 КБ | не нужны (частично покрыты `outputFileTracingExcludes`, но не `.dockerignore`) |
| `public/orion/**`, `public/prototypes/**` | часть из 21 МБ | не нужны рантайму, но это замороженные области (владелец решает) |

`.env` в контекст не попадает (`.env*`, `:16`) — подтверждено, это ключевое.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что предлагается |
|---|---|---|---|---|---|
| 1 | важно | `prisma/seed.ts:139-153,155-166`; попадает в образы через `Dockerfile:62,98`, `Dockerfile.workers:41,73` | В образах `migrate`, `app`, `workers` лежит `seed.ts` с фиксированными паролями тестовых учёток (`admin123`, `dispatch123`, `operator123`, `sas02password` и т.д.) | Если образ утечёт/попадёт в реестр, это готовый список логинов+паролей тестовых пользователей (`admin@piling.ru`). На проде сид отключён (`assertNotProduction`, `prisma/seed.ts:36-40`; `SKIP_SEED=1` в `docker-compose.prod.yml:144`), но сам файл в образе — инфо-утечка | Не копировать `prisma/seed*.ts` в финальный `app`/`workers` runner; для `migrate` — держать сид в отдельном месте/выносить патчи |
| 2 | важно | `Dockerfile:15,61` | Ступень `migrate` копирует `node_modules` из `deps`, а `deps` собран обычным `npm ci` (без `--omit=dev`); боевой сервис `migrate` несёт всё dev-дерево | На 30-ГБ VPS `docker compose build migrate` (`.github/workflows/deploy.yml:83`) собирается и лежит со всем dev-деревом: `typescript`, `vitest`, `@playwright/test` (+браузерные бинарники), `tailwindcss`, `eslint`, `prisma` CLI и студия. Комментарий `Dockerfile:46-53` сократил migrate, но dev-зависимости оставил | Prune `--omit=dev` в ступени `migrate` (оставив prisma CLI), либо отдельная ступень с только нужным подграфом |
| 3 | важно | `Dockerfile:104`, `Dockerfile.workers:72` | `src/generated` копируется целиком и несёт `query_engine-windows.dll.node` 21 МБ (и wasm-движки) в linux-alpine образы | Мёртвый вес в каждом боевом образе `app` и `workers`; на почти полном диске прода каждая выкладка даёт лишние ~21 МБ × 2 образа. Windows-движок в alpine никогда не грузится | При сборке образа удалять платформенные движки, кроме `linux-musl` (или `PRISMA_CLI_QUERY_ENGINE_TYPE`/очистка `*.dll.node`) |
| 4 | важно | `Dockerfile.workers:72` | В `workers` копируется весь `src/` (70 МБ), включая 361 `*.test.ts` и 164 каталога `__tests__` | Тестовые файлы и фикстуры уезжают в боевой образ; лишний вес и раскрытие внутренностей кода. Воркеры запускаются через `tsx` из исходников (`Dockerfile.workers:99`), поэтому исходники нужны — но не тесты | Исключить `**/__tests__/**`, `**/*.test.ts(x)`, `**/*.spec.*` при `COPY src` |
| 5 | важно | `Dockerfile:98`, `Dockerfile.workers:73` | `prisma/` копируется целиком (`schema.prisma`, `migrations` 505 КБ, `seed.ts`, `seed-test-data.ts`) в рантайм `app` и `workers` | Миграции и seed-файлы рантайму приложения не нужны (миграции накатывает сервис `migrate`); это лишний вес в каждом образе плюс тест-пароли (см. п.1) | Оставить в `app`/`workers` только то, что реально читается в рантайме (проверить), либо не копировать `prisma/` вовсе |
| 6 | мелочь | `Dockerfile.quick:7` | `npm ci` **без** `--ignore-scripts` — в отличие от основного `Dockerfile:15`, где от этого отказались как от supply-chain риска (`Dockerfile:11-14`) | Файл нигде не собирается, но если кто-то на него переключится — вернётся риск посторонних postinstall-скриптов | Удалить `Dockerfile.quick` или привести к `--ignore-scripts` (задача — только опись, не правка) |
| 7 | мелочь | `Dockerfile.quick:25-27` | Runner не копирует `node_modules/@prisma` и `src/generated`, а `COPY` обёрнуты в `2>/dev/null \|\| true` | Образ заведомо нерабочий (прод падал бы на `@prisma/client-runtime-utils`, см. комментарий `Dockerfile:100-102`), и ошибки копирования глушатся | Удалить неиспользуемый вариант |
| 8 | мелочь | `deploy/Dockerfile.prod:65` | `RUN chown -R nextjs:nodejs /app` переписывает метаданные всех файлов в дублирующий overlay-слой | Раздувает слой образа; в `Dockerfile.workers:69-70` прямо объяснено, почему вместо этого нужен `--chown` в `COPY` | Использовать `--chown` в `COPY`, убрать `chown -R` |
| 9 | мелочь | `deploy/Dockerfile.prod` (весь), `Dockerfile.quick` (весь), `scripts/Dockerfile.backup` (весь) | Три Dockerfile не собираются никем: `docker-compose*.yml`, `scripts/deploy-prod.sh`, `.github/workflows/**`, CI на них не ссылаются (только `docs/archive/**` и старые отчёты) | Мёртвые инструкции сборки: расходуют внимание и содержат устаревшие/опасные приёмы (пп.6-8). В образы не попадают, поэтому диск не занимают | Решение владельца: удалить или пометить как запасной ручной путь |
| 10 | мелочь | `.dockerignore` | Не исключены `tests/` (341 КБ), `agents/` (312 КБ), `tsconfig.tsbuildinfo` (~1 МБ), `observability/`, `performance/`, `chaos/`, `security/`, `reports/`, `load-tests/`, `deploy/`, `.github/`, `.githooks/` | Всё это попадает в контекст сборки и в слой `COPY . .` ступени `builder` (`Dockerfile:37`, `Dockerfile.quick:9`, `deploy/Dockerfile.prod:34`). В финальные образы не уезжает, но контекст/промежуточные слои занимают диск при сборке на VPS | Добавить эти пути в `.dockerignore` |
| 11 | мелочь | `.dockerignore` (нет записи) | `public/orion/**` и `public/prototypes/**` не исключены и уезжают в `app` (`Dockerfile:97 COPY public`) | Замороженные области (ORION-сайт, прототипы вкладок оператора) попадают в боевой образ как статика. Не секрет, но вес и «мусор» в проде | Не трогать без решения владельца (замороженная зона); отметить как известный вес |
| 12 | мелочь | `.dockerignore:44-54` | Каталог `scripts` исключён, но точечно возвращены `validate-env.ts`, `copy-standalone-assets.js`, `patch-postgres-client.js`, `trace-runtime-deps.cjs`, `lib/module-boundaries.ts` | Сам механизм корректен; риск в том, что при добавлении нового build-скрипта его надо не забыть вернуть, иначе `npm run build` в образе упадёт только на сервере | Комментарий уже есть (`:50-52`); при ревизии — держать список синхронным |
| 13 | мелочь | `.dockerignore:105-111` | Правила `public/*concept*.html`, `public/*-preview.html`, `public/__*.html` защищают от публикации черновиков (инцидент 30.09.2026) | Полезная защита, но узкая: не покрывает вложенные каталоги (шаблон без `**`) — проверить, что новых черновиков в подпапках `public/` не осталось | Не проверено, что покрытие достаточное (см. «Не проверено») |
| 14 | мелочь | `Dockerfile:97` | `COPY ... /app/public ./public` тянет весь `public/` (21 МБ), включая иконки/фото оборудования и `login-bg` | Большая часть статики нужна сайту; это осознанный вес, но именно он вместе с п.3/п.5 формирует размер образа `app` | Оставить; учитывать при оценке размера |
| 15 | мелочь | `next.config.ts:152-159` | `sourcemaps.disable: !process.env.SENTRY_AUTH_TOKEN` — при отсутствии токена плагин не удаляет карты | Если на VPS сборка идёт без `SENTRY_AUTH_TOKEN`, удаление `.js.map` может не отработать. Проверка в рабочем дереве показала 0 `*.js.map` в `.next/static`, но это не боевая сборка | Не проверено на боевой сборке (см. «Не проверено») |

## Не проверено

1. **Реальные размеры боевых образов.** Docker не запускался, образы не собирались (задача запрещает). Все размеры — по файловым деревьям рабочего дерева (`du -sh`), а не по слоям `docker image`. Не проверено.
2. **Нужен ли `prisma/` в рантайме `app`/`workers`.** Утверждение «миграции/seed рантайму не нужны» — вывод из кода, а не из трассировки standalone; точный список читаемых путей не подтверждён запуском. Не проверено.
3. **Покрытие правил `public/*concept*.html` для вложенных каталогов.** Семантика glob в `.dockerignore` (сопоставление `*` на глубине) не проверялась сборкой; наличие свежих черновиков в подпапках `public/` не инвентаризировано. Не проверено.
4. **Удаляются ли source maps на боевой сборке.** `deleteSourcemapsAfterUpload` зависит от `SENTRY_AUTH_TOKEN`, наличие которого в сборочном окружении VPS не проверялось (переменные окружения прода не читались). Не проверено.
5. **Наличие `.env` в контексте на сервере.** `.dockerignore:16` (`.env*`) делает утечку невозможной по конфигурации, но реальная выкладка на `/opt/pilingtrack` и её `.dockerignore` не сверялись (SSH/прод-доступ запрещён). Не проверено.
6. **Исчерпанность списка собираемых образов.** Проверено: `grep -rn "build:" docker-compose*.yml` даёт только `docker-compose.yml:24,61,156` (сервисы `migrate`, `app`, `workers`) — остальные compose-файлы (`monitoring-prod`, `observability`, `monitoring-standalone`, `prod`, `staging`) образов не собирают. То есть три Dockerfile из шести — полная картина того, что уезжает в прод.
