/**
 * Seed script to populate database with test data
 * Run: npx tsx prisma/seed-test-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding test data...');

  // 1. Create equipment (установки)
  console.log('\n📦 Creating equipment...');
  const equipment1 = await prisma.equipment.upsert({
    where: { id: 'equip-test-1' },
    update: {},
    create: {
      id: 'equip-test-1',
      name: 'Бауман 100',
      model: 'BG-15',
      description: 'Тестовая установка №1',
      isActive: true,
    },
  });
  console.log(`✅ ${equipment1.name}`);

  const equipment2 = await prisma.equipment.upsert({
    where: { id: 'equip-test-2' },
    update: {},
    create: {
      id: 'equip-test-2',
      name: 'Либхерр 200',
      model: 'LRB 16',
      description: 'Тестовая установка №2',
      isActive: true,
    },
  });
  console.log(`✅ ${equipment2.name}`);

  // 2. Create site (объект)
  console.log('\n🏗️ Creating site...');
  const site = await prisma.site.upsert({
    where: { id: 'site-test-1' },
    update: {},
    create: {
      id: 'site-test-1',
      name: 'Тестовый объект',
      description: 'Тестовый строительный объект',
      isActive: true,
    },
  });
  console.log(`✅ ${site.name}`);

  // 3. Create crew (бригада)
  console.log('\n👷 Creating crew...');
  await prisma.user.findFirst({ where: { email: 'admin@piling.ru' } });
  const crew = await prisma.crew.upsert({
    where: { id: 'crew-test-1' },
    update: {},
    create: {
      id: 'crew-test-1',
      name: 'Бригада №1',
      equipmentId: equipment1.id,
      isActive: true,
    },
  });
  console.log(`✅ ${crew.name} -> ${equipment1.name}`);

  // 4. Create dictionary items
  console.log('\n📚 Creating dictionaries...');
  
  // Pile grades
  const pileGrade1 = await prisma.pileGrade.upsert({
    where: { id: 'pile-grade-1' },
    update: {},
    create: { id: 'pile-grade-1', name: 'С-1', description: 'Свая 1 типа' },
  });
  const pileGrade2 = await prisma.pileGrade.upsert({
    where: { id: 'pile-grade-2' },
    update: {},
    create: { id: 'pile-grade-2', name: 'С-2', description: 'Свая 2 типа' },
  });
  console.log(`✅ Pile grades: ${pileGrade1.name}, ${pileGrade2.name}`);

  // Drilling types
  const drillType1 = await prisma.drillingType.upsert({
    where: { id: 'drill-type-1' },
    update: {},
    create: { id: 'drill-type-1', name: 'Лидерное', description: 'Лидерное бурение' },
  });
  const drillType2 = await prisma.drillingType.upsert({
    where: { id: 'drill-type-2' },
    update: {},
    create: { id: 'drill-type-2', name: 'Обычное', description: 'Обычное бурение' },
  });
  console.log(`✅ Drilling types: ${drillType1.name}, ${drillType2.name}`);

  // Downtime reasons
  const dtReason1 = await prisma.downtimeReason.upsert({
    where: { id: 'dt-reason-1' },
    update: {},
    create: { id: 'dt-reason-1', name: 'Поломка', description: 'Поломка техники' },
  });
  const dtReason2 = await prisma.downtimeReason.upsert({
    where: { id: 'dt-reason-2' },
    update: {},
    create: { id: 'dt-reason-2', name: 'Погода', description: 'Плохие погодные условия' },
  });
  console.log(`✅ Downtime reasons: ${dtReason1.name}, ${dtReason2.name}`);

  // 5. Create reports for period 08.04.2026 - 15.04.2026
  console.log('\n📄 Creating reports...');
  
  const operator = await prisma.user.findFirst({ where: { email: 'operator@piling.ru' } });
  if (!operator) {
    console.error('❌ Operator not found!');
    return;
  }

  const reports = [
    { date: '2026-04-08', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-09', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-10', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-11', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-12', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-13', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-14', shiftStart: '08:00', shiftEnd: '20:00' },
    { date: '2026-04-15', shiftStart: '08:00', shiftEnd: '20:00' },
  ];

  for (const report of reports) {
    await prisma.report.upsert({
      where: { id: `report-${report.date}` },
      update: {},
      create: {
        id: `report-${report.date}`,
        userId: operator.id,
        siteId: site.id,
        equipmentId: equipment1.id,
        date: new Date(report.date),
        shiftStart: report.shiftStart,
        shiftEnd: report.shiftEnd,
        piles: {
          create: [
            { pileGradeId: pileGrade1.id, count: 5 },
            { pileGradeId: pileGrade2.id, count: 3 },
          ],
        },
        drillings: {
          create: [
            { typeId: drillType1.id, meters: 12.5 },
          ],
        },
        downtimes: {
          create: [
            { reasonId: dtReason1.id, duration: 2, comment: 'Замена оборудования' },
          ],
        },
      },
    });
    console.log(`✅ Report ${report.date}`);
  }

  console.log('\n✅ Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
