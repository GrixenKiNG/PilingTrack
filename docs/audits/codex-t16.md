# Поток 16 — зависимости

Рабочее дерево `D:/PillingR/wt-codex16`, ветка `codex/deps-1010`, база `e6aef7a4`. Push, merge, SSH и выкладка не выполнялись. Схема и миграции не менялись.

## D1 — сделано

Коммит `8e1abc5f`. `@sentry/nextjs` 10.76.2 → 11.6.0. Настройки сбора данных общие для браузера, сервера, edge и standalone workers: выключены cookies, userInfo, тела HTTP, SQL-параметры, содержимое GenAI/GraphQL; закрыты чувствительные заголовки и параметры token/password. Частоты остались 0 в браузере и 0.1 на сервере/edge/workers. `traceLifecycle: 'static'` сохраняет пакетную отправку трасс; `beforeSendLog` отбрасывает логи, поскольку старый выключатель удалён SDK 11.

OTel явно включён на сервере и в standalone workers: отдельной регистрации провайдера в приложении нет. Workers используют `@sentry/node`. Туннель `/_relay` исключён из proxy matcher. Тест перехватил настоящий envelope BrowserClient, проверил rewrite, matcher и сбор данных; запросы Sentry наружу не отправлялись.

Проверки: установка с `--ignore-scripts` exit 0 (не проверка чистой установки); Prisma generate с безопасным конфигом exit 0; `npx tsc --noEmit` exit 0; `npm run lint` exit 0, ноль предупреждений; focused Vitest 4 файла, 47 passed / 0 skipped, exit 0. Первичный red: 7 failed / 1 passed; часть падений уточняла контракт SDK/rewrite.

Финальный Docker build `pilingtrack-workers:codex-t16-d1` exit 0; `scripts/smoke-workers-image.sh` через Git Bash exit 0, достигнут Arming. Node образа 22.23.3 (exit 0), npm базового образа 10.9.9. Dockerfile не менялся; тестовый URL стадии сборки уже находился в Dockerfile. Образ запускался без сети; production не использовался.

Руководство: [Sentry 10 → 11](https://docs.sentry.io/platforms/javascript/guides/nextjs/migration/v10-to-v11/).

## D2 — сделано

Коммит `47965b3d`. `ioredis` 5.11.1 → 6.0.0, версия закреплена. Выбран RESP2: все подключения явно задают `protocol: 2`, включая rate limiter, revocation store, cache factory, PDF queue/workers, диагностические скрипты, нагрузочные тесты и disposable e2e fixture. Бизнес-правила auth/лимитера не менялись. BullMQ 6.3.12 использует ту же deduped ioredis 6.0.0.

Живой Redis 7.4.11 проверен до и после обновления. `node scripts/test-redis-protocol.cjs`: exit 0, 10 passed / 0 failed / 0 skipped. Проверены GET/SET, JSON сессии, INCR, TTL/PTTL, pipeline/MULTI, точный Lua лимитера и настоящая завершённая задача BullMQ с сохранённым результатом. Скрипт создаёт свой Redis-контейнер с уникальным ownership label и удаляет его в finally; контейнер удалён.

Focused safe Vitest: exit 0, 6 файлов / 84 passed / 0 skipped. Red constructor protocol: PDF worker 4 passed / 1 failed; unified worker 9 passed / 2 failed (один protocol, один timeout холодного импорта). Финальный прогон полностью прошёл. Generate + patch client, tsc, lint, `npm ls ioredis --all`, `node --check`, diff check: exit 0. Установка с `--ignore-scripts` не названа clean install.

## D3 — отложено

Поиск не нашёл импортов `cookie`, `next-themes`, `@types/bcryptjs` в коде/скриптах/тестах/конфигах; совпадения cookie в настройках Sentry/маскирования — имена HTTP-полей. Удаление требует сборки и тестов по заданию. `npm run build` с запретом чтения `.env` дал exit 1: отсутствуют DATABASE_PROVIDER и SESSION_SECRET. Next build не начался. Поддельные настройки не добавлялись, поэтому доказательства для удаления недостаточно. Зависимости оставлены.

OTel и `@swc/helpers` также оставлены: отсутствие прямого импорта не доказывает отсутствие использования инфраструктурой SDK/компилятора.

## D4 — исправления сделаны, приёмка частичная

Коммит `50c5bac7`. Существующие overrides сохранены; добавлены точные mysql2 3.15.3 → 3.24.5, deepmerge-ts 7.1.5 → 8.0.2, source-map-js 1.2.1 → 1.2.2. Исходный audit: exit 1, 10 high; итоговый: exit 1, 5 high в цепочке braces → micromatch → fast-glob → eslint-plugin-next → eslint-config-next. Исправленной версии braces для этой находки не установлено; предложенный npm downgrade eslint-config-next до 14 не выполнялся. [Advisory braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Установка с `--ignore-scripts`, Prisma generate/validate, tsc, lint и diff check: exit 0. Focused Vitest: 3 файла / 53 passed / 0 skipped, exit 0. Отдельные реальные библиотеки mysql2 formatting без подключения, deepmerge config merge и PostCSS/source-map: 3 проверки прошли, exit 0.

Статический `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`: exit 0, SQL 103250 байт, 83 CREATE TABLE — столько же моделей в схеме. Для этой проверки отдельный ignored config содержит только schema и metadata URL `postgresql://schema_only@schema-only.invalid:5432/schema`: это зарезервированный несуществующий адрес для статического сравнения, а не настройки приложения. Данные БД не читались, SQL не применялся. Сравнение схемы с самой собой: exit 0, `No difference detected`.

Schema-only config без datasource сначала дал ложный exit 0 без SQL; DEBUG показал отсутствие аргумента --datasource у schema-engine. Этот результат не засчитан. С metadata fixture действительная генерация SQL доказана. Build остался exit 1 на отсутствующем окружении, до компиляции Next. Поэтому D4 не объявляется полной зелёной приёмкой.

## D5 — политика и чистая установка зависимостей проверены

Коммит `948c583f`. Новая .npmrc разрешает только @prisma/engines@7.10.0, prisma@7.10.0, esbuild@0.28.2, msgpackr-extract@3.0.4, unrs-resolver@1.12.2. Engine hook готовит Prisma binaries; prisma preinstall проверяет runtime; esbuild/resolver/msgpack hooks готовят нативные инструменты. sharp 0.35.5 и @prisma/client 7.10.0 не имеют install script; @sentry/cli и protobufjs отсутствуют после D1. macOS-only fsevents не установлен на Windows/Linux и оставлен без разрешения; macOS установка не проверена.

`npm install-scripts ls --json`: exit 0, pending-список пуст. Проверка реальным policy matcher установленного npm 11.19.0: exit 0, разрешены пять точных версий, отклонены пять других версий и неизвестный пакет. Первый вариант проверочного скрипта ошибочно включал Darwin-only fsevents и дал exit 1; после учёта платформы проверка прошла.

В отдельной обычной папке output/codex-t16/clean-install скопированы package.json/lock/.npmrc и схема; в копии удалён ТОЛЬКО корневой postinstall. `npm ci --foreground-scripts --no-audit --no-fund`: exit 0, 819 пакетов, выполнены все пять разрешённых hooks. Реальные esbuild transform, загрузка resolver и msgpack native, кодирование 1×1 PNG sharp: exit 0, четыре проверки. Prisma generate и validate в этой чистой копии: exit 0 / 0 с config без dotenv/datasource. Root postinstall приложения требует окружения; чистая установка приложения целиком не объявлена пройденной. Лог установки сохранён в output/codex-t16/clean-install.log.

Финальные безопасные Prisma generate + patch client, `npx tsc --noEmit`, `npm run lint`: exit 0, предупреждений lint нет. Dockerfile workers не копирует .npmrc и использует npm ci --ignore-scripts. Финальный образ pilingtrack-workers:codex-t16-final собран после всех зависимостей: build exit 0, smoke startup/Arming exit 0; Node 22.23.3 / npm 10.9.9 проверены отдельными командами с exit 0. Образ не зависит от политики npm 11 на этом ПК.

## D6 — проверена готовность, обновления не установлены

Native preview 7.0.0-dev.20260707.2 установлен только в отдельную принадлежащую проверке папку Temp. Финальный `tsgo --project D:/PillingR/wt-codex16/tsconfig.json --noEmit --incremental false --pretty false` повторён после D2/D4: exit 0, 0 ошибок. Временная папка удалена; отсутствие подтверждено. Первый промежуточный запуск на незавершённом D1 дал две ошибки implicit any; они не являются финальным результатом TS 7. Ошибка пути bin/tsgo.js при повторной подготовке дала MODULE_NOT_FOUND, после чтения реального bin запущен compiler; ошибка пути не засчитана как результат typecheck.

В tsconfig нет baseUrl, moduleResolution=bundler, strict=true: перечисленные в задании изменения не дали ошибок native compiler. Полная сборка Next с TS 7 не проверена. Текущий typescript-eslint 8.70.1 допускает TypeScript <6.1.0, поэтому поддержку TS 7 утверждать нельзя. Для ESLint 10 нужны совместимые react/import/jsx-a11y plugins и соответствующий eslint-config-next: нынешние react 7.37.5, import 2.32.0, jsx-a11y 6.10.2 ограничивают peer диапазон ESLint 9. Номер ещё не проверенной совместимой версии не выдуман. В проекте остаются TypeScript 6.0.3 / ESLint 9.39.5 / eslint-config-next 16.4.0.

Вывод: native typecheck готов, совместимость всей цепочки ещё не доказана; обновлять TS 7 / ESLint 10 сейчас нельзя на основании этой проверки. [Peer requirements](https://typescript-eslint.io/users/dependency-versions/), [native preview](https://github.com/microsoft/typescript-go/blob/main/_packages/native-preview/README.md).

## GitNexus и ограничения

MCP недоступен. Две CLI-попытки (Node 26.7 и 24.19) завершились exit 1: @ladybugdb/core source build, spawnSync cmd.exe ENOENT. Пользователь разрешил замену impact/detect_changes для потоков 16/17. Перед изменениями/коммитами используются поиск по всему репозиторию и diff; callers/processes/graph risk остаются UNKNOWN.

Отклонение: при D4 один первый вызов справки Prisma был запущен без безопасного конфига. CLI загрузил prisma.config.ts с dotenv/config; `.env` мог быть прочитан автоматически. Значения секретов в выводе не появились. Дальнейшие Prisma-вызовы выполняются с безопасным конфигом и файловым guard. Это не заявляется соблюдённой проверкой запрета чтения.

## Итоговые проверки

Стандартный vitest.config.ts сам читает .env. Поэтому использована ignored копия output/codex-t16/vitest.no-env.config.ts: сохранены plugins/setup/includes, удалён dotenv-loader, envDir=false, alias указывает на ../../src. Для npm/Prisma/build добавлен ignored NODE_OPTIONS preload, запрещающий чтение .env, а DATABASE_URL/POSTGRES/APP_ROLE, REDIS_URL и build-секреты удалены из окружения дочернего процесса. Это изменение способа проверки, а не правка конфигов проекта или поддельное окружение приложения.

| Проверка | Exit | Результат |
|---|---:|---|
| .next/dev/types | 0 | Каталог отсутствовал; чужие/сгенерированные типы не удалялись |
| npx tsc --noEmit | 0 | На финальном клиенте/зависимостях |
| npm run lint | 0 | Ноль warnings, text integrity passed |
| npx vitest run --config output/codex-t16/vitest.no-env.config.ts --maxWorkers=2 --testTimeout=30000 | 0 | 392 файлов прошли, 13 пропущены; 4177 passed, 2 expected fail, 257 skipped; всего 4436 |
| npx playwright test --list | 0 | 291 тест в 27 файлах; запуск браузерных тестов не выполнялся |
| npm run build с файловым guard | 1 | Нет DATABASE_PROVIDER / SESSION_SECRET; Next compilation не началась |
| Финальный workers Docker build / smoke | 0 / 0 | Startup и Arming без сети; Next в workers не нужен |

Skipped интеграции не выдаются за проверенные. JSON Vitest считает expected failures частью passed (4179); выше приведён раздельный итог текстового reporter. Полный прогон сделан после D4; последующая .npmrc не меняет исполняемый код/версии. Непроверенные Next route types остаются риском сборки.

Исходные файлы не удалялись. Изменения защищённых rate-limiter/session-service ограничены protocol:2 и прямо разрешены D2; Dockerfile/tenancy/auth-политика/ORION не изменялись. Предположительно лишние зависимости сохранены по D3. Коммиты реализации: 8e1abc5f, 47965b3d, 50c5bac7, 948c583f; итоговый отчёт — отдельный коммит.

## Изменённые файлы

| Путь | Строки относительно e6aef7a4 |
|---|---:|
| .npmrc | +2 / −0 |
| e2e/fixtures/disposable-performance.mjs | +1 / −1 |
| load-tests/event-storm.ts | +1 / −0 |
| package-lock.json | +698 / −1011 |
| package.json | +6 / −3 |
| scripts/redis-stress-test.js | +2 / −0 |
| scripts/test-redis-cache.js | +1 / −0 |
| scripts/test-redis-protocol.cjs | +173 / −0 |
| sentry.edge.config.ts | +4 / −2 |
| sentry.server.config.ts | +7 / −2 |
| src/__tests__/sentry-config.test.ts | +99 / −0 |
| src/instrumentation-client.ts | +6 / −2 |
| src/lib/pdf-queue.ts | +2 / −0 |
| src/lib/rate-limiter.ts | +1 / −0 |
| src/lib/redis-cache.ts | +1 / −0 |
| src/lib/sentry-data-collection.ts | +19 / −0 |
| src/proxy.ts | +1 / −1 |
| src/services/auth/session-service.ts | +1 / −0 |
| src/workers/__tests__/pdf-worker.test.ts | +9 / −1 |
| src/workers/__tests__/unified-worker.test.ts | +6 / −1 |
| src/workers/pdf-worker.ts | +1 / −0 |
| src/workers/unified-worker/pdf.ts | +1 / −0 |
| src/workers/unified-worker/sentry.ts | +6 / −2 |

Временная clean-install папка удалена после проверки абсолютного пути, отсутствия junction и ownership marker; Remove-Item exit 0, Test-Path False. Проверочные логи и безопасные конфиги остались в ignored output.
