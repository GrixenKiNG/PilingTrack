ALTER TABLE "WorkPermit"
ADD COLUMN "rejectedAt" TIMESTAMPTZ(3),
ADD COLUMN "rejectedById" TEXT,
ADD COLUMN "rejectReason" TEXT;
