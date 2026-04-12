-- ============================================================
-- PilingTrack — Full DDL PostgreSQL 16
-- Enterprise Edition: multi-tenant, RLS, event-driven, sync-ready
--
-- Применяется ПОСЛЕ Prisma migrate (дополняет Prisma-схему)
-- Usage: psql -U postgres -d pilingtrack -f scripts/apply-full-ddl.sql
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================
-- 2. ДОПОЛНИТЕЛЬНЫЕ ТАБЛИЦЫ (не покрытые Prisma)
-- ============================================================

-- 2.1 Event Store (для event sourcing / replay)
CREATE TABLE IF NOT EXISTS "EventStore" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID,
  "aggregateId" UUID NOT NULL,
  "aggregateType" TEXT NOT NULL,
  type TEXT NOT NULL,
  version INT NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_event_store_aggregate ON "EventStore"("aggregateId", version);
CREATE INDEX idx_event_store_tenant ON "EventStore"("tenantId");
CREATE INDEX idx_event_store_type ON "EventStore"(type);

-- 2.2 Notifications
CREATE TABLE IF NOT EXISTS "Notification" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID,
  "userId" UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB,
  read BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_user ON "Notification"("userId", read);
CREATE INDEX idx_notifications_tenant ON "Notification"("tenantId");
CREATE INDEX idx_notifications_created ON "Notification"("createdAt" DESC);

-- 2.3 Rate Limits (fallback для Redis)
CREATE TABLE IF NOT EXISTS "RateLimit" (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rate_limits_reset ON "RateLimit"("resetAt");

-- 2.4 System Metrics
CREATE TABLE IF NOT EXISTS "SystemMetric" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  tags JSONB,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_system_metrics_name ON "SystemMetric"(name, "createdAt" DESC);

-- 2.5 Unified Dictionary (справочники)
CREATE TABLE IF NOT EXISTS "Dictionary" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID,
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata JSONB,
  "isActive" BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_dictionary_unique ON "Dictionary"(type, code, "tenantId") WHERE "tenantId" IS NOT NULL;
CREATE INDEX idx_dictionary_type ON "Dictionary"(type);
CREATE INDEX idx_dictionary_tenant ON "Dictionary"("tenantId");

-- ============================================================
-- 3. ДОПОЛНИТЕЛЬНЫЕ ИНДЕКСЫ НА СУЩЕСТВУЮЩИХ ТАБЛИЦАХ
-- ============================================================

-- 3.1 Partial index для активных отчётов
CREATE INDEX IF NOT EXISTS idx_reports_active ON "Report"("tenantId", "date" DESC)
  WHERE deleted = FALSE;

-- 3.2 GIN индекс для JSONB payload (если есть)
-- (Применяется только если колонка payload существует)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Report' AND column_name = 'payload'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_reports_payload_gin ON "Report" USING GIN(payload);
  END IF;
END $$;

-- 3.3 Composition index для site + date lookup
CREATE INDEX IF NOT EXISTS idx_reports_site_date ON "Report"("siteId", "date" DESC);

-- 3.4 Outbox: индекс для worker polling
CREATE INDEX IF NOT EXISTS idx_outbox_poll ON "OutboxEvent"(published, "createdAt" ASC)
  WHERE published = FALSE;

-- 3.5 Sync queue performance
CREATE INDEX IF NOT EXISTS idx_device_sync_tenant ON "DeviceSyncState"("tenantId");
CREATE INDEX IF NOT EXISTS idx_device_sync_last ON "DeviceSyncState"("lastSyncAt" DESC);

-- ============================================================
-- 4. ТРИГГЕРЫ (автоматический updated_at)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггеры для основных таблиц
DO $$
DECLARE
  tbl TEXT;
  tables_with_updated TEXT[] := ARRAY[
    'Tenant', 'User', 'Site', 'Crew', 'Equipment',
    'Report', 'PileGrade', 'DrillingType', 'DowntimeReason',
    'TelegramConfig', 'Dictionary'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_updated
  LOOP
    -- Проверить что таблица существует и имеет колонку updatedAt
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = tbl AND column_name = 'updatedAt'
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_%s_updated ON "%I"',
        tbl, tbl
      );
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON "%I"
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 5. ROW-LEVEL SECURITY (RLS) — Multi-Tenant Isolation
-- ============================================================

-- Включаем RLS для всех tenant-таблиц
DO $$
DECLARE
  tbl TEXT;
  tenant_tables TEXT[] := ARRAY[
    'Tenant', 'User', 'Site', 'Crew', 'Equipment',
    'Report', 'OutboxEvent', 'AuditLog', 'FeedbackEvent',
    'Notification', 'Dictionary', 'DeviceSyncState',
    'ReportStats', 'ReportAnalytics', 'SiteDailySummary',
    'OperatorPerformance', 'DowntimeSummary', 'SiteWeeklyTrend',
    'EventStore'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
      -- Проверить что есть колонка tenantId
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = tbl AND column_name = 'tenantId'
      ) THEN
        -- Включить RLS
        EXECUTE format('ALTER TABLE "%I" ENABLE ROW LEVEL SECURITY', tbl);

        -- Удалить существующую политику если есть
        EXECUTE format(
          'DROP POLICY IF EXISTS tenant_isolation_%s ON "%I"',
          LOWER(tbl), tbl
        );

        -- Создать политику: фильтрация по tenantId
        -- NOTE: Роль проверяется на уровне приложения (assertCan)
        -- current_setting(... true) returns NULL if not set, so policy allows access when no tenant is configured (dev mode)
        EXECUTE format(
          'CREATE POLICY tenant_isolation_%s ON "%I"
           USING ("tenantId" = current_setting(''app.tenant_id'', true)::uuid OR current_setting(''app.tenant_id'', true) IS NULL)',
          LOWER(tbl), tbl
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 6. TELEMETRY PARTITIONING (если таблица существует)
-- ============================================================

-- Примечание: Prisma не поддерживает партиционирование нативно.
-- Партиционирование создаётся вручную на уровне PostgreSQL.
-- Следующий код создаёт партицию для текущего месяца.

DO $$
DECLARE
  partition_name TEXT;
  month_start DATE;
  month_end DATE;
BEGIN
  -- Текущий месяц
  month_start := DATE_TRUNC('month', CURRENT_DATE);
  month_end := month_start + INTERVAL '1 month';
  partition_name := 'TelemetryRecord_' || TO_CHAR(month_start, 'YYYY_MM');

  -- Проверить что основная таблица существует
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'TelemetryRecord') THEN
    -- Проверить что таблица ещё не партицирована
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      WHERE c.relname = 'TelemetryRecord'
    ) THEN
      -- Создать партицию (только если таблица пуста)
      IF NOT EXISTS (SELECT 1 FROM "TelemetryRecord" LIMIT 1) THEN
        -- Переименовать текущую таблицу в партицию
        EXECUTE format('ALTER TABLE "TelemetryRecord" RENAME TO %I', partition_name);

        -- Создать партицированную основную таблицу
        EXECUTE format(
          'CREATE TABLE "TelemetryRecord" (
            LIKE %I INCLUDING ALL
          ) PARTITION BY RANGE ("timestamp")',
          partition_name
        );

        -- Добавить существующую таблицу как партицию
        EXECUTE format(
          'ALTER TABLE "TelemetryRecord" ATTACH PARTITION %I
           FOR VALUES FROM (%L) TO (%L)',
          partition_name, month_start, month_end
        );

        -- Пересоздать индексы на основной таблице
        EXECUTE format(
          'CREATE INDEX idx_telemetry_tenant ON "TelemetryRecord"("tenantId")'
        );
        EXECUTE format(
          'CREATE INDEX idx_telemetry_equipment ON "TelemetryRecord"("equipmentId")'
        );
        EXECUTE format(
          'CREATE INDEX idx_telemetry_ts ON "TelemetryRecord"("timestamp" DESC)'
        );
      END IF;
    END IF;
  END IF;
END $$;

-- Функция для создания будущих партиций (вызывается через pg_cron)
CREATE OR REPLACE FUNCTION create_telemetry_partition(
  partition_start DATE
)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  partition_end DATE;
BEGIN
  partition_name := 'TelemetryRecord_' || TO_CHAR(partition_start, 'YYYY_MM');
  partition_end := partition_start + INTERVAL '1 month';

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF "TelemetryRecord"
     FOR VALUES FROM (%L) TO (%L)',
    partition_name, partition_start, partition_end
  );

  -- Индексы на новой партиции
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_tenant ON %I("tenantId")',
    partition_name, partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_ts ON %I("timestamp" DESC)',
    partition_name, partition_name
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. ФУНКЦИИ-ХЕЛПЕРЫ
-- ============================================================

-- 7.1 Установить tenant_id для текущей сессии (для RLS)
CREATE OR REPLACE FUNCTION set_app_tenant_id(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.2 Получить текущий tenant_id сессии
CREATE OR REPLACE FUNCTION get_app_tenant_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.tenant_id', TRUE);
END;
$$ LANGUAGE plpgsql;

-- 7.3 Массовое удаление старых idempotency_keys (очистка)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys(
  retention_days INT DEFAULT 7
)
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM "IdempotencyKey"
    WHERE "expiresAt" < NOW() - (retention_days || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 7.4 Массовое удаление старых outbox events
CREATE OR REPLACE FUNCTION cleanup_processed_outbox_events(
  retention_days INT DEFAULT 14
)
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM "OutboxEvent"
    WHERE published = TRUE
      AND "createdAt" < NOW() - (retention_days || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 7.5 Статистика системы (для monitoring)
CREATE OR REPLACE FUNCTION get_system_stats()
RETURNS TABLE (
  total_tenants BIGINT,
  total_users BIGINT,
  total_reports BIGINT,
  reports_today BIGINT,
  pending_outbox BIGINT,
  active_devices BIGINT,
  telemetry_count BIGINT,
  db_size_bytes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM "Tenant")::BIGINT,
    (SELECT COUNT(*) FROM "User")::BIGINT,
    (SELECT COUNT(*) FROM "Report")::BIGINT,
    (SELECT COUNT(*) FROM "Report" WHERE "date" = CURRENT_DATE::TEXT)::BIGINT,
    (SELECT COUNT(*) FROM "OutboxEvent" WHERE published = FALSE)::BIGINT,
    (SELECT COUNT(DISTINCT "deviceId") FROM "DeviceSyncState" WHERE "lastSyncAt" > NOW() - INTERVAL '1 hour')::BIGINT,
    (SELECT COUNT(*) FROM "TelemetryRecord" WHERE "timestamp" > NOW() - INTERVAL '1 hour')::BIGINT,
    pg_database_size(current_database());
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. CONNECTION SETTINGS (рекомендуемые)
-- ============================================================

-- Эти настройки требуют суперпользователя и перезагрузки.
-- Раскомментировать при необходимости:
-- ALTER SYSTEM SET max_connections = 200;
-- ALTER SYSTEM SET shared_buffers = '2GB';
-- ALTER SYSTEM SET work_mem = '16MB';
-- ALTER SYSTEM SET effective_cache_size = '6GB';
-- ALTER SYSTEM SET maintenance_work_mem = '512MB';
-- ALTER SYSTEM SET checkpoint_completion_target = 0.9;
-- ALTER SYSTEM SET wal_buffers = '16MB';
-- ALTER SYSTEM SET default_statistics_target = 100;

-- ============================================================
-- 8. BUSINESS-LEVEL IDEMPOTENCY CONSTRAINTS
-- ============================================================

-- Prevent duplicate reports for the same user/site/date
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_unique_user_date
  ON "Report"("userId", "siteId", "date")
  WHERE deleted = FALSE;

-- Idempotency keys: unique per scope+key (already enforced by PK, but explicit index)
CREATE INDEX IF NOT EXISTS idx_idempotency_scope_key
  ON "IdempotencyKey"(scope, key);

-- Dead letter queue: index for efficient querying
CREATE INDEX IF NOT EXISTS idx_dlq_status_created
  ON "DeadLetterQueue"(status, "createdAt" DESC);

-- Telemetry: tenant index for multi-tenant filtering
CREATE INDEX IF NOT EXISTS idx_telemetry_tenant
  ON "TelemetryRecord"("tenantId");

-- Reports: composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_reports_tenant_date_status
  ON "Report"("tenantId", "date" DESC, status);

-- ============================================================
-- 9. GRANTS (для application user)
-- ============================================================

-- Заменить 'app_user' на реального пользователя приложения
DO $$
DECLARE
  app_user TEXT := 'app_user'; -- Изменить при необходимости
  tbl TEXT;
BEGIN
  -- Проверить что пользователь существует
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_user) THEN
    -- Grant на все таблицы
    FOR tbl IN
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "%I" TO %I', tbl, app_user);
    END LOOP;

    -- Grant на sequence
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_user);

    -- Grant на функции
    EXECUTE format('GRANT EXECUTE ON FUNCTION set_app_tenant_id(UUID) TO %I', app_user);
    EXECUTE format('GRANT EXECUTE ON FUNCTION get_app_tenant_id() TO %I', app_user);
    EXECUTE format('GRANT EXECUTE ON FUNCTION get_system_stats() TO %I', app_user);
  END IF;
END $$;

-- ============================================================
-- ГОТОВО
-- ============================================================

COMMENT ON SCHEMA public IS 'PilingTrack — Enterprise DDL (multi-tenant, RLS, event-driven, sync-ready)';
