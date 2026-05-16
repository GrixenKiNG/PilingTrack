#!/bin/bash
# Remote audit script for PilingTrack production VM
set +e
cd /opt/pilingtrack 2>/dev/null || true
PSQL="docker exec pilingtrack-postgres psql -U piling -d pilingtrack -At"

echo "=== DB SIZE ==="
$PSQL -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

echo "=== POSTGRES VERSION ==="
$PSQL -c "SHOW server_version;"

echo "=== CONNECTIONS BY STATE ==="
$PSQL -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"

echo "=== TOP TABLES BY SIZE ==="
$PSQL -c "SELECT relname || '|' || n_live_tup || '|' || pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;"

echo "=== TABLES WITH BLOAT (high n_dead_tup) ==="
$PSQL -c "SELECT relname || '|live=' || n_live_tup || '|dead=' || n_dead_tup || '|last_vacuum=' || COALESCE(last_autovacuum::text,'never') FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY n_dead_tup DESC LIMIT 10;"

echo "=== UNUSED INDEXES (idx_scan=0, size>1MB) ==="
$PSQL -c "SELECT s.indexrelname || '|on ' || s.relname || '|' || pg_size_pretty(pg_relation_size(s.indexrelid)) FROM pg_stat_user_indexes s WHERE s.idx_scan = 0 AND pg_relation_size(s.indexrelid) > 1024*1024 ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 20;"

echo "=== MISSING FK INDEXES ==="
$PSQL -c "SELECT c.conrelid::regclass::text || '.' || a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND a.attnum=ANY(i.indkey));"

echo "=== PG_STAT_STATEMENTS top by total time ==="
$PSQL -c "SELECT calls || '|total_s=' || round((total_exec_time/1000)::numeric,1) || '|mean_ms=' || round(mean_exec_time::numeric,1) || '|' || left(regexp_replace(query, '\s+', ' ', 'g'),120) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;" 2>&1 | head -15

echo "=== LONG-RUNNING QUERIES (>5s) ==="
$PSQL -c "SELECT pid || '|' || age(now(),query_start) || '|' || state || '|' || left(query,100) FROM pg_stat_activity WHERE state != 'idle' AND now()-query_start > interval '5 seconds';"

echo "=== TABLE 'Report' tenancy check ==="
$PSQL -c "SELECT COALESCE(\"tenantId\",'NULL') || '|' || count(*)::text FROM \"Report\" GROUP BY \"tenantId\" ORDER BY count(*) DESC LIMIT 5;" 2>&1

echo "=== USERS tenancy check ==="
$PSQL -c "SELECT COALESCE(\"tenantId\",'NULL') || '|' || count(*)::text FROM \"User\" GROUP BY \"tenantId\" ORDER BY count(*) DESC LIMIT 5;" 2>&1

echo "=== prisma_migrations status ==="
$PSQL -c "SELECT migration_name || '|' || COALESCE(finished_at::text,'PENDING') || '|rolled_back=' || (rolled_back_at IS NOT NULL)::text FROM _prisma_migrations ORDER BY finished_at DESC NULLS FIRST LIMIT 10;" 2>&1

echo "=== RLS enabled tables ==="
$PSQL -c "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity = true;"
