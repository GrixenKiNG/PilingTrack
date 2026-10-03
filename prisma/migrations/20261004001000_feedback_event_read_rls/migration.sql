-- Read/acknowledgement state belongs to the recipient's organisation.
-- FeedbackEvent stays a platform feed, including audience ALL; this policy
-- isolates only per-user state and does not narrow the event audience.
BEGIN;
ALTER TABLE "FeedbackEventRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedbackEventRead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_feedback_event_read ON "FeedbackEventRead"
  FOR ALL USING (EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "FeedbackEventRead"."userId"
      AND u."tenantId" = current_setting('app.current_tenant', true)
  ));
COMMIT;
