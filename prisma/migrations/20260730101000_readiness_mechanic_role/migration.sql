DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE "role" NOT IN ('ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC')
  ) THEN
    RAISE EXCEPTION 'readiness preflight: unsupported string-backed user role exists';
  END IF;
END $$;

ALTER TABLE "User"
  ADD CONSTRAINT "User_role_readiness_check"
  CHECK ("role" IN ('ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC'))
  NOT VALID;

ALTER TABLE "User"
  VALIDATE CONSTRAINT "User_role_readiness_check";

CREATE INDEX "User_tenantId_role_isActive_idx"
  ON "User" ("tenantId", "role", "isActive");
