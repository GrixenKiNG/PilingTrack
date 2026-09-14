-- Проверка СИЗ перед сменой: одна запись на работника в производственные сутки.
--
-- Таблица новая и пустая. Прежних данных о СИЗ в продукте нет — переносить
-- нечего.

-- CreateTable
CREATE TABLE "PpeCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productionDate" DATE NOT NULL,
    "items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PpeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PpeCheck_tenantId_userId_productionDate_key"
  ON "PpeCheck"("tenantId", "userId", "productionDate");

-- CreateIndex
CREATE INDEX "PpeCheck_tenantId_productionDate_idx" ON "PpeCheck"("tenantId", "productionDate");

-- AddForeignKey
ALTER TABLE "PpeCheck" ADD CONSTRAINT "PpeCheck_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- RLS: строгая форма, как на остальных таблицах смены. Равенство без
-- «ИЛИ тенант не задан» — тем шаблоном в продукте уже случался IDOR.
-- ============================================================
ALTER TABLE "PpeCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PpeCheck" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_ppe_check" ON "PpeCheck";
CREATE POLICY "tenant_isolation_ppe_check" ON "PpeCheck" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
