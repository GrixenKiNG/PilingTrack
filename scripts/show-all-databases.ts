/**
 * Show All Databases in PilingTrack Project
 *
 * Checks:
 * 1. PostgreSQL (pilingtrack_test) - main dev DB
 * 2. SQLite (dev.db / custom.db) - local dev DB
 * 3. PostgreSQL (pilingtrack) - production DB (if exists)
 */

import { PrismaClient } from '../src/generated/postgres-client/client';
import { PrismaClient as SqlitePrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

async function checkPostgreSQL() {
  console.log('\n' + '═'.repeat(60));
  console.log('🐘 PostgreSQL — pilingtrack_test');
  console.log('═'.repeat(60));

  try {
    const db = new PrismaClient();
    const [userCount, siteCount, equipCount, crewCount, reportCount, pileGradeCount, drillingCount, downtimeCount, pileWorkCount, drillingWorkCount, downtimeEntryCount] = await Promise.all([
      db.user.count(),
      db.site.count(),
      db.equipment.count(),
      db.crew.count(),
      db.report.count(),
      db.pileGrade.count(),
      db.drillingType.count(),
      db.downtimeReason.count(),
      db.pileWork.count(),
      db.leaderDrilling.count(),
      db.reportDowntime.count(),
    ]);

    console.log(`  Users:            ${userCount}`);
    console.log(`  Sites:            ${siteCount}`);
    console.log(`  Equipment:        ${equipCount}`);
    console.log(`  Crews:            ${crewCount}`);
    console.log(`  Reports:          ${reportCount}`);
    console.log(`  Pile Grades:      ${pileGradeCount}`);
    console.log(`  Drilling Types:   ${drillingCount}`);
    console.log(`  Downtime Reasons: ${downtimeCount}`);
    console.log(`  Pile Work:        ${pileWorkCount}`);
    console.log(`  Leader Drilling:  ${drillingWorkCount}`);
    console.log(`  Downtime Entries: ${downtimeEntryCount}`);

    // Show sample data
    if (userCount > 0) {
      const users = await db.user.findMany({ select: { email: true, role: true, name: true }, take: 3 });
      console.log('\n  Sample Users:');
      users.forEach(u => console.log(`    ${u.email} (${u.role}) — ${u.name}`));
    }

    if (siteCount > 0) {
      const sites = await db.site.findMany({ select: { name: true, status: true }, take: 3 });
      console.log('\n  Sample Sites:');
      sites.forEach(s => console.log(`    ${s.name} [${s.status}]`));
    }

    if (reportCount > 0) {
      const reports = await db.report.findMany({
        select: { reportId: true, date: true, status: true, site: { select: { name: true } } },
        take: 3,
        orderBy: { date: 'desc' },
      });
      console.log('\n  Sample Reports:');
      reports.forEach(r => console.log(`    ${r.reportId} — ${r.date} [${r.status}] → ${r.site.name}`));
    }

    await db.$disconnect();
    console.log('\n  ✅ Connected');
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }
}

async function checkSQLite() {
  console.log('\n' + '═'.repeat(60));
  console.log('📁 SQLite — dev databases');
  console.log('═'.repeat(60));

  const dbPaths = [
    'db/custom.db',
    'db/dev.db',
    'db/test.db',
    'db/pilingtrack.db',
  ];

  for (const dbPath of dbPaths) {
    const fullPath = path.join(__dirname, '..', dbPath);
    const exists = fs.existsSync(fullPath);

    if (!exists) {
      console.log(`\n  ❌ ${dbPath} — not found`);
      continue;
    }

    const stats = fs.statSync(fullPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`\n  📁 ${dbPath} — ${sizeMB} MB`);

    try {
      const db = new SqlitePrismaClient({
        datasources: {
          db: { url: `file:${fullPath}` },
        },
      });

      const [userCount, siteCount, reportCount] = await Promise.all([
        db.user.count(),
        db.site.count(),
        db.report.count(),
      ]);

      console.log(`    Users:   ${userCount}`);
      console.log(`    Sites:   ${siteCount}`);
      console.log(`    Reports: ${reportCount}`);

      if (userCount > 0) {
        const users = await db.user.findMany({ select: { email: true, role: true, name: true }, take: 3 });
        console.log('    Sample Users:');
        users.forEach((u: { email: string; role: string; name: string }) => console.log(`      ${u.email} (${u.role}) — ${u.name}`));
      }

      await db.$disconnect();
    } catch (e: any) {
      console.log(`    ❌ Error reading DB: ${e.message}`);
    }
  }
}

async function main() {
  console.log('🔍 Scanning all databases in PilingTrack project...\n');

  await checkPostgreSQL();
  await checkSQLite();

  // Check environment configs
  console.log('\n' + '═'.repeat(60));
  console.log('⚙️  Environment Configurations');
  console.log('═'.repeat(60));

  const envFiles = ['.env', '.env.production', '.env.example', '.env.production.example'];
  for (const envFile of envFiles) {
    const fullPath = path.join(__dirname, '..', envFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const dbLine = content.split('\n').find(l => l.startsWith('DATABASE_URL=') && !l.startsWith('DATABASE_URL_PG'));
      const provider = content.split('\n').find(l => l.startsWith('DATABASE_PROVIDER='));
      console.log(`\n  📄 ${envFile}:`);
      if (provider) console.log(`    ${provider}`);
      if (dbLine) console.log(`    ${dbLine.substring(0, 60)}...`);
    }
  }
}

main().catch(console.error);
