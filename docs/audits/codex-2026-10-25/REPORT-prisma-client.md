# Задача 1 — генератор Prisma client

Ветка codex/prisma-client-1025, рабочая папка D:/PillingR/wt-prisma-client-1025. База origin/main: f21eb0bc8f20df6b5ed51642622d4c3ff2fccb9c. Изменения и отчёт — один коммит; точный SHA дан в итоговом сообщении, доступен через git log -1.

## Результат

Генератор заменён на prisma-client с прежним output, moduleFormat=cjs и importFileExtension=ts. Явный CJS-формат совместим с существующим проектом без type=module и workers/tsx. Клиент — исходный TypeScript; Next компилирует его вместе с серверным кодом. Проверка полным сравнением текста вне generator-блока: модели, индексы и datasource идентичны базе. Миграции не изменены.

В db.ts статический импорт заменил eval(require), абсолютный runtime-путь client.js и кэш runtime-модуля. Существующий lazy proxy и ленивое создание PrismaClient, адаптер, параметры пула, транзакции и RLS-обёртки сохранены. Статический граф теперь позволяет Next трассировать runtime без патча и ручного копирования generated-папки / полного @prisma. Workers исполняют тот же клиент через установленный production tsx.

Удалён старый скрипт патча (60 строк) и все активные вызовы в package.json, Dockerfile.workers и трёх disposable .sh. Удалено исключение для него в .dockerignore. Зависимости и lock не изменены. Seed и служебные скрипты импортируют явный /client. Plain Node smoke и ESM role-audit используют scoped tsx/cjs/api loader. Правило ESLint уже запрещает @/generated/postgres-client/* в runtime клиентских компонентов; /client покрыт существующим правилом, семантика не менялась.

В RLS-тесте изменена только загрузка generated-клиента с отдельного разрешения владельца; проверки и SQL не изменялись. Код security/auth/RLS, замороженные зоны и deploy-скрипты не менялись.

## Файлы и размеры

| Файл | Строк после |
|---|---:|
| `.dockerignore` | 110 |
| `Dockerfile` | 119 |
| `Dockerfile.workers` | 97 |
| `e2e/fixtures/role-audit.mjs` | 25 |
| `package.json` | 140 |
| `prisma/schema.prisma` | 2897 |
| `prisma/seed-test-data.ts` | 175 |
| `prisma/seed.ts` | 732 |
| `scripts/apply-postgres-hardening.ts` | 275 |
| `scripts/backfill-maintenance-regulation.ts` | 163 |
| `scripts/copy-standalone-assets.js` | 47 |
| `scripts/explain-analyze.ts` | 222 |
| `scripts/patch-postgres-client.js` | удалён (60 строк) |
| `scripts/reset-one-password.ts` | 50 |
| `scripts/reset-passwords.ts` | 60 |
| `scripts/seed-checklist-blocks.ts` | 985 |
| `scripts/seed-maintenance-plans.ts` | 120 |
| `scripts/seed-user-document-types.ts` | 150 |
| `scripts/smoke-auth-access.js` | 337 |
| `src/lib/db.ts` | 186 |
| `src/modules/equipment/application/queries/__tests__/run-fuel-disposable.sh` | 11 |
| `src/services/telemetry/__tests__/run-reliability-disposable.sh` | 11 |
| `tests/integration/notifications/run-disposable.sh` | 44 |
| `tests/integration/rls-tenant-enforcement.spec.ts` | 142 |

Удаление скрипта проверено rg по всему репозиторию: все активные ссылки были перечислены выше и удалены. Исторические упоминания в старых отчётах не являются исполняемыми вызовами. Удалений компонентов, функций предметной области или тестов нет.

## Проверки

Журналы и каждый реальный exit code: D:/PillingR/night-logs/codex-1025/<имя>.log и <имя>.exit. Команды запускаются отдельными дочерними процессами.

| Команда / проверка | Код | Результат | Журнал |
|---|---:|---|---|
| npm ci | 1 | postinstall без DATABASE_URL_POSTGRES; установка зависимостей по lock выполнена | prisma-ci |
| npm run db:generate до/после | 0 / 0 | оба клиента сгенерированы; финальный 7.10.0, без патча | prisma-generate-before / after |
| npx tsc --noEmit -p tsconfig.json до / после | 0 / 0 | финальные типы после Next build | prisma-baseline-tsc / prisma-final-tsc |
| node node_modules/vitest/vitest.mjs run src/lib src/services/telemetry src/modules/equipment/application/queries src/workers tests/integration/rls-tenant-enforcement.spec.ts, до | 1 | 674 passed / 5 skipped / 3 failed, повтор на исходной базе | prisma-baseline-unit-repeat |
| та же команда после | 0 | 677 passed / 5 skipped / 0 failed | prisma-after-unit |
| npm run test:unit -- --maxWorkers=8 | 0 | 5481 passed / 265 skipped / 0 failed; 494 passed / 15 skipped files | prisma-final-unit |
| npx eslint --no-warn-ignored <изменённые TS/JS/MJS> | 0 | проектный ESLint; scripts/prisma/e2e игнорируются штатной конфигурацией | prisma-current-eslint |
| npx playwright test --list | 0 | 318 tests in 28 files до и после | prisma-playwright-list-fixed / bullmq-playwright-baseline |
| npm run build, разрешённое локальное build-окружение | 0 | webpack, route types, 95 static pages, standalone | prisma-build-local-authorized |
| Docker workers runner build | 0 | pilingtrack-workers:codex-prisma-1025 | prisma-docker-workers-build |
| workers smoke | 0 | starting, arming, ready; нет missing module; stop exit0/OOMfalse | prisma-workers-* |
| Docker app runner build, повтор | 0 | pilingtrack-app:codex-prisma-1025 | prisma-docker-app-build-retry |
| app HTTP smoke | 0 | /api 200, /login 200, /api/reports/pdf 401, /api/health 503 при изолированной недоступной БД | prisma-app-http-smoke-retry |
| CJS generated-client + lazy db import | 0 | без подключения к БД | prisma-cjs-import |
| ESM role-audit import, финальный | 0 | фикстура не запускалась, запросов к БД нет | prisma-esm-import-final |

До базового tsc свежая рабочая папка не содержала .next/dev/types. Build действительно проверил Next route types; skipped не считаются выполненной интеграцией.

## Исходные сбои и исправленные пробы

На исходной базе затронутые тесты дважды показали три падения: page-ability-layouts.test.ts, сценарий admin/page без права — timeout 5000ms; projection-worker.test.ts W121 overlapping weekly — timeout 5000ms; W121 stop pending weekly — ожидался один вызов mockWeeklyUpsert, получено два. Второй прогон сохранил настоящий exit1; у первого завершённого прогона потеряна запись exit при сбросе инструментального REPL, поэтому он не используется как самостоятельный зелёный шлюз. Тесты не переписывались. Финальные targeted и полная suite зелёные. Точная причина нестабильности исходных тестов отдельно не исследовалась.

Первый локальный build завершился exit1 на отсутствии DATABASE_PROVIDER и SESSION_SECRET. После явного разрешения владельца helper читает только пять уже существующих build-time ENV из Dockerfile и передаёт их дочернему build в RAM, без записи значений и без .env. Генерация до этого использовала разрешённый фиктивный URL только для npm run db:generate.

Первая app image build завершилась exit1 в next/font (TypeError на URL шрифта без расширения). Повтор того же исходника прошёл полностью; исходные логи сохранены. Замороженная страница operator/v5 и её шрифт не менялись. Этот дефект Next 16.4.1 отдельно учтён в patch-обновлении задачи 3.

Первый Playwright --list дал exit0, но SyntaxError import.meta вне ESM и 0 тестов: это не считалось успешной проверкой. Путь scoped loader исправлен на process.cwd()/package.json без import.meta; повтор собрал 318 тестов в 28 файлах, столько же на исходной базе в соседней ветке (next.config не влияет на collection). Тела тестов не менялись.

Первый scoped ESM tsx/esm/api import дал ENOENT с namespace в пути на Node26; в фикстуре выбран работающий tsx/cjs/api, повтор exit0. Первый запуск app без SESSION_SECRET дал HTTP500 на instrumentation. Повторный smoke использовал одноразовые криптографические ключи, сгенерированные внутри процесса контейнера и существующие только в памяти. Изображение при этом не менялось.

Оба smoke-контейнера работали с --network none и адресами loopback:1 из ранбука 008. Ошибки связи с PostgreSQL/Redis ожидаемы; проверялись старт и маршруты/отсутствие missing modules, не здоровый полный production stand. App health 503 не объявляется зелёной БД. Контейнеры удалены после проверки ownership label; теги образов сохранены. App штатно остановлен, фактический exit указан в prisma-app-final-state.json.

## GitNexus

Свежий индекс до основных правок, list, query/context и file-qualified upstream impact: loadPrismaRuntimeModule LOW / 3 зависимых, createPrismaClient LOW / 2, copyRecursive LOW / 1, smoke getPrismaClient LOW / 4. Пустые flows не считались отсутствием использования: импортёры и пути проверены rg. Перед коммитом выполнены обновление индекса и полный detect_changes all с partial=false/truncated=false; полный JSON сохранён рядом с журналами. Дополнительные impact двух require-замен внутри scripts/apply-postgres-hardening.ts и scripts/explain-analyze.ts выполнены при финальной сверке: LOW / 2 и LOW / 1. Отдельный impact именно этих двух функций до первоначальной замены был пропущен; это процессуальное отклонение от AGENTS.md, а не заявленная pre-edit проверка. До коммита результаты подтверждены прямыми вызовами main/getPrismaClient и CLI-записями package.json. SQL/бизнес-логика этих скриптов не менялась. Ограничения бюджета общих execution flows остаются свойством индекса.

## Ограничения

Предупреждение BullMQ optional GLIDE остаётся в этой ветке и исправляется отдельной задачей 2. У Docker остаются штатные warnings об уже существующих build-time stub ENV; реальные секреты не использовались. Новые зависимости, schema models, миграции, production, SSH, push/merge/deploy не затрагивались. Seed, hardening и прочие скрипты, способные записывать в БД, не запускались; проверена структура импортов, но их действия с реальной БД не заявляются проверенными. Playwright — только collection, не browser E2E.

Документация генератора: https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators . Ранбук smoke: docs/runbooks/008-manual-deploy.md.
