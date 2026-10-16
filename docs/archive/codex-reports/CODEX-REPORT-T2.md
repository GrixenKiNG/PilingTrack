# CODEX — отчёт потока 2, 02.10.2026

Рабочая папка: `D:\PillingR\wt-codex2`, ветка `codex/integration-1002`.
Исходный HEAD: `13a4e4a1c226fff990825596cb86a3935b511546`; дерево было чистым.
Задачи выполнены по порядку: стенд → настоящие интеграции → restore drill → CI.
Поток 1 и его `.github/workflows/ci.yml` не менялись.

## 1. Сделано и коммиты

| Задача | Коммит | Результат |
|---|---|---|
| Стенд | `2f3ef53b` `(CODEX-T2-1)` | Postgres 16, новый случайный `codex-pg-*`, loopback/случайный порт; 107 миграций реально применены через `prisma migrate deploy`; owner `piling`, штатные `pilingtrack_app`/`pilingtrack_identity`, генерируемые пароли; отдельный Prisma/Vitest config без `.env`; down проверяет имя и метку |
| RLS и pipeline | `6c84ff00` `(CODEX-T2-2)` | 21 настоящий RLS сценарий на шести таблицах; пять настоящих сценариев команд осмотра и projection вместо отключённого Proxy-harness; запросы/записи выполняются PostgreSQL/Prisma под app-ролью |
| Восстановление | `a82f6b26` `(CODEX-T2-3)` | custom dump через gzip; один exported read-only snapshot для дампа и манифеста; восстановление в новый контейнер; counts всех таблиц, миграции, RLS, роли и fail-closed; отрицательная сверка неправильного манифеста; runbook 015 |
| CI | `96a904c5` `(CODEX-T2-4)` | Отдельный `.github/workflows/integration.yml`, service Postgres 16, все миграции/роли/генерация без `.env`, реальные тесты и JSON gate против пропусков/исчезновения наборов; исправлена наблюдавшаяся startup race — readiness по TCP, а не временному Unix socket |

Отчёт — отдельный коммит `(CODEX-T2-REPORT)`; его hash доступен в `git log -1`.

## 2. Изменённые файлы

Numstat относительно исходного `13a4e4a1`, до добавления этого отчёта:

| Путь | Добавлено | Удалено |
|---|---:|---:|
| `.github/workflows/integration.yml` | 77 | 0 |
| `docs/runbooks/015-disposable-integration-restore.md` | 83 | 0 |
| `prisma.integration.config.ts` | 8 | 0 |
| `scripts/check-integration-results.cjs` | 21 | 0 |
| `scripts/db-drill-manifest.cjs` | 16 | 0 |
| `scripts/restore-drill-verify.cjs` | 41 | 0 |
| `scripts/restore-drill.sh` | 40 | 0 |
| `scripts/test-db-down.sh` | 13 | 0 |
| `scripts/test-db-dump.cjs` | 31 | 0 |
| `scripts/test-db-up.sh` | 41 | 0 |
| `tests/integration/disposable-ci.spec.ts` | 39 | 0 |
| `tests/integration/disposable-restore.spec.ts` | 68 | 0 |
| `tests/integration/disposable-rls.spec.ts` | 55 | 0 |
| `tests/integration/disposable-scripts.spec.ts` | 11 | 0 |
| `tests/integration/helpers/disposable-db.ts` | 81 | 0 |
| `tests/integration/tech-readiness-write-pipeline.spec.ts` | 97 | 184 |
| `vitest.integration.config.ts` | 14 | 0 |

Удалённых путей нет. Удалены только локальный неэкспортируемый
`IntegrationHarness`, Proxy, безусловный `describe.skip` и шесть предположительных
тестов старого pipeline-файла; заменены пятью проверками текущих реальных команд.
`rg` по `src/ tests/ e2e/ scripts/` показал использование `IntegrationHarness`
только в этом отключённом файле. Runtime-функции/экспорты приложения не удалялись.

## 3. Доказательства интеграций

Свой стенд: `codex-pg-9ccaea480607`, Postgres 16.
Migrate deploy: **107/107**, exit 0; app гранты на **83/84** таблицы
(`_prisma_migrations` исключён намеренно). App — не superuser, без BYPASSRLS;
identity — не superuser, BYPASSRLS, NOLOGIN, штатное исключение опознания.

RLS: Report, Site, Equipment, Inspection, Shift, AuditLog. В каждой таблице
по одной строке двух отдельных организаций. Собственная организация видит
только свою строку; без организации/с пустым GUC — ноль; чужая запись — 42501.
Две транзакции используют один и тот же `pg_backend_pid`; между ними все шесть
таблиц закрыты. App не читает журнал миграций и не создаёт таблицы.

Pipeline использует реальные `completeInspectionWithOutcome` и
`projectReadinessEvent`. Подменены подключение DB и широкие фасады на реальные
узкие функции; SQL не мокается. Отказ INSERT OutboxEvent откатывает COMPLETED;
повтор завершения не создаёт второй event; чужой осмотр отклоняется; отказ INSERT
CurrentReadiness откатывает snapshot и projected marker; успешная projection
создаёт один immutable snapshot и текущий read model. Попытка UPDATE snapshot
отклоняется триггером базы. Каждый тест имеет собственные фикстуры.

Последний полный прогон: **35 passed / 0 failed / 0 skipped**, 5 файлов,
35.54 s, exit 0. Фактический JSON: `output/codex-t2-integration.json` (ignored).
CI gate на этом файле: **35 passed, zero skipped**, exit 0.

### RED → GREEN

- До down-скрипта три защитных теста падали с 127; после — 3/3.
- До fixture harness новый RLS-файл не собирался (missing module, exit 1).
  Дополнительно проведена реальная mutation-проверка: временное отключение RLS
  только на Site своего стенда дало **4 failed / 17 passed**; политика возвращена
  в `finally`, затем 21/21. Слабый тест не смог бы поймать эту поломку.
- До restore-скрипта два input guard теста падали; после — 2/2 плюс live drill.
- Подменённый count Report в манифесте даёт `Restore mismatch in counts`, exit 1;
  отрицательный сценарий проходит только при этом отказе и удалённом target.
- До JSON gate три CI guard теста падали; после — 3/3.
- На повторе действительно поймана startup race: **34 passed / 1 failed**,
  `pg_restore: FATAL: the database system is shutting down`. Unix pg_isready
  увидел временный init-сервер. После ожидания TCP — снова **35/35, skip 0**.

## 4. Учение восстановления

Синтетические данные своего стенда, **не production dump**.
Формат совпадает с `backup-postgres.sh`: `pg_dump -F c | gzip`.
Манифест и dump используют один exported repeatable-read snapshot; SHA-256
привязывает манифест к сжатому файлу. Сверяются counts всех public таблиц,
имена/checksum/applied_steps/finished/rolled_back миграций, ENABLE/FORCE RLS
и определения политик. Роли выдаются штатными SQL-скриптами после `--no-acl`.

Последний результат:

- **84 таблицы**, все counts совпали.
- **107 миграций**, состояния/checksums совпали.
- **76 RLS-политик**, определения и flags совпали.
- Report/Site/Equipment/Inspection/Shift/AuditLog: **source=2 / restored=2**;
  app-роль без организации — **0** на каждой.
- Успешное восстановление со сверкой — **13 секунд** на этой локальной машине.
- Подменённый манифест вызывает отказ; оба созданных restore-target удаляются.

Учение 27.09.2026 (runbook 010) остаётся отдельным историческим доказательством.
Этот прогон не проверяет production/offsite download, media, секреты,
восстановление VPS, запуск всех сервисов или реальный эксплуатационный RTO.
Внешний дамп без доверенного манифеста исходного snapshot не принимается как
доказанное равенство. Генератор synthetic dump ограничен 64 MiB до gzip.

## 5. Общие проверки — реальные exit codes

Команды выполнены отдельно, без tail/head, подставных env или production.
Перед unit/сборкой адреса внешних БД удалены из окружения процесса; `.env`
не читался. Проверена только возможность наличия загружаемых файлов, не содержимое.

| Проверка | Exit | Результат |
|---|---:|---|
| Очистка stale `.next/dev/types` | 0 | Путь проверен внутри worktree; каталог отсутствовал, удаления не было |
| `npx --no-install tsc --noEmit` | 0 | В том числе перед каждым кодовым коммитом; последний после проверки stale types |
| `npm run lint` | 0 | 0 errors / **7 исходных warnings**; два собственных warning устранены; text integrity passed |
| `npm run test:unit` | **1** | **2644 passed / 7 failed / 81 skipped**; 301 passed / 1 failed / 9 skipped файлов, всего 311 |
| `npx --no-install playwright test --list` | 0 | **99 тестов / 11 файлов**, количество не упало; браузеры не запускались |
| `npm run build` | **1** | Остановлен `validate-env.ts`: нет `DATABASE_PROVIDER` и `SESSION_SECRET`; Next build/route types не подтверждены |
| `npx --no-install vitest run --config vitest.integration.config.ts` (с переменными своего стенда) | 0 | **35/35, skipped 0**, включая настоящее восстановление |
| `node scripts/check-integration-results.cjs output/codex-t2-integration.json` | 0 | Фактический JSON принят, 35 passed / 0 skips |
| `bash -n` новых shell-скриптов | 0 | Синтаксис up/down/restore |
| `node --check` manifest/dump/verify scripts | 0 | Синтаксис CJS |
| YAML parse через установленный `js-yaml` | 0 | Отдельный integration job, Postgres 16, 10 шагов |

Семь падений — `src/services/reports/__tests__/daily-summary.test.ts`, известные
в исходном состоянии: моки не изолируют DB event-handler, он требует DATABASE_URL.
Их не скрывал skip/исключением/подставной БД и не правил в потоке 2.
81 skip в обычном unit-прогоне не считаются прошедшей интеграцией: реальные DB
сценарии доказаны отдельным проектом с заданными переменными. В общем прогоне
без стенда новые DB сценарии намеренно пропускаются.

GitNexus: shared runner недоступен из-за native `@ladybugdb/core` на Node 26,
подтверждено потоком 1. Использован прямо разрешённый владельцем fallback:
`rg` callers в `src/ tests/ e2e/ scripts/`, затем `git diff --cached --stat`.
Пакеты GitNexus не устанавливались; результаты поиска записаны в commit bodies.

## 6. Что не менялось, ограничения и эксплуатация

- Production, SSH, push, merge, schema/migrations, auth/security/tenancy runtime,
  Dockerfile/compose, зависимости, экраны машиниста и ORION не менялись.
- Дефектов RLS в проверенных шести таблицах не выявлено; `it.fails` не добавлен,
  потому что маскировать нечего. Непроверенные таблицы/HTTP-права не объявляются
  доказанными. Identity BYPASSRLS — штатное исключение, не находка.
- Другие отключённые readiness наборы пока не переписаны; HTTP-аудит,
  idempotency pipeline и запуск смены не входят в пять реализованных сценариев.
  Старый Proxy обещал audit/idempotency внутри completion, но текущая команда
  пишет source/outbox; эти старые предположения не выдаются за выполненный контракт.
- PgBouncer имитирован двумя транзакциями на одном соединении; отдельный
  PgBouncer daemon не запускался.
- GitHub workflow не запускался: push запрещён. Доказаны локальный эквивалент
  DB-прогона, YAML parse и JSON gate; Node 22/hosted runner проверит приёмка.
- Стендовые пароли не сохранялись в репозитории. Случайный app пароль в CI
  маскируется; owner service-only пароль зависит от run id/attempt и действует
  только в одноразовой базе изолированного runner.
- При исчезновении Docker daemon Docker Desktop запускался скрыто, а затем
  возобновлён только собственный `codex-pg-9ccaea480607`. Это глобальный запуск
  приложения Docker; явно ни start/stop/exec/inspect контейнеров владельца,
  ни подключений к их БД не выполнялось. Их состояние не проверялось.
- После задач source-контейнер удалён down-скриптом, exit 0. Повторный
  `docker ps -a --filter label=pilingtrack.codex.test-db=1 --format '{{.Names}}'`
  дал пустой результат, exit 0. Наших контейнеров/volume не осталось;
  временные synthetic dumps/manifests удалены тестами.

Субагенты: независимый read-only аудит backup/runbooks выполнил переиспользованный
`strategy_audit` через родительский поток (новый spawn был недоступен по лимиту).
Его анализ подтвердил custom-gzip формат, восстановление ролей и исторический
drill; реализация и все заявленные проверки выполнены в этом worktree.

Перед отчётным коммитом после удаления БД: независимые CI/cleanup guards — 6 passed / 0 failed / 0 skipped, exit 0; повторный tsc — exit 0. Последний полный live-прогон до удаления стенда остаётся 35/35.
