-- Предсменный допуск: между планированием и запуском появляется решение
-- диспетчера. Раньше смену запускал сам оператор, а «приёмка» стояла в конце
-- и закрывала смену — человеческого допуска перед работой не было.

ALTER TYPE "ShiftState" ADD VALUE IF NOT EXISTS 'PENDING_ACCEPTANCE' AFTER 'PLANNED';

ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "requestedAt"   TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "requestedById" TEXT,
  ADD COLUMN IF NOT EXISTS "declinedAt"    TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "declinedById"  TEXT,
  ADD COLUMN IF NOT EXISTS "declineReason" TEXT;
