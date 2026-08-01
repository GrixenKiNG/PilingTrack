CREATE OR REPLACE FUNCTION prevent_readiness_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ReadinessScoreSnapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReadinessScoreSnapshot_immutable_update"
BEFORE UPDATE ON "ReadinessScoreSnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_readiness_snapshot_mutation();

CREATE TRIGGER "ReadinessScoreSnapshot_immutable_delete"
BEFORE DELETE ON "ReadinessScoreSnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_readiness_snapshot_mutation();
