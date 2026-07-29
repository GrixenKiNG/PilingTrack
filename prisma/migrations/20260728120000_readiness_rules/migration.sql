CREATE TABLE "ReadinessRuleSet" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "version"     TEXT NOT NULL,
  "criteria"    JSONB NOT NULL,
  "blockers"    JSONB NOT NULL,
  "updatedBy"   TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReadinessRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReadinessRuleSet_active_tenant_status_key"
  ON "ReadinessRuleSet" ("tenantId", "status")
  WHERE "status" IN ('DRAFT', 'PUBLISHED');

CREATE INDEX "ReadinessRuleSet_tenantId_idx"
  ON "ReadinessRuleSet" ("tenantId");
CREATE INDEX "ReadinessRuleSet_tenantId_status_idx"
  ON "ReadinessRuleSet" ("tenantId", "status");

ALTER TABLE "ReadinessRuleSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadinessRuleSet" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_readiness_rule_set ON "ReadinessRuleSet"
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
