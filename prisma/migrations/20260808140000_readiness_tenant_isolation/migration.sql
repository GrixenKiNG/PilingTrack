-- Изоляция тенанта на уровне БД для таблиц, которые её не получили.
--
-- Проверено перед включением: у всех перечисленных таблиц колонка "tenantId"
-- объявлена NOT NULL, поэтому строгое сравнение не может спрятать строку.
-- Ветка "tenantId" IS NULL из старых политик здесь намеренно не повторяется —
-- она ослабляет изоляцию, а необходимости в ней нет.
--
-- Очереди и служебные журналы (OutboxEvent, IdempotencyKey, TenantAuditChain,
-- ReadinessBackfillProgress) сознательно не трогаем: воркеры разбирают их
-- сквозь все тенанты, и FORCE RLS мог бы молча урезать выборку.

ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shift ON "Shift"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "ShiftHandover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftHandover" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shifthandover ON "ShiftHandover"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "WorkPermit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkPermit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_workpermit ON "WorkPermit"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "WorkPermitApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkPermitApproval" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_workpermitapproval ON "WorkPermitApproval"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "ReadinessScoreSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadinessScoreSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_readinessscoresnapshot ON "ReadinessScoreSnapshot"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "CurrentReadiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CurrentReadiness" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_currentreadiness ON "CurrentReadiness"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "MeterReading" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MeterReading" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_meterreading ON "MeterReading"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "MaintenancePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenancePlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_maintenanceplan ON "MaintenancePlan"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "PileGrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PileGrade" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pilegrade ON "PileGrade"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "DrillingType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DrillingType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drillingtype ON "DrillingType"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "DowntimeReason" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DowntimeReason" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_downtimereason ON "DowntimeReason"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "TelematicsDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelematicsDevice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telematicsdevice ON "TelematicsDevice"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "TelematicsDeviceAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelematicsDeviceAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telematicsdeviceassignment ON "TelematicsDeviceAssignment"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
