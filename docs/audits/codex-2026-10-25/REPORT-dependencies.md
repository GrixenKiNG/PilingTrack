# Задача 3 — аудит и обновление зависимостей

Ветка codex/dependency-audit-1025, рабочая папка D:/PillingR/wt-dependency-audit-1025. База origin/main: f21eb0bc8f20df6b5ed51642622d4c3ff2fccb9c. Изменения независимы от веток задач 1 и 2; объединение и push не выполнялись.

## Границы и метод

Проверены все 60 исходных прямых зависимостей: 39 production и 21 dev. Поиск по отслеживаемым src/scripts/tests/e2e/prisma, конфигурациям и Dockerfile; точные импорты отделены от упоминаний в документах. Неявные типы, генераторы, CLI и динамический coverage учитывались отдельно. Таблица ниже показывает фактические версии lock, а не только диапазоны package.json; latest — снимок npm outdated на 25.10.2026, не обещание будущей актуальности.

Менялись только package.json, package-lock.json и этот отчёт. Исходники, тесты, схема/миграции, auth/RLS, замороженные зоны, Dockerfiles и deploy не изменялись. Новых имён пакетов при обновлениях не добавлено; состав каждого промежуточного lock проверялся до установки. npm audit fix --force не использовался.

Чистая установка выполнялась как npm ci --ignore-scripts: корневой postinstall требует отсутствующего URL. В начале отдельно выполнен разрешённый npm run db:generate со scoped фиктивным DATABASE_URL_POSTGRES; после обновлений генерация реально выполнялась через build. Для build использованы только пять штатных build-time значений Dockerfile, явно разрешённых владельцем, в окружении дочернего процесса. .env не читались и не создавались; значения в новые файлы не сохранялись.

## Уязвимости и удаление

Начальный npm audit: exit 1, одна high — happy-dom 20.14.6, GHSA-834v-8h66-3h79. Мажор 21.0.4 явно разрешён владельцем и проверен отдельной группой. После него npm audit: exit 0, ноль уязвимостей. CSS/iframe loading обратно не включались. Vite уже был 8.3.5, совпадал с latest и не имел уязвимости в исходном audit. Цепочка braces/micromatch/fast-glob через ESLint также не была уязвимой по фактическому исходному audit; сведения старого аудита не выдавались за текущее состояние.

Удалены только cookie 2.0.1 и @types/bcryptjs 3.0.0. Перед удалением выполнен повторный npm ls после группы Prisma: оба пакета только прямые, транзитивных потребителей нет (deps-remove-candidates-current.json). Полный поиск точных import/require/dynamic import не нашёл использования cookie; упоминания HTTP cookie не являются импортом пакета. @types/bcryptjs — stub, bcryptjs поставляет собственные types. Его dist-tag latest 2.4.6 ниже установленного stub 3.0.0; это не предложенное major-обновление и не downgrade. Файлы исходников/тестов не удалялись. @swc/helpers оставлен: нужен Next/fontkit транзитивно. Остальные @types и coverage-v8 нужны инструментам без прямого runtime import.

## Отклонённая группа Radix

Группа 5 не сохранена. npm ci/build/tsc: exit 0; unit: exit 1, 5302 passed / 2 skipped / 3 failed. Падения:

- src/lib/__tests__/no-global-db-in-tx.test.ts, «найденные вхождения совпадают с KNOWN»: timeout 20000 ms.
- src/lib/__tests__/page-ability-layouts.test.ts, «таблица покрывает все вызовы requirePageAbility( в src/app»: timeout 5000 ms.
- src/workers/__tests__/no-next-in-workers.test.ts, «ни один файл статического графа unified-worker не импортирует next»: timeout 5000 ms.

Assertion-регрессия Radix этим не доказана. По правилу красного шлюза восстановлены оба файла из deps-group5-before (база 1c239e1df8a8a12d02d7cb2fb76f843557a5a3db); git status после восстановления пустой, повторный npm ci --ignore-scripts exit 0, audit установки 0 vulnerabilities. Все девять прямых Radix-пакетов оставлены в исходных версиях. lint/audit группы 5 не запускались: драйвер остановился на unit. Тесты и таймауты не менялись, красный результат не заменён узким повтором.

## Проверки

Журналы и настоящие exit codes: D:/PillingR/night-logs/codex-1025. Группы выполнялись последовательно; внутри группы каждая команда запускалась отдельным дочерним процессом, следующая — после завершения предыдущей. Перед tsc удалялась только проверенная абсолютная папка .next/dev/types.

Исходная база: npm ci --ignore-scripts 0; npm run db:generate 0; node node_modules/vitest/vitest.mjs run src --maxWorkers=2 — exit 0, 5305 passed / 2 skipped / 0 failed, 478 файлов. npm outdated exit 1 означает наличие обновлений, это не ошибка сбора.

Для каждой принятой группы: npm run build; node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json (тот же компилятор, который запускает npx tsc); node node_modules/vitest/vitest.mjs run src --maxWorkers=8; npm run lint (eslint . и check-text-integrity). Все unit-группы сравнивались с 5305 passed / 2 skipped / 0 failed.

| Группа | npm ci | build | tsc | unit (passed/skipped/failed) | lint | audit |
|---|---:|---:|---:|---|---:|---:|
| 1 | 0 | 0 | 0 | 0; 5305/2/0 | 0 | не запускался; исходный high |
| 2 | 0 | 0 | 0 | 0; 5305/2/0 | 0 | 0 |
| 3 | 0 | 0 | 0 | 0; 5305/2/0 | 0 | 0 |
| 4 | 0 | 0 | 0 | 0; 5305/2/0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 1; 5302/2/3; откат | не запускался | не запускался |
| 6 | 0 | 0 | 0 | 0; 5305/2/0 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0; 5305/2/0 | 0 | 0 |

## Коммиты принятых групп

- e58456f186c746b8527bd9ecb7eb984322830c67 chore(deps): update Next and its ESLint config to 16.4.3
- c80f1f7d4dc38bed744a4bfc86ec93720f6e7ea4 fix(deps): upgrade approved happy-dom to patched 21.0.4
- bb5ae8f146c8dc6d25d39e16882bdfdc473bf155 chore(deps): align Prisma client adapter and CLI on 7.10.1
- 1c239e1df8a8a12d02d7cb2fb76f843557a5a3db chore(deps): patch test tooling and remove unused dependencies
- e407f58509339f5c1df6ebc355bf62f2dfd35d36 chore(deps): update React motion icons and state runtime
- d567c0eb9f8aca85ddc0030bf0e91541379d3866 chore(deps): update storage telemetry queue and JWT patches

## Полная таблица исходных прямых зависимостей

Тип сравнивает исходную и latest; для Prisma выбран только patch 7.10.1 при отложенном latest major. Ноль уязвимостей относится к итоговому npm audit, не к полному security review.

| Пакет / класс | Было | После | Latest (снимок) | Тип | Уязвимость до → после | Использование | Решение |
|---|---|---|---|---|---|---|---|
| @aws-sdk/client-s3 / prod | 3.1149.0 | 3.1156.0 | 3.1156.0 | minor | 0 → 0 | src/app/api/media/[id]/download/route.ts:7, src/app/api/media/download-batch/route.ts:23 | обновлён, шлюзы пройдены |
| @aws-sdk/s3-request-presigner / prod | 3.1149.0 | 3.1156.0 | 3.1156.0 | minor | 0 → 0 | src/app/api/media/[id]/download/route.ts:6, src/app/api/media/download-batch/route.ts:22 | обновлён, шлюзы пройдены |
| @prisma/adapter-pg / prod | 7.10.0 | 7.10.1 | 7.10.1 | patch | 0 → 0 | src/lib/db.ts:12, src/workers/__tests__/no-next-in-workers.test.ts:274 | обновлён, шлюзы пройдены |
| @prisma/client / prod | 7.10.0 | 7.10.1 | 7.10.1 | patch | 0 → 0 | prisma/seed-test-data.ts:6, scripts/explain-analyze.ts:18 | обновлён, шлюзы пройдены |
| @radix-ui/react-alert-dialog / prod | 1.1.24 | 1.1.24 | 1.2.1 | minor | 0 → 0 | src/components/ui/alert-dialog.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-checkbox / prod | 1.3.12 | 1.3.12 | 1.4.1 | minor | 0 → 0 | src/components/ui/checkbox.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-dialog / prod | 1.2.0 | 1.2.0 | 1.3.1 | minor | 0 → 0 | src/components/ui/dialog.tsx:4, src/components/ui/sheet.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-label / prod | 2.1.16 | 2.1.16 | 2.1.17 | patch | 0 → 0 | src/components/ui/label.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-scroll-area / prod | 1.3.0 | 1.3.0 | 1.4.0 | minor | 0 → 0 | src/components/ui/scroll-area.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-select / prod | 2.3.8 | 2.3.8 | 2.4.1 | minor | 0 → 0 | src/components/ui/select.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-separator / prod | 1.1.16 | 1.1.16 | 1.2.0 | minor | 0 → 0 | src/components/ui/separator.tsx:4 | отложен: группа 5 откатилась |
| @radix-ui/react-slot / prod | 1.4.0 | 1.4.0 | 1.5.0 | minor | 0 → 0 | src/components/ui/badge.tsx:2, src/components/ui/button.tsx:2 | отложен: группа 5 откатилась |
| @radix-ui/react-tabs / prod | 1.1.22 | 1.1.22 | 1.2.1 | minor | 0 → 0 | src/components/ui/tabs.tsx:4 | отложен: группа 5 откатилась |
| @sentry/nextjs / prod | 11.6.0 | 11.9.0 | 11.9.0 | minor | 0 → 0 | src/__tests__/sentry-config.test.ts:8, src/app/(app)/__tests__/error.test.tsx:11 | обновлён, шлюзы пройдены |
| @swc/helpers / prod | 0.5.23 | 0.5.23 | 0.5.23 | нет | 0 → 0 | Next.js и fontkit: npm ls подтверждает транзитивное использование; оставить | оставлен |
| ajv / prod | 8.20.0 | 8.20.0 | 8.20.0 | нет | 0 → 0 | src/core/event-bus/schema-registry/registry.ts:1 | оставлен |
| ajv-formats / prod | 3.0.1 | 3.0.1 | 3.0.1 | нет | 0 → 0 | src/core/event-bus/schema-registry/registry.ts:2 | оставлен |
| bcryptjs / prod | 3.0.3 | 3.0.3 | 3.0.3 | нет | 0 → 0 | src/core/security/password.ts:1, src/services/auth/__tests__/auth-service-credentials.test.ts:14 | оставлен |
| bullmq / prod | 6.3.12 | 6.4.2 | 6.4.2 | minor | 0 → 0 | src/app/api/reports/pdf/__tests__/route.test.ts:44, src/lib/pdf-queue.ts:18 | обновлён, шлюзы пройдены |
| class-variance-authority / prod | 0.7.1 | 0.7.1 | 0.7.1 | нет | 0 → 0 | src/components/ui/alert.tsx:2, src/components/ui/badge.tsx:3 | оставлен |
| clsx / prod | 2.1.1 | 2.1.1 | 2.1.1 | нет | 0 → 0 | src/lib/utils.ts:1 | оставлен |
| cookie / prod | 2.0.1 | удалён | 2.0.1 | нет | 0 → 0 | src/__tests__/sentry-config.test.ts:45, src/lib/sentry-data-collection.ts:5 | удалён после поиска и npm ls |
| dotenv / prod | 18.0.7 | 18.0.9 | 18.0.9 | patch | 0 → 0 | src/workers/__tests__/no-next-in-workers.test.ts:269, src/workers/pdf-worker.ts:13 | обновлён, шлюзы пройдены |
| framer-motion / prod | 14.1.0 | 14.6.0 | 14.6.0 | minor | 0 → 0 | src/app/(app)/__tests__/layout.test.tsx:43, src/app/(app)/layout.tsx:7 | обновлён, шлюзы пройдены |
| ioredis / prod | 6.0.0 | 6.0.0 | 6.0.0 | нет | 0 → 0 | src/app/api/reports/pdf/__tests__/route.test.ts:47, src/core/infrastructure/__tests__/leader-election-hung-request.test.ts:13 | оставлен |
| jose / prod | 6.2.12 | 6.2.13 | 6.2.13 | patch | 0 → 0 | src/modules/operator-mobile/application/knowledge-attempt.ts:2, src/services/auth/__tests__/session-service-store.test.ts:2 | обновлён, шлюзы пройдены |
| lucide-react / prod | 1.55.0 | 1.61.0 | 1.61.0 | minor | 0 → 0 | src/components/orion/orion-contact.tsx:4, src/components/orion/orion-equipment-profile.tsx:1 | обновлён, шлюзы пройдены |
| next / prod | 16.4.1 | 16.4.3 | 16.4.3 | patch | 0 → 0 | src/__tests__/proxy-csp.test.ts:2, src/__tests__/sentry-config.test.ts:4 | обновлён, шлюзы пройдены |
| pdfkit / prod | 0.20.2 | 0.20.2 | 0.20.2 | нет | 0 → 0 | src/lib/__tests__/pdf-generator.test.ts:122, src/lib/__tests__/pdf-generator.test.ts:197 | оставлен |
| react / prod | 19.3.0 | 19.3.1 | 19.3.1 | patch | 0 → 0 | src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx:3, src/app/(app)/admin/checklists/[id]/page.tsx:3 | обновлён, шлюзы пройдены |
| react-dom / prod | 19.3.0 | 19.3.1 | 19.3.1 | patch | 0 → 0 | src/components/piling/to/readiness/shared/command-dialog.tsx:10, src/components/piling/to/readiness/shared/entity-detail-shell.tsx:10 | обновлён, шлюзы пройдены |
| react-error-boundary / prod | 6.1.6 | 6.1.6 | 6.1.6 | нет | 0 → 0 | src/app/(app)/__tests__/layout.test.tsx:14, src/components/piling/app-error-boundary.tsx:3 | оставлен |
| recharts / prod | 3.10.1 | 3.10.1 | 3.10.1 | нет | 0 → 0 | src/components/piling/admin-analytics.tsx:17 | оставлен |
| sharp / prod | 0.35.5 | 0.35.5 | 0.35.5 | нет | 0 → 0 | src/core/media/__tests__/confirm-upload-validation.test.ts:55, src/core/media/__tests__/retention.test.ts:24 | оставлен |
| sonner / prod | 2.0.8 | 2.0.8 | 2.0.8 | нет | 0 → 0 | src/app/api/auth/logout/__tests__/route.test.ts:28, src/app/layout.tsx:6 | оставлен |
| tailwind-merge / prod | 3.7.0 | 3.7.0 | 3.7.0 | нет | 0 → 0 | src/lib/utils.ts:2 | оставлен |
| tsx / prod | 4.23.15 | 4.23.15 | 4.23.15 | нет | 0 → 0 | src/services/telemetry/__tests__/telemetry-reliability.integration.ts:26, Dockerfile.workers:97 | оставлен |
| zod / prod | 4.6.7 | 4.6.7 | 4.6.7 | нет | 0 → 0 | src/app/api/admin/dlq/route.ts:1, src/app/api/admin/incidents/route.ts:15 | оставлен |
| zustand / prod | 5.0.15 | 5.0.16 | 5.0.16 | patch | 0 → 0 | src/components/piling/use-feedback-feed.ts:4, src/lib/store.ts:1 | обновлён, шлюзы пройдены |
| @playwright/test / dev | 1.64.0 | 1.64.1 | 1.64.1 | patch | 0 → 0 | e2e/fixtures/auth.fixture.ts:1, e2e/fixtures/auth.fixture.ts:64 | обновлён, шлюзы пройдены |
| @tailwindcss/postcss / dev | 4.3.3 | 4.3.3 | 4.3.3 | нет | 0 → 0 | postcss.config.mjs:2 | оставлен |
| @testing-library/jest-dom / dev | 7.0.1 | 7.0.1 | 7.0.1 | нет | 0 → 0 | src/test/setup.ts:1 | оставлен |
| @testing-library/react / dev | 16.3.3 | 16.3.3 | 16.3.3 | нет | 0 → 0 | src/app/(app)/__tests__/error.test.tsx:9, src/app/(app)/__tests__/layout.test.tsx:12 | оставлен |
| @types/bcryptjs / dev | 3.0.0 | удалён | 2.4.6 | stub; latest ниже | 0 → 0 | устаревший stub, bcryptjs содержит types; кандидат удалить | удалён после поиска и npm ls |
| @types/pdfkit / dev | 0.17.6 | 0.17.7 | 0.17.7 | patch | 0 → 0 | типизация pdfkit через TypeScript | обновлён, шлюзы пройдены |
| @types/pg / dev | 8.23.1 | 8.23.1 | 8.23.1 | нет | 0 → 0 | типизация pg; также adapter-pg требует транзитивно | оставлен |
| @types/react / dev | 19.3.0 | 19.3.0 | 19.3.0 | нет | 0 → 0 | типизация React, implicit TypeScript и peers | оставлен |
| @types/react-dom / dev | 19.3.0 | 19.3.0 | 19.3.0 | нет | 0 → 0 | типизация ReactDOM и peers | оставлен |
| @vitejs/plugin-react / dev | 6.1.2 | 6.1.2 | 6.1.2 | нет | 0 → 0 | vitest.config.ts:5 | оставлен |
| @vitest/coverage-v8 / dev | 5.0.3 | 5.0.5 | 5.0.5 | patch | 0 → 0 | provider v8 в vitest.config.ts, динамическая загрузка Vitest | обновлён, шлюзы пройдены |
| eslint / dev | 9.39.5 | 9.39.5 | 10.13.0 | major | 0 → 0 | scripts/hooks/eslint-on-edit.js:14 | major отложен |
| eslint-config-next / dev | 16.4.1 | 16.4.3 | 16.4.3 | patch | 0 → 0 | eslint.config.mjs:1, eslint.config.mjs:2 | обновлён, шлюзы пройдены |
| eslint-plugin-react-hooks / dev | 7.1.1 | 7.1.1 | 7.1.1 | нет | 0 → 0 | eslint.config.mjs:3 | оставлен |
| happy-dom / dev | 20.14.6 | 21.0.4 | 21.0.4 | major | high → 0 | vitest.config.ts: environment happy-dom; import в guard-тестах | обновлён, шлюзы пройдены |
| pg / dev | 8.23.1 | 8.23.1 | 8.23.1 | нет | 0 → 0 | src/modules/equipment/application/queries/__tests__/fuel-contract.integration.ts:5, src/modules/layout/__tests__/layout-concurrency.integration.ts:2 | оставлен |
| prisma / dev | 7.10.0 | 7.10.1 | 8.0.0-rc.27 | major | 0 → 0 | src/app/api/reports/single-pdf/__tests__/route.test.ts:239, src/components/piling/admin-dlq.tsx:117 | patch 7.10.1 принят; major 8 отложен |
| tailwindcss / dev | 4.3.3 | 4.3.3 | 4.3.3 | нет | 0 → 0 | src/app/globals.css:1 | оставлен |
| tw-animate-css / dev | 1.4.0 | 1.4.0 | 1.4.0 | нет | 0 → 0 | src/app/globals.css:2 | оставлен |
| typescript / dev | 6.0.3 | 6.0.3 | 7.0.2 | major | 0 → 0 | src/app/api/__tests__/api-routes.test.ts:11, src/app/api/__tests__/route-guards.test.ts:4 | major отложен |
| vitest / dev | 5.0.3 | 5.0.5 | 5.0.5 | patch | 0 → 0 | src/__tests__/proxy-csp.test.ts:1, src/__tests__/sentry-config.test.ts:1 | обновлён, шлюзы пройдены |

## Отложенные major-версии

- TypeScript 6.0.3 → 7.0.2: установленный @typescript-eslint/typescript-estree 8.70.1 требует TypeScript >=4.8.4 <6.1.0. Нужна совместимая цепочка ESLint/Next и проверка Compiler API в служебных скриптах.
- ESLint 9.39.5 → 10.13.0: peer-диапазоны eslint-plugin-react 7.37.5, eslint-plugin-import 2.32.0 и eslint-plugin-jsx-a11y 6.10.2 заканчиваются на 9. Нужна согласованная миграция конфигурации и плагинов.
- Prisma 7.10.1 → 8.0.0-rc.27: RC и другой клиент @prisma/orm-postgres; требуется отдельная миграция, проверка совместимости transaction/extensions API и RLS-обёрток. Ни клиент 8, ни новый пакет не добавлялись.
- happy-dom 21.0.4 — единственное согласованное major-исключение, уже выполнено. Старые сведения о необходимости перехода на ioredis 6/Sentry 11 неактуальны: оба major уже были в исходном main.

## Влияние и пределы GitNexus

Репозиторий/worktree: D:/PillingR/wt-dependency-audit-1025; индексы обновлялись в этой папке, SHA записаны в .gitnexus/meta.json и журналах. UNKNOWN db (lazy proxy) подтверждён текстом: 110 импортёров, 100 production. UNKNOWN RootLayout — реальная точка входа Next; usePilingStore — create/persist с импортёрами в приложении, не доказательство неиспользования. getDefaultPage LOW, 2 узла. Для UI найдено 260 файлов с импортами.

До Radix: Dialog CRITICAL 57 узлов / 28 прямых / 8 потоков, Checkbox LOW 7 / 3 / 1; предупреждение дано до изменения. Перед серверной группой verifySessionToken CRITICAL 182 / 3 / 130, владелец предупреждён до изменения; менялся только patch jose. enqueuePdfGeneration LOW 2; storage uploadBuffer UNKNOWN подтверждён динамическим импортом в src/lib/pdf-generator/storage.ts:32.

Перед каждым коммитом выполнен detect_changes scope=all с явными repo/worktree; полные raw JSON сохранены, partial=false/truncated=false. Для package.json/lock changed_count=0 означает отсутствие индексируемых исходных функций, а не отсутствие воздействия зависимостей. Сам индекс сообщает об ограничениях покрытия потоков; пустые результаты не использовались как доказательство безопасности. Функциональный результат проверялся сборкой и тестами.

## Источники и ограничения

Release review, engine/peer metadata и полные выходы: release-notes.md, dependency-metadata.json, deferred-majors-peer-evidence.json, deps-lucide-notes.json в папке журналов. Проверены release notes Next/Happy DOM/Prisma/Vitest/Playwright, Motion диапазон 14.1–14.6, Lucide все 1.56–1.61, React, Zustand, AWS, jose, BullMQ, Sentry и dotenv. Изменённые MotionGlobalConfig.useManualTiming и Sentry span-origin selectors в коде не используются. Happy DOM CSS/iframe запрет не обходился.

- [Happy DOM advisory](https://github.com/advisories/GHSA-834v-8h66-3h79)
- [Next 16.4.3](https://github.com/vercel/next.js/releases/tag/v16.4.3)
- [Prisma 7.10.1](https://github.com/prisma/orm/releases/tag/7.10.1)
- [Prisma release status](https://www.prisma.io/docs/orm/release-status)
- [Motion changelog](https://github.com/motiondivision/motion/blob/v14.6.0/CHANGELOG.md)
- [Lucide 1.61](https://github.com/lucide-icons/lucide/releases/tag/1.61.0)
- [Sentry 11.9](https://github.com/getsentry/sentry-javascript/releases/tag/11.9.0)
- [BullMQ 6.4.2](https://github.com/taskforcesh/bullmq/releases/tag/v6.4.2)

npm run prod:smoke не запускался: нет собственного полного disposable-стенда DB/Redis/S3; default URL скрипта ведёт в production и не использовался. Интеграционные тесты без инфраструктуры могут пропускаться, число skipped приведено отдельно. Проверки реального браузера и устройств в этой задаче не выполнялись; Playwright --list подтверждает сбор тестов.

Образы Docker в задаче 3 не строились по её запрету. Положительные image build/smoke задачи 1 относятся только к её коммиту 356cc58ca8d9081a659cb3681f82b0279e1bf370 (Prisma 7.10.0), не к обновлённым зависимостям или объединённым веткам. После объединения владельцем требуется совместная сборка образов и smoke на стенде. В этой независимой ветке остаётся исходное предупреждение optional GLIDE; исправление проверено отдельно в ветке задачи 2.

## Итоговые проверки

Код проверен на d567c0eb9f8aca85ddc0030bf0e91541379d3866; после проверок добавлен только этот отчёт.

| Команда | Exit | Результат |
|---|---:|---|
| npm run build, группа 7 | 0 | финальные зависимости; компиляция, типы, 95 страниц и трассировка завершены |
| node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | 0 | отдельный tsc после удаления .next/dev/types |
| npm run lint, группа 7 | 0 | ESLint и text integrity |
| npm run test:unit -- --maxWorkers=8 | 0 | 5481 passed / 265 skipped / 0 failed; файлы 494 passed / 15 skipped |
| npx playwright test --list | 0 | 318 тестов / 28 файлов; без ошибок сбора |
| npm outdated --json | 1 | ожидаемый exit 1: 9 Radix + ESLint/Prisma/TypeScript majors, все причины выше |
| npm audit --json | 0 | info/low/moderate/high/critical: 0/0/0/0/0 |

Полный test:unit охватывает больше файлов, чем обязательный run src каждой группы; 265 skipped не подменяются словом «все прошли». В журналах Vitest есть предупреждения Vite о будущем native configLoader и MaxListeners; они не подавлялись изменениями конфигурации или env.


## Изменённые файлы

Прямых зависимостей после: 38 production + 20 dev; обновлено 21 прямых пакетов, удалено 2. Новых имён во всём итоговом lock относительно базы: 0.

| Файл | Строк после |
|---|---:|
| package.json | 138 |
| package-lock.json | 14125 |
| docs/audits/codex-2026-10-25/REPORT-dependencies.md | 180 |
