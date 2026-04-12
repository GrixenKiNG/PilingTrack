import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const db = new PrismaClient();

/**
 * Generate a random secure password.
 */
function generatePassword(length = 16): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

/**
 * Prevent seeding in production environment.
 */
function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Seeding is disabled in production. Use migrations for schema changes.');
    process.exit(1);
  }
}

function hashPassword(password: string): string {
  return hashSync(password, 12); // Increased from 10 to 12 rounds
}

async function seed() {
  assertNotProduction();
  console.log('Seeding database...');

  // Generate random passwords for seed users
  const adminPassword = generatePassword();
  const dispatcherPassword = generatePassword();
  const operator1Password = generatePassword();
  const operator2Password = generatePassword();
  const assistantPassword = generatePassword();

  console.log('⚠️  Generated passwords (save these for testing):');
  console.log(`   admin@piling.ru: ${adminPassword}`);
  console.log(`   dispatch@piling.ru: ${dispatcherPassword}`);
  console.log(`   operator@piling.ru: ${operator1Password}`);
  console.log(`   sas02@rambler.ru: ${operator2Password}`);
  console.log(`   helper@piling.ru: ${assistantPassword}`);

  const admin = await db.user.upsert({
    where: { email: 'admin@piling.ru' },
    update: {
      name: 'Администратор',
      role: 'ADMIN',
      phone: '+7-900-000-0001',
    },
    create: {
      email: 'admin@piling.ru',
      password: hashPassword(adminPassword),
      name: 'Администратор',
      role: 'ADMIN',
      phone: '+7-900-000-0001',
    },
  });

  const dispatcher = await db.user.upsert({
    where: { email: 'dispatch@piling.ru' },
    update: {
      name: 'Петрова Д.В.',
      role: 'DISPATCHER',
      phone: '+7-900-000-0002',
    },
    create: {
      email: 'dispatch@piling.ru',
      password: hashPassword(dispatcherPassword),
      name: 'Петрова Д.В.',
      role: 'DISPATCHER',
      phone: '+7-900-000-0002',
    },
  });

  const operator1 = await db.user.upsert({
    where: { email: 'operator@piling.ru' },
    update: {
      name: 'Иванов И.П.',
      role: 'OPERATOR',
      phone: '+7-900-100-0001',
    },
    create: {
      email: 'operator@piling.ru',
      password: hashPassword(operator1Password),
      name: 'Иванов И.П.',
      role: 'OPERATOR',
      phone: '+7-900-100-0001',
    },
  });

  const operator2 = await db.user.upsert({
    where: { email: 'sas02@rambler.ru' },
    update: {
      name: 'Герасимов Сергей',
      role: 'OPERATOR',
      phone: '+7-900-100-0002',
    },
    create: {
      email: 'sas02@rambler.ru',
      password: hashPassword(operator2Password),
      name: 'Герасимов Сергей',
      role: 'OPERATOR',
      phone: '+7-900-100-0002',
    },
  });

  const assistant = await db.user.upsert({
    where: { email: 'helper@piling.ru' },
    update: {
      name: 'Сидоров К.А.',
      role: 'ASSISTANT',
      phone: '+7-900-200-0001',
    },
    create: {
      email: 'helper@piling.ru',
      password: hashPassword(assistantPassword),
      name: 'Сидоров К.А.',
      role: 'ASSISTANT',
      phone: '+7-900-200-0001',
    },
  });

  console.log(`Users: ${[admin, dispatcher, operator1, operator2, assistant].length}`);

  const pileGrades = [
    'СВ 120-35',
    'СВ 150-50',
    'СВ 200-60',
    'СВ 300-80',
    'СВ 400-100',
  ];

  for (const name of pileGrades) {
    await db.pileGrade.upsert({
      where: { id: `pg-${name}` },
      update: { name, isActive: true },
      create: { id: `pg-${name}`, name, isActive: true },
    });
  }

  const drillingTypes = [
    'Лидерное бурение d=150мм',
    'Лидерное бурение d=200мм',
    'Расширение скважины',
  ];

  for (const name of drillingTypes) {
    await db.drillingType.upsert({
      where: { id: `dt-${name}` },
      update: { name, isActive: true },
      create: { id: `dt-${name}`, name, isActive: true },
    });
  }

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

  console.log('Dictionaries seeded');

  const equipmentItems = [
    {
      id: 'eq-pve-50pr',
      name: 'PVE 50PR',
      model: 'PVE 50PR',
      qty: 1,
      description: 'Вибропогружатель забивной',
    },
    {
      id: 'eq-lrh-100-1',
      name: 'Liebherr LRH 100 №1',
      model: 'LRH 100',
      qty: 1,
      description: 'Роторный гусеничный кран',
    },
    {
      id: 'eq-lrh-100-2',
      name: 'Liebherr LRH 100 №2',
      model: 'LRH 100',
      qty: 1,
      description: 'Роторный гусеничный кран',
    },
    {
      id: 'eq-kburg-1602-1',
      name: 'КБУРГ-16.02 №1',
      model: 'КБУРГ-16.02',
      qty: 1,
      description: 'Копровая установка буровая',
    },
    {
      id: 'eq-kburg-1602-2',
      name: 'КБУРГ-16.02 №2',
      model: 'КБУРГ-16.02',
      qty: 1,
      description: 'Копровая установка буровая',
    },
    {
      id: 'eq-kopernik-sd20',
      name: 'Kopernik-SD-20',
      model: 'SD-20',
      qty: 1,
      description: 'Самоходная установка',
    },
  ];

  for (const equipment of equipmentItems) {
    await db.equipment.upsert({
      where: { id: equipment.id },
      update: {
        name: equipment.name,
        model: equipment.model,
        qty: equipment.qty,
        description: equipment.description,
        isActive: true,
      },
      create: {
        ...equipment,
        isActive: true,
      },
    });
  }

  console.log(`Equipment: ${equipmentItems.length}`);

  const site1 = await db.site.upsert({
    where: { id: 'site-demo-1' },
    update: {
      name: 'МКАД-Юг, Участок 3',
      plannedPiles: 240,
      plannedDrilling: 180.5,
      status: 'ACTIVE',
      isActive: true,
    },
    create: {
      id: 'site-demo-1',
      name: 'МКАД-Юг, Участок 3',
      plannedPiles: 240,
      plannedDrilling: 180.5,
      status: 'ACTIVE',
      isActive: true,
    },
  });

  const site2 = await db.site.upsert({
    where: { id: 'site-demo-2' },
    update: {
      name: 'М-11, Переезд через реку',
      plannedPiles: 150,
      plannedDrilling: 120,
      status: 'ACTIVE',
      isActive: true,
    },
    create: {
      id: 'site-demo-2',
      name: 'М-11, Переезд через реку',
      plannedPiles: 150,
      plannedDrilling: 120,
      status: 'ACTIVE',
      isActive: true,
    },
  });

  const field = await db.pileField.upsert({
    where: { id: 'field-1' },
    update: { name: 'Свайное поле №1', siteId: site1.id },
    create: { id: 'field-1', name: 'Свайное поле №1', siteId: site1.id },
  });

  const cluster1 = await db.cluster.upsert({
    where: { id: 'cluster-1' },
    update: { name: 'Куст А', fieldId: field.id },
    create: { id: 'cluster-1', name: 'Куст А', fieldId: field.id },
  });

  const cluster2 = await db.cluster.upsert({
    where: { id: 'cluster-2' },
    update: { name: 'Куст Б', fieldId: field.id },
    create: { id: 'cluster-2', name: 'Куст Б', fieldId: field.id },
  });

  const picketsA = ['Пикет 1', 'Пикет 2', 'Пикет 3', 'Пикет 4', 'Пикет 5'];
  const picketsB = ['Пикет 6', 'Пикет 7', 'Пикет 8'];

  for (const picketName of picketsA) {
    await db.picket.upsert({
      where: { id: `picket-${picketName}` },
      update: { name: picketName, clusterId: cluster1.id },
      create: { id: `picket-${picketName}`, name: picketName, clusterId: cluster1.id },
    });
  }

  for (const picketName of picketsB) {
    await db.picket.upsert({
      where: { id: `picket-${picketName}` },
      update: { name: picketName, clusterId: cluster2.id },
      create: { id: `picket-${picketName}`, name: picketName, clusterId: cluster2.id },
    });
  }

  console.log('Site hierarchy created');

  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-site1-sv120' },
    update: { siteId: site1.id, pileGradeId: 'pg-СВ 120-35', count: 100, metersPerUnit: 12 },
    create: {
      id: 'plan-pile-site1-sv120',
      siteId: site1.id,
      pileGradeId: 'pg-СВ 120-35',
      count: 100,
      metersPerUnit: 12,
    },
  });

  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-site1-sv150' },
    update: { siteId: site1.id, pileGradeId: 'pg-СВ 150-50', count: 80, metersPerUnit: 15 },
    create: {
      id: 'plan-pile-site1-sv150',
      siteId: site1.id,
      pileGradeId: 'pg-СВ 150-50',
      count: 80,
      metersPerUnit: 15,
    },
  });

  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-site1-sv200' },
    update: { siteId: site1.id, pileGradeId: 'pg-СВ 200-60', count: 60, metersPerUnit: 20 },
    create: {
      id: 'plan-pile-site1-sv200',
      siteId: site1.id,
      pileGradeId: 'pg-СВ 200-60',
      count: 60,
      metersPerUnit: 20,
    },
  });

  await db.siteDrillingPlan.upsert({
    where: { id: 'plan-drilling-site1-150' },
    update: { siteId: site1.id, diameter: 150, count: 120, metersPerUnit: 8 },
    create: {
      id: 'plan-drilling-site1-150',
      siteId: site1.id,
      diameter: 150,
      count: 120,
      metersPerUnit: 8,
    },
  });

  await db.siteDrillingPlan.upsert({
    where: { id: 'plan-drilling-site1-200' },
    update: { siteId: site1.id, diameter: 200, count: 80, metersPerUnit: 10 },
    create: {
      id: 'plan-drilling-site1-200',
      siteId: site1.id,
      diameter: 200,
      count: 80,
      metersPerUnit: 10,
    },
  });

  console.log('Site plans created');

  const userSiteAssignments = [
    { userId: operator1.id, siteId: site1.id },
    { userId: admin.id, siteId: site1.id },
    { userId: operator1.id, siteId: site2.id },
    { userId: operator2.id, siteId: site1.id },
    { userId: dispatcher.id, siteId: site1.id },
  ];

  for (const assignment of userSiteAssignments) {
    await db.userSiteAssignment.upsert({
      where: {
        userId_siteId: {
          userId: assignment.userId,
          siteId: assignment.siteId,
        },
      },
      update: {},
      create: assignment,
    });
  }

  console.log('User-site assignments created');

  const crew1 = await db.crew.upsert({
    where: { operatorId: operator1.id },
    update: {
      name: 'Экипаж Иванова',
      equipmentId: 'eq-pve-50pr',
      siteId: site1.id,
      isActive: true,
    },
    create: {
      name: 'Экипаж Иванова',
      operatorId: operator1.id,
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
    where: { operatorId: operator2.id },
    update: {
      name: 'Экипаж Герасимова',
      equipmentId: 'eq-lrh-100-1',
      siteId: site1.id,
      isActive: true,
    },
    create: {
      name: 'Экипаж Герасимова',
      operatorId: operator2.id,
      equipmentId: 'eq-lrh-100-1',
      siteId: site1.id,
      isActive: true,
    },
  });

  await db.crewAssistant.deleteMany({ where: { crewId: crew2.id } });
  await db.crewAssistant.createMany({
    data: [{ crewId: crew2.id, name: 'Морозов А.Н.' }],
  });

  console.log('Crews created');
  console.log('Seed complete');
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
