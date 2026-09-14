-- Залоги журнала забивки: серия ударов и погружение сваи за неё.
--
-- Нормативная форма журнала (СП 45.13330, бывш. СНиП 3.02.01-87) требует
-- «погружение сваи от каждого залога». Пара полей в PilePassport хранит только
-- последний замер; ход забивки — ряд залогов — жил нигде.
--
-- Старые паспорта не трогаем: у них залогов нет, и отказ по-прежнему считается
-- по паре refusalSet* в самом паспорте.

-- CreateTable
CREATE TABLE "PileDrivingSet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "blows" INTEGER NOT NULL,
    "penetrationMm" DOUBLE PRECISION NOT NULL,
    "dropHeightM" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PileDrivingSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PileDrivingSet_passportId_ordinal_key" ON "PileDrivingSet"("passportId", "ordinal");

-- CreateIndex
CREATE INDEX "PileDrivingSet_tenantId_passportId_idx" ON "PileDrivingSet"("tenantId", "passportId");

-- AddForeignKey
-- Cascade: паспорт удалён — залоги без него ничего не доказывают.
ALTER TABLE "PileDrivingSet" ADD CONSTRAINT "PileDrivingSet_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "PilePassport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- RLS: та же строгая форма, что на PilePassport. Строгое равенство без
-- «ИЛИ тенант не задан» — этим шаблоном в продукте уже случался IDOR.
-- ============================================================
ALTER TABLE "PileDrivingSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PileDrivingSet" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_pile_driving_set" ON "PileDrivingSet";
CREATE POLICY "tenant_isolation_pile_driving_set" ON "PileDrivingSet" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
