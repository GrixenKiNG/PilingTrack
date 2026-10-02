# CODEX-REPORT-T4 — поток 4, 03.10.2026

Рабочая папка D:\PillingR\wt-codex4, ветка codex/night-1003, исходный HEAD 7f676926. Production, SSH, push, секреты и .env не затрагивались. Пакеты не устанавливались.

GitNexus: impact gracefulShutdown через разрешённый runner с GITNEXUS_INVOCATION=gitnexus — exit 1 (глобальный CLI отсутствует). Автоустановка запрещена. Используется прямо разрешённый fallback rg + git diff --stat/--check перед правками и коммитами; callers/processes/risk графа не установлены, не считаются нулевыми/низкими.

## D1 — барьер смены поколения

Новый --replace-worker-generation обязателен для app/workers. App запускает embedded outbox/projection по умолчанию (instrumentation.ts, embedded-workers.ts), поэтому эти сервисы заменяются вместе. Сборка и передача образов остаются до остановки. Отдельный scripts/replace-worker-generation.sh используется и для rollback: перечисляет все старые контейнеры проекта с service=app/workers, запрещает restart, останавливает compose и оставшиеся one-off, проверяет фактический state/exit/OOM, затем заново проверяет отсутствие RUNNING, и только после всего барьера делает up. При ошибке up останавливает частично поднятые сервисы.

Внешние процессы/другие хосты скрипт обнаружить не может: требует явного WORKER_GENERATION_EXTERNAL_STOPPED=1 после ручной проверки/отключения их автозапуска. По умолчанию проект pilingtrack. Compose timeout 30с проверяется против реально заданного WORKER_SHUTDOWN_TIMEOUT_MS старых контейнеров (по умолчанию 8000) с запасом ≥5с. Увеличение compose timeout не продлевает внутренний дедлайн. Exit 1/137/143/OOM блокирует новое поколение: необходим разбор drain, автоматически не обходится.

Красная проверка scripts/test-worker-generation.sh до создания helper: exit 127 (helper отсутствует); журнал output/codex-t4/d1-red.log. Зелёная проверка на реальном Docker, проект codex-deploytest, Alpine sleep, app + две реплики workers: exit 0. Порядок STOP→VERIFY→START доказан журналом; ID старых контейнеров после force-recreate отсутствуют. Fault injection делает stop успешным без реальной остановки: helper отказывает с exit 1, START отсутствует, ID остаются прежними. Все codex-deploytest контейнеры/сеть удалены trap. Deploy на сервере не запускался. Ранбук 008 дополнен.

Проверки: bash -n — exit 0; git diff --check — exit 0. Unit tests не относятся к shell-барьеру; реальные контейнеры проверены. Ограничение: compose up не атомарен, поэтому отказ во время старта компенсируется stop; если сам Docker недоступен при stop, требуется ручная проверка (ошибка печатается).
Коммит D1: df0913d7.

## D2 — доказательства на живом Postgres

Добавлены tests/integration/disposable-m6-m8.spec.ts и scripts/test-m6-m8.sh. Поднимается только codex-pg-<random>, все 107 миграций применяются существующим test-db-up.sh; cleanup гарантирован trap test-db-down.sh. Сгенерированные реквизиты остаются в памяти shell; файлы .env/production БД не используются. Модели и RLS не замоканы: приложение работает ролью pilingtrack_app; владелец только создаёт/проверяет/убирает свои фикстуры. Telegram fetch заглушён на telegram.invalid, реальные сообщения не отправлялись.

M6: реальный черновик с 3 сваями ×6м не попадает в FleetSnapshot и SiteDailySummary, включая rebuild. После изменения сохранённого статуса на submitted живой recompute (тот же обработчик REPORT_SUBMITTED) даёт 3 сваи/18м/1 отчёт; rebuild даёт идентичные значения. HTTP отправка отчёта в этой проверке не проверялась.

M7: A подтверждён, B получает сетевую ошибку. Транзакция сохраняет telegramDeliveredChatIds=[A] в OutboxEvent при published=false. Затем Prisma disconnect, удаление кэшированного клиента и resetModules; новый клиент/обработчик читает строку из БД и отправляет только B. Повтор published=true не отправляет никому. Это имитация перезапуска клиента и модулей в одном тестовом процессе, не аварийное убийство процесса.

M8: настоящие Media-строки фото и PDF-вложения плюс их реальные файлы. Dry-run: 1 кандидат/0 удалений, все строки/файлы остаются. Apply: удалён только UUID PDF из storage/pdf-results возрастом 31 день; свежий PDF, фото и вложение сохранены побайтно, строки Media идентичны. S3 в этой проверке не использовался.

Красный прогон реального старого кода: временно подставлены rebuild/fleet b6f602b5 и Telegram e6982cc1, затем автоматически восстановлены без смены ветки. Exit 1: 2 failed/1 passed/0 skipped (M6 draft KPI=3 вместо 0; M7 частичный успех ошибочно завершён). Зелёный текущий код после восстановления: exit 0, 3 passed/0 failed/0 skipped, 1 файл, 2.45с. Журналы output/codex-t4/d2-red-old-code.log и d2-green.log. Первый диагностический прогон был exit 1 (1 failed/2 passed): тест возвращал ленивый PrismaPromise из tenant-контекста; тестовый callback исправлен на async/await, реализация tenancy не менялась. TypeScript exit 0. Одноразовые контейнеры после каждого прогона удалены.
Коммит D2: a4398d65.

## D3 — организация outbox из объекта

Проанализированы все 9 файлов Hermes 9306bcf8 и все вызовы toOutboxData в src/tests/scripts/e2e. Equipment и Site уже берут tenantId из состояния агрегата, правок не требуют. Единственный неверный источник — PrismaCrewRepository.save: getRequestTenantId заменён на чтение Site.tenantId по актуальному state.siteId внутри транзакции crew+outbox. Если объект/организация не разрешились, транзакция отказывает, pending events не очищаются. Контекст пользователя больше не используется для организации события. Доступ/RLS/tenancy/права не изменены.

В существующий crew.repository.test.ts добавлены случаи платформенного ADMIN tenant-c при Site tenant-site, отсутствие request-контекста и отсутствие Site/tenantId. Красный старый код: exit 1, 4 failed/0 passed/0 skipped. Зелёный прогон crew repository/commands + Site/Equipment repository: exit 0, 39 passed/0 failed/0 skipped, 4 файла. Журналы d3-red.log/d3-green.log. Проверена атомарность размещения источника/события в одной транзакции; отдельный живой сценарий platform ADMIN через HTTP не запускался. Риск исходного дефекта — неверная организация события перед tenant #2, не изменение намеренной модели платформенных ролей.
Коммит D3: e297aaf6.

## D4 — «На добивку» требует основания

decidePilePassport уже правильно проверял trim(note), выдавал ServiceError 400 «Укажите, почему свая идёт на добивку» и не менял запись. Клиент отправляет trim(note)||undefined. Сервисная логика не переписана; к decideSchema маршрута добавлено условное superRefine с тем же правилом. Теперь пустое основание отклоняется до SELECT прежнего паспорта, ошибки custom возвращаются по-русски в error. Неизменные withMutation/auth/права/tenant-фильтр сохранены, экран не менялся.

Красный маршрутный тест до правки: exit 1, 3 failed/5 passed/0 skipped (undefined/пусто/пробелы). Зелёные маршрут + сервис: exit 0, 22 passed/0 failed/0 skipped, 2 файла. Дополнительно сервисный тест доказывает отсутствие записи при отказе, обрезку действительного основания и допустимое ACCEPTED без основания. Журналы d4-red.log/d4-green.log. Поиск callers: маршрут decide и сервисные/маршрутные тесты; GitNexus fallback, графовый риск неизвестен.
Коммит D4: 403ebc2f.

## D5 — ноль предупреждений lint

Все 7 исходных предупреждений устранены без новых eslint-disable. Существующие намеренные пояснённые suppressions сохранены. crews/all: явный отказ 401 при отсутствующем user позволяет убрать неподавленное user!. Четыре интеграционных файла: URL проверяется до подключения/создания БД вместо non-null assertion; startSnapshotId явно обязателен до чтения снимка. Неиспользуемая локальная tenantB удалена (поиск файла: только декларация, не экспорт/файл).

Красный existing route тест: exit 1, 1 failed/4 passed/0 skipped. После правки первый прогон без DB: exit 0, 5 passed/16 skipped; пропуски не считаются доказательством. Повтор всех затронутых тестов на новом codex-pg-* со всеми миграциями и настоящей ролью приложения для RLS: exit 0, 21 passed/0 failed/0 skipped, 5 файлов, 12.95с. Контейнер удалён trap. npm run lint: до exit 0 с 7 warnings; после exit 0, 0 errors/0 warnings, text integrity passed. TypeScript exit 0. Журналы d5-red.log/d5-tests.log/d5-live.log/d5-after.log/d5-tsc.log. Auth/security/RLS реализация и тестовые ожидания успеха не ослаблены.
Коммит D5: 59f2de4f.

## D6 — ревью ночных правок Hermes

Read-only git -C D:\PillingR\wt-night log a5cfa9ff..HEAD и diff 713ae2c1..hermes/q4-0926 -- src/. Проверенный tip 38d2b889: шесть новых коммитов 803133ac, dc7b2629, a2ce1238, 8cdb47b5, 435492af, 38d2b889. Прочитан весь production diff и новые тесты: 6 production-файлов и 5 test-файлов. Merge --no-ff выполнен без конфликтов: e5fcb793, фактический второй родитель d68afe13 (38d2b889 плюс документационный R110); его рекомендации не реализовывались. Финальная сверка refs: hermes/q4-0926 = 1859fe12, после d68afe13 добавлены только аудиты R111/R112, diff 38d2b889..hermes/q4-0926 -- src/ пустой. R111/R112 не слиты. Forbidden/operator/ORION/security/schema/compose файлы этим merge не менялись.

Исправленная регрессия повторной загрузки объектов: cancelled проверялся только ДО await res.json(). Новый повтор мог успешно показать свежие объекты, затем поздний JSON старого запроса перезаписывал фильтр прежним списком. Добавлена одна проверка cancelled ПОСЛЕ await. Красный тест на коде Hermes: exit 1, 1 failed/6 passed/0 skipped. Зелёные все 5 затронутых test-файлов: exit 0, 55 passed/0 failed/0 skipped. Журналы d6-red.log/d6-green.log. Тест выполняет два запроса и завершает старый JSON после нового, затем проверяет сохранение свежего списка, а не только строку текста.

| Остаточное замечание | Важность | Доказательство / ограничение |
|---|---|---|
| catchText определяет сеть по любому TypeError, включая возможный JS TypeError после fetch | P3 | use-site-mutations.ts: instanceof TypeError; тесты проверяют настоящий fetch TypeError и SyntaxError, но не различают этап исключения |
| beforeunload защищает закрытие/перезагрузку документа, но не переход внутри SPA / переключение React-вкладки | P3, неполное покрытие прежнего требования | оба layout-editor: только listener beforeunload; Next navigation не вызывает событие. Не новая регрессия сохранения, не доказательство всех видов ухода |
| Новые фото-состояния/onError сделаны для kind=image ServerPhoto; dataKey=photo PhotoBlock по-прежнему не объясняет загрузку/ошибку img | P3, неполный охват F-M4-TILE | две отдельные ветки EquipmentTileBlockContent; новые тесты покрывают только kind=image |
| Общая подпись «Обновлено» относится только к аналитике, а парк/ТО/отчёты читаются независимо | P3 | analyticsUpdatedAt присваивается только loadAnalytics; при сбое ops есть отдельный stale баннер |
| Тесты beforeunload используют synthetic DOM event | ограничение доказательства | наличие listener доказано; native browser prompt/SPA/navigation визуально не проверены |

Права/валидация и сообщения ошибок прочитаны; поглощения ошибки сохранения с ложным успехом в новых правках не обнаружено. load(true) в maintenance используется только после 409; onSaved вызывает callback без аргументов. Refresh sites race исправлен выше. Другие уже существовавшие гонки аналитики не объявлены новой регрессией Hermes. Браузерный прогон не выполнялся.
Дополнение D1 при подготовке D7: gracefulShutdown и embedded shutdown ловят некоторые stop-ошибки и могут завершаться exit 0. Поэтому helper теперь читает журнал только с начала остановки и блокирует START по Worker/Embedded worker/Redis/Prisma shutdown failed или Shutdown deadline exceeded; недоступный журнал тоже отказ. Содержимое журнала не печатается (только русский отказ с ID). Красный новый fault-injection test на прежнем helper: exit 1 (ошибка drain с exit 0 была пропущена). Зелёная реальная Docker-имитация после правки: exit 0; покрыты stop→verify→start, живой старый контейнер и ошибочный drain с exit 0. bash -n helper exit 0; codex-deploytest удалён. Журналы d1-drain-red.log/d1-drain-green.log/d1-drain-refusal.log. Код shutdown/embedded и security не менялся.

Коммит исправления D6: ae90b421.
Коммит дополнительной защиты D1: f8595269.

## D7 — ранбук релиза

Создан docs/runbooks/016-release-2026-10.md: принятие в main и точное равенство origin/main, диск/образы/rollback, диапазон миграций и свежий migrate-image при необходимости, workers smoke и app artifact/runtime distinction, зависимости без ненужного restart, полный внешний/compose stop-барьер и внутренний shutdown deadline, post-deploy version/deep-health/Redis leaders/backlog/Telegram/alerts, rollback тем же барьером, PDF flags именно в workers.environment (env_file отсутствует) и сначала dry-run. Уточнены ограничения local storage, lease без DB fencing, сохранность helper при возврате к старому git SHA. Все команды в этом документе — план для Claude/владельца; ни один production шаг не выполнен. Диапазон a803e61c..HEAD по prisma/migrations пустой; фактический production OLD_SHA оператор обязан сверить заново. Проверено чтением актуального кода и git diff --check; red/unit tests для документа не применимы.

Коммит дополнительной проверки аргументов D1: 01b9ab0f. Проверка неизвестных сервисов выполняется до нормализации app/workers, чтобы неизвестный аргумент не исчезал молча. Коммит D7: 56641136.

## D8 — финальная проверка ветки

D1–D8 завершены локально; это не подтверждение готовности production-конфигурации или браузерных сценариев. Ни один production-шаг ранбука не выполнялся. Проверки ниже выполнены на 56641136; после них изменён только этот отчёт.

| Команда / проверка | Реальный exit | Результат |
|---|---:|---|
| Безопасное удаление устаревшего .next/dev/types | 0 | Проверен абсолютный путь внутри wt-codex4 и отсутствие ReparsePoint перед Remove-Item |
| npx.cmd --no-install tsc --noEmit до build | 0 | Ошибок нет; output/codex-t4/d8-tsc.log |
| npm.cmd run lint | 0 | 0 errors / 0 warnings; text integrity passed; d8-lint.log |
| npx.cmd --no-install vitest run --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=output/codex-t4/d8-vitest.json | 0 | 2968 passed / 0 failed / 84 skipped, всего 3052; файлов 331 passed / 10 skipped = 341; 262.00с; d8-vitest.log/json |
| npx.cmd --no-install playwright test --list | 0 | 99 тестов в 11 файлах, число не снизилось; d8-playwright-list.log. Сценарии не запускались |
| docker build -f Dockerfile.workers --target runner -t codex-workers:smoke . | 0 | Образ собран; d8-workers-build.log |
| bash scripts/smoke-workers-image.sh codex-workers:smoke | 0 | Проверены запуск и Arming в изолированном контейнере, network none; d8-workers-smoke.log |
| npm run build через node output/codex-t4/build-d8.cjs | 0 | Проверка env, db:generate, Next webpack / TypeScript / 94 страницы и standalone assets завершены; d8-build-retry.log |
| npx.cmd --no-install tsc --noEmit после build | 0 | Повтор с актуальными типами Next также без ошибок |
| bash -n scripts/deploy-prod.sh | 0 | Отдельный запуск |
| bash -n scripts/replace-worker-generation.sh | 0 | Отдельный запуск |
| bash -n scripts/test-worker-generation.sh | 0 | Отдельный запуск |
| bash -n scripts/test-m6-m8.sh | 0 | Отдельный запуск |
| GitNexus detect-changes --scope all --repo . через разрешённый runner | 1 | Глобальный CLI отсутствует; GITNEXUS_INVOCATION=gitnexus исключает автоустановку; d8-gitnexus.log. Использован разрешённый rg/diff fallback |

npm run test:unit — это ровно vitest run по package.json. Отдельно повторно не запускался: выше выполнен полный Vitest, требуемый D8, с ограничением параллелизма и JSON-результатом. Его 84 skipped не объявляются успешными проверками БД. Живые D2 (3/3) и D5 (21/21) выполнены отдельно без skipped; результаты описаны в соответствующих разделах.

Build запускался с заданными задачей фиктивными DATABASE_URL_POSTGRES=postgresql://x:x@localhost:5432/x и DATABASE_PROVIDER=postgres. SESSION_SECRET сгенерирован crypto.randomBytes(32).toString('hex') только в памяти родительского Node-процесса и передан дочернему env, нигде не записан и не выведен. Реальные .env/секреты не читались и не изменялись. Первый wrapper через cmd.exe завершился exit 1 с The syntax of the command is incorrect до запуска npm; журнал d8-build.log. Исправлен только игнорируемый wrapper на Git Bash, повтор actual npm build завершился exit 0.

Предупреждения успешной сборки: REDIS_URL не задан (локальный rate limit in-memory), SENTRY_AUTH_TOKEN не задан (нет загрузки sourcemaps), optional @valkey/valkey-glide отсутствует в BullMQ. Зависимости и env не подставлялись для подавления предупреждений. Фиктивная конфигурация build не доказывает production Redis/БД/Telegram или работу PDF-очистки.

Одноразовые контейнеры/сети собственных codex-deploytest/codex-pg/worker-smoke запусков удалены; codex-workers:smoke удалён без force (exit 0, sha256:8f807c5d0cabe3d031a3409b9d54c9e89b5b01eec50e542ba9f7abe5bc76016a). Общие базовые postgres/alpine и Docker build cache не чистились. pilingtrack-* не трогались. Журналы и локальные вспомогательные файлы output/codex-t4 игнорируются Git и не входят в коммиты.

## Коммиты и изменённые файлы

Исходный HEAD 7f676926; все изменения в разрешённой существующей ветке codex/night-1003. Каждая логическая правка — отдельный коммит, новые поведенческие тесты сначала проверены на старом коде (красные результаты выше). Последний коммит (CODEX-D8) содержит только этот итоговый отчёт; его hash указан в финальном сообщении и доступен через git log -1.

| Коммит | Изменение |
|---|---|
| df0913d7 | (CODEX-D1) Добавить барьер смены поколения воркеров |
| a4398d65 | (CODEX-D2) Доказать M6–M8 на одноразовом Postgres |
| e297aaf6 | (CODEX-D3) Брать организацию события бригады из Site |
| 403ebc2f | (CODEX-D4) Требовать основание добивки в схеме API |
| 59f2de4f | (CODEX-D5) Убрать семь предупреждений lint явными проверками |
| e5fcb793 | (CODEX-D6) Включить проверенные ночные правки Hermes до 38d2b889 |
| ae90b421 | (CODEX-D6) Не подменять свежие объекты поздним ответом прежнего запроса |
| f8595269 | (CODEX-D1) Блокировать новое поколение при скрытой ошибке остановки |
| 01b9ab0f | (CODEX-D1) Проверять список сервисов до выбора режима поколения |
| 56641136 | (CODEX-D7) Подготовить пошаговый ранбук выкладки и отката релиза |

Полный diff относительно 7f676926, включая разрешённый merge Hermes. Числа — добавленные/удалённые строки (git diff --numstat), не общий размер файла. Удалённых файлов нет; доказательство ненужности файлов/экспортов для удаления не требуется. Единственная удалённая неиспользуемая локальная переменная tenantB описана в D5.

| Путь | + строк | − строк |
|---|---:|---:|
| `CODEX-REPORT-T4.md` | 169 | 0 |
| `docs/audits/hermes-night/R110-safety-messages.md` | 111 | 0 |
| `docs/runbooks/008-manual-deploy.md` | 12 | 0 |
| `docs/runbooks/016-release-2026-10.md` | 121 | 0 |
| `scripts/deploy-prod.sh` | 15 | 2 |
| `scripts/replace-worker-generation.sh` | 56 | 0 |
| `scripts/test-m6-m8.sh` | 9 | 0 |
| `scripts/test-worker-generation.sh` | 60 | 0 |
| `src/app/api/crews/all/__tests__/route.test.ts` | 8 | 0 |
| `src/app/api/crews/all/route.ts` | 2 | 1 |
| `src/app/api/pile-passports/[id]/decide/__tests__/route.test.ts` | 11 | 0 |
| `src/app/api/pile-passports/[id]/decide/route.ts` | 5 | 1 |
| `src/components/piling/__tests__/admin-dashboard.test.tsx` | 102 | 3 |
| `src/components/piling/admin-dashboard.tsx` | 41 | 4 |
| `src/components/piling/admin-sites/__tests__/use-site-mutations.test.ts` | 32 | 1 |
| `src/components/piling/admin-sites/use-site-mutations.ts` | 29 | 14 |
| `src/components/piling/layout-editor/__tests__/layout-load-failure.test.tsx` | 82 | 0 |
| `src/components/piling/layout-editor/layout-editor.tsx` | 14 | 0 |
| `src/components/piling/layout-editor/page-layout-editor.tsx` | 13 | 0 |
| `src/components/piling/maintenance/__tests__/maintenance-messages.test.tsx` | 40 | 0 |
| `src/components/piling/maintenance/maintenance-board.tsx` | 16 | 7 |
| `src/components/piling/monitoring/__tests__/equipment-tile-block.test.tsx` | 23 | 1 |
| `src/components/piling/monitoring/equipment-tile-block.tsx` | 26 | 6 |
| `src/modules/crews/infrastructure/__tests__/crew.repository.test.ts` | 18 | 5 |
| `src/modules/crews/infrastructure/crew.repository.ts` | 4 | 7 |
| `src/modules/reports/application/queries/__tests__/pile-passport.service.test.ts` | 19 | 3 |
| `tests/integration/disposable-m6-m8.spec.ts` | 137 | 0 |
| `tests/integration/rls-tenant-enforcement.spec.ts` | 2 | 1 |
| `tests/integration/tech-readiness-projection.spec.ts` | 2 | 1 |
| `tests/integration/tech-readiness-shifts.spec.ts` | 4 | 2 |
| `tests/integration/tech-readiness-work-permits.spec.ts` | 2 | 2 |

## Что оставлено без изменений и пределы доказательств

- main, другие рабочие деревья, production, SSH/SCP, push/deploy, реальные БД/Telegram не использованы. Другие папки только читались в прямо разрешённых исключениях GitNexus и wt-night.
- package*.json/версии, schema/migrations, auth/security/CSRF/rate-limiter/RLS/tenancy-реализация, Dockerfile/compose, операторские экраны и ORION не менялись. Старые намеренные eslint-disable сохранены. Отдельный диапазон миграций a803e61c..HEAD пустой, фактический production OLD_SHA неизвестен.
- D1 не обнаруживает внешние процессы на других хостах и не предоставляет DB fencing. Ранбук требует ручного подтверждения их остановки, проверки Redis lease/логов и фактических старых контейнеров. Compose up не атомарен; ошибка компенсируется stop. Timeout без увеличения внутреннего drain-дедлайна не разрешает запуск.
- D2 M7 доказывает сохранность состояния в БД при перезапуске клиента/модулей в одном процессе. OS crash, реальные Telegram API, HTTP submit workflow, S3 и production storage не проверялись. Очистка PDF не включалась: дефолты enabled=false/dry-run=true сохранены.
- Playwright проверен только на сбор тестов. Браузерные E2E, native beforeunload, мобильные размеры и живые роли не проверялись; остаточные замечания D6 приведены выше и не устранены сверх задачи.
- GitNexus графовые callers/processes/risk недоступны; пустой результат не трактуется как безопасность. Использован прямо разрешённый задачей текстовый fallback. Предупреждения build перечислены выше.

Финальный git diff --check — exit 0; git diff --stat — exit 0 (изменён только отчёт). Forbidden paths diff пустой, exit 0. После коммита чистота дерева проверяется отдельно и указывается в финальном сообщении.
