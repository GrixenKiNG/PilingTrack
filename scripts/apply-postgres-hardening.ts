/**
 * Apply PostgreSQL Production Hardening
 *
 * Applies CHECK constraints, partial indexes, soft delete columns,
 * and RLS policies to PostgreSQL database AFTER Prisma migration.
 *
 * Usage:
 *   npx tsx scripts/apply-postgres-hardening.ts
 *
 * Prerequisites:
 *   - DATABASE_PROVIDER=postgres
 *   - DATABASE_URL_POSTGRES set
 *   - PostgreSQL running
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

// Detect which Prisma client to use
function getPrismaClient() {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  if (provider === 'postgres') {
    // Prisma 7 requires an adapter when driverAdapters is set in the schema
    // (see prisma/seed.ts) — a bare `new PrismaClient()` throws otherwise.
    let PostgresClient: any;
    try {
      ({ PrismaClient: PostgresClient } = require('../src/generated/postgres-client'));
    } catch {
      throw new Error('PostgreSQL Prisma client not generated. Run: npm run db:generate');
    }
    const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL_POSTGRES (or DATABASE_URL) is required.');
    }
    return new PostgresClient({ adapter: new PrismaPg({ connectionString }) });
  }

  // For SQLite dev, just log what WOULD be applied
  return null;
}

async function applyHardening(prisma: any) {
  console.log('🔧 Applying PostgreSQL production hardening...\n');

  // ============================================================
  // 1. CHECK CONSTRAINTS (правило #13)
  // ============================================================
  console.log('📋 Step 1: CHECK constraints...');

  // Postgres has no `ADD CONSTRAINT IF NOT EXISTS` (only ADD COLUMN supports that).
  // Idempotency comes from the DO block catching duplicate_object (constraint already exists).
  const idempotentAdd = (table: string, name: string, check: string) => `
    DO $$ BEGIN
      ALTER TABLE "${table}" ADD CONSTRAINT ${name} CHECK (${check});
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;`;

  const checkConstraints: { name: string; sql: string }[] = [
    { name: 'chk_user_role_valid', sql: idempotentAdd('User', 'chk_user_role_valid', `"role" IN ('ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT')`) },
    { name: 'chk_report_status_valid', sql: idempotentAdd('Report', 'chk_report_status_valid', `"status" IN ('draft', 'submitted')`) },
    { name: 'chk_report_shift_valid', sql: idempotentAdd('Report', 'chk_report_shift_valid', `"shiftType" IN ('DAY', 'NIGHT')`) },
    // Report.date is TEXT (clean 'YYYY-MM-DD', no time component) by design — cast for comparison.
    // Compare against business-timezone "today" (MSK), not CURRENT_DATE: the DB runs on UTC,
    // where MSK's "today" is still "tomorrow" between 00:00 and 03:00 MSK — legitimate
    // night-shift reports would violate a CURRENT_DATE check.
    { name: 'chk_report_date_not_future', sql: idempotentAdd('Report', 'chk_report_date_not_future', `"date"::date <= (now() AT TIME ZONE 'Europe/Moscow')::date`) },
    { name: 'chk_downtime_duration_positive', sql: idempotentAdd('ReportDowntime', 'chk_downtime_duration_positive', `"duration" >= 0`) },
    { name: 'chk_pile_count_positive', sql: idempotentAdd('PileWork', 'chk_pile_count_positive', `"count" > 0`) },
    { name: 'chk_drilling_meters_positive', sql: idempotentAdd('LeaderDrilling', 'chk_drilling_meters_positive', `"meters" >= 0`) },
    { name: 'chk_equipment_qty_positive', sql: idempotentAdd('Equipment', 'chk_equipment_qty_positive', `"qty" > 0`) },
    // Value lists below matched against the authoritative types (SiteStatus in
    // site.aggregate.ts; FeedbackEventLevel/Audience/Priority in lib/types.ts),
    // not just what happened to be in the DB — the original lists here had both
    // missing real values (INACTIVE, audit, USER, ALL) and fictional ones
    // (ARCHIVED, MANAGEMENT, TECHNICAL) that don't exist anywhere in the code.
    { name: 'chk_site_status_valid', sql: idempotentAdd('Site', 'chk_site_status_valid', `"status" IN ('ACTIVE', 'INACTIVE', 'COMPLETED')`) },
    { name: 'chk_feedback_level_valid', sql: idempotentAdd('FeedbackEvent', 'chk_feedback_level_valid', `"level" IN ('info', 'warn', 'error', 'success', 'audit')`) },
    { name: 'chk_feedback_priority_valid', sql: idempotentAdd('FeedbackEvent', 'chk_feedback_priority_valid', `"priority" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`) },
    { name: 'chk_feedback_audience_valid', sql: idempotentAdd('FeedbackEvent', 'chk_feedback_audience_valid', `"audience" IN ('ALL', 'OPERATIONS', 'USER')`) },
    { name: 'chk_idempotency_status_valid', sql: idempotentAdd('IdempotencyKey', 'chk_idempotency_status_valid', `"status" IN ('pending', 'processing', 'completed', 'failed')`) },
    { name: 'chk_outbox_published', sql: idempotentAdd('OutboxEvent', 'chk_outbox_published', `"published" IN (true, false)`) },
    { name: 'chk_refresh_token_valid', sql: idempotentAdd('RefreshToken', 'chk_refresh_token_valid', `NOT "revoked" OR "revokedReason" IS NOT NULL`) },
  ];

  let appliedChecks = 0;
  let failedChecks = 0;

  for (const { name, sql } of checkConstraints) {
    try {
      await prisma.$executeRawUnsafe(sql);
      appliedChecks++;
    } catch (e: any) {
      failedChecks++;
      console.error(`  ❌ ${name} failed: ${e.message?.substring(0, 200)}`);
    }
  }

  console.log(`  ✅ ${appliedChecks} CHECK constraints applied/verified (${failedChecks} failed — see errors above)\n`);

  // ============================================================
  // 2. PARTIAL INDEXES (правило #17)
  // ============================================================
  console.log('📊 Step 2: Partial indexes...');

  const partialIndexes = [
    // Active users
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_email ON "User"("email")
      WHERE "isActive" = true`,

    // Active sites
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sites_active ON "Site"("name")
      WHERE "isActive" = true`,

    // Active equipment
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_active ON "Equipment"("name")
      WHERE "isActive" = true`,

    // Active crews
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crews_active ON "Crew"("name")
      WHERE "isActive" = true`,

    // Active dictionaries
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pile_grades_active ON "PileGrade"("name")
      WHERE "isActive" = true`,

    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drilling_types_active ON "DrillingType"("name")
      WHERE "isActive" = true`,

    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downtime_reasons_active ON "DowntimeReason"("name")
      WHERE "isActive" = true`,

    // Pending outbox events
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_pending ON "OutboxEvent"("createdAt")
      WHERE "published" = false`,

    // Retryable outbox events
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_retryable ON "OutboxEvent"("attempts", "createdAt")
      WHERE "published" = false AND "attempts" < 5`,

    // Submitted reports (analytics)
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_submitted ON "Report"("siteId", "date")
      WHERE "status" = 'submitted'`,

    // Draft reports (editing)
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_draft ON "Report"("userId", "date")
      WHERE "status" = 'draft'`,

    // Failed idempotency keys
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_idempotency_failed ON "IdempotencyKey"("expiresAt")
      WHERE "status" = 'failed'`,

    // Expired refresh tokens
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_expired ON "RefreshToken"("expiresAt")
      WHERE "expiresAt" < NOW()`,
  ];

  let appliedIdx = 0;
  let skippedIdx = 0;

  for (const sql of partialIndexes) {
    try {
      // CONCURRENTLY cannot be used in a transaction
      await prisma.$executeRawUnsafe(sql);
      appliedIdx++;
    } catch (e: any) {
      if (e.message?.includes('already exists') || e.message?.includes('concurrently')) {
        // Try without CONCURRENTLY
        const sqlWithoutConcurrent = sql.replace('CONCURRENTLY ', '');
        try {
          await prisma.$executeRawUnsafe(sqlWithoutConcurrent);
          appliedIdx++;
        } catch {
          skippedIdx++;
        }
      } else {
        skippedIdx++;
      }
    }
  }

  console.log(`  ✅ ${appliedIdx} partial indexes applied (${skippedIdx} already exist)\n`);

  // ============================================================
  // 3. SOFT DELETE COLUMNS (правило #10)
  // ============================================================
  console.log('🗑️  Step 3: Soft delete columns...');

  const softDeleteColumns = [
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
    'ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
    'ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
    'ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
    'ALTER TABLE "PileGrade" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
    'ALTER TABLE "DrillingType" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
    'ALTER TABLE "DowntimeReason" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL',
  ];

  let appliedSoft = 0;
  for (const sql of softDeleteColumns) {
    try {
      await prisma.$executeRawUnsafe(sql);
      appliedSoft++;
    } catch {
      // Already exists
    }
  }

  // Partial indexes for soft-delete
  const softDeleteIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_users_not_deleted ON "User"("email")
      WHERE "deletedAt" IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_sites_not_deleted ON "Site"("name")
      WHERE "deletedAt" IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_equipment_not_deleted ON "Equipment"("name")
      WHERE "deletedAt" IS NULL`,
  ];

  let appliedSoftIdx = 0;
  for (const sql of softDeleteIndexes) {
    try {
      await prisma.$executeRawUnsafe(sql);
      appliedSoftIdx++;
    } catch {
      // Already exists
    }
  }

  console.log(`  ✅ ${appliedSoft} soft delete columns, ${appliedSoftIdx} partial indexes added\n`);

  // ============================================================
  // 4. ROW-LEVEL SECURITY (правило #25) — verification only.
  //
  // RLS enable/policies/FORCE are owned by Prisma migrations
  // (20260425000000_enable_rls_foundation and later). The old mutating
  // version of this step silently failed on every CREATE POLICY
  // (Postgres has no `CREATE POLICY IF NOT EXISTS`) while its ENABLE
  // loop still ran — that out-of-band drift is how Tenant/OutboxEvent
  // ended up with RLS enabled and zero policies. This step now only
  // reports state and flags dangerous combinations.
  // ============================================================
  console.log('🔒 Step 4: Row-Level Security (verify, owned by migrations)...');

  const rlsState: { relname: string; rls: boolean; forced: boolean; policies: number }[] =
    await prisma.$queryRawUnsafe(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      ORDER BY c.relname`);

  let rlsProblems = 0;
  for (const t of rlsState) {
    if (t.policies === 0) {
      rlsProblems++;
      console.warn(`  ⚠️  "${t.relname}": RLS enabled but NO policies — non-owner roles are locked out${t.forced ? ' (FORCED: owner too!)' : ''}`);
    } else if (!t.forced) {
      rlsProblems++;
      console.warn(`  ⚠️  "${t.relname}": RLS not FORCED — table owner bypasses all policies`);
    }
  }

  console.log(`  ✅ ${rlsState.length} tables with RLS (${rlsState.filter(t => t.forced).length} forced), ${rlsProblems} warnings\n`);

  // ============================================================
  // 5. VACUUM ANALYZE
  // ============================================================
  console.log('🧹 Step 5: VACUUM ANALYZE...');
  try {
    await prisma.$executeRawUnsafe('VACUUM ANALYZE');
    console.log('  ✅ VACUUM ANALYZE completed\n');
  } catch (e: any) {
    console.warn(`  ⚠️  VACUUM failed: ${e.message}\n`);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log('='.repeat(60));
  console.log('✅ PostgreSQL production hardening applied successfully!');
  console.log('='.repeat(60));
  console.log('\nApplied:');
  console.log(`  ✅ ${appliedChecks} CHECK constraints`);
  console.log(`  ✅ ${appliedIdx} partial indexes`);
  console.log(`  ✅ ${appliedSoft} soft delete columns + ${appliedSoftIdx} partial indexes`);
  console.log(`  ✅ RLS verified: ${rlsState.length} tables, ${rlsProblems} warnings (RLS itself is managed by migrations)`);
  console.log('\nTo set tenant context before queries:');
  console.log("  SET app.current_tenant = 'tenant-id-here';");
}

async function main() {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  if (provider !== 'postgres') {
    console.log('⚠️  DATABASE_PROVIDER is not "postgres". Skipping hardening.');
    console.log('To apply, set:');
    console.log('  DATABASE_PROVIDER=postgres');
    console.log('  DATABASE_URL_POSTGRES=postgresql://...');
    console.log('\nThen run: npm run postgres:apply-hardening');
    return;
  }

  const prisma = getPrismaClient();
  if (!prisma) {
    console.error('❌ Could not create Prisma client');
    process.exit(1);
  }

  try {
    await applyHardening(prisma);
  } catch (error) {
    console.error('❌ Hardening failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
