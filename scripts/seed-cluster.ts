// Seed data script for PilingTrack
const { PrismaClient } = require('./src/generated/postgres-client/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_POSTGRES } },
});

async function main() {
  console.log('Seeding database...');

  // Admin user
  const existingAdmin = await prisma.user.findFirst({ where: { email: 'admin@piling.ru' } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: 'admin@piling.ru',
        password: bcrypt.hashSync('admin123', 12),
        name: 'Администратор',
        role: 'ADMIN',
        phone: '+7-900-000-0001',
      },
    });
    console.log('  ✅ Admin user created');
  }

  // Dispatcher
  const existingDispatcher = await prisma.user.findFirst({ where: { email: 'dispatch@piling.ru' } });
  if (!existingDispatcher) {
    await prisma.user.create({
      data: {
        email: 'dispatch@piling.ru',
        password: bcrypt.hashSync('2222', 12),
        name: 'Петрова Д.В.',
        role: 'DISPATCHER',
        phone: '+7-900-000-0002',
      },
    });
    console.log('  ✅ Dispatcher created');
  }

  // Operator
  const existingOperator = await prisma.user.findFirst({ where: { email: 'operator@piling.ru' } });
  if (!existingOperator) {
    await prisma.user.create({
      data: {
        email: 'operator@piling.ru',
        password: bcrypt.hashSync('operator123', 12),
        name: 'Иванов И.П.',
        role: 'OPERATOR',
        phone: '+7-900-100-0001',
      },
    });
    console.log('  ✅ Operator created');
  }

  // Dictionaries
  const existingPileGrades = await prisma.pileGrade.count();
  if (existingPileGrades === 0) {
    await prisma.pileGrade.createMany({
      data: [
        { name: 'С1' },
        { name: 'С2' },
        { name: 'С3' },
        { name: 'С4' },
        { name: 'С5' },
      ],
    });
    console.log('  ✅ Pile grades created');
  }

  const existingDrillingTypes = await prisma.drillingType.count();
  if (existingDrillingTypes === 0) {
    await prisma.drillingType.createMany({
      data: [
        { name: 'Ø300' },
        { name: 'Ø400' },
        { name: 'Ø500' },
        { name: 'Ø600' },
      ],
    });
    console.log('  ✅ Drilling types created');
  }

  const existingDowntimeReasons = await prisma.downtimeReason.count();
  if (existingDowntimeReasons === 0) {
    await prisma.downtimeReason.createMany({
      data: [
        { name: 'Поломка оборудования' },
        { name: 'Отсутствие материала' },
        { name: 'Погодные условия' },
        { name: 'Пересменка' },
        { name: 'Обед' },
        { name: 'Ремонт сваебойной установки' },
      ],
    });
    console.log('  ✅ Downtime reasons created');
  }

  // Equipment
  const existingEquipment = await prisma.equipment.count();
  if (existingEquipment === 0) {
    await prisma.equipment.create({ data: { name: 'Установка-1', model: 'Junttan PM26', qty: 1 } });
    await prisma.equipment.create({ data: { name: 'Установка-2', model: 'Junttan PM28', qty: 1 } });
    await prisma.equipment.create({ data: { name: 'Установка-3', model: 'Bauer BG 20', qty: 1 } });
    console.log('  ✅ Equipment created');
  }

  // Sites
  const existingSites = await prisma.site.count();
  if (existingSites === 0) {
    const site1 = await prisma.site.create({
      data: {
        name: 'Объект: ЖК "Центральный"',
        plannedPiles: 500,
        plannedDrilling: 1200,
        status: 'ACTIVE',
      },
    });

    const field1 = await prisma.pileField.create({
      data: { name: 'Поле-1', siteId: site1.id },
    });
    const cluster1 = await prisma.cluster.create({
      data: { name: 'Куст-1', fieldId: field1.id },
    });
    await prisma.picket.createMany({
      data: [
        { name: 'Пикет-1', clusterId: cluster1.id },
        { name: 'Пикет-2', clusterId: cluster1.id },
        { name: 'Пикет-3', clusterId: cluster1.id },
      ],
    });
    console.log('  ✅ Site "Центральный" with hierarchy created');

    await prisma.site.create({
      data: {
        name: 'Объект: Мост через р. Волга',
        plannedPiles: 200,
        plannedDrilling: 800,
        status: 'ACTIVE',
      },
    });
    console.log('  ✅ Site "Мост через р. Волга" created');
  }

  // Crew
  const existingCrews = await prisma.crew.count();
  if (existingCrews === 0) {
    const operator = await prisma.user.findFirst({ where: { email: 'operator@piling.ru' } });
    const equipment = await prisma.equipment.findFirst();
    const site = await prisma.site.findFirst();

    if (operator && equipment && site) {
      await prisma.crew.create({
        data: {
          name: 'Бригада-1',
          operatorId: operator.id,
          equipmentId: equipment.id,
          siteId: site.id,
        },
      });
      console.log('  ✅ Crew created');
    }
  }

  console.log('\n🎉 Seeding completed!');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
