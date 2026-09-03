-- Разбор происшествия: кто, когда и к чему пришли.
--
-- Раньше происшествие можно было только завести. Состояния v3 (STOPPED,
-- RESUMED) описывают остановку и возобновление работы — но не разбор: у
-- диспетчера не было места записать вывод, а у записи — автора и времени
-- решения. Три колонки, все допускают пустоту: у происшествий, заведённых до
-- этой правки, разбора действительно нет.
ALTER TABLE "SafetyIncident"
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

-- Выборка «что ещё не разобрано» — единственный запрос этого экрана.
CREATE INDEX IF NOT EXISTS "SafetyIncident_tenant_open_idx"
  ON "SafetyIncident" ("tenantId", "reviewedAt", "occurredAt" DESC);
