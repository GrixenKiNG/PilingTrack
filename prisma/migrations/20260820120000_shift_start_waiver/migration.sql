-- Разрешение диспетчера на пуск заблокированной машины.
--
-- ЗАЧЕМ. Контур готовности умеет запрещать пуск, но не умеет разрешать его в
-- виде исключения. На площадке исключения случаются, и сегодня они решаются
-- мимо системы — то есть без следа. Эта таблица делает исключение видимым:
-- кто выпустил машину, почему и на какие именно препятствия закрыл глаза.
--
-- ОТПЕЧАТОК ПРЕПЯТСТВИЙ, А НЕ ХЭШ ФАКТОВ. Разрешение привязано к набору
-- условий блокировщиков на момент выдачи. Хэш фактов не годится: он меняется
-- от сдвига моточасов и течения времени, и разрешение переставало бы
-- действовать через минуту. С отпечатком правило читаемое: появилось новое
-- препятствие — нужно новое решение, исчезли старые — пуск и так открыт.
--
-- ЗАПИСЬ НЕИЗМЕНЯЕМАЯ. Ни version, ни updatedAt: разрешение не правят, выдают
-- новое. Уникальность по смене — разрешение действует ровно на одну смену.
--
-- RLS СРАЗУ СТРОГАЯ, без режима аудита: tenantId объявлен NOT NULL, а ходят
-- к таблице только маршруты /api/readiness/*, которые работают внутри
-- withReadinessSerializableTransaction — она сама выставляет app.current_tenant
-- и падает, если он не установился.

CREATE TABLE IF NOT EXISTS "ShiftStartWaiver" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "shiftId"            TEXT NOT NULL,
  "snapshotId"         TEXT NOT NULL,
  "blockerFingerprint" TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "issuedById"         TEXT NOT NULL,
  "issuedAt"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ShiftStartWaiver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftStartWaiver_tenantId_shiftId_key"
  ON "ShiftStartWaiver" ("tenantId", "shiftId");
CREATE INDEX IF NOT EXISTS "ShiftStartWaiver_tenantId_issuedAt_idx"
  ON "ShiftStartWaiver" ("tenantId", "issuedAt");

ALTER TABLE "ShiftStartWaiver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftStartWaiver" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_shiftstartwaiver ON "ShiftStartWaiver";
CREATE POLICY tenant_isolation_shiftstartwaiver ON "ShiftStartWaiver"
  FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
