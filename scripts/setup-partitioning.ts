#!/usr/bin/env node
/**
 * Partitioning Setup for Large Tables
 *
 * Creates time-based partitions for high-volume tables:
 * - TelemetryRecord (by month)
 * - OutboxEvent (by month)
 * - AuditLog (by month)
 *
 * Usage:
 *   npx tsx scripts/setup-partitioning.ts
 *
 * IMPORTANT: Run AFTER Prisma migration on PostgreSQL.
 * This script recreates tables with partitioning — existing data will be migrated.
 */

const { execSync } = require('child_process');

function run(cmd: string, opts: Record<string, unknown> = {}) {
  console.log(`  Running: ${cmd.substring(0, 100)}...`);
  return execSync(cmd, { stdio: 'inherit', cwd: process.cwd(), ...opts });
}

// Partitioned tables configuration
const PARTITIONED_TABLES = [
  {
    name: 'TelemetryRecord',
    column: 'timestamp',
    months: 6, // Create 6 months of partitions
  },
  {
    name: 'OutboxEvent',
    column: 'createdAt',
    months: 6,
  },
  {
    name: 'AuditLog',
    column: 'timestamp',
    months: 12, // Keep 12 months of partitions
  },
];

function generatePartitionSQL(table: string, column: string, months: number) {
  const sql: string[] = [];

  // Step 1: Rename original table
  sql.push(`ALTER TABLE "${table}" RENAME TO "${table}_old";`);

  // Step 2: Create partitioned table with same structure
  sql.push(`CREATE TABLE "${table}" (LIKE "${table}_old" INCLUDING ALL) PARTITION BY RANGE ("${column}");`);

  // Step 3: Create partitions for next N months
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const partitionName = `${table.toLowerCase()}_${startStr.replace('-', '_').substring(0, 7)}`;

    sql.push(`CREATE TABLE "${partitionName}" PARTITION OF "${table}"
      FOR VALUES FROM ('${startStr}') TO ('${endStr}');`);
  }

  // Step 4: Create default partition for future data
  sql.push(`CREATE TABLE "${table.toLowerCase()}_default" PARTITION OF "${table}" DEFAULT;`);

  // Step 5: Migrate data from old table (batch insert)
  sql.push(`INSERT INTO "${table}" SELECT * FROM "${table}_old";`);

  // Step 6: Drop old table
  sql.push(`DROP TABLE "${table}_old" CASCADE;`);

  // Step 7: Recreate indexes on partitioned table
  // (Prisma will handle this via migrations, but we add partition-specific indexes)

  return sql.join('\n\n');
}

async function setupPartitioning() {
  console.log('\n📊 PostgreSQL Partitioning Setup\n');
  console.log('This will recreate the following tables with time-based partitioning:');
  for (const table of PARTITIONED_TABLES) {
    console.log(`  - ${table.name} (by ${table.column}, ${table.months} months)`);
  }
  console.log('\n⚠️  WARNING: This is a DDL operation. Ensure you have a backup.\n');

  const provider = process.env.DATABASE_PROVIDER || 'sqlite';
  if (provider !== 'postgres') {
    console.log('⚠️  DATABASE_PROVIDER is not "postgres". Partitioning only works on PostgreSQL.');
    console.log('Skipping partitioning setup.');
    return;
  }

  // Generate SQL script
  const allSQL: string[] = [];

  for (const table of PARTITIONED_TABLES) {
    console.log(`\n📋 Generating partition SQL for ${table.name}...`);
    const sql = generatePartitionSQL(table.name, table.column, table.months);
    allSQL.push(sql);
  }

  // Write to file for manual execution
  const fs = require('fs');
  const path = require('path');
  const outputPath = path.join(process.cwd(), 'scripts', 'partitioning.sql');

  fs.writeFileSync(outputPath, allSQL.join('\n\n'));
  console.log(`\n✅ Partitioning SQL written to: ${outputPath}`);
  console.log('\nTo apply:');
  console.log(`  psql -U piling -d pilingtrack -f ${outputPath}`);
  console.log('\nOr via Prisma:');
  console.log('  npx prisma db execute --schema prisma/schema.postgres.prisma');
}

setupPartitioning().catch(e => {
  console.error('❌ Partitioning setup failed:', e);
  process.exit(1);
});
