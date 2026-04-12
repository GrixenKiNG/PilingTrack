import { PrismaClient } from '../src/generated/postgres-client';

const db = new PrismaClient();

async function main() {
  console.log('=== DETAILED DATABASE STATE ===\n');

  // Users
  const users = await db.user.findMany({ select: { id: true, email: true, name: true, role: true } });
  console.log(`👤 USERS (${users.length}):`);
  users.forEach(u => console.log(`  ${u.email} | ${u.name} | ${u.role} | id: ${u.id}`));

  // Sites
  const sites = await db.site.findMany({ select: { id: true, name: true, status: true, isActive: true, plannedPiles: true } });
  console.log(`\n🏗️ SITES (${sites.length}):`);
  sites.forEach(s => console.log(`  ${s.name} | ${s.status} | planned: ${s.plannedPiles} | id: ${s.id}`));

  // Equipment
  const equipment = await db.equipment.findMany({ select: { id: true, name: true, model: true, isActive: true } });
  console.log(`\n🚜 EQUIPMENT (${equipment.length}):`);
  equipment.forEach(e => console.log(`  ${e.name} | ${e.model} | ${e.isActive ? 'active' : 'inactive'}`));

  // Crews
  const crews = await db.crew.findMany({ select: { id: true, name: true } });
  console.log(`\n👷 CREWS (${crews.length}):`);
  for (const c of crews) {
    const crewWithDetails = await db.crew.findUnique({
      where: { id: c.id },
      include: { equipment: true, assistants: true, operator: true }
    });
    console.log(`  ${c.name} | equipments: ${crewWithDetails?.equipment.length || 0} | assistants: ${crewWithDetails?.assistants.length || 0}`);
  }

  // Reports
  const reports = await db.report.findMany({ select: { id: true, date: true, siteId: true, crewId: true, authorId: true, shift: true } });
  console.log(`\n📝 REPORTS (${reports.length}):`);
  reports.forEach(r => console.log(`  ${r.date.toISOString().split('T')[0]} | site: ${r.siteId?.slice(0,12)} | crew: ${r.crewId?.slice(0,12)} | author: ${r.authorId?.slice(0,12)} | shift: ${r.shift}`));

  // Site-User assignments
  const siteUsers = await db.siteUser.findMany({ include: { user: { select: { email: true } }, site: { select: { name: true } } } });
  console.log(`\n🔗 SITE-USERS (${siteUsers.length}):`);
  siteUsers.forEach(su => console.log(`  ${su.user.email} → ${su.site.name}`));

  // Pile fields
  const fields = await db.pileField.findMany({ select: { id: true, name: true, siteId: true } });
  console.log(`\n📋 PILE FIELDS (${fields.length}):`);
  fields.forEach(f => console.log(`  ${f.name} | site: ${f.siteId?.slice(0,12)}`));

  // Clusters
  const clusters = await db.cluster.findMany({ select: { id: true, name: true, fieldId: true } });
  console.log(`\n🔶 CLUSTERS (${clusters.length}):`);
  clusters.forEach(c => console.log(`  ${c.name} | field: ${c.fieldId?.slice(0,12)}`));

  // Pickets
  const pickets = await db.picket.findMany({ select: { id: true, name: true, clusterId: true } });
  console.log(`\n📍 PICKETS (${pickets.length}):`);
  pickets.forEach(p => console.log(`  ${p.name} | cluster: ${p.clusterId?.slice(0,12)}`));

  // Pile Grades
  const grades = await db.pileGrade.findMany({ select: { id: true, name: true, isActive: true } });
  console.log(`\n🔷 PILE GRADES (${grades.length}):`);
  grades.forEach(g => console.log(`  ${g.name} | ${g.isActive ? 'active' : 'inactive'}`));

  // Drilling Types
  const drills = await db.drillingType.findMany({ select: { id: true, name: true, isActive: true } });
  console.log(`\n🔩 DRILLING TYPES (${drills.length}):`);
  drills.forEach(d => console.log(`  ${d.name} | ${d.isActive ? 'active' : 'inactive'}`));

  // Downtime Reasons
  const downtimes = await db.downtimeReason.findMany({ select: { id: true, name: true, isActive: true } });
  console.log(`\n⏸️ DOWNTIME REASONS (${downtimes.length}):`);
  downtimes.forEach(d => console.log(`  ${d.name} | ${d.isActive ? 'active' : 'inactive'}`));
}

main().then(() => db.$disconnect()).catch(console.error);
