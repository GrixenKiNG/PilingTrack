/**
 * Apply full DDL to PostgreSQL database.
 *
 * This script:
 * 1. Runs Prisma generate
 * 2. Runs Prisma db push (schema sync)
 * 3. Applies raw SQL DDL (RLS, triggers, partitions, extensions, etc.)
 *
 * Usage:
 *   npx tsx scripts/apply-full-ddl.ts
 *   or
 *   npm run db:apply-ddl
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = join(__dirname, 'apply-full-ddl.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  const dbUrl = process.env.DATABASE_URL_POSTGRES;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL_POSTGRES is not set');
    process.exit(1);
  }

  console.log('🔧 Applying full DDL to PostgreSQL...\n');

  // Step 1: Prisma generate
  console.log('📦 Step 1: Prisma generate...');
  try {
    execSync('npx prisma generate --schema prisma/schema.postgres.prisma', {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
    });
    console.log('✅ Prisma client generated\n');
  } catch (error) {
    console.error('❌ Prisma generate failed:', (error as Error).message);
    process.exit(1);
  }

  // Step 2: Prisma db push
  console.log('📦 Step 2: Prisma db push (schema sync)...');
  try {
    execSync('npx prisma db push --schema prisma/schema.postgres.prisma --accept-data-loss', {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
    });
    console.log('✅ Prisma schema synced\n');
  } catch (error) {
    console.error('❌ Prisma db push failed:', (error as Error).message);
    process.exit(1);
  }

  // Step 3: Apply raw SQL DDL
  console.log('📦 Step 3: Applying raw SQL DDL (extensions, RLS, triggers, partitions)...\n');

  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    console.log('🔌 Connected to PostgreSQL\n');

    // Split SQL into statements (by semicolon)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Skip DO blocks with complex logic — execute them as-is
      if (stmt.includes('DO $$') || stmt.includes('CREATE OR REPLACE FUNCTION')) {
        try {
          await client.query(stmt + ';');
          successCount++;
        } catch (error) {
          const msg = (error as Error).message;
          if (msg.includes('already exists') || msg.includes('does not exist')) {
            skipCount++;
          } else {
            console.error(`   ❌ Statement ${i + 1} failed:`, msg.slice(0, 100));
            errorCount++;
          }
        }
        continue;
      }

      try {
        await client.query(stmt);
        successCount++;
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes('already exists') || msg.includes('does not exist')) {
          skipCount++;
        } else {
          console.error(`   ❌ Statement ${i + 1} failed:`, msg.slice(0, 100));
          errorCount++;
        }
      }
    }

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Applied: ${successCount}`);
    console.log(`   ⏭️  Skipped (already exists): ${skipCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    if (errorCount > 0) {
      console.error('\n⚠️  Some statements failed. Review errors above.');
      process.exitCode = 1;
    } else {
      console.log('\n✅ Full DDL applied successfully!\n');
    }
  } catch (error) {
    console.error('💥 Connection failed:', (error as Error).message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
