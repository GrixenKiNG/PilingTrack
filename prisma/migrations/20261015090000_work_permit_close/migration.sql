-- CLOSED is added here but first written by application commands after this
-- migration commits; no statement below uses the new existing-enum value.
ALTER TYPE "WorkPermitState" ADD VALUE 'CLOSED';

CREATE TYPE "WorkPermitCloseReason" AS ENUM ('WORK_DONE', 'VALIDITY_ELAPSED');

ALTER TABLE "WorkPermit"
ADD COLUMN "closedAt" TIMESTAMPTZ(3),
ADD COLUMN "closedById" TEXT,
ADD COLUMN "closeReason" "WorkPermitCloseReason";
