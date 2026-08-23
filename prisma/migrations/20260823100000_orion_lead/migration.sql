-- Заявки с публичного сайта ОРИОН.
-- До этой таблицы единственным экземпляром заявки было сообщение в Telegram:
-- при сбое доставки клиент терялся молча.
CREATE TABLE "OrionLead" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "contact"       TEXT NOT NULL,
    "message"       TEXT NOT NULL DEFAULT '',
    "isSpam"        BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt"   TIMESTAMPTZ(3),
    "deliveryError" TEXT,
    "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrionLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrionLead_tenantId_createdAt_idx" ON "OrionLead"("tenantId", "createdAt");
CREATE INDEX "OrionLead_deliveredAt_idx" ON "OrionLead"("deliveredAt");

-- Изоляция тенанта — тем же строгим правилом, что и остальные 46 таблиц
-- (ранбук 012). Публичный обработчик пишет заявку внутри withTenantContext,
-- поэтому переменная app.current_tenant выставлена и здесь.
ALTER TABLE "OrionLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrionLead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_orionlead ON "OrionLead";
CREATE POLICY tenant_isolation_orionlead ON "OrionLead"
  FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
