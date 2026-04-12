import { PrismaClient } from '../src/generated/postgres-client/client';

const db = new PrismaClient();

async function main() {
  const userCount = await db.user.count();
  const siteCount = await db.site.count();
  const equipCount = await db.equipment.count();
  const crewCount = await db.crew.count();
  const reportCount = await db.report.count();
  const pileGradeCount = await db.pileGrade.count();
  const drillingCount = await db.drillingType.count();
  const downtimeCount = await db.downtimeReason.count();

  console.log('=== PostgreSQL Data ===');
  console.log(`Users: ${userCount}`);
  console.log(`Sites: ${siteCount}`);
  console.log(`Equipment: ${equipCount}`);
  console.log(`Crews: ${crewCount}`);
  console.log(`Reports: ${reportCount}`);
  console.log(`Pile Grades: ${pileGradeCount}`);
  console.log(`Drilling Types: ${drillingCount}`);
  console.log(`Downtime Reasons: ${downtimeCount}`);

  // Show users
  const users = await db.user.findMany({ select: { email: true, role: true, name: true, isActive: true } });
  console.log('\n=== Users ===');
  users.forEach(u => console.log(`  ${u.email} (${u.role}) — ${u.name} [${u.isActive ? 'active' : 'inactive'}]`));

  // Show sites
  const sites = await db.site.findMany({ select: { name: true, status: true, isActive: true } });
  console.log('\n=== Sites ===');
  sites.forEach(s => console.log(`  ${s.name} [${s.status}, ${s.isActive ? 'active' : 'inactive'}]`));
}

main().then(() => db.$disconnect()).catch(e => { console.error(e.message); process.exit(1); });
