-- Per-entity layout scope: a surface now has one base layout (entityId = '')
-- plus optional per-entity overrides (entityId = the entity's id, e.g. an
-- equipment card). Additive; existing rows become the base ('').

ALTER TABLE "ModuleLayoutTemplate" ADD COLUMN "entityId" TEXT NOT NULL DEFAULT '';

DROP INDEX "ModuleLayoutTemplate_tenantId_surfaceId_key";
CREATE UNIQUE INDEX "ModuleLayoutTemplate_tenantId_surfaceId_entityId_key"
  ON "ModuleLayoutTemplate"("tenantId", "surfaceId", "entityId");
