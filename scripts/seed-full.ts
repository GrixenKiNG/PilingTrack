/**
 * Full Seed Script — PilingTrack PostgreSQL
 *
 * Creates complete production-like data:
 * - 5 Users (ADMIN, DISPATCHER, 2x OPERATOR, ASSISTANT)
 * - 3 Sites with hierarchy (fields → clusters → pickets)
 * - 6 Equipment items
 * - 3 Crews with assistants
 * - Pile Grades, Drilling Types, Downtime Reasons
 * - 5 Reports with piles, drillings, downtimes
 * - User-Site assignments
 *
 * Usage: npx tsx scripts/seed-full.ts
 */

import { PrismaClient } from '../src/generated/postgres-client/client';
import { hashSync } from 'bcryptjs';

const db = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding PostgreSQL database...\n');

  // ============================================================
  // 1. Dictionary Data
  // ============================================================
  console.log('📚 Creating dictionaries...');

  const pileGrades = ['СВ 120-35', 'СВ 150-50', 'СВ 200-60', 'СВ 300-80', 'СВ 400-100'];
  for (const name of pileGrades) {
    await db.pileGrade.upsert({
      where: { id: `pg-${name}` },
      update: { name, isActive: true },
      create: { id: `pg-${name}`, name, isActive: true },
    });
  }
  console.log(`   ✅ ${pileGrades.length} Pile Grades`);

  const drillingTypes = ['Лидерное бурение d=150мм', 'Лидерное бурение d=200мм', 'Расширение скважины'];
  for (const name of drillingTypes) {
    await db.drillingType.upsert({
      where: { id: `dt-${name}` },
      update: { name, isActive: true },
      create: { id: `dt-${name}`, name, isActive: true },
    });
  }
  console.log(`   ✅ ${drillingTypes.length} Drilling Types`);

  const downtimeReasons = [
    'Переезд установки',
    'Плохие погодные условия',
    'Отсутствие свай на складе',
    'Ремонт установки',
    'Ожидание техники',
    'Прочее',
  ];
  for (const name of downtimeReasons) {
    await db.downtimeReason.upsert({
      where: { id: `dr-${name}` },
      update: { name, isActive: true },
      create: { id: `dr-${name}`, name, isActive: true },
    });
  }
  console.log(`   ✅ ${downtimeReasons.length} Downtime Reasons`);

  // ============================================================
  // 2. Equipment
  // ============================================================
  console.log('\n🚜 Creating equipment...');

  const equipmentList = [
    { id: 'eq-pve-50pr', name: 'PVE 50PR', model: 'PVE 50PR', qty: 1, desc: 'Вибропогружатель забивной' },
    { id: 'eq-lrh-100-1', name: 'Liebherr LRH 100 №1', model: 'LRH 100', qty: 1, desc: 'Роторный гусеничный кран' },
    { id: 'eq-lrh-100-2', name: 'Liebherr LRH 100 №2', model: 'LRH 100', qty: 1, desc: 'Роторный гусеничный кран' },
    { id: 'eq-kburg-1602-1', name: 'КБУРГ-16.02 №1', model: 'КБУРГ-16.02', qty: 1, desc: 'Копровая установка буровая' },
    { id: 'eq-kburg-1602-2', name: 'КБУРГ-16.02 №2', model: 'КБУРГ-16.02', qty: 1, desc: 'Копровая установка буровая' },
    { id: 'eq-kopernik-sd20', name: 'Kopernik SD-20', model: 'SD-20', qty: 1, desc: 'Самоходная установка' },
  ];

  for (const eq of equipmentList) {
    await db.equipment.upsert({
      where: { id: eq.id },
      update: {},
      create: { id: eq.id, name: eq.name, model: eq.model, qty: eq.qty, description: eq.desc, isActive: true },
    });
  }
  console.log(`   ✅ ${equipmentList.length} Equipment items`);

  // ============================================================
  // 3. Users
  // ============================================================
  console.log('\n👤 Creating users...');

  const users = [
    { email: 'admin@piling.ru', password: 'admin123', name: 'Администратор', role: 'ADMIN' as const, phone: '+7-900-000-0001' },
    { email: 'dispatch@piling.ru', password: '2222', name: 'Петрова Д.В.', role: 'DISPATCHER' as const, phone: '+7-900-000-0002' },
    { email: 'operator@piling.ru', password: 'operator123', name: 'Иванов И.П.', role: 'OPERATOR' as const, phone: '+7-900-100-0001' },
    { email: 'sas02@rambler.ru', password: '1111', name: 'Герасимов Сергей', role: 'OPERATOR' as const, phone: '+7-900-100-0002' },
    { email: 'helper@piling.ru', password: '3333', name: 'Сидоров К.А.', role: 'ASSISTANT' as const, phone: '+7-900-200-0001' },
  ];

  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, phone: u.phone },
      create: { email: u.email, password: hashSync(u.password, 12), name: u.name, role: u.role, phone: u.phone },
    });
  }
  console.log(`   ✅ ${users.length} Users`);

  // Get user IDs
  const admin = await db.user.findUnique({ where: { email: 'admin@piling.ru' } });
  const dispatcher = await db.user.findUnique({ where: { email: 'dispatch@piling.ru' } });
  const operator1 = await db.user.findUnique({ where: { email: 'operator@piling.ru' } });
  const operator2 = await db.user.findUnique({ where: { email: 'sas02@rambler.ru' } });
  const assistant = await db.user.findUnique({ where: { email: 'helper@piling.ru' } });

  // ============================================================
  // 4. Sites with Hierarchy
  // ============================================================
  console.log('\n🏗️  Creating sites...');

  const site1 = await db.site.upsert({
    where: { id: 'site-mkad' },
    update: {},
    create: { id: 'site-mkad', name: 'МКАД-Юг, Участок 3', plannedPiles: 240, plannedDrilling: 180.5, status: 'ACTIVE', isActive: true },
  });

  const site2 = await db.site.upsert({
    where: { id: 'site-m11' },
    update: {},
    create: { id: 'site-m11', name: 'М-11, Переезд через реку', plannedPiles: 150, plannedDrilling: 120, status: 'ACTIVE', isActive: true },
  });

  const site3 = await db.site.upsert({
    where: { id: 'site-luzhnik' },
    update: {},
    create: { id: 'site-luzhnik', name: 'Лужники, Реконструкция', plannedPiles: 300, plannedDrilling: 200, status: 'ACTIVE', isActive: true },
  });

  console.log(`   ✅ 3 Sites`);

  // Site 1 Hierarchy: Field → Clusters → Pickets
  const field1 = await db.pileField.upsert({
    where: { id: 'field-1' },
    update: {},
    create: { id: 'field-1', name: 'Свайное поле №1', siteId: site1.id },
  });

  const clusterA = await db.cluster.upsert({
    where: { id: 'cluster-A' },
    update: {},
    create: { id: 'cluster-A', name: 'Куст А', fieldId: field1.id },
  });

  const clusterB = await db.cluster.upsert({
    where: { id: 'cluster-B' },
    update: {},
    create: { id: 'cluster-B', name: 'Куст Б', fieldId: field1.id },
  });

  const picketsA = ['Пикет 1', 'Пикет 2', 'Пикет 3', 'Пикет 4', 'Пикет 5'];
  for (const name of picketsA) {
    await db.picket.upsert({
      where: { id: `picket-${name}` },
      update: {},
      create: { id: `picket-${name}`, name, clusterId: clusterA.id },
    });
  }

  const picketsB = ['Пикет 6', 'Пикет 7', 'Пикет 8'];
  for (const name of picketsB) {
    await db.picket.upsert({
      where: { id: `picket-${name}` },
      update: {},
      create: { id: `picket-${name}`, name, clusterId: clusterB.id },
    });
  }

  console.log(`   ✅ 1 Field, 2 Clusters, 8 Pickets`);

  // Site Plans
  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-1' },
    update: {},
    create: { siteId: site1.id, pileGradeId: 'pg-СВ 120-35', count: 100, metersPerUnit: 12 },
  });
  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-2' },
    update: {},
    create: { siteId: site1.id, pileGradeId: 'pg-СВ 150-50', count: 80, metersPerUnit: 15 },
  });
  await db.siteDrillingPlan.upsert({
    where: { id: 'plan-drill-1' },
    update: {},
    create: { siteId: site1.id, diameter: 150, count: 120, metersPerUnit: 8 },
  });

  console.log(`   ✅ Site plans created`);

  // ============================================================
  // 5. User-Site Assignments
  // ============================================================
  console.log('\n🔗 Assigning users to sites...');

  const assignments = [
    { userId: operator1!.id, siteId: site1.id },
    { userId: admin!.id, siteId: site1.id },
    { userId: operator1!.id, siteId: site2.id },
    { userId: operator2!.id, siteId: site1.id },
    { userId: dispatcher!.id, siteId: site1.id },
    { userId: operator2!.id, siteId: site3.id },
  ];

  for (const a of assignments) {
    await db.userSiteAssignment.upsert({
      where: { userId_siteId: a },
      update: {},
      create: a,
    });
  }
  console.log(`   ✅ ${assignments.length} assignments`);

  // ============================================================
  // 6. Crews
  // ============================================================
  console.log('\n👷 Creating crews...');

  const crew1 = await db.crew.upsert({
    where: { id: 'crew-ivanov' },
    update: {},
    create: {
      id: 'crew-ivanov',
      name: 'Экипаж Иванова',
      operatorId: operator1!.id,
      equipmentId: 'eq-pve-50pr',
      siteId: site1.id,
      isActive: true,
    },
  });

  await db.crewAssistant.deleteMany({ where: { crewId: crew1.id } });
  await db.crewAssistant.createMany({
    data: [
      { crewId: crew1.id, name: 'Сидоров К.А.' },
      { crewId: crew1.id, name: 'Козлов М.В.' },
    ],
  });

  const crew2 = await db.crew.upsert({
    where: { id: 'crew-gerasimov' },
    update: {},
    create: {
      id: 'crew-gerasimov',
      name: 'Экипаж Герасимова',
      operatorId: operator2!.id,
      equipmentId: 'eq-lrh-100-1',
      siteId: site1.id,
      isActive: true,
    },
  });

  await db.crewAssistant.deleteMany({ where: { crewId: crew2.id } });
  await db.crewAssistant.createMany({
    data: [{ crewId: crew2.id, name: 'Морозов А.Н.' }],
  });

  console.log(`   ✅ 2 Crews with assistants`);

  // ============================================================
  // 7. Reports with Data
  // ============================================================
  console.log('\n📊 Creating reports...');

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Report 1 — Today, operator1, site1, with piles + drillings
  const report1 = await db.report.create({
    data: {
      reportId: `rpt-${todayStr}-001`,
      userId: operator1!.id,
      crewId: crew1.id,
      equipmentId: 'eq-pve-50pr',
      siteId: site1.id,
      date: todayStr,
      shiftType: 'DAY',
      shiftStart: '08:00',
      shiftEnd: '20:00',
      status: 'submitted',
      lastEditedById: operator1!.id,
      lastEditedByName: 'Иванов И.П.',
      lastEditedByRole: 'OPERATOR',
      piles: {
        create: [
          { picketId: 'picket-Пикет 1', pileGradeId: 'pg-СВ 120-35', count: 5 },
          { picketId: 'picket-Пикет 2', pileGradeId: 'pg-СВ 150-50', count: 3 },
        ],
      },
      drillings: {
        create: [
          { picketId: 'picket-Пикет 3', typeId: 'dt-Лидерное бурение d=150мм', count: 2, metersPerUnit: 8, meters: 16 },
        ],
      },
      downtimes: {
        create: [
          { reasonId: 'dr-Переезд установки', duration: 45, comment: 'Переезд на новый куст' },
        ],
      },
    },
  });
  console.log(`   ✅ Report 1: ${report1.reportId} (5 piles, 3 piles, 1 drilling, 1 downtime)`);

  // Report 2 — Yesterday, operator2, site1
  const report2 = await db.report.create({
    data: {
      reportId: `rpt-${yesterdayStr}-001`,
      userId: operator2!.id,
      crewId: crew2.id,
      equipmentId: 'eq-lrh-100-1',
      siteId: site1.id,
      date: yesterdayStr,
      shiftType: 'DAY',
      shiftStart: '07:00',
      shiftEnd: '19:00',
      status: 'submitted',
      lastEditedById: operator2!.id,
      lastEditedByName: 'Герасимов Сергей',
      lastEditedByRole: 'OPERATOR',
      piles: {
        create: [
          { picketId: 'picket-Пикет 4', pileGradeId: 'pg-СВ 200-60', count: 8 },
          { picketId: 'picket-Пикет 5', pileGradeId: 'pg-СВ 120-35', count: 4 },
          { picketId: 'picket-Пикет 6', pileGradeId: 'pg-СВ 300-80', count: 2 },
        ],
      },
      drillings: {
        create: [
          { typeId: 'dt-Лидерное бурение d=200мм', count: 3, metersPerUnit: 10, meters: 30 },
        ],
      },
      downtimes: {
        create: [
          { reasonId: 'dr-Плохие погодные условия', duration: 120, comment: 'Снегопад' },
          { reasonId: 'dr-Ремонт установки', duration: 60, comment: 'Замена гидравлики' },
        ],
      },
    },
  });
  console.log(`   ✅ Report 2: ${report2.reportId} (14 piles, 1 drilling, 2 downtimes)`);

  // Report 3 — Today, operator1, site1, night shift
  const report3 = await db.report.create({
    data: {
      reportId: `rpt-${todayStr}-002`,
      userId: operator1!.id,
      crewId: crew1.id,
      equipmentId: 'eq-pve-50pr',
      siteId: site1.id,
      date: todayStr,
      shiftType: 'NIGHT',
      shiftStart: '20:00',
      shiftEnd: '06:00',
      status: 'draft',
      lastEditedById: operator1!.id,
      lastEditedByName: 'Иванов И.П.',
      lastEditedByRole: 'OPERATOR',
      piles: {
        create: [
          { pileGradeId: 'pg-СВ 120-35', count: 3 },
        ],
      },
      downtimes: {
        create: [
          { reasonId: 'dr-Отсутствие свай на складе', duration: 90, comment: 'Ожидание поставки' },
        ],
      },
    },
  });
  console.log(`   ✅ Report 3: ${report3.reportId} (night shift, draft)`);

  // Report 4 — Yesterday, operator2, site3
  const report4 = await db.report.create({
    data: {
      reportId: `rpt-${yesterdayStr}-002`,
      userId: operator2!.id,
      equipmentId: 'eq-kburg-1602-1',
      siteId: site3.id,
      date: yesterdayStr,
      shiftType: 'NIGHT',
      shiftStart: '20:00',
      shiftEnd: '06:00',
      status: 'submitted',
      lastEditedById: operator2!.id,
      lastEditedByName: 'Герасимов Сергей',
      lastEditedByRole: 'OPERATOR',
      piles: {
        create: [
          { pileGradeId: 'pg-СВ 150-50', count: 6 },
          { pileGradeId: 'pg-СВ 200-60', count: 4 },
        ],
      },
      drillings: {
        create: [
          { typeId: 'dt-Расширение скважины', count: 1, metersPerUnit: 12, meters: 12 },
        ],
      },
    },
  });
  console.log(`   ✅ Report 4: ${report4.reportId} (site3, night shift)`);

  // Report 5 — 2 days ago, operator1, site1
  const twoDaysAgo = new Date(today); twoDaysAgo.setDate(today.getDate() - 2);
  const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

  const report5 = await db.report.create({
    data: {
      reportId: `rpt-${twoDaysAgoStr}-001`,
      userId: operator1!.id,
      crewId: crew1.id,
      equipmentId: 'eq-pve-50pr',
      siteId: site1.id,
      date: twoDaysAgoStr,
      shiftType: 'DAY',
      shiftStart: '08:00',
      shiftEnd: '20:00',
      status: 'submitted',
      lastEditedById: operator1!.id,
      lastEditedByName: 'Иванов И.П.',
      lastEditedByRole: 'OPERATOR',
      piles: {
        create: [
          { picketId: 'picket-Пикет 7', pileGradeId: 'pg-СВ 120-35', count: 7 },
          { picketId: 'picket-Пикет 8', pileGradeId: 'pg-СВ 150-50', count: 5 },
        ],
      },
      drillings: {
        create: [
          { typeId: 'dt-Лидерное бурение d=150мм', count: 4, metersPerUnit: 8, meters: 32 },
        ],
      },
    },
  });
  console.log(`   ✅ Report 5: ${report5.reportId} (2 days ago)`);

  // ============================================================
  // 8. Final Summary
  // ============================================================
  console.log('\n' + '═'.repeat(50));
  console.log('🌱 SEED COMPLETE');
  console.log('═'.repeat(50));

  const [userCount, siteCount, equipCount, crewCount, reportCount, pileGradeCount, drillingCount, downtimeCount] = await Promise.all([
    db.user.count(),
    db.site.count(),
    db.equipment.count(),
    db.crew.count(),
    db.report.count(),
    db.pileGrade.count(),
    db.drillingType.count(),
    db.downtimeReason.count(),
  ]);

  console.log(`  Users:            ${userCount}`);
  console.log(`  Sites:            ${siteCount}`);
  console.log(`  Equipment:        ${equipCount}`);
  console.log(`  Crews:            ${crewCount}`);
  console.log(`  Reports:          ${reportCount}`);
  console.log(`  Pile Grades:      ${pileGradeCount}`);
  console.log(`  Drilling Types:   ${drillingCount}`);
  console.log(`  Downtime Reasons: ${downtimeCount}`);
  console.log('═'.repeat(50));
}

seed()
  .catch((error) => {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
