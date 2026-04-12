/**
 * Full database population script — PilingTrack
 * Fills all entities and creates proper relationships.
 */
import { PrismaClient } from '../src/generated/postgres-client';
import { hashSync } from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  console.log('🌱 Full database population...\n');

  // ============================================================
  // 1. Get existing users
  // ============================================================
  console.log('👤 Fetching users...');
  const users = await db.user.findMany();
  const byEmail = (email: string) => users.find(u => u.email === email)!;

  // Main users
  const admin = byEmail('admin@piling.ru');
  const dispatcher = byEmail('dispatch@piling.ru');
  const operator1 = byEmail('operator@piling.ru');  // Иванов
  const operator2 = byEmail('sas02@rambler.ru');    // Герасимов
  const operator3 = byEmail('mag@piling.ru');       // Митрофанов
  const operator4 = byEmail('ivv@piling.ru');       // Игнатьев
  const operator5 = byEmail('apj@piling.ru');       // Андреев
  const assistant1 = byEmail('helper@piling.ru');   // Сидоров
  const assistant2 = byEmail('kn@piling.ru');       // Курнаков
  const assistant3 = byEmail('tr@piling.ru');       // Токсубаев
  const assistant4 = byEmail('sas@piling.ru');      // Солдатов

  console.log(`   ✅ ${users.length} users loaded\n`);

  // ============================================================
  // 2. Clean and re-seed Equipment (remove duplicates)
  // ============================================================
  console.log('🚜 Cleaning & seeding equipment...');
  
  // Delete dependent data first
  await db.reportDowntime.deleteMany();
  await db.leaderDrilling.deleteMany();
  await db.pileWork.deleteMany();
  await db.report.deleteMany();
  await db.crew.deleteMany();
  await db.equipment.deleteMany();

  const equipmentData = [
    { id: 'eq-pve-50pr', name: 'PVE 50PR', model: 'PVE 50PR', qty: 1, description: 'Вибропогружатель забивной', isActive: true },
    { id: 'eq-lrh-100-1', name: 'Liebherr LRH 100 №1 (2013г. №115127)', model: 'LRH 100', qty: 1, description: 'Роторный гусеничный кран', isActive: true },
    { id: 'eq-lrh-100-2', name: 'Liebherr LRH 100 №2 (2009г. №115103)', model: 'LRH 100', qty: 1, description: 'Роторный гусеничный кран', isActive: true },
    { id: 'eq-kburg-1602-1', name: 'КБУРГ-16.02 №1 (2025г. Volvo-360 №208)', model: 'КБУРГ-16.02', qty: 1, description: 'Копровая установка буровая', isActive: true },
    { id: 'eq-kburg-1602-2', name: 'КБУРГ-16.02 №2 (2018г. №09)', model: 'КБУРГ-16.02', qty: 1, description: 'Копровая установка буровая', isActive: true },
    { id: 'eq-kopernik-sd20', name: 'Kopernik SD-20', model: 'SD-20', qty: 1, description: 'Самоходная установка', isActive: true },
  ];

  for (const eq of equipmentData) {
    await db.equipment.create({ data: eq });
  }
  console.log(`   ✅ ${equipmentData.length} equipment items\n`);

  // ============================================================
  // 3. Clean and re-seed Sites (remove duplicates)
  // ============================================================
  console.log('🏗️ Cleaning & seeding sites...');
  
  // Delete related data
  await db.picket.deleteMany();
  await db.cluster.deleteMany();
  await db.pileField.deleteMany();
  await db.userSiteAssignment.deleteMany();
  await db.site.deleteMany();

  const sites = [
    {
      id: 'site-mkad',
      name: 'МКАД-Юг, Участок 3',
      plannedPiles: 240,
      plannedDrilling: 180.5,
      status: 'ACTIVE',
      isActive: true,
      fields: [
        {
          id: 'field-mkad-1',
          name: 'Свайное поле №1',
          clusters: [
            { id: 'cluster-mkad-a', name: 'Куст А', pickets: ['Пикет 1', 'Пикет 2', 'Пикет 3', 'Пикет 4', 'Пикет 5'] },
            { id: 'cluster-mkad-b', name: 'Куст Б', pickets: ['Пикет 6', 'Пикет 7', 'Пикет 8'] },
          ]
        }
      ]
    },
    {
      id: 'site-m11',
      name: 'М-11, Переезд через реку',
      plannedPiles: 150,
      plannedDrilling: 120,
      status: 'ACTIVE',
      isActive: true,
      fields: [
        {
          id: 'field-m11-1',
          name: 'Свайное поле №1',
          clusters: [
            { id: 'cluster-m11-a', name: 'Куст В', pickets: ['Пикет 10', 'Пикет 11', 'Пикет 12'] },
          ]
        }
      ]
    },
    {
      id: 'site-vzhm',
      name: 'ВСЖМ, Вышний Волочек',
      plannedPiles: 1000,
      plannedDrilling: 800,
      status: 'ACTIVE',
      isActive: true,
      fields: [
        {
          id: 'field-vzhm-1',
          name: 'Свайное поле №1',
          clusters: [
            { id: 'cluster-vzhm-a', name: 'Куст Г', pickets: ['Пикет 20', 'Пикет 21', 'Пикет 22', 'Пикет 23'] },
            { id: 'cluster-vzhm-b', name: 'Куст Д', pickets: ['Пикет 24', 'Пикет 25'] },
          ]
        }
      ]
    },
    {
      id: 'site-vsmzh',
      name: 'ВСМЖ, Великий Новгород',
      plannedPiles: 500,
      plannedDrilling: 400,
      status: 'ACTIVE',
      isActive: true,
      fields: [
        {
          id: 'field-vsmzh-1',
          name: 'Свайное поле №1',
          clusters: [
            { id: 'cluster-vsmzh-a', name: 'Куст Е', pickets: ['Пикет 30', 'Пикет 31', 'Пикет 32'] },
          ]
        }
      ]
    },
  ];

  for (const siteData of sites) {
    const { fields, ...siteInfo } = siteData;
    await db.site.create({ data: { ...siteInfo } });

    for (const fieldData of fields) {
      const { clusters, ...fieldInfo } = fieldData;
      await db.pileField.create({ data: { ...fieldInfo, siteId: siteData.id } });

      for (const clusterData of clusters) {
        const { pickets, ...clusterInfo } = clusterData;
        await db.cluster.create({ data: { ...clusterInfo, fieldId: fieldData.id } });

        for (const picketName of pickets) {
          await db.picket.create({ data: { id: `picket-${picketName}`, name: picketName, clusterId: clusterData.id } });
        }
      }
    }
  }
  console.log(`   ✅ ${sites.length} sites with hierarchy\n`);

  // ============================================================
  // 4. Crews with Equipment & Assistants
  // ============================================================
  console.log('👷 Creating crews with equipment & assistants...');

  const crewsData = [
    {
      id: 'crew-ivanov',
      name: 'Экипаж Иванова',
      operatorId: operator1.id,  // Иванов И.П.
      equipmentId: 'eq-kburg-1602-1',
      siteId: 'site-mkad',
      assistants: ['Сидоров К.А.'],
    },
    {
      id: 'crew-gerasimov',
      name: 'Экипаж Герасимова',
      operatorId: operator2.id,  // Герасимов
      equipmentId: 'eq-kburg-1602-2',
      siteId: 'site-mkad',
      assistants: ['Курнаков Николай'],
    },
    {
      id: 'crew-mitrofanov',
      name: 'Экипаж Митрофанова',
      operatorId: operator3.id,  // Митрофанов
      equipmentId: 'eq-lrh-100-1',
      siteId: 'site-m11',
      assistants: ['Токсубаев Роман'],
    },
    {
      id: 'crew-ignatiev',
      name: 'Экипаж Игнатьева',
      operatorId: operator4.id,  // Игнатьев
      equipmentId: 'eq-lrh-100-2',
      siteId: 'site-vzhm',
      assistants: ['Солдатов Александр С.'],
    },
    {
      id: 'crew-andreev',
      name: 'Экипаж Андреева',
      operatorId: operator5.id,  // Андреев
      equipmentId: 'eq-kopernik-sd20',
      siteId: 'site-vsmzh',
      assistants: [],
    },
  ];

  for (const crewData of crewsData) {
    const { assistants, ...crewInfo } = crewData;
    
    await db.crew.create({
      data: {
        ...crewInfo,
        assistants: { create: assistants.map(name => ({ name })) },
      }
    });
  }
  console.log(`   ✅ ${crewsData.length} crews created\n`);

  // ============================================================
  // 5. Assign users to sites
  // ============================================================
  console.log('🔗 Assigning users to sites...');

  const siteUsers = [
    { userId: admin.id, siteId: 'site-mkad' },
    { userId: dispatcher.id, siteId: 'site-mkad' },
    { userId: operator1.id, siteId: 'site-mkad' },
    { userId: operator2.id, siteId: 'site-mkad' },
    { userId: assistant1.id, siteId: 'site-mkad' },
    { userId: assistant2.id, siteId: 'site-mkad' },
    { userId: operator3.id, siteId: 'site-m11' },
    { userId: assistant3.id, siteId: 'site-m11' },
    { userId: operator4.id, siteId: 'site-vzhm' },
    { userId: assistant4.id, siteId: 'site-vzhm' },
    { userId: operator5.id, siteId: 'site-vsmzh' },
    { userId: dispatcher.id, siteId: 'site-vzhm' },
    { userId: dispatcher.id, siteId: 'site-m11' },
    { userId: dispatcher.id, siteId: 'site-vsmzh' },
  ];

  for (const su of siteUsers) {
    await db.userSiteAssignment.create({ data: su });
  }
  console.log(`   ✅ ${siteUsers.length} assignments\n`);

  // ============================================================
  // 6. Create sample reports
  // ============================================================
  console.log('📝 Creating reports...');
  
  const crew1 = await db.crew.findUnique({ where: { id: 'crew-ivanov' } });
  const crew2 = await db.crew.findUnique({ where: { id: 'crew-gerasimov' } });

  const pileGrade1 = await db.pileGrade.findFirst({ where: { name: 'СВ 120-35' } });
  const pileGrade2 = await db.pileGrade.findFirst({ where: { name: 'СВ 150-50' } });
  const drilling1 = await db.drillingType.findFirst({ where: { name: 'Лидерное бурение d=150мм' } });
  const drilling2 = await db.drillingType.findFirst({ where: { name: 'Лидерное бурение d=200мм' } });
  const downtime1 = await db.downtimeReason.findFirst({ where: { name: 'Переезд установки' } });

  const reports = [
    {
      id: 'report-1',
      reportId: 'RPT-2026-04-09-001',
      date: '2026-04-09',
      siteId: 'site-mkad',
      crewId: 'crew-ivanov',
      userId: operator1.id,
      shiftType: 'DAY',
      shiftStart: '07:00',
      shiftEnd: '19:00',
      status: 'submitted',
      piles: [
        { picketId: 'picket-Пикет 1', pileGradeId: pileGrade1!.id, count: 3 },
        { picketId: 'picket-Пикет 2', pileGradeId: pileGrade1!.id, count: 2 },
      ],
      drillings: [
        { typeId: drilling1!.id, count: 5, metersPerUnit: 12, meters: 60 },
      ],
      downtimes: [
        { reasonId: downtime1!.id, duration: 45, comment: 'Переезд между кустами' },
      ],
    },
    {
      id: 'report-2',
      reportId: 'RPT-2026-04-09-002',
      date: '2026-04-09',
      siteId: 'site-mkad',
      crewId: 'crew-gerasimov',
      userId: operator2.id,
      shiftType: 'DAY',
      shiftStart: '07:00',
      shiftEnd: '19:00',
      status: 'submitted',
      piles: [
        { picketId: 'picket-Пикет 6', pileGradeId: pileGrade2!.id, count: 4 },
      ],
      drillings: [],
      downtimes: [],
    },
    {
      id: 'report-3',
      reportId: 'RPT-2026-04-10-001',
      date: '2026-04-10',
      siteId: 'site-m11',
      crewId: 'crew-mitrofanov',
      userId: operator3.id,
      shiftType: 'DAY',
      shiftStart: '06:00',
      shiftEnd: '18:00',
      status: 'draft',
      piles: [
        { picketId: 'picket-Пикет 10', pileGradeId: pileGrade1!.id, count: 5 },
      ],
      drillings: [
        { typeId: drilling2!.id, count: 3, metersPerUnit: 15, meters: 45 },
      ],
      downtimes: [],
    },
  ];

  for (const r of reports) {
    const { piles, drillings, downtimes, ...reportInfo } = r;
    
    await db.report.create({
      data: {
        ...reportInfo,
        piles: { create: piles },
        drillings: { create: drillings },
        downtimes: { create: downtimes },
      }
    });
  }
  console.log(`   ✅ ${reports.length} reports created\n`);

  // ============================================================
  // 7. Summary
  // ============================================================
  console.log('\n=== POPULATION SUMMARY ===');
  const stats = {
    users: await db.user.count(),
    sites: await db.site.count(),
    fields: await db.pileField.count(),
    clusters: await db.cluster.count(),
    pickets: await db.picket.count(),
    equipment: await db.equipment.count(),
    crews: await db.crew.count(),
    pileGrades: await db.pileGrade.count(),
    drillingTypes: await db.drillingType.count(),
    downtimeReasons: await db.downtimeReason.count(),
    reports: await db.report.count(),
    pileWorks: await db.pileWork.count(),
    leaderDrillings: await db.leaderDrilling.count(),
    reportDowntimes: await db.reportDowntime.count(),
    siteAssignments: await db.userSiteAssignment.count(),
  };

  console.log('┌──────────────────────┬────────────┐');
  console.log('│ Сущность             │ Количество │');
  console.log('├──────────────────────┼────────────┤');
  const labels: Record<string, string> = {
    users: '👤 Users',
    sites: '🏗️ Sites',
    fields: '📋 Pile Fields',
    clusters: '🔶 Clusters',
    pickets: '📍 Pickets',
    equipment: '🚜 Equipment',
    crews: '👷 Crews',
    pileGrades: '🔷 Pile Grades',
    drillingTypes: '🔩 Drilling Types',
    downtimeReasons: '⏸️ Downtime Reasons',
    reports: '📝 Reports',
    pileWorks: '  Pile Works',
    leaderDrillings: '  Drillings',
    reportDowntimes: '  Downtimes',
    siteAssignments: '🔗 Site-User Links',
  };
  for (const [key, label] of Object.entries(labels)) {
    console.log(`│ ${label.padEnd(20)} │ ${String(stats[key as keyof typeof stats]).padStart(10)} │`);
  }
  console.log('└──────────────────────┴────────────┘');

  console.log('\n✅ Database fully populated!');
}

main().then(() => db.$disconnect()).catch((e) => {
  console.error('❌ Seed failed:', e.message);
  process.exit(1);
});
