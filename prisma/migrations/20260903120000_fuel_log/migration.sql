-- Журнал топлива (долив + остаток по указателю). Аддитивно, без потерь данных.
--
-- Как у MeterReading: источник истины — история записей. Расход отдельным
-- числом не хранится, он выводится из долива, остатка и объёма бака. Моточасы
-- для «л/моточас» берутся из MeterReading, отдельной копии наработки тут нет.
-- Фаза телеметрии пишет сюда с source='TELEMETRY' без изменения схемы.

-- AlterTable: объём бака у техники (для перевода остатка % в литры)
ALTER TABLE "Equipment" ADD COLUMN "fuelTankLiters" INTEGER;

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "litersAdded" INTEGER,
    "tankPercent" INTEGER,
    "source" "MeterSource" NOT NULL DEFAULT 'MANUAL',
    "recordedById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelLog_tenantId_idx" ON "FuelLog"("tenantId");

-- CreateIndex
CREATE INDEX "FuelLog_equipmentId_recordedAt_idx" ON "FuelLog"("equipmentId", "recordedAt");

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- RLS: строгая политика, как на MeterReading и остальных 46+ таблицах.
-- Организация лежит в самой строке; пишется командой внутри тенантной
-- транзакции, читается карточкой техники под сессией — контекст есть на
-- обоих концах. Форма — строгое равенство без «ИЛИ тенант не задан»
-- (тот самый шаблон, которым в этом продукте уже случался IDOR, 31.05.2026).
-- ============================================================
ALTER TABLE "FuelLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FuelLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_fuel_log" ON "FuelLog";
CREATE POLICY "tenant_isolation_fuel_log" ON "FuelLog" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
