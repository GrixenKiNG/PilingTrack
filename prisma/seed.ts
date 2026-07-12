import { PrismaClient } from '../src/generated/postgres-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashSync } from 'bcryptjs';
import { initializeTenantDictionaries } from '../src/services/dictionaries/tenant-dictionary-initializer';

// Prisma 7 requires an adapter when driverAdapters is set in the schema.
// Without this, `new PrismaClient()` throws and the migrate container had
// to be run with SKIP_SEED=1. Now seed works in dev/CI; prod still skips
// via SKIP_SEED=1 + the assertNotProduction guard below.
const connectionString =
  process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL_POSTGRES (or DATABASE_URL) is required to seed.');
}
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Generate a random secure password.
 */
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

async function seedHydraulicHammerEO(prisma: PrismaClient, tenantId: string) {
  const exists = await prisma.checklistTemplate.findFirst({
    where: { tenantId, name: 'ЕО гидромолота', level: 'EO' },
  });
  if (exists) return;
  await prisma.checklistTemplate.create({
    data: {
      tenantId,
      name: 'ЕО гидромолота',
      level: 'EO',
      appliesToModel: 'HHK7A',
      sections: {
        create: [
          {
            tenantId,
            title: 'Гидросистема',
            order: 0,
            items: {
              create: [
                { tenantId, text: 'РВД без течей и повреждений', answerType: 'YES_NO', required: true, photoRequired: false, order: 0 },
                { tenantId, text: 'Рабочее давление по манометру', answerType: 'MEASURE', unit: 'бар', norm: 'HHK7A ~183, HHK5A ~131', required: true, photoRequired: false, order: 1 },
              ],
            },
          },
          {
            tenantId,
            title: 'Свайный наголовник',
            order: 1,
            items: {
              create: [
                { tenantId, text: 'Наголовник без трещин', answerType: 'STATUS4', required: true, photoRequired: true, order: 0 },
                { tenantId, text: 'Износ демпферной подушки (Ø600 — замена ≤150 мм)', answerType: 'MEASURE', unit: 'мм', norm: 'замена при ≤150 мм', required: true, photoRequired: false, order: 1 },
              ],
            },
          },
          {
            tenantId,
            title: 'Смазка',
            order: 2,
            items: {
              create: [
                { tenantId, text: 'Смазка наголовника и направляющих выполнена', answerType: 'DONE', required: true, photoRequired: false, order: 0 },
              ],
            },
          },
        ],
      },
    },
  });
}

async function seed() {
  assertNotProduction();
  console.log('Seeding database...');

  const tenantId = process.env.DEFAULT_TENANT_ID ?? 'orion';

  // Use fixed passwords for testing
  const adminPassword = 'admin123';
  const dispatcherPassword = 'dispatch123';
  const operator1Password = 'operator123';
  const operator2Password = 'sas02password';
  const assistantPassword = 'helper123';

  console.log('🔑 Fixed passwords for testing:');
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
      password: hashPassword(adminPassword),
    },
    create: {
      tenantId,
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
      password: hashPassword(dispatcherPassword),
    },
    create: {
      tenantId,
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
      password: hashPassword(operator1Password),
    },
    create: {
      tenantId,
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
      password: hashPassword(operator2Password),
    },
    create: {
      tenantId,
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
      password: hashPassword(assistantPassword),
    },
    create: {
      tenantId,
      email: 'helper@piling.ru',
      password: hashPassword(assistantPassword),
      name: 'Сидоров К.А.',
      role: 'ASSISTANT',
      phone: '+7-900-200-0001',
    },
  });

  console.log(`Users: ${[admin, dispatcher, operator1, operator2, assistant].length}`);

  await initializeTenantDictionaries(
    db,
    process.env.DEFAULT_TENANT_ID ?? 'orion'
  );

  console.log('Dictionaries seeded');

  const equipmentItems = [
    {
      id: 'eq-pve-50pr',
      name: 'PVE 50PR',
      model: 'PVE 50PR',
      qty: 1,
      description: 'Гидравлический вибропогружатель PVE 50PR для забивки и извлечения шпунта/свай. Техническая карточка заполнена по открытым каталогам PVE/Woltman и типовой комплектации с силовой станцией.',
      inventoryNumber: 'PT-PVE-001',
      kind: 'VIBRO_HAMMER',
      baseVehicle: null,
      serialNumber: '50PR-DEMO-001',
      manufactureYear: 2019,
      weightTons: 18,
      weightWithEquipmentTons: 22,
      heightMm: 2550,
      lengthMm: 5200,
      widthMm: 2300,
      engineBrand: null,
      engineSerialNumber: null,
      enginePower: null,
      maxPileLength: 18,
      maxDrillingDepth: null,
      hammerType: 'PVE 50PR',
      hammerSerialNumber: 'PVE50PR-DEMO-001',
      hammerEnergyKj: null,
      hammerKind: 'HYDRAULIC',
      isCombined: false,
      heightMeters: 2.55,
      maxPileDiameter: null,
      engineHoursTotal: 8450,
      nextMaintenanceAtHours: 9000,
      homeBaseLocation: 'Склад / база механизации',
    },
    {
      id: 'eq-lrh-100-1',
      name: 'Liebherr LRH 100 №1',
      model: 'LRH 100',
      qty: 1,
      description: 'Гусеничная установка Liebherr LRH 100 для свайных работ и лидерного бурения. Значения — каталожные для семейства LRH 100, фактическая масса зависит от навесного оборудования.',
      inventoryNumber: 'PT-LRH-001',
      kind: 'HYBRID',
      baseVehicle: 'Liebherr LRH 100 carrier',
      serialNumber: 'LRH100-DEMO-001',
      manufactureYear: 2018,
      weightTons: 96,
      weightWithEquipmentTons: 115,
      heightMm: 3400,
      lengthMm: 18750,
      widthMm: 3500,
      engineBrand: 'Liebherr diesel',
      engineSerialNumber: null,
      enginePower: 400,
      maxPileLength: 24.5,
      maxDrillingDepth: 40,
      hammerType: 'Hydraulic hammer / rotary drive',
      hammerSerialNumber: null,
      hammerEnergyKj: null,
      hammerKind: 'HYDRAULIC',
      isCombined: true,
      heightMeters: 24.5,
      maxPileDiameter: 1200,
      engineHoursTotal: 1248,
      nextMaintenanceAtHours: 1500,
      homeBaseLocation: 'Склад / база механизации',
    },
    {
      id: 'eq-lrh-100-2',
      name: 'Liebherr LRH 100 №2',
      model: 'LRH 100',
      qty: 1,
      description: 'Вторая гусеничная установка Liebherr LRH 100: свайные работы, лидерное бурение, работа с гидромолотом/вращателем. Техническая карточка заполнена по каталожным параметрам LRH 100.',
      inventoryNumber: 'PT-LRH-002',
      kind: 'HYBRID',
      baseVehicle: 'Liebherr LRH 100 carrier',
      serialNumber: 'LRH100-DEMO-002',
      manufactureYear: 2018,
      weightTons: 96,
      weightWithEquipmentTons: 115,
      heightMm: 3400,
      lengthMm: 18750,
      widthMm: 3500,
      engineBrand: 'Liebherr diesel',
      engineSerialNumber: null,
      enginePower: 400,
      maxPileLength: 24.5,
      maxDrillingDepth: 40,
      hammerType: 'Hydraulic hammer / rotary drive',
      hammerSerialNumber: null,
      hammerEnergyKj: null,
      hammerKind: 'HYDRAULIC',
      isCombined: true,
      heightMeters: 24.5,
      maxPileDiameter: 1200,
      engineHoursTotal: 1670,
      nextMaintenanceAtHours: 2000,
      homeBaseLocation: 'Склад / база механизации',
    },
    {
      id: 'eq-kburg-1602-1',
      name: 'КБУРГ-16.02 №1',
      model: 'КБУРГ-16.02',
      qty: 1,
      description: 'Копрово-буровая установка КБУРГ-16.02 для лидерного бурения и свайных работ. Открытых паспортных данных мало; заполнены типовые параметры для класса 16-метровых копрово-буровых установок.',
      inventoryNumber: 'PT-KBURG-001',
      kind: 'DRILLING_RIG',
      baseVehicle: 'Гусеничная база / экскаваторный носитель',
      serialNumber: 'KBURG1602-DEMO-001',
      manufactureYear: 2020,
      weightTons: 38,
      weightWithEquipmentTons: 42,
      heightMm: 3200,
      lengthMm: 12500,
      widthMm: 3000,
      engineBrand: 'Diesel',
      engineSerialNumber: null,
      enginePower: 180,
      maxPileLength: 16,
      maxDrillingDepth: 16,
      hammerType: 'Rotary drive',
      hammerSerialNumber: null,
      hammerEnergyKj: null,
      hammerKind: 'NONE',
      isCombined: true,
      heightMeters: 16,
      maxPileDiameter: 800,
      engineHoursTotal: 3120,
      nextMaintenanceAtHours: 3500,
      homeBaseLocation: 'Склад / база механизации',
    },
    {
      id: 'eq-kburg-1602-2',
      name: 'КБУРГ-16.02 №2',
      model: 'КБУРГ-16.02',
      qty: 1,
      description: 'Вторая копрово-буровая установка КБУРГ-16.02. Карточка заполнена типовыми техническими параметрами 16-метровой буровой/копровой установки.',
      inventoryNumber: 'PT-KBURG-002',
      kind: 'DRILLING_RIG',
      baseVehicle: 'Гусеничная база / экскаваторный носитель',
      serialNumber: 'KBURG1602-DEMO-002',
      manufactureYear: 2021,
      weightTons: 38,
      weightWithEquipmentTons: 42,
      heightMm: 3200,
      lengthMm: 12500,
      widthMm: 3000,
      engineBrand: 'Diesel',
      engineSerialNumber: null,
      enginePower: 180,
      maxPileLength: 16,
      maxDrillingDepth: 16,
      hammerType: 'Rotary drive',
      hammerSerialNumber: null,
      hammerEnergyKj: null,
      hammerKind: 'NONE',
      isCombined: true,
      heightMeters: 16,
      maxPileDiameter: 800,
      engineHoursTotal: 2260,
      nextMaintenanceAtHours: 2500,
      homeBaseLocation: 'Склад / база механизации',
    },
    {
      id: 'eq-kopernik-sd20',
      name: 'Kopernik-SD-20',
      model: 'SD-20',
      qty: 1,
      description: 'Самоходная сваебойная установка Kopernik-SD-20 для работы со сваями до 20 м. По открытым данным модель встречается редко; заполнены типовые параметры класса SD-20.',
      inventoryNumber: 'PT-SD20-001',
      kind: 'PILE_DRIVER',
      baseVehicle: 'Self-propelled crawler carrier',
      serialNumber: 'SD20-DEMO-001',
      manufactureYear: 2020,
      weightTons: 45,
      weightWithEquipmentTons: 52,
      heightMm: 3300,
      lengthMm: 14000,
      widthMm: 3200,
      engineBrand: 'Diesel',
      engineSerialNumber: null,
      enginePower: 220,
      maxPileLength: 20,
      maxDrillingDepth: null,
      hammerType: 'Diesel / hydraulic pile hammer',
      hammerSerialNumber: null,
      hammerEnergyKj: 60,
      hammerKind: 'HYDRAULIC',
      isCombined: false,
      heightMeters: 20,
      maxPileDiameter: 600,
      engineHoursTotal: 1840,
      nextMaintenanceAtHours: 2000,
      homeBaseLocation: 'Склад / база механизации',
    },
  ] as const;

  for (const equipment of equipmentItems) {
    const { id, ...equipmentData } = equipment;
    await db.equipment.upsert({
      where: { id },
      update: {
        ...equipmentData,
        isActive: true,
        tenantId,
      },
      create: {
        ...equipment,
        isActive: true,
        tenantId,
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

  const pileGradesByName = await db.pileGrade.findMany({
    where: {
      tenantId,
      name: { in: ['СВ 120-35', 'СВ 150-50', 'СВ 200-60'] },
    },
    select: { id: true, name: true },
  });
  const pileGradeId = new Map(pileGradesByName.map((grade) => [grade.name, grade.id]));
  const requirePileGradeId = (name: string): string => {
    const id = pileGradeId.get(name);
    if (!id) throw new Error(`Pile grade "${name}" was not seeded for tenant "${tenantId}".`);
    return id;
  };

  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-site1-sv120' },
    update: { siteId: site1.id, pileGradeId: requirePileGradeId('СВ 120-35'), count: 100, metersPerUnit: 12 },
    create: {
      id: 'plan-pile-site1-sv120',
      siteId: site1.id,
      pileGradeId: requirePileGradeId('СВ 120-35'),
      count: 100,
      metersPerUnit: 12,
    },
  });

  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-site1-sv150' },
    update: { siteId: site1.id, pileGradeId: requirePileGradeId('СВ 150-50'), count: 80, metersPerUnit: 15 },
    create: {
      id: 'plan-pile-site1-sv150',
      siteId: site1.id,
      pileGradeId: requirePileGradeId('СВ 150-50'),
      count: 80,
      metersPerUnit: 15,
    },
  });

  await db.sitePilePlan.upsert({
    where: { id: 'plan-pile-site1-sv200' },
    update: { siteId: site1.id, pileGradeId: requirePileGradeId('СВ 200-60'), count: 60, metersPerUnit: 20 },
    create: {
      id: 'plan-pile-site1-sv200',
      siteId: site1.id,
      pileGradeId: requirePileGradeId('СВ 200-60'),
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

  await seedHydraulicHammerEO(db, process.env.DEFAULT_TENANT_ID ?? 'orion');
  console.log('Checklist templates seeded');

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
