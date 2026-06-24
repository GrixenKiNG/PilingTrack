-- One installation = one active crew. App-level check (assertEquipmentNotDoubleBooked)
-- already enforces this, but isn't transactionally race-safe; this index makes it a
-- hard DB invariant. Inactive crews keep history (multiple inactive rows per
-- equipment are fine), so the index is partial on isActive = true.
CREATE UNIQUE INDEX "Crew_equipmentId_active_unique" ON "Crew" ("equipmentId") WHERE "isActive" = true;
