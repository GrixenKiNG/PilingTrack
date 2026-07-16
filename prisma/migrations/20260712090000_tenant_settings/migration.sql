-- Per-tenant workspace settings (company/ИНН/timezone/units/currency) +
-- notification preferences. One row per tenant. Additive.

CREATE TABLE "TenantSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT '',
    "inn" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'UTC+3',
    "dateFormat" TEXT NOT NULL DEFAULT 'DD.MM.YYYY',
    "units" TEXT NOT NULL DEFAULT 'metric',
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId");
CREATE INDEX "TenantSettings_tenantId_idx" ON "TenantSettings"("tenantId");

-- Tenant isolation: ENABLE + FORCE RLS, fail-open when app.current_tenant is
-- unset/empty, strict equality otherwise (codebase-standard policy form).
ALTER TABLE "TenantSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantSettings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_settings ON "TenantSettings"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
