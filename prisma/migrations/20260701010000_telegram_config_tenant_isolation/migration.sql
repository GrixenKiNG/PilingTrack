-- TelegramConfig Tenant Isolation
-- 1. Add tenantId to TelegramConfig, backfill existing rows with 'orion', then drop the default.
ALTER TABLE "TelegramConfig" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'orion';
ALTER TABLE "TelegramConfig" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "TelegramConfig_tenantId_idx" ON "TelegramConfig"("tenantId");

-- 2. RLS for TelegramConfig
ALTER TABLE "TelegramConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telegramconfig ON "TelegramConfig"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
