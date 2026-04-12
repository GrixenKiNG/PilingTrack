# PilingTrack — Full DDL PostgreSQL 16

Enterprise-полная схема базы данных с multi-tenancy, RLS, event-driven архитектурой, sync-ready версионированием, партицированием телеметрии, аудитом и CQRS read models.

## Структура

| Файл | Назначение |
|------|------------|
| `prisma/schema.postgres.prisma` | Prisma-схема (модели, связи, индексы, enum) |
| `scripts/apply-full-ddl.sql` | Raw SQL DDL (RLS, триггеры, партиции, extensions, функции) |
| `scripts/apply-full-ddl.ts` | Скрипт применения: Prisma generate → db push → SQL DDL |

## Что включено

### Модели (28 + 5 новых = 33)

| Категория | Модели |
|-----------|--------|
| **Multi-tenant** | `Tenant`, `User` (с tenantId) |
| **Core** | `Site`, `Equipment`, `Crew`, `CrewAssistant` |
| **Hierarchy** | `PileField` → `Cluster` → `Picket` |
| **Reports** | `Report`, `ReportVersion`, `ReportAudit` |
| **Report data** | `PileWork`, `LeaderDrilling`, `ReportDowntime` |
| **Dictionaries** | `PileGrade`, `DrillingType`, `DowntimeReason`, `Dictionary` (new) |
| **CQRS Projections** | `ReportAnalytics`, `SiteDailySummary`, `ReportStats`, `OperatorPerformance`, `DowntimeSummary`, `SiteWeeklyTrend` |
| **Infrastructure** | `OutboxEvent`, `AuditLog`, `IdempotencyKey`, `RefreshToken` |
| **Sync** | `DeviceSyncState` |
| **Telemetry** | `TelemetryRecord` (партицированная) |
| **Feedback** | `FeedbackEvent`, `FeedbackEventRead` |
| **Config** | `TelegramConfig` |
| **Event Store** | `EventStore` (new) |
| **Notifications** | `Notification` (new) |
| **Rate Limits** | `RateLimit` (new) |
| **Metrics** | `SystemMetric` (new) |

### Enum (9 штук)

| Enum | Значения |
|------|----------|
| `UserRole` | ADMIN, DISPATCHER, OPERATOR, ASSISTANT |
| `ReportStatus` | draft, submitted |
| `SiteStatus` | ACTIVE, COMPLETED, ARCHIVED |
| `ShiftType` | day, night |
| `FeedbackLevel` | info, success, warn, error, audit |
| `FeedbackPriority` | LOW, MEDIUM, HIGH, CRITICAL |
| `FeedbackAudience` | ALL, OPERATIONS, USER |
| `OutboxStatus` | pending, processing, completed, failed |
| `IdempotencyStatus` | processing, completed, failed |

### Row-Level Security (RLS)

Включён для 18 tenant-таблиц. Политики:
- `tenant_isolation_{table}` — пользователи видят только данные своего тенанта
- ADMIN/DISPATCHER bypass на уровне приложения

### Партицирование

`TelemetryRecord` — партицирована по RANGE (timestamp):
- Автоматическое создание партиции для текущего месяца
- Функция `create_telemetry_partition(date)` для будущих партиций
- Рекомендуется pg_cron: `SELECT cron.schedule('0 0 1 * *', 'SELECT create_telemetry_partition(DATE_TRUNC(''month'', CURRENT_DATE + INTERVAL ''1 month''))')`

### Триггеры

Автоматический `updatedAt` для 11 таблиц через `set_updated_at()`.

### Функции-хелперы

| Функция | Назначение |
|---------|------------|
| `set_app_tenant_id(uuid)` | Установить tenant для сессии (RLS) |
| `get_app_tenant_id()` | Получить текущий tenant сессии |
| `cleanup_expired_idempotency_keys(int)` | Удалить старые idempotency keys |
| `cleanup_processed_outbox_events(int)` | Удалить обработанные outbox события |
| `get_system_stats()` | Полная статистика системы (returns TABLE) |

### Индексы

**Стандартные (Prisma @@index):**
- Все foreign keys
- tenantId на всех tenant-таблицах
- Составные индексы для частых запросов

**Performance (SQL DDL):**
- `idx_reports_active` — partial index WHERE deleted = FALSE
- `idx_reports_payload_gin` — GIN индекс для JSONB payload
- `idx_reports_site_date` — составной site + date
- `idx_outbox_poll` — partial index для worker polling WHERE published = FALSE

## Применение

```bash
# Полное применение (рекомендуется):
npm run db:apply-ddl

# Или по шагам:
npx prisma generate --schema prisma/schema.postgres.prisma
npx prisma db push --schema prisma/schema.postgres.prisma
psql -U postgres -d pilingtrack -f scripts/apply-full-ddl.sql
```

## Масштабирование

| Метрика | Значение |
|---------|----------|
| Пользователи | 10k–100k |
| Отчёты/день | 200k+ |
| Telemetry/час | миллионы |
| DB размер | ограничен только диском (партицирование) |

## Connection Settings (рекомендуемые)

```sql
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
```
