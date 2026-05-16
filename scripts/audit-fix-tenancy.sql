-- Discover all tables with nullable tenantId
\echo '=== nullable tenantId columns ==='
SELECT table_name FROM information_schema.columns
WHERE column_name='tenantId' AND is_nullable='YES' AND table_schema='public'
ORDER BY table_name;

\echo '=== NULL counts ==='
DO $$
DECLARE
  r RECORD;
  n BIGINT;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE column_name='tenantId' AND is_nullable='YES' AND table_schema='public' LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "tenantId" IS NULL', r.table_name) INTO n;
    RAISE NOTICE '% : % NULL', r.table_name, n;
  END LOOP;
END $$;

\echo '=== backfilling NULL tenantId -> orion ==='
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE column_name='tenantId' AND is_nullable='YES' AND table_schema='public' LOOP
    EXECUTE format('UPDATE %I SET "tenantId"=''orion'' WHERE "tenantId" IS NULL', r.table_name);
    RAISE NOTICE '% : backfilled', r.table_name;
  END LOOP;
END $$;

\echo '=== setting NOT NULL ==='
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE column_name='tenantId' AND is_nullable='YES' AND table_schema='public' LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenantId" SET NOT NULL', r.table_name);
    RAISE NOTICE '% : NOT NULL applied', r.table_name;
  END LOOP;
END $$;

\echo '=== verification ==='
SELECT table_name, is_nullable FROM information_schema.columns
WHERE column_name='tenantId' AND table_schema='public'
ORDER BY table_name;
