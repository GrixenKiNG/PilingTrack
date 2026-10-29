-- Стыки секций составных свай: сварка и антикоррозионная обработка шва.
--
-- Из них собираются акты скрытых работ на сварку секций и на антикоррозионную
-- обработку стыков (СП 48.13330, приложение Б.3). У обычных свай стыков нет;
-- старые паспорта не трогаем.

-- CreateTable
CREATE TABLE "PileJoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "weldedAt" TIMESTAMPTZ(3) NOT NULL,
    "welderName" TEXT NOT NULL,
    "electrode" TEXT NOT NULL,
    "anticorrosionMaterial" TEXT,
    "anticorrosionAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PileJoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PileJoint_passportId_ordinal_key" ON "PileJoint"("passportId", "ordinal");

-- CreateIndex
CREATE INDEX "PileJoint_tenantId_passportId_idx" ON "PileJoint"("tenantId", "passportId");

-- AddForeignKey
-- Cascade: паспорт удалён — стыки без него ничего не доказывают (как залоги).
ALTER TABLE "PileJoint" ADD CONSTRAINT "PileJoint_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "PilePassport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Покрытие без даты и дата без покрытия — не запись, а недоразумение.
ALTER TABLE "PileJoint" ADD CONSTRAINT "PileJoint_anticorrosion_pair_check"
  CHECK (("anticorrosionMaterial" IS NULL) = ("anticorrosionAt" IS NULL));

-- ============================================================
-- RLS: строгая форма, как на PileDrivingSet. Строгое равенство без
-- «ИЛИ тенант не задан» — этим шаблоном в продукте уже случался IDOR.
-- ============================================================
ALTER TABLE "PileJoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PileJoint" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_pile_joint" ON "PileJoint";
CREATE POLICY "tenant_isolation_pile_joint" ON "PileJoint" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
