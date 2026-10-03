-- G1: instruction/knowledge history already carries tenantId on both writers.
-- No data changes; deployment prechecks and rollback: runbook 012, G1 section.
BEGIN;
ALTER TABLE "BriefingRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BriefingRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_briefing_record ON "BriefingRecord" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));
COMMIT;
