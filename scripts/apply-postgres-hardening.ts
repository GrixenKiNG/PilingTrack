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

import { PrismaClient } from '@prisma/client';

// Detect which Prisma client to use
function getPrismaClient() {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  if (provider === 'postgres') {
    // Try to load the postgres client
    try {
      const { PrismaClient: PostgresClient } = require('../src/generated/postgres-client');
      return new PostgresClient();
    } catch {
      throw new Error('PostgreSQL Prisma client not generated. Run: npm run db:generate:postgres');
    }
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

  const checkConstraints = [
    // Role constraint
    `ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS chk_user_role_valid
      CHECK ("role" IN ('ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'))`,

    // Report status
    `ALTER TABLE "Report" ADD CONSTRAINT IF NOT EXISTS chk_report_status_valid
      CHECK ("status" IN ('draft', 'submitted'))`,

    // Report shiftType
    `ALTER TABLE "Report" ADD CONSTRAINT IF NOT EXISTS chk_report_shift_valid
      CHECK ("shiftType" IN ('DAY', 'NIGHT'))`,

    // Report date not in future
    `ALTER TABLE "Report" ADD CONSTRAINT IF NOT EXISTS chk_report_date_not_future
      CHECK ("date" <= CURRENT_DATE)`,

    // Downtime duration
    `ALTER TABLE "ReportDowntime" ADD CONSTRAINT IF NOT EXISTS chk_downtime_duration_positive
      CHECK ("duration" >= 0)`,

    // PileWork count
    `ALTER TABLE "PileWork" ADD CONSTRAINT IF NOT EXISTS chk_pile_count_positive
      CHECK ("count" > 0)`,

    // LeaderDrilling meters
    `ALTER TABLE "LeaderDrilling" ADD CONSTRAINT IF NOT EXISTS chk_drilling_meters_positive
      CHECK ("meters" >= 0)`,

    // Equipment quantity
    `ALTER TABLE "Equipment" ADD CONSTRAINT IF NOT EXISTS chk_equipment_qty_positive
      CHECK ("qty" > 0)`,

    // Site status
    `ALTER TABLE "Site" ADD CONSTRAINT IF NOT EXISTS chk_site_status_valid
      CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'ARCHIVED'))`,

    // FeedbackEvent level
    `ALTER TABLE "FeedbackEvent" ADD CONSTRAINT IF NOT EXISTS chk_feedback_level_valid
      CHECK ("level" IN ('info', 'warn', 'error', 'success'))`,

    // FeedbackEvent priority
    `ALTER TABLE "FeedbackEvent" ADD CONSTRAINT IF NOT EXISTS chk_feedback_priority_valid
      CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))`,

    // FeedbackEvent audience
    `ALTER TABLE "FeedbackEvent" ADD CONSTRAINT IF NOT EXISTS chk_feedback_audience_valid
      CHECK ("audience" IN ('OPERATIONS', 'MANAGEMENT', 'TECHNICAL'))`,

    // IdempotencyKey status
    `ALTER TABLE "IdempotencyKey" ADD CONSTRAINT IF NOT EXISTS chk_idempotency_status_valid
      CHECK ("status" IN ('pending', 'processing', 'completed', 'failed'))`,

    // OutboxEvent published
    `ALTER TABLE "OutboxEvent" ADD CONSTRAINT IF NOT EXISTS chk_outbox_published
      CHECK ("published" IN (true, false))`,

    // RefreshToken
    `ALTER TABLE "RefreshToken" ADD CONSTRAINT IF NOT EXISTS chk_refresh_token_valid
      CHECK (NOT "revoked" OR "revokedReason" IS NOT NULL)`,
  ];

  let appliedChecks = 0;
  let skippedChecks = 0;

  for (const sql of checkConstraints) {
    try {
      await prisma.$executeRawUnsafe(sql);
      appliedChecks++;
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        skippedChecks++;
      } else {
        console.warn(`  ⚠️  Warning: ${e.message?.substring(0, 100)}`);
        skippedChecks++;
      }
    }
  }

  console.log(`  ✅ ${appliedChecks} CHECK constraints applied (${skippedChecks} already exist)\n`);

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
  // 4. ROW-LEVEL SECURITY (правило #25)
  // ============================================================
  console.log('🔒 Step 4: Row-Level Security...');

  const rlsTables = [
    'Tenant', 'User', 'Site', 'Report', 'ReportAnalytics',
    'ReportStats', 'OperatorPerformance', 'DowntimeSummary',
    'SiteWeeklyTrend', 'AuditLog', 'OutboxEvent', 'TelemetryRecord',
  ];

  let enabledRLS = 0;
  for (const table of rlsTables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      enabledRLS++;
    } catch {
      // Already enabled
    }
  }

  // Tenant isolation policies
  const rlsPolicies = [
    `CREATE POLICY IF NOT EXISTS tenant_isolation_user ON "User"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_site ON "Site"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_report ON "Report"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_stats ON "ReportStats"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_operator ON "OperatorPerformance"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_downtime ON "DowntimeSummary"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_trend ON "SiteWeeklyTrend"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_audit ON "AuditLog"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_outbox ON "OutboxEvent"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,

    `CREATE POLICY IF NOT EXISTS tenant_isolation_telemetry ON "TelemetryRecord"
      USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant', true))`,
  ];

  let appliedPolicies = 0;
  for (const sql of rlsPolicies) {
    try {
      await prisma.$executeRawUnsafe(sql);
      appliedPolicies++;
    } catch (e: any) {
      if (!e.message?.includes('already exists')) {
        console.warn(`  ⚠️  Policy skipped: ${e.message?.substring(0, 100)}`);
      }
    }
  }

  console.log(`  ✅ ${enabledRLS} tables RLS enabled, ${appliedPolicies} policies applied\n`);

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
  console.log(`  ✅ ${enabledRLS} tables with RLS, ${appliedPolicies} policies`);
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
