#!/usr/bin/env node
/**
 * PostgreSQL Migration Setup
 *
 * 1. Generates PostgreSQL schema from SQLite schema
 * 2. Creates Prisma migration for PostgreSQL
 * 3. Applies migration to PostgreSQL database
 *
 * Usage:
 *   npx tsx scripts/setup-postgres.ts
 *
 * Or manually:
 *   npm run prisma:generate:postgres
 *   npx prisma migrate dev --schema prisma/schema.postgres.prisma --name init
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const sqliteSchemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
const postgresSchemaPath = path.join(projectRoot, 'prisma', 'schema.postgres.prisma');

function log(msg) { console.log(`[PG] ${msg}`); }
function run(cmd, opts = {}) {
  log(`Running: ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: projectRoot, ...opts });
}

async function main() {
  // 1. Generate PostgreSQL schema from SQLite schema
  log('Step 1: Generating PostgreSQL schema...');
  const sqliteSchema = fs.readFileSync(sqliteSchemaPath, 'utf8');
  const postgresSchema = sqliteSchema
    .replace(
      /generator client\s*{[\s\S]*?provider\s*=\s*"prisma-client-js"[\s\S]*?}/m,
      'generator client {\n  provider = "prisma-client-js"\n  output   = "../src/generated/postgres-client"\n}'
    )
    .replace(
      /datasource db\s*{([\s\S]*?)provider\s*=\s*"sqlite"/m,
      'datasource db {$1provider = "postgresql"'
    )
    .replace('env("DATABASE_URL")', 'env("DATABASE_URL_POSTGRES")');

  fs.writeFileSync(postgresSchemaPath, postgresSchema, 'utf8');
  log('Generated schema.postgres.prisma');

  // 2. Generate Prisma client for PostgreSQL
  log('Step 2: Generating PostgreSQL Prisma client...');
  run('npx prisma generate --schema prisma/schema.postgres.prisma');

  // 3. Run migration on PostgreSQL
  log('Step 3: Running Prisma migration on PostgreSQL...');
  try {
    run('npx prisma migrate deploy --schema prisma/schema.postgres.prisma');
    log('PostgreSQL migration applied successfully');
  } catch (e) {
    log('Migration failed — attempting db push...');
    try {
      run('npx prisma db push --schema prisma/schema.postgres.prisma');
      log('PostgreSQL schema pushed successfully');
    } catch (e2) {
      log('ERROR: Could not apply migration to PostgreSQL');
      log('Make sure PostgreSQL is running and DATABASE_URL_POSTGRES is set');
      process.exit(1);
    }
  }

  // 4. Run RLS script if exists
  const rlsPath = path.join(projectRoot, 'scripts', 'init-rls.sql');
  if (fs.existsSync(rlsPath)) {
    log('Step 4: RLS script exists — apply manually with psql:');
    log(`  psql -U piling -d pilingtrack -f ${rlsPath}`);
  }

  log('PostgreSQL setup complete!');
  log('To switch to PostgreSQL, set:');
  log('  DATABASE_PROVIDER=postgres');
  log('  DATABASE_URL_POSTGRES=postgresql://...');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
