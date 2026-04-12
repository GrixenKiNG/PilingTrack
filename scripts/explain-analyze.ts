/**
 * EXPLAIN ANALYZE — Query Performance Checker
 *
 * Runs EXPLAIN ANALYZE on key queries and checks for:
 * - Sequential scans on large tables
 * - Missing indexes
 * - Slow execution times
 *
 * Usage:
 *   npx tsx scripts/explain-analyze.ts
 *
 * CI/CD Integration:
 *   Add to GitHub Actions workflow:
 *   - name: Query Performance Check
 *     run: npm run db:explain-analyze
 */

import { PrismaClient } from '@prisma/client';

interface QueryCheck {
  name: string;
  sql: string;
  params?: any[];
  maxDurationMs?: number;
  expectIndexScan?: boolean;
}

// Key queries to check
const QUERIES: QueryCheck[] = [
  {
    name: 'Report by site and date',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "Report" WHERE "siteId" = $1 AND "date" = $2',
    params: ['test-site', '2026-04-05'],
    maxDurationMs: 100,
    expectIndexScan: true,
  },
  {
    name: 'User by email (login)',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "User" WHERE "email" = $1',
    params: ['test@example.com'],
    maxDurationMs: 50,
    expectIndexScan: true,
  },
  {
    name: 'Active sites list',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "Site" WHERE "isActive" = true ORDER BY "name"',
    maxDurationMs: 100,
    expectIndexScan: true,
  },
  {
    name: 'Pending outbox events',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "OutboxEvent" WHERE "published" = false ORDER BY "createdAt" ASC LIMIT 50',
    maxDurationMs: 50,
    expectIndexScan: true,
  },
  {
    name: 'Report stats by site and date',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "ReportStats" WHERE "siteId" = $1 AND "date" = $2',
    params: ['test-site', '2026-04-05'],
    maxDurationMs: 50,
    expectIndexScan: true,
  },
  {
    name: 'Downtime summary by site and date',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "DowntimeSummary" WHERE "siteId" = $1 AND "date" = $2',
    params: ['test-site', '2026-04-05'],
    maxDurationMs: 50,
    expectIndexScan: true,
  },
  {
    name: 'Telemetry by equipment and time range',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "TelemetryRecord" WHERE "equipmentId" = $1 AND "timestamp" >= $2 AND "timestamp" <= $3',
    params: ['test-equip', '2026-04-01', '2026-04-30'],
    maxDurationMs: 100,
    expectIndexScan: true,
  },
  {
    name: 'Operator performance by user and date',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "OperatorPerformance" WHERE "userId" = $1 AND "date" = $2',
    params: ['test-user', '2026-04-05'],
    maxDurationMs: 50,
    expectIndexScan: true,
  },
  {
    name: 'PileWork by report',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "PileWork" WHERE "reportId" = $1',
    params: ['test-report'],
    maxDurationMs: 50,
    expectIndexScan: true,
  },
  {
    name: 'Audit log by entity',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "AuditLog" WHERE "entity" = $1 AND "entityId" = $2 ORDER BY "timestamp" DESC LIMIT 50',
    params: ['Report', 'test-report'],
    maxDurationMs: 100,
    expectIndexScan: true,
  },
];

interface CheckResult {
  name: string;
  pass: boolean;
  duration?: number;
  hasSeqScan?: boolean;
  plan?: string;
  warning?: string;
}

async function runExplainAnalyze(prisma: PrismaClient): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  console.log('\n🔍 EXPLAIN ANALYZE — Query Performance Check\n');

  for (const query of QUERIES) {
    try {
      const explainResult = await prisma.$queryRawUnsafe(query.sql, ...(query.params || []));
      const plan = typeof explainResult === 'string' ? explainResult : JSON.stringify(explainResult, null, 2);

      // Check for sequential scan
      const hasSeqScan = plan.toLowerCase().includes('seq scan');

      // Extract duration from EXPLAIN ANALYZE output
      const durationMatch = plan.match(/Execution Time:\s*([\d.]+)\s*ms/);
      const duration = durationMatch ? parseFloat(durationMatch[1]) : undefined;

      // Determine pass/fail
      let pass = true;
      let warning: string | undefined;

      if (query.maxDurationMs && duration && duration > query.maxDurationMs) {
        pass = false;
        warning = `Duration ${duration}ms exceeds threshold ${query.maxDurationMs}ms`;
      }

      if (query.expectIndexScan && hasSeqScan) {
        pass = false;
        warning = warning ? `${warning}; Sequential scan detected` : 'Sequential scan detected (expected index scan)';
      }

      results.push({
        name: query.name,
        pass,
        duration,
        hasSeqScan,
        plan: plan.substring(0, 500),
        warning,
      });

      // Print result
      const icon = pass ? '✅' : '❌';
      const durStr = duration ? `${duration.toFixed(1)}ms` : 'N/A';
      const scanType = hasSeqScan ? 'Seq Scan' : 'Index Scan';
      console.log(`  ${icon} ${query.name} — ${durStr} (${scanType})${warning ? ` ⚠️  ${warning}` : ''}`);

    } catch (e: any) {
      results.push({
        name: query.name,
        pass: false,
        warning: e.message?.substring(0, 200),
      });
      console.log(`  ❌ ${query.name} — Error: ${e.message?.substring(0, 100)}`);
    }
  }

  return results;
}

async function main() {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  if (provider !== 'postgres') {
    console.log('⚠️  EXPLAIN ANALYZE only works on PostgreSQL.');
    console.log('Set DATABASE_PROVIDER=postgres to run this check.');
    return;
  }

  let prisma: PrismaClient;
  try {
    const { PrismaClient: PostgresClient } = require('../src/generated/postgres-client');
    prisma = new PostgresClient();
  } catch {
    console.error('❌ PostgreSQL Prisma client not generated.');
    console.error('Run: npm run db:generate:postgres');
    process.exit(1);
  }

  try {
    const results = await runExplainAnalyze(prisma);

    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    const failed = results.filter(r => !r.pass);

    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${passed}/${total} passed`);

    if (failed.length > 0) {
      console.log('\n❌ Failed queries:');
      for (const r of failed) {
        console.log(`  - ${r.name}: ${r.warning}`);
      }
      console.log('\nRecommendations:');
      console.log('  1. Add indexes for queries with sequential scans');
      console.log('  2. Run VACUUM ANALYZE to update statistics');
      console.log('  3. Consider partial indexes for filtered queries');
      console.log('  4. Check postgres-production-hardening.sql for missing indexes');
    } else {
      console.log('\n✅ All queries are performing well!');
    }

    console.log('='.repeat(60));

    // Exit with error if any query failed
    if (failed.length > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
