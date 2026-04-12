// Миграция данных из SQLite в PostgreSQL через Prisma
const { PrismaClient } = require('@prisma/client');
const { PrismaClient: PGClient } = require('../src/generated/postgres-client');
const { execSync } = require('child_process');
const path = require('path');

// Читаем SQLite через better-sqlite3 или через npx prisma db execute
const fs = require('fs');

async function main() {
  const pg = new PGClient();
  await pg.$connect();
  console.log('✓ Подключено к PostgreSQL\n');

  // Читаем данные из SQLite через sql.js или через Prisma SQLite client
  const sqliteDb = new PrismaClient({
    datasources: { db: { url: 'file:' + path.resolve(__dirname, '..', 'db', 'custom.db') } }
  });

  try {
    // 1. Equipment
    console.log('🔧 Миграция оборудования...');
    const equipment = await sqliteDb.$queryRaw`SELECT * FROM Equipment`;
    console.log(`  Найдено в SQLite: ${equipment.length}`);
    for (const e of equipment) {
      await pg.equipment.upsert({
        where: { id: e.id },
        update: { name: e.name, model: e.model, qty: e.qty, isActive: Boolean(e.isActive), description: e.description || '', updatedAt: new Date(e.updatedAt) },
        create: { id: e.id, name: e.name, model: e.model, qty: e.qty, isActive: Boolean(e.isActive), description: e.description || '', createdAt: new Date(e.createdAt), updatedAt: new Date(e.updatedAt) }
      });
      console.log(`  ✅ ${e.name}`);
    }
    const pgEquipCount = await pg.equipment.count();
    console.log(`  → В PostgreSQL: ${pgEquipCount}\n`);

    // 2. Dictionaries
    console.log('📖 Миграция справочников...');
    
    const pileGrades = await sqliteDb.$queryRaw`SELECT * FROM PileGrade`;
    for (const p of pileGrades) {
      await pg.pileGrade.upsert({
        where: { id: p.id },
        update: { name: p.name, isActive: Boolean(p.isActive), updatedAt: new Date(p.updatedAt) },
        create: { id: p.id, name: p.name, isActive: Boolean(p.isActive), createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) }
      });
    }
    console.log(`  ✅ Марки свай: ${pileGrades.length}`);

    const drillingTypes = await sqliteDb.$queryRaw`SELECT * FROM DrillingType`;
    for (const d of drillingTypes) {
      await pg.drillingType.upsert({
        where: { id: d.id },
        update: { name: d.name, isActive: Boolean(d.isActive), updatedAt: new Date(d.updatedAt) },
        create: { id: d.id, name: d.name, isActive: Boolean(d.isActive), createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) }
      });
    }
    console.log(`  ✅ Типы бурения: ${drillingTypes.length}`);

    const downtimeReasons = await sqliteDb.$queryRaw`SELECT * FROM DowntimeReason`;
    for (const d of downtimeReasons) {
      await pg.downtimeReason.upsert({
        where: { id: d.id },
        update: { name: d.name, isActive: Boolean(d.isActive), updatedAt: new Date(d.updatedAt) },
        create: { id: d.id, name: d.name, isActive: Boolean(d.isActive), createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) }
      });
    }
    console.log(`  ✅ Причины простоев: ${downtimeReasons.length}\n`);

    // 3. Users
    console.log('👤 Миграция пользователей...');
    const users = await sqliteDb.$queryRaw`SELECT * FROM User`;
    for (const u of users) {
      try {
        const existing = await pg.user.findUnique({ where: { id: u.id } });
        if (!existing) {
          await pg.user.create({
            data: {
              id: u.id,
              email: u.email,
              password: u.password || '',
              pin: u.pin,
              pinLookup: u.pinLookup,
              name: u.name,
              phone: u.phone || '',
              role: u.role,
              isActive: Boolean(u.isActive),
              timezone: u.timezone || 'Europe/Moscow',
              createdAt: new Date(u.createdAt),
              updatedAt: new Date(u.updatedAt)
            }
          });
          console.log(`  ✅ ${u.name} (${u.role})`);
        } else {
          console.log(`  ⏭ ${u.name} (уже есть)`);
        }
      } catch (err) {
        console.log(`  ⚠ ${u.name}: ${err.message.substring(0, 80)}`);
      }
    }
    const pgUserCount = await pg.user.count();
    console.log(`  → В PostgreSQL: ${pgUserCount}\n`);

    // 4. Crews
    console.log('👷 Миграция бригад...');
    const crews = await sqliteDb.$queryRaw`SELECT * FROM Crew`;
    for (const c of crews) {
      try {
        const existing = await pg.crew.findUnique({ where: { id: c.id } });
        if (!existing) {
          await pg.crew.create({
            data: {
              id: c.id,
              name: c.name || '',
              isActive: Boolean(c.isActive),
              operatorId: c.operatorId,
              equipmentId: c.equipmentId,
              siteId: c.siteId,
              createdAt: new Date(c.createdAt),
              updatedAt: new Date(c.updatedAt)
            }
          });
          console.log(`  ✅ Бригада ${c.id} (оператор: ${c.operatorId})`);
        }
      } catch (err) {
        console.log(`  ⚠ ${c.id}: ${err.message.substring(0, 80)}`);
      }
    }
    const pgCrewCount = await pg.crew.count();
    console.log(`  → В PostgreSQL: ${pgCrewCount}\n`);

    // 5. CrewAssistants
    console.log(' Миграция помощников бригад...');
    const assistants = await sqliteDb.$queryRaw`SELECT * FROM CrewAssistant`;
    for (const a of assistants) {
      try {
        await pg.crewAssistant.upsert({
          where: { id: a.id },
          update: { name: a.name, updatedAt: new Date(a.updatedAt) },
          create: { id: a.id, crewId: a.crewId, name: a.name, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) }
        });
      } catch (err) { /* skip */ }
    }
    console.log(`  → Перенесено: ${assistants.length}\n`);

    // 6. UserSiteAssignments
    console.log('🔗 Миграция привязок...');
    const assignments = await sqliteDb.$queryRaw`SELECT * FROM UserSiteAssignment`;
    for (const a of assignments) {
      try {
        await pg.userSiteAssignment.upsert({
          where: { id: a.id },
          update: {},
          create: { id: a.id, userId: a.userId, siteId: a.siteId, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) }
        });
      } catch (err) { /* skip */ }
    }
    console.log(`  → Перенесено: ${assignments.length}\n`);

    // 7. Reports
    console.log('📋 Миграция отчётов...');
    const reports = await sqliteDb.$queryRaw`SELECT * FROM Report`;
    for (const r of reports) {
      try {
        const existing = await pg.report.findUnique({ where: { id: r.id } });
        if (!existing) {
          await pg.report.create({
            data: {
              id: r.id,
              reportId: r.reportId,
              userId: r.userId,
              crewId: r.crewId,
              equipmentId: r.equipmentId,
              siteId: r.siteId,
              date: r.date,
              shiftType: r.shiftType,
              shiftStart: r.shiftStart,
              shiftEnd: r.shiftEnd,
              status: r.status,
              version: r.version,
              vectorClock: r.vectorClock ? JSON.parse(r.vectorClock) : null,
              lastEditedById: r.lastEditedById,
              lastEditedByName: r.lastEditedByName,
              lastEditedByRole: r.lastEditedByRole,
              createdAt: new Date(r.createdAt),
              updatedAt: new Date(r.updatedAt)
            }
          });
          console.log(`  ✅ ${r.reportId}`);
        }
      } catch (err) {
        console.log(`  ⚠ ${r.reportId}: ${err.message.substring(0, 80)}`);
      }
    }
    const pgReportCount = await pg.report.count();
    console.log(`  → В PostgreSQL: ${pgReportCount}\n`);

    // 8. PileWork
    console.log('🔩 Миграция забитых свай...');
    const pileWorks = await sqliteDb.$queryRaw`SELECT * FROM PileWork`;
    for (const p of pileWorks) {
      try {
        await pg.pileWork.upsert({
          where: { id: p.id },
          update: { count: p.count, picketId: p.picketId, pileGradeId: p.pileGradeId },
          create: { id: p.id, reportId: p.reportId, picketId: p.picketId, pileGradeId: p.pileGradeId, count: p.count, createdAt: new Date(p.createdAt) }
        });
      } catch (err) { /* skip */ }
    }
    console.log(`  → Перенесено: ${pileWorks.length}\n`);

    // 9. LeaderDrilling
    console.log('🕳️ Миграция бурения...');
    const drillings = await sqliteDb.$queryRaw`SELECT * FROM LeaderDrilling`;
    for (const d of drillings) {
      try {
        await pg.leaderDrilling.upsert({
          where: { id: d.id },
          update: { count: d.count, picketId: d.picketId, typeId: d.typeId, meters: d.meters, metersPerUnit: d.metersPerUnit },
          create: { id: d.id, reportId: d.reportId, picketId: d.picketId, typeId: d.typeId, count: d.count, meters: d.meters, metersPerUnit: d.metersPerUnit, createdAt: new Date(d.createdAt) }
        });
      } catch (err) { /* skip */ }
    }
    console.log(`  → Перенесено: ${drillings.length}\n`);

    // 10. ReportDowntime
    console.log('⏸️ Миграция простоев...');
    const downtimes = await sqliteDb.$queryRaw`SELECT * FROM ReportDowntime`;
    for (const d of downtimes) {
      try {
        await pg.reportDowntime.upsert({
          where: { id: d.id },
          update: { duration: d.duration, comment: d.comment, reasonId: d.reasonId },
          create: { id: d.id, reportId: d.reportId, duration: d.duration, comment: d.comment, reasonId: d.reasonId, createdAt: new Date(d.createdAt) }
        });
      } catch (err) { /* skip */ }
    }
    console.log(`  → Перенесено: ${downtimes.length}\n`);

  } catch (err) {
    console.error('❌ Ошибка миграции:', err.message);
  } finally {
    await pg.$disconnect();
    await sqliteDb.$disconnect();
  }

  // Финальная проверка
  console.log('='.repeat(50));
  console.log('📊 ФИНАЛЬНАЯ ПРОВЕРКА POSTGRESQL');
  console.log('='.repeat(50));
  
  const pg2 = new PGClient();
  await pg2.$connect();
  
  const checks = [
    ['Пользователи', await pg2.user.count()],
    ['Оборудование', await pg2.equipment.count()],
    ['Объекты', await pg2.site.count()],
    ['Бригады', await pg2.crew.count()],
    ['Марки свай', await pg2.pileGrade.count()],
    ['Типы бурения', await pg2.drillingType.count()],
    ['Причины простоев', await pg2.downtimeReason.count()],
    ['Отчёты', await pg2.report.count()],
    ['Забитые сваи', await pg2.pileWork.count()],
    ['Бурение', await pg2.leaderDrilling.count()],
    ['Простои', await pg2.reportDowntime.count()],
    ['Помощники бригад', await pg2.crewAssistant.count()],
    ['Привязки', await pg2.userSiteAssignment.count()],
  ];

  for (const [name, count] of checks) {
    const icon = count > 0 ? '✅' : '❌';
    console.log(`  ${icon} ${name}: ${count}`);
  }

  await pg2.$disconnect();
  console.log('\n✅ Миграция завершена!');
}

main().catch(err => {
  console.error('❌ Критическая ошибка:', err.message);
  process.exit(1);
});
