-- Паспорт сваи (журнал забивки). Одна свая — одна запись PileWork с count = 1
-- и один паспорт к ней. Учётная часть (планы, погонные метры, проекции) не
-- меняется: паспорт цепляется сбоку и ничего в PileWork не переписывает.

-- CreateTable
CREATE TABLE "PilePassport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pileWorkId" TEXT NOT NULL,
    "clientCommandId" TEXT NOT NULL,
    "pileNumber" TEXT NOT NULL,
    "designHeadLevelM" DOUBLE PRECISION,
    "actualHeadLevelM" DOUBLE PRECISION,
    "drivenDepthM" DOUBLE PRECISION,
    "refusalSetPenetrationMm" DOUBLE PRECISION,
    "refusalSetBlows" INTEGER,
    "designRefusalMm" DOUBLE PRECISION,
    "totalBlows" INTEGER,
    "blowsLastMeter" INTEGER,
    "redriven" BOOLEAN NOT NULL DEFAULT false,
    "headCutOff" BOOLEAN NOT NULL DEFAULT false,
    "planDeviationMm" DOUBLE PRECISION,
    "tiltPercent" DOUBLE PRECISION,
    "hammerType" TEXT,
    "hammerEnergyKj" DOUBLE PRECISION,
    "dropHeightM" DOUBLE PRECISION,
    "mediaIds" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "drivenAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PilePassport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilePassport_pileWorkId_key" ON "PilePassport"("pileWorkId");

-- CreateIndex
-- Повтор команды при обрыве сети не должен заводить второй паспорт.
CREATE UNIQUE INDEX "PilePassport_tenantId_clientCommandId_key" ON "PilePassport"("tenantId", "clientCommandId");

-- CreateIndex
-- Поиск «есть ли уже паспорт на сваю С-130» при вводе номера.
CREATE INDEX "PilePassport_tenantId_pileNumber_idx" ON "PilePassport"("tenantId", "pileNumber");

-- CreateIndex
CREATE INDEX "PilePassport_tenantId_drivenAt_idx" ON "PilePassport"("tenantId", "drivenAt");

-- AddForeignKey
-- Cascade: удалили запись выработки — паспорт без неё смысла не имеет.
ALTER TABLE "PilePassport" ADD CONSTRAINT "PilePassport_pileWorkId_fkey" FOREIGN KEY ("pileWorkId") REFERENCES "PileWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- RLS: строгая политика, как на FuelLog, MeterReading и остальных таблицах.
-- Организация лежит в самой строке; пишется командой внутри тенантной
-- транзакции, читается экраном под сессией — контекст есть на обоих концах.
-- Форма — строгое равенство без «ИЛИ тенант не задан» (тот самый шаблон,
-- которым в этом продукте уже случался IDOR, 31.05.2026).
-- ============================================================
ALTER TABLE "PilePassport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PilePassport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_pile_passport" ON "PilePassport";
CREATE POLICY "tenant_isolation_pile_passport" ON "PilePassport" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
