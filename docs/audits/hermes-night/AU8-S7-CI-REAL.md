# AU8-S7-CI-REAL: что реально проверяет CI и совпадает ли проверенное с выкладываемым

Версия: `git rev-parse HEAD` рабочей папки = `24268fb609e0281db601808c2a634120403be19e` (ветка `hermes/q4-0926`).
Прочитаны: `.github/workflows/{ci,deploy,integration}.yml`, `scripts/deploy-prod.sh`, `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`, `Dockerfile.workers`, `package.json`, `playwright.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `.github/CODEOWNERS` и скрипты, на которые они ссылаются (`smoke-workers-image.sh`, `check-integration-results.cjs`, `check-migrations.js`, `check-layer-boundaries.ts`, `check-text-integrity.js`, `validate-env.ts`, `replace-worker-generation.sh`, `test-deploy-workflow.cjs`).

## Итог

Найдено 13 находок: критично — 1, важно — 6, мелочь — 6.

Главное: **ни один способ выкладки не заблокирован результатом CI.** CI (`.github/workflows/ci.yml`) прогоняет тесты, типы, границы слоёв, миграционный страж и даже собирает образ воркеров, но он запускается только на push/PR в `main` и никак не связан с выкладкой. `deploy.yml` — ручной (`workflow_dispatch`, строка 6) и делает `git pull origin main` на сервере; `scripts/deploy-prod.sh` собирает образы локально и тоже не смотрит на CI. Значит, зелёный CI и выкладываемый SHA — совпадают только «по доброй воле».

Топ-5: (1) выкладка не гейтится CI; (2) production-образ приложения (`Dockerfile` target runner) в CI не собирается — там собирается только `Dockerfile.workers`; (3) `deploy-prod.sh` собирает боевые образы на машине разработчика, а не из проверенного CI артефакта; (4) применяется ли на сервере оверлей `docker-compose.prod.yml` — неясно, ни один путь выкладки не передаёт `-f`/`COMPOSE_FILE`; (5) E2E в CI — 6 файлов из 27 и только chromium.

Совпадают по SHA: и `deploy.yml`, и `deploy-prod.sh` сверяют короткий SHA сборки с полем `version` из `/api/health`, и оба берут его из `origin/main` — расхождения нет. Проверено чтением файлов.

## Методика

- `git rev-parse HEAD`, `git status` — зафиксирована версия и чистота дерева.
- `search_files`/`read_file` по `.github/`, `scripts/`, корневым `Dockerfile*`/`docker-compose*.yml`, `package.json`.
- `grep` по `.github/workflows/` на `node-version`, `image: postgres`, `dockerfile`, `needs:`, `continue-on-error`, `if:` — чтобы найти все условные/пропускаемые шаги.
- Проверено существование всех скриптов, на которые ссылается CI (`for f in ...; do [ -f scripts/$f ]`), и подсчёт e2e-спеков (`ls e2e/*.spec.* e2e/**/*.spec.*` → 27 файлов).
- Команды (все — только чтение):

```bash
git rev-parse HEAD                                  # 24268fb609e0281db601808c2a634120403be19e
ls e2e/*.spec.* e2e/**/*.spec.* | wc -l            # 27
grep -rn "node-version" .github/workflows/           # ci.yml: 3× '20'; integration.yml: '22'
grep -rn "image: postgres" .github/workflows/        # ci.yml: 2× postgres:18-alpine; integration.yml: postgres:16
grep -rn "dockerfile\|Dockerfile\|docker/build-push" .github/workflows/   # только Dockerfile.workers (ci.yml:100)
grep -rn "compose -f\|compose --file\|COMPOSE_FILE" scripts/deploy-prod.sh .github/workflows/   # ничего
```

### Таблица 1. Шаги CI (`ci.yml`) → что запускает → блокирует ли выпуск

| Job | Шаг | Что запускает | Блокирует ли выпуск | Что пропускается / чего не проверяет |
|---|---|---|---|---|
| unit | `npm ci` (ci.yml:43-44) | install (postinstall → `db:generate`) | Нет гейта на выкладку; шаг красный только внутри GitHub | — |
| unit | Lint (ci.yml:51-56) | `eslint . && node scripts/check-text-integrity.js` | То же | Варнинги НЕ валят (нет `--max-warnings`; комментарий ci.yml:54-55 допускает ~684 warnings). См. находку 11 |
| unit | Typecheck (ci.yml:58-61) | `npx tsc --noEmit` | То же | Только TS-типы; route-типы Next ловит лишь `npm run build` (в e2e-джобе) |
| unit | Layer boundaries (ci.yml:63-68) | `npx tsx scripts/check-layer-boundaries.ts` | То же | Нарушения из baseline `scripts/.layer-boundaries-baseline.txt` игнорируются |
| unit | Migration guard (ci.yml:70-77) | `npm run db:check-migrations` | То же | Только текстовый скан `prisma/migrations/**`; данные не трогаются (см. check-migrations.js:16-30) |
| unit | Workers no-next (ci.yml:79-81) | `vitest run .../no-next-in-workers.test.ts` | То же | — |
| unit | Unit tests (ci.yml:83-85) | `vitest run src/ tests/contract --coverage --maxWorkers=2` | То же | Пороги покрытия (vitest.config.ts:69-74) — реальный гейт джобы |
| workers-smoke | Build workers (ci.yml:96-105) | `docker/build-push-action` → `Dockerfile.workers` target runner | То же | Собирается ТОЛЬКО образ воркеров, не приложения |
| workers-smoke | Smoke (ci.yml:107-108) | `bash scripts/smoke-workers-image.sh` (сеть `none`, фейковые URL) | То же | Проверяет лишь загрузку модулей и `Arming` (smoke-workers-image.sh:34-43) |
| schema-validation | migrate deploy (ci.yml:178-179) + 30 таблиц (183-187) + app-role (191-194) + `vitest tests/integration` (196-197) | Postgres 18 + Redis 7 сервисы | То же | Гоняется на ПУСТОЙ базе; данные прода не воспроизводятся |
| schema-validation | RLS/DB-gated «не пропускать» (ci.yml:202-214, 222-239) | fail, если в логе есть «N skipped» | То же | Ловит молчаливый skip, но не ловит неверный результат, если тест «зелёный» без реальной проверки |
| e2e | build + start + Playwright (ci.yml:301-354) | `npm run build`, `npm run start`, ожидание `/api/liveness` | То же | — |
| e2e | Golden path (ci.yml:356-367) | 5 спеков: app, admin-users, admin-dictionaries, operator-report-smoke, report-creation-flow | То же | Из 27 файлов e2e/ — только эти 5 (+role-audit). Остальные 21 не запускаются |
| e2e | Seven role accounts (ci.yml:369-372) | `e2e/role-audit.spec.js --workers=1` | То же | — |

### Таблица 2. Ручные / только локальные запуски (в CI не входят)

| Что | Где | Как запускается |
|---|---|---|
| Выкладка на сервер (сборка там) | `.github/workflows/deploy.yml:6` | GitHub UI → Run workflow (workflow_dispatch) |
| Выкладка с локальной сборкой | `scripts/deploy-prod.sh` | только руками с машины разработчика |
| Полный e2e-набор | `package.json:38` (`test:e2e`) | локально; в CI только подмножество |
| `npm run verify` (полный) | `package.json:30` | локально; включает `test:smoke:auth-access`, которого в CI нет |
| `prod:smoke`, `db:refresh-prod-snapshot`, `backfill:analytics`, `postgres:*`, `test:load` | `package.json:16-29,55` | локально/по кнопке |

### Таблица 3. Совпадает ли SHA CI с выкладываемым

| | CI | deploy.yml | deploy-prod.sh | Вердикт |
|---|---|---|---|---|
| Источник SHA | пуш/PR в `main` (ci.yml:3-7) | `git pull origin main` на сервере (deploy.yml:67), `BEFORE=$(git rev-parse HEAD)` (deploy.yml:60) | `HEAD == origin/main` обязателен (deploy-prod.sh:57-61) | один и тот же `main` |
| Как зашит в образ | `npm run build` (ci.yml:319) | `export APP_VERSION=$(git rev-parse --short HEAD)` (deploy.yml:68) → build-arg через compose | `--build-arg APP_VERSION=$SHA` (deploy-prod.sh:65,88) | одинаково (короткий SHA) |
| Проверка после выкладки | — | health `version` == EXPECTED (deploy.yml:104-118) | health/`version` (deploy-prod.sh:125-139) | совпадает |

Вывод: SHA, который проверяет CI, и SHA, который выкладывается, — один и тот же коммит `main`, но **связь не гарантирована процессом** (нет гейта), а не потому что артефакты совпадают (см. находки 1, 2, 6).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | статус | как чинить |
|---|---|---|---|---|---|---|
| 1 | критично | `.github/workflows/deploy.yml:5-6,32`; `scripts/deploy-prod.sh:57-61` | Ни выкладка через GitHub, ни локальный скрипт не проверяют, что CI для выкладываемого SHA прошёл. У `deploy` нет `needs`, `deploy-prod.sh` не читает статус CI | Пуш в `main` → CI ещё идёт или упал (concurrency `cancel-in-progress` ci.yml:12 может отменить прогон) → кто-то запускает выкладку → на прод уезжает непроверенный коммит. Ровно тот случай, ради которого CI и заводили | ПРОЙДЕНО (по коду) | Гейтить ручную выкладку на успешный CI-чек (GitHub Environment required checks / branch protection на `main`) и добавить в `deploy-prod.sh` проверку статуса checks для `$SHA` |
| 2 | важно | `.github/workflows/ci.yml:96-105` (только `file: Dockerfile.workers`); `Dockerfile` (target runner) | CI собирает и смоукит ТОЛЬКО образ воркеров. Production-образ приложения (`Dockerfile` → `runner`) в CI никогда не собирается | Регрессия в `Dockerfile` (недостающий `COPY`, сломанный `prisma generate`, битый HEALTHCHECK) не будет поймана до самой выкладки. `grep dockerfile` по `.github/workflows/` даёт единственное вхождение — `ci.yml:100, Dockerfile.workers` | ПРОЙДЕНО | Добавить в CI job, собирающий `Dockerfile` target runner и хотя бы health-smoke по образцу `workers-smoke` |
| 3 | важно | `scripts/deploy-prod.sh:65,88,108` | Боевые образы собираются ЛОКАЛЬНО на машине разработчика и уезжают `docker save | ssh docker load`. CI их не собирал | «Проверено CI» и «собрано и выложено» — разные артефакты из разных окружений. Локальный Docker/Node могут дать другое содержимое образа, чем проверялось | ПРОЙДЕНО | Собирать образ в CI (или на сервере по проверенному SHA) и выкладывать именно этот артефакт; либо сверять digest образа с CI-собранным |
| 4 | важно | `scripts/deploy-prod.sh:113`; `.github/workflows/deploy.yml:83,101`; `docker-compose.prod.yml:1-20` | Пути выкладки вызывают `docker compose up/build` БЕЗ `-f`/`--file`, т.к. оверлей `docker-compose.prod.yml` применяется только если на сервере задан `COMPOSE_FILE` (в репозитории его нет; `grep` не находит) | Если оверлей не применён: порты Postgres/Redis/MinIO остаются опубликованными на хост, `NODE_OPTIONS=--max-old-space-size=512` не задан (проверка памяти в `/api/health` висит в `warn`). ГИПОТЕЗА — зависит от боевого `.env` на сервере | ГИПОТЕЗА | Явно передавать `-f docker-compose.yml -f docker-compose.prod.yml` в скриптах выкладки либо зафиксировать `COMPOSE_FILE` и проверить это на сервере |
| 5 | важно | `.github/workflows/ci.yml:356-367`; `playwright.config.ts:26-44` | CI гоняет 6 файлов e2e из 27 (`ls` → 27) и только проект `chromium`; проекты `Mobile Safari` и `Mobile Chrome` в CI не запускаются | Большинство пользовательских сценариев (qa-ac/*, release-critical-path, inspection-to-flow и др.) никогда не проверяются автоматически; мобильный layout не тестируется | ПРОЙДЕНО | Расширить glob или добавить отдельный необязательный job для полного набора и мобильных проектов |
| 6 | важно | `.github/workflows/integration.yml:23,44` | Второй, независимый workflow гоняет интеграцию на `postgres:16` и Node 22, тогда как прод и ci.yml — `postgres:18`/Node 20 | Проверка ставит не тот мажор Postgres, что в бою (docker-compose.yml:345 `postgres:18-alpine`); RLS/restore-учение проверяются на другой версии. Плюс `integration.yml` не связан с `ci.yml` (разные workflow, разные concurrency-группы) — он может вообще не быть обязательной проверкой | ПРОЙДЕНО (по коду) | Привести `integration.yml` к `postgres:18` и Node 20 либо явно задокументировать, почему версии различаются |
| 7 | мелочь | `.github/workflows/ci.yml:40,167,298`; `Dockerfile:4,20,54,73`; `Dockerfile.workers:23,34,59` | CI работает на Node 20, а боевые образы — на `node:22-alpine` | Сборка/тесты идут на другом мажоре Node, чем рантайм. Часть различий поведения Node не поймать в CI | ПРОЙДЕНО | Поднять Node в CI до 22 (или опустить образы до 20) |
| 8 | мелочь | `scripts/deploy-prod.sh:65`; `Dockerfile.workers` | `--build-arg APP_VERSION=$SHA` передаётся при сборке воркеров, но в `Dockerfile.workers` нет `ARG APP_VERSION` — аргумент мёртвый | Docker выдаёт предупреждение о неиспользуемом build-arg; ложное ощущение, что версия воркера фиксируется | ПРОЙДЕНО | Убрать аргумент для воркеров или добавить `ARG`/`ENV` в `Dockerfile.workers` |
| 9 | мелочь | `package.json:30` (`verify`); `.github/workflows/ci.yml` | Локальный `npm run verify` строже CI: включает `npm run build` и `test:smoke:auth-access`, которых в CI нет | Разработчик полагается на CI как на «полную проверку», а часть гейтов существует только локально | ПРОЙДЕНО | Либо добавить `test:smoke:auth-access` в CI, либо убрать из `verify` и задокументировать |
| 10 | мелочь | `.github/workflows/ci.yml:54-55`; `AGENTS.md:55` | Комментарий CI допускает ~684 ESLint-варнинга (гейт не падает), а AGENTS.md утверждает «lint baseline is zero warnings» | Расхождение документации: непонятно, является ли нулевой варнинг требованием. Линт не ловит новые варнинги | ПРОЙДЕНО | Привести формулировки к одному факту (варнинги не блокируют) |
| 11 | мелочь | `.github/` (нет `dependabot.yml`; в workflows нет сканирования) | В CI нет сканирования зависимостей и секретов (Dependabot/CodeQL/secret-scanning workflows отсутствуют) | Уязвимость в зависимости или случайно закоммиченный секрет не будут замечены автоматически на этапе CI | ПРОЙДЕНО | Включить Dependabot и GitHub secret scanning |
| 12 | мелочь | `.github/workflows/deploy.yml:5-6,67` | `deploy.yml` можно запустить из UI с любой ветки/ref, но он всегда делает `git pull origin main` на сервере | Оператор думает, что выкатывает свою ветку, а по факту выкладывается `main` | ПРОЙДЕНО | Зафиксировать ref/добавить проверку входа или комментарий |
| 13 | мелочь | `scripts/deploy-prod.sh:57-61`; `.github/workflows/deploy.yml:107-118` | Обе выкладки сверяют короткий SHA с health, но не сверяют digest образа с тем, что был проверен/собран | При локальной сборке (находка 3) нельзя доказать, что на прод уехал именно проверенный артефакт | ГИПОТЕЗА | Хранить/сверять `image digest` между сборкой и выкладкой |

## Не проверено

- **Branch protection и required checks на GitHub** — не читаемы из репозитория. Именно от них зависит, «блокирует ли выпуск» красный CI. Все вердикты «блокирует» в таблице 1 даны по логике workflow (джоба красная), а не по настройке репозитория. НЕ ПРОВЕРЕНО.
- **`COMPOSE_FILE` в боевом `/opt/pilingtrack/.env`** — на сервер не ходили (правило задачи: без прода). Применяется ли `docker-compose.prod.yml` фактически — ГИПОТЕЗА (находка 4).
- **Реальные статусы прогонов CI** (зелёные ли последние запуски, есть ли расхождения) — не запускали Actions.
- **Существующие отчёты в `docs/audits/`** намеренно не открывались (требование независимого прохода), поэтому пересечения с прежними находками не сверялись.
- Наличие окружения `production` с обязательным approval у `deploy.yml:32` — из кода виден только `environment: production`; настроены ли protection rules — НЕ ПРОВЕРЕНО.
