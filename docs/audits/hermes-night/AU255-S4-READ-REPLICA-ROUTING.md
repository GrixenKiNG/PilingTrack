# AU255-S4-READ-REPLICA-ROUTING: Чтение — основная база или реплика

**Версия (git rev-parse HEAD):** ff808e9ab8db8dd1f90cc91f4c8363f22ffd54d8

---

## Итог (5 строк)

- **Реплики чтения нет**: во всех compose-файлах (`docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`) один сервис `postgres` без настройки streaming replication или managed replica.
- **Все запросы идут в primary**: код приложения (`src/lib/db.ts:76-114`) создаёт единственный `PrismaClient` с `DATABASE_URL` → PgBouncer (transaction pooling) → основная БД; альтернативных пулов/клиентов для чтения нет.
- **`wal_level=replica` включен в проде** (`docker-compose.prod.yml:100`) — это для WAL-архивирования/PITR, а не для чтения с реплики.
- **Риск устаревания — не применим**, так как реплики нет; все чтения строго консистентны (ReadCommitted, isolationLevel в `src/lib/db.ts:54-58`).
- **Статус**: ПРОЙДЕНО — реплика чтения отсутствует, схема «один Primary» подтверждена кодом и compose.

---

## Методика

1. **Compose-файлы**: полный просмотр `docker-compose.yml` (456 строк), `docker-compose.prod.yml` (150 строк), `docker-compose.staging.yml` — сервисы `postgres`, наличие `replicas`, `deploy.replicas`, дополнительных PG-контейнеров, `read_only`/replica-параметров.
2. **Prisma-конфиг**: `prisma/schema.prisma` (datasource db), `prisma.config.ts` (url: `DATABASE_URL_POSTGRES`), `prisma.integration.config.ts` — один datasource.
3. **Клиент БД**: `src/lib/db.ts` — `createPrismaClient()` (строки 76–114) использует `DATABASE_URL || DATABASE_URL_POSTGRES`; единственный пул соединений, PgBouncer в transaction pooling mode (compose:6432).
4. **Поиск по коду**: `rg -i "replica|read.*replica|readReplica|DATABASE_URL_READ|READ_DATABASE"` — 0 совпадений в `src/**/*.ts`, `prisma/**`, `scripts/**`.
5. **Воркеры/телеметрия**: `src/workers/unified-worker/**`, `src/services/telemetry/**` — все импортируют `@/lib/db` → тот же единственный клиент.
6. **Архив/документы**: `docs/archive/FAILURE-SCENARIOS-2026-04-09.md:45` — явная запись «Нет read replica».

---

## Находки

| # | Severity | Путь:строка | Проблема | Сценарий / почему важно | Предложение |
|---|---|---|---|---|---|
| 1 | критично | `docker-compose.yml:344-378` + `docker-compose.prod.yml:64-111` | Один сервис `postgres`; нет реплики чтения. `wal_level=replica` только для WAL/PITR. | Любой SELECT (дашборды, отчёты, аналитика) нагружает Primary. При росте данных — конкуренция с записями (outbox, shifts, reports). | Если нужна реплика: добавить сервис `postgres-replica` с `command: postgres -c hot_standby=on -c wal_level=replica ...`, настроить streaming replication от primary, вынести `DATABASE_URL_READ` в env. |
| 2 | критично | `src/lib/db.ts:76-114` | `createPrismaClient()` использует единственный `url = process.env.DATABASE_URL || DATABASE_URL_POSTGRES` → PgBouncer → Primary. | Нет механизма маршрутизации read-only запросов на реплику. | При появлении реплики — завести `DATABASE_URL_READ`, создать второй `PrismaClient` (например, `dbRead`) и использовать его в query-only путях (GET API, projection worker, analytics). |
| 3 | важно | `src/lib/db.ts:54-58` | `DEFAULT_TX_OPTIONS.isolationLevel = 'ReadCommitted'` — все транзакции на Primary. | Консистентность гарантирована, но нет горизонтального масштабирования чтения. | Документировать: текущая схема — строгая консистентность, реплика не используется. |
| 4 | важно | `src/workers/unified-worker/outbox.ts:94-105` `src/modules/reports/application/projections/projection-worker.ts:161` | Outbox и projection workers читают `db.outboxEvent.findMany` / `projectOutboxEvents` через общий `db`. | Фоновые воркеры конкурируют с API за пул PgBouncer (DEFAULT_POOL_SIZE=40). | При реплике — projection worker перевести на `dbRead`; outbox publisher оставлять на primary (нужны writes для `published/projected` flags). |
| 5 | важно | `src/services/telemetry/telemetry-ingestion-service.ts:57-60` `src/services/telemetry/telemetry-buffer.ts:32` | Telemetry ingestion и buffer используют `getDbClient()` → `@/lib/db` → Primary. | Высокочастотные INSERT (до 1000 rps) идут в Primary через PgBouncer. | Telemetry — кандидат на отдельный кластер / TimescaleDB; если останется в PG — при реплике писать в Primary, читать (дашборды) с реплики. |
| 6 | мелочь | `src/app/api/auth/me/route.ts:12-15` `src/core/observability/health-tracker/helpers.ts:1` | Все API routes и health checks используют `getDbClient()` → единственный клиент. | Нет разделения read/write на уровне маршрутов. | При реплике — GET-эндпоинты (`withApi`) перевести на `dbRead`; POST/PUT/DELETE (`withMutation`) — на `db`. |

---

## Таблица: запрос | файл:строка | база | допустимая задержка | риск

| Запрос (описание) | Файл:строка | Куда идёт | Допустимая задержка | Риск |
|---|---|---|---|---|
| Все Prisma-операции (findMany, findUnique, count, aggregate, $queryRaw, $transaction) | `src/lib/db.ts:200` (экспорт `db`) | Primary (через PgBouncer tx pool) | 0 (строгая консистентность) | Нет риска устаревания; риск — нагрузка на Primary |
| Outbox worker: `db.outboxEvent.findMany` + `updateMany` | `src/services/reports/outbox-publisher.ts:94-105, 156-164` | Primary | 0 (нужны writes для флагов published/projected) | Не подходит для реплики — требует записи |
| Projection worker: `projectOutboxEvents` → `db.site.findMany`, `projectWeeklyTrend` | `src/modules/reports/application/projections/projection-worker.ts:161, 187-191` | Primary | Секунды-минуты (только чтение) | Кандидат на реплику при её появлении |
| Telemetry ingestion: `db.telemetryRecord.createMany` / буфер | `src/services/telemetry/telemetry-ingestion-service.ts:269+` `src/services/telemetry/telemetry-buffer.ts:133` | Primary | 0 (writes) | Высокая нагрузка на Primary; чтение для дашбордов — кандидат на реплику |
| Health check DB: `db.$queryRaw`SELECT 1` | `src/core/observability/health-tracker/checkers/database.ts:8` | Primary | 0 | Неинтенсивный, остаётся на Primary |
| API GET (reports, sites, equipment, shifts, users) | `src/app/api/**/route.ts` (все с `withApi`) | Primary | 0–1с (UI) | Основной потребитель чтения — переводить на реплику в первую очередь |
| API POST/PUT/DELETE (mutations) | `src/app/api/**/route.ts` (все с `withMutation`) | Primary | 0 | Оставлять на Primary |

---

## Не проверено

| Область | Причина |
|---|---|
| Managed PostgreSQL (RDS, Yandex Cloud, Cloud SQL) в реальном проде | `docker-compose.prod.yml:66-68` комментарий: «Reuse a managed RDS / Yandex Cloud Postgres in real production by replacing this service with an external: true network reference». Реальная топология продовой БД не проверялась — там может быть встроенная read replica, которой нет в compose. |
| PgBouncer конфиг `pgbouncer.ini` / `userlist.txt` | Образ `edoburu/pgbouncer` генерирует конфиг из `DATABASE_URL` env; файлы в репозитории не найдены. Не проверено, поддерживает ли он `server_read_only` или `target_session_attrs=read-write/read-only`. |
| Реальная нагрузка / метрики пула | `DEFAULT_POOL_SIZE=40`, `MAX_CLIENT_CONN=1000` — не замерялось, достаточно ли пула при текущей нагрузке без реплики. |
| Стратегия миграции на реплику (DDL replication, sequence sync) | Не разрабатывалась — задача только аудит текущего состояния. |

---

## Статусы проверки

- Наличие реплики в compose: **ПРОЙДЕНО** (нет)
- Наличие реплики в Prisma schema / config: **ПРОЙДЕНО** (один datasource)
- Код маршрутизации read/read-write: **ПРОЙДЕНО** (единый клиент `db`)
- Переменные окружения для read-replica: **ПРОЙДЕНО** (нет `DATABASE_URL_READ*`)
- Архивные записи о read replica: **ПРОЙДЕНО** (`docs/archive/FAILURE-SCENARIOS-2026-04-09.md:45` — «Нет read replica»)
- Продовая топология (managed PG): **НЕ ПРОВЕРЕНО** (требует доступа к инфраструктуре)

---

## Приложение: ключевые пути кода (для повторной проверки)

```
docker-compose.yml:344-378          # postgres service
docker-compose.prod.yml:64-111      # postgres prod override, wal_level=replica
src/lib/db.ts:76-114                # createPrismaClient() — единственный клиент
src/lib/db.ts:54-58                 # DEFAULT_TX_OPTIONS ReadCommitted
prisma/schema.prisma:6-8            # datasource db
prisma.config.ts:7                  # url: DATABASE_URL_POSTGRES
docs/archive/FAILURE-SCENARIOS-2026-04-09.md:45  # «Нет read replica»
```