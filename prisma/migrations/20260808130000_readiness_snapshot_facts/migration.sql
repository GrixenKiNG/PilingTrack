-- Historical readiness facts cannot be reconstructed safely from mutable
-- source rows. Keep the column nullable so existing immutable snapshots stay
-- readable while every new authoritative evaluation stores its exact inputs.
ALTER TABLE "ReadinessScoreSnapshot"
ADD COLUMN "facts" JSONB;
