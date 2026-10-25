# Задача 2 — optional Valkey GLIDE в BullMQ

Ветка codex/bullmq-build-warning-1025, папка D:/PillingR/wt-bullmq-build-warning-1025. База origin/main f21eb0bc8f20df6b5ed51642622d4c3ff2fccb9c. Один коммит конфигурации и отчёта; SHA — в итоговом сообщении / git log -1.

## Вывод и изменение

Для текущих очередей предупреждение не означает поломку: код создаёт ioredis Redis c protocol:2, а GLIDE-адаптер не настраивает. Проверены src/lib/pdf-queue.ts, src/workers/pdf-worker.ts и src/workers/unified-worker/pdf.ts, а также весь src/scripts на Glide, valkey-glide, clientFactory (совпадений нет).

BullMQ 6.3.12 публикует ESM barrel: dist/esm/index.js → classes/index.js → valkey-glide-client.js. Webpack видит require('@valkey/valkey-glide') внутри createGlideBatch и предупреждает при обходе ESM-графа, хотя текущие ioredis клиенты этот путь не вызывают.

Выбран вариант (а): serverExternalPackages: [bullmq] в next.config.ts. Ровно три добавленные строки (опция и два комментария): Next оставляет BullMQ нативному Node/CJS loader; webpack не разрешает необязательный адаптер. Alias-заглушек и подавления сообщений нет. production webpack и CSP/nonce-настройки не менялись. Новых пакетов и изменений lock нет.

## Проверки

Полные журналы и реальные exit codes находятся в D:/PillingR/night-logs/codex-1025/bullmq-*.

| Проверка | Exit | Результат |
|---|---:|---|
| npm ci --ignore-scripts | 0 | чистая установка по исходному lock; postinstall выполнен отдельно как разрешённый db:generate |
| npm run db:generate | 0 | scoped фиктивный URL только этой команде |
| npx tsc --noEmit -p tsconfig.json | 0 | после итоговой конфигурации, bullmq-final-tsc |
| node node_modules/vitest/vitest.mjs run src/workers/__tests__/pdf-worker.test.ts src/app/api/reports/pdf/__tests__/route.test.ts | 0 | 18 passed / 0 skipped / 0 failed |
| npx eslint next.config.ts | 0 | ошибок и предупреждений нет |
| npm run build | 0 | компиляция, TypeScript, 95 static pages, standalone; строк @valkey/valkey-glide в полном логе нет |
| npx playwright test --list | 0 | 318 тестов / 28 файлов; collection, не браузерный E2E |
| реальный enqueue → Worker → completed на собственном Redis | 0 | GLIDE не установлен, попыток его загрузки 0; результат job.echo=ok |

Наличие предупреждения до исправления воспроизведено отдельной локальной сборкой исходного Next 16.4.1 в задаче Prisma (та же очередь и ESM import trace); это не перенос зелёного build между ветками. Полный build именно этой ветки — bullmq-build.log/.exit — завершился 0 без предупреждения.

Runtime probe — внешний временный harness bullmq-runtime-smoke.cjs, не новый тест репозитория. Node Module._load считал попытки загрузить GLIDE; require.resolve отдельно подтвердил отсутствие пакета. Использован существующий redis:7-alpine, контейнер codex-bullmq-redis-1025 с собственным ownership label, отдельным динамическим loopback портом и уникальной очередью. Он удалён после остановки и проверки label; чужие Redis/очереди не затрагивались. Probe проверяет настоящий BullMQ/ioredis, не mock; полный путь авторизованного production PDF не запускался.

Build использовал только пять штатных build-time значений Dockerfile в памяти дочернего процесса с явного разрешения владельца. .env не читались и не создавались, реальная БД и production не подключались. Валидатор сообщает отсутствие Redis и Sentry token; это не отсутствие GLIDE.

## GitNexus и границы

До изменения построен свежий индекс в правильной папке, выполнен file-qualified upstream impact enqueuePdfGeneration: LOW, два прямых зависимых и два процесса. Текстом дополнительно проверены пути Redis/GLIDE и конфигурация. Перед коммитом полный detect_changes all: partial=false/truncated=false; полный JSON сохранён.

Изменён next.config.ts; отчёт добавлен. Frozen зоны, модели/миграции, auth/security, Docker/deploy-файлы и зависимости не менялись. Нет push/merge/deploy/SSH. Образы для этой задачи не пересобирались; обязательные image-гейты относятся к задаче 1.

API опции проверен по установленной документации Next 16.4.1: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md.
