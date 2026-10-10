# AU92-S7-DOCKERFILES: Dockerfile и образы — слои, секреты, размер, воспроизводимость

Аудит только для чтения. Версия рабочей папки: `git rev-parse HEAD` = `0e6a99ab5a0205d9e7c347069cab23fe39a56b96` (ветка `hermes/q4-0926`).
Прочитаны целиком: `Dockerfile`, `Dockerfile.workers`, `Dockerfile.quick`, `.dockerignore`, `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`, `docker-compose.observability.yml`, `docker-compose.monitoring-prod.yml`, `docker-compose.monitoring-standalone.yml`, `deploy/Dockerfile.prod`, `scripts/Dockerfile.backup`, `package.json`, `next.config.ts` (выборочно), `scripts/copy-standalone-assets.js`, `scripts/deploy-prod.sh`, `prisma/seed.ts` (фрагмент).

## Итог

0 критично, 6 важно, 12 мелочь (итого 18 находок).

Топ-5:
1. В оба боевых рантайм-образа копируется `prisma/seed.ts` с фиксированными тестовыми паролями (`Dockerfile:98`, `Dockerfile.workers:73` + `prisma/seed.ts:140-145`) — лишний секрет в образе.
2. Базовые образы не закреплены: `node:22-alpine` тегом без digest, у сервисов `pgbouncer`, `pgadmin`, а также всего мониторинга — тег `:latest` (воспроизводимость сборки не гарантирована).
3. Образ воркеров содержит весь `src/` целиком, включая `__tests__`/спеки (`Dockerfile.workers:43,72`) — тесты едут в прод.
4. `Dockerfile.quick` глушит ошибки `|| true` и `2>/dev/null || true` и ставит зависимости с запуском postinstall-скриптов (`Dockerfile.quick:7,13,14,25-27`) — сборка «зелёная» на сломанном образе.
5. `deploy/Dockerfile.prod`: `chown -R /app` создаёт дублирующий слой (файл воркеров прямо предупреждает об этом), `npm prune --production` бесполезен и устарел, а комментарий обещает distroless при фактическом alpine (`deploy/Dockerfile.prod:5,43,48,65`).

Мультиэтапная сборка, non-root в app/workers, healthcheck, `npm ci` по lockfile — на месте (см. чек-лист, статусы ПРОЙДЕНО).

## Методика

- Только чтение. Ни один файл кода не менялся; создан только этот отчёт.
- Найдены файлы: `search_files target=files` по `Dockerfile*`, `docker-compose*`, `.dockerignore`.
- Все Dockerfile/compose прочитаны через `read_file` целиком (построчный вывод). Байтовый контроль сомнительных строк — через `node -e` (проверка литерала `***`).
- Кто на что ссылается: `search_files pattern="dockerfile:|docker build|-f Dockerfile"` по `*.yml/*.yaml/*.sh/*.ps1` — в бою собираются только `Dockerfile` (targets `migrate`, `runner`) и `Dockerfile.workers` (target `runner`); `Dockerfile.quick`, `deploy/Dockerfile.prod`, `scripts/Dockerfile.backup` ни одним compose/deploy-скриптом не собираются.
- Состав образов — по тексту `COPY`/`RUN`, размеры образов НЕ измерялись (запрещено заданием).
- Проверка версий базовых образов и «latest» — по строкам `FROM`/`image:`.
- Статусы: ПРОЙДЕНО — пункт соответствует требованию; ГИПОТЕЗА — дефект подтверждён по коду, но эффект в рантайме не запускался; НЕ ПРОВЕРЕНО — данных нет.
- Числа — только из команд (`git rev-parse HEAD`, `git blame`), не выдуманы.

## Чек-лист по заданию

| Пункт | Файл:строка | Статус | Риск |
|---|---|---|---|
| Закрепление базовых образов (тег/digest) | `Dockerfile:4,20,54,73`; `Dockerfile.workers:23,34,59`; `deploy/Dockerfile.prod:14,27,48` | ГИПОТЕЗА | Тег без digest: другой билд образа-базы меняет содержимое без изменения кода |
| Закрепление образов сервисов | `docker-compose.yml:238,384` (`edoburu/pgbouncer:latest`, `dpage/pgadmin4:latest`); `docker-compose.observability.yml:23,45,71,87,105,122,138,153` | ГИПОТЕЗА | `:latest` — при `pull` поведение стенда меняется непредсказуемо |
| Фиксированные теги для БД/кеша | `docker-compose.yml:281,317,345` (`redis:7-alpine`, `postgres:18-alpine`) | ГИПОТЕЗА | Минорные теги плывут; digest не задан |
| Pinned-by-date образы MinIO | `docker-compose.yml:404,426` | ПРОЙДЕНО | `minio/minio:RELEASE.2024-09-13...`, `minio/mc:RELEASE.2024-09-16...` — версия зафиксирована |
| Многоэтапная сборка | `Dockerfile:4,20,54,73`; `Dockerfile.workers:23,34,59`; `deploy/Dockerfile.prod:14,27,48` | ПРОЙДЕНО | Есть stages deps/builder/migrate/runner |
| В рантайм не едут исходники (app) | `Dockerfile:95-104` | ПРОЙДЕНО | Копируются standalone/static/public/prisma/@prisma/src/generated, не весь `src` |
| В рантайм не едут исходники (workers) | `Dockerfile.workers:72` | ГИПОТЕЗА | `COPY --from=builder /app/src ./src` — весь `src` включая `__tests__` |
| `.env` не попадает в контекст | `.dockerignore:16` (`.env*`) | ПРОЙДЕНО | `.env` (файл есть в рабочей папке) исключён |
| Секреты в образе | `Dockerfile:98`; `Dockerfile.workers:73`; `prisma/seed.ts:140-145` | ГИПОТЕЗА | В образ едет `seed.ts` с фиксированными паролями тестовых учёток |
| Секреты в слоях сборки | `Dockerfile:24-26` | ГИПОТЕЗА | Build-time stub-`ENV` (SESSION_SECRET и др.) видны в истории слоя builder |
| dev-зависимости в рантайме (app) | `Dockerfile:95-104` | ПРОЙДЕНО | Рантайм берёт трассированный standalone, devDeps не копируются |
| dev-зависимости в рантайме (workers) | `Dockerfile.workers:53` | ПРОЙДЕНО | `npm prune --omit=dev` + удаление next/@next/@img/sharp |
| Запуск не от root (app) | `Dockerfile:114` (`USER 1001:1001`) | ПРОЙДЕНО | Numeric UID |
| Запуск не от root (workers) | `Dockerfile.workers:87` (`USER nextjs`) | ПРОЙДЕНО | Пользователь nextjs |
| Запуск не от root (migrate) | `Dockerfile:54-68` (нет `USER`) | ГИПОТЕЗА | Стадия `migrate` — root (DDL-задача, но всё же) |
| Запуск не от root (backup) | `scripts/Dockerfile.backup:1-30` (нет `USER`) | ГИПОТЕЗА | Бэкап-образ — root |
| Healthcheck (app) | `Dockerfile:110-111`; `docker-compose.yml:139-144` | ПРОЙДЕНО | `wget --spider /api/health` |
| Healthcheck (workers) | `Dockerfile.workers:93-94`; `docker-compose.yml:216-221` | ПРОЙДЕНО | `curl -f :3002/health` |
| Healthcheck (quick) | `Dockerfile.quick:1-33` | ГИПОТЕЗА | Нет HEALTHCHECK |
| Кэш слоёв: deps до COPY . . | `Dockerfile:10-15,36-37` | ПРОЙДЕНО | `npm ci` по package/lockfile выполняется до `COPY . .` |
| Кэш слоёв: apk после COPY | `Dockerfile:95-107` | ГИПОТЕЗА | `apk add wget` (107) после больших COPY — правка исходников инвалидирует слой |
| Воспроизводимость из lockfile | `Dockerfile:15`; `Dockerfile.workers:29`; `deploy/Dockerfile.prod:22` | ПРОЙДЕНО | `npm ci` строго по `package-lock.json`, без `|| npm install` |
| Запуск postinstall при сборке | `Dockerfile.quick:7` | ГИПОТЕЗА | `npm ci` без `--ignore-scripts` (в `Dockerfile:15` флаг есть) |
| Глушение ошибок сборки | `Dockerfile.quick:13,14,25-27` | ГИПОТЕЗА | `|| true`/`2>/dev/null || true` скрывают провал `prisma generate`, `build` и COPY |
| Прод-оверлей снимает порты БД/Redis | `docker-compose.prod.yml:69,114,125` (`!reset []`) | ПРОЙДЕНО | Порты postgres/redis/pgbouncer наружу не выставлены |
| Ротация логов | `docker-compose.prod.yml:36-40,52-56` | ПРОЙДЕНО | `json-file` с `max-size`/`max-file` для app/workers |
| Пароль Redis не в аргументах процесса | `docker-compose.yml:292-293` | ГИПОТЕЗА | `--requirepass <пароль>` виден в `ps`/`docker inspect` |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `Dockerfile:98`; `Dockerfile.workers:73`; `prisma/seed.ts:140-145` | В рантайм-образы app и workers копируется `prisma/` вместе с `seed.ts`, где зашиты фиксированные пароли тестовых учёток (`admin123`, `dispatch123`, `operator123`, `sas02password`) | Образ утекает в реестр/архив — в нём готовый список логинов и паролей (`admin@piling.ru`). От запуска защищает лишь `assertNotProduction` (`prisma/seed.ts:35-40`) + `NODE_ENV=production` | Не копировать `prisma/seed.ts` в стадии `runner` (app/workers): копировать `prisma/schema.prisma`+`migrations` при необходимости, сид оставить только стадии `migrate` |
| 2 | важно | `Dockerfile:4,20,54,73`; `Dockerfile.workers:23,34,59`; `docker-compose.yml:238,384`; `docker-compose.observability.yml:23,45,71,87,105,122,138,153` | Базовые образы приложения закреплены тегом, не digest (`node:22-alpine`); у pgbouncer/pgadmin и всего мониторинга — `:latest` | «Воспроизводимая сборка из lockfile» ложна: зависимости фиксированы, а базовый образ и сервисы дрейфуют между сборками/пулами; откат по тегу не гарантирует то же содержимое | Пинить digest (`node:22-alpine@sha256:...`), заменить `:latest` на конкретные версии образов |
| 3 | важно | `Dockerfile.workers:43,72` | Образ воркеров копирует `src/` целиком в рантайм; в `src` лежат тесты (`src/workers/__tests__/workers-image-smoke.test.ts`, `no-next-in-workers.test.ts`, `unified-worker.test.ts` и др.) | Прод-образ содержит тестовые файлы и фикстуры: лишний размер и лишняя поверхность (тест-код с путями/данными в проде) | Исключать `**/__tests__/**` и `**/*.test.ts` при COPY или через отдельный слой/stage |
| 4 | важно | `Dockerfile.quick:7,13,14,25-27` | `npm ci` без `--ignore-scripts` (7); `npx prisma generate ... || true` (13); `npm run build || echo` (14); `COPY ... 2>/dev/null || true` (25-27); нет HEALTHCHECK | Образ собирается «успешно», даже если prisma-клиент не сгенерирован или сборка упала; рантайм падает на старте. postinstall-скрипты зависимостей исполняются (тот самый supply-chain, который в `Dockerfile:11-14` намеренно закрыт) | Убрать `|| true`/`2>/dev/null`, добавить `--ignore-scripts`, явный prisma generate и HEALTHCHECK; либо пометить файл как не для боевой сборки |
| 5 | важно | `deploy/Dockerfile.prod:5,43,48,65` | Комментарий обещает «Distroless final image» (5), по факту `node:22-alpine` (48); `npm prune --production` (43) устарел и бесполезен (в runner копируется только standalone); `RUN chown -R nextjs:nodejs /app` (65) | `chown -R` перезаписывает метаданные всех файлов в дублирующий слой — ровно тот приём, от которого `Dockerfile.workers:69-70` прямо предостерегает (двоение образа); расхождение комментария и реализации путает сопровождение | Уточнить комментарий, убрать `prune`, заменить `chown -R` на `COPY --chown` / `chown` одного каталога |
| 6 | важно | `.dockerignore:33,55,59` (нет записей для `tests/`, `**/*.test.ts`, `tsconfig.tsbuildinfo`) | В контекст сборки и в слой `COPY . .` (`Dockerfile:37`) попадают тесты (`tests/`, `**/*.test.ts`), 1 МБ `tsconfig.tsbuildinfo` и пр. | Раздувание контекста/слоёв; тест-файлы попадают в слой builder; при `COPY src` (workers) — прямо в прод | Добавить в `.dockerignore`: `tests`, `**/*.test.ts`, `**/__tests__`, `tsconfig.tsbuildinfo` |
| 7 | мелочь | `Dockerfile:24-26` | Build-time stub-значения как `ENV` (SESSION_SECRET/DEVICE_KEY_LOOKUP_SECRET/PIN_LOOKUP_SECRET) | Видны в истории слоя стадии builder; если кто-то соберёт `--target builder` и запустит — приложение стартует с заведомо известным секретом | Передавать только как `ARG` (не `ENV`) или унести заглушки в одноразовый скрипт |
| 8 | мелочь | `docker-compose.yml:292-293` | Пароль Redis передаётся аргументом `redis-server --requirepass <пароль>` | `ps`/`docker inspect` внутри контейнера показывают пароль в командной строке процесса; при утечке логов/дампов — прямой доступ к Redis | Передавать через env `REDIS_PASSWORD` и `requirepass` из env (файл-конфиг), не как CLI-аргумент |
| 9 | мелочь | `docker-compose.observability.yml:125`; `docker-compose.monitoring-prod.yml:105` | DSN экспортёра Postgres выглядит как литерал `${POSTGRES_USER:***@postgres:5432/...}` (проверено `node -e`: строка содержит `***`, подстановка пароля отсутствует/битая) | `postgres-exporter` не получит корректный DSN/пароль → метрики Postgres в Grafana пустые, «no data», ложная тишина в мониторинге | Восстановить корректную подстановку `:${POSTGRES_PASSWORD}` (или отдельная read-only роль) |
| 10 | мелочь | `docker-compose.observability.yml:50`; `docker-compose.monitoring-standalone.yml:49` | `GF_SECURITY_ADMIN_PASSWORD=admin` жёстко в файле | Учётка Grafana admin/admin в стенде; если порт открыт наружу — открытый доступ к дашбордам | Задать пароль через `${GRAFANA_PASSWORD:?}` (как в `docker-compose.monitoring-prod.yml:60`) |
| 11 | мелочь | `docker-compose.observability.yml:16,25-26,...`; `docker-compose.monitoring-standalone.yml:25-26,...` | Обsolete-ключ `version: '3.8'` (observability:16); все порты биндятся на `0.0.0.0` (например `:25-26`) | Compose v2 игнорирует `version` и предупреждает; сервисы доступны с любой сетевой карты — на машине с публичным IP это открытые Grafana/Prometheus | Удалить `version`; биндить на `127.0.0.1:` как в monitoring-prod |
| 12 | мелочь | `scripts/Dockerfile.backup:1` | Базовый образ `postgres:16-alpine` (в бою Postgres `18-alpine`, `docker-compose.yml:345`), нет `USER` (root), образ ни одним compose/deploy не собирается | Версия pg-утилит не совпадает с серверной (риск несовместимости дампа), бэкап-процесс под root | Согласовать с `postgres:18-alpine`, добавить non-root; либо удалить/архивировать как неиспользуемый |
| 13 | мелочь | `scripts/deploy-prod.sh:113` | Переключение выполняется `docker compose up -d --no-build ${UP[*]}` без `-f docker-compose.yml -f docker-compose.prod.yml` | Если на сервере не задан `COMPOSE_FILE`, прод-оверлей (снятие портов, лимиты, ротация логов) не применяется — базовый compose поднимет БД/Redis наружу. `docs/deployment.md:73` показывает запуск оверлея | Явно передавать оба `-f` (или закрепить `COMPOSE_FILE` в окружении сервера и проверить) |
| 14 | мелочь | `scripts/deploy-prod.sh:65`; `Dockerfile.workers:1-99` (нет `ARG APP_VERSION`) | В сборку воркеров передаётся `--build-arg APP_VERSION=$SHA`, но `Dockerfile.workers` не объявляет `ARG APP_VERSION` | Docker предупреждает о неиспользуемом build-arg; версия SHA не фиксируется в образе воркеров — ложное ощущение трассируемости | Добавить `ARG/ENV APP_VERSION` в `Dockerfile.workers` либо убрать build-arg |
| 15 | мелочь | `Dockerfile:28-31` (комментарий про Turbopack) vs `package.json:8` (`next build --webpack`) | Комментарий в Dockerfile объясняет поведение `APP_VERSION` через «`next build` (Turbopack)», а фактически сборка идёт `--webpack` | Обоснование в комментарии может не соответствовать текущему бандлеру → ложная уверенность в инлайне `process.env.APP_VERSION` | Обновить комментарий под `--webpack` или вернуть Turbopack |
| 16 | мелочь | `Dockerfile:97,104` vs `scripts/copy-standalone-assets.js:32-45` | `COPY /app/public` и `COPY /app/src/generated` в runner дублируют то, что `copy-standalone-assets.js` уже положил в `.next/standalone` | Лишние слои/размер, при этом источник истины раздваивается (что реально нужно — неясно) | Оставить один механизм (понимая причину из комментария `Dockerfile:100-102`) |
| 17 | мелочь | `Dockerfile:107` | `apk add --no-cache wget` стоит ПОСЛЕ больших `COPY` (95-104) | Любая правка исходников инвалидирует слой установки wget — лишняя пересборка | Перенести установку пакетов выше COPY |
| 18 | мелочь | `docker-compose.yml:237-339,344-378` (redis/redis-cache/postgres/pgbouncer) | Ни `read_only`, ни `cap_drop`, ни `security_opt`, ни non-root не заданы для сервисов данных | Стандартный набор hardening для контейнеров отсутствует; при компрометации контейнера шире поверхность | Добавить `cap_drop: [ALL]`, `security_opt: no-new-privileges`, `read_only` где возможно |

## Не проверено

- Фактические размеры образов и состав слоёв (`docker image inspect`/`dive`) — образы не собирались (запрещено заданием). Оценка по составу — только по тексту `COPY`/`RUN`.
- Реальная применимость прод-оверлея на сервере: задан ли `COMPOSE_FILE` в боевом `.env` — вне репозитория (не читал `.env`). Находка 13 — по коду `scripts/deploy-prod.sh:113`.
- Действительно ли DSN экспортёра (находки 9) ломается в рантайме или Compose/образ иначе трактует `***` — `docker compose config` не запускал.
- Реальный эффект заглушек-секретов `Dockerfile:24-26` в проде — стадия builder не запускалась (по коду она не доходит до runner).
- Есть ли на сервере/в реестре старые образы с `seed.ts` — базы и реестр не читались.
- Не читались отчёты в `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` (запрещено заданием); совпадения возможны и не проверялись.
