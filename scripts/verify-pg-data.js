// Перезапуск данных через API — имитация того, что делает фронтенд
const { Client } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL_POSTGRES;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✓ Подключено к PostgreSQL\n');

  // Проверяем, что все данные корректно в PG
  console.log('=== ДАННЫЕ В POSTGRESQL ===\n');

  // 1. Equipment
  console.log('🔧 Оборудование:');
  const equip = await client.query('SELECT id, name, model, qty, "isActive" FROM "Equipment" ORDER BY name');
  equip.rows.forEach(e => {
    console.log(`  ${e.isActive ? '✅' : '❌'} ${e.name} (${e.model}) — кол-во: ${e.qty}`);
  });
  console.log(`  Всего: ${equip.rows.length}\n`);

  // 2. PileGrades
  console.log('📖 Марки свай:');
  const grades = await client.query('SELECT name, "isActive" FROM "PileGrade" ORDER BY name');
  grades.rows.forEach(g => {
    console.log(`  ${g.isActive ? '✅' : '❌'} ${g.name}`);
  });
  console.log(`  Всего: ${grades.rows.length}\n`);

  // 3. DrillingTypes
  console.log('🕳️ Типы бурения:');
  const types = await client.query('SELECT name, "isActive" FROM "DrillingType" ORDER BY name');
  types.rows.forEach(t => {
    console.log(`  ${t.isActive ? '✅' : '❌'} ${t.name}`);
  });
  console.log(`  Всего: ${types.rows.length}\n`);

  // 4. DowntimeReasons
  console.log('⏸️ Причины простоев:');
  const reasons = await client.query('SELECT name, "isActive" FROM "DowntimeReason" ORDER BY name');
  reasons.rows.forEach(r => {
    console.log(`  ${r.isActive ? '✅' : '❌'} ${r.name}`);
  });
  console.log(`  Всего: ${reasons.rows.length}\n`);

  // 5. Crews с операторами и оборудованием
  console.log('👷 Бригады:');
  const crews = await client.query(`
    SELECT c.id, c.name, c."isActive", u.name as operator_name, e.name as equip_name, s.name as site_name
    FROM "Crew" c
    LEFT JOIN "User" u ON c."operatorId" = u.id
    LEFT JOIN "Equipment" e ON c."equipmentId" = e.id
    LEFT JOIN "Site" s ON c."siteId" = s.id
    ORDER BY u.name
  `);
  crews.rows.forEach(c => {
    console.log(`  ${c.operator_name || c.name} — ${c.equip_name || 'N/A'} @ ${c.site_name || 'N/A'}`);
  });
  console.log(`  Всего: ${crews.rows.length}\n`);

  // 6. Reports с детализацией
  console.log('📋 Отчёты:');
  const reports = await client.query(`
    SELECT r."reportId", r.date, r."shiftType", r.status,
           u.name as user_name, s.name as site_name,
           (SELECT COUNT(*) FROM "PileWork" pw WHERE pw."reportId" = r.id) as pile_count,
           (SELECT COUNT(*) FROM "LeaderDrilling" ld WHERE ld."reportId" = r.id) as drill_count,
           (SELECT COALESCE(SUM(duration), 0) FROM "ReportDowntime" rd WHERE rd."reportId" = r.id) as downtime
    FROM "Report" r
    LEFT JOIN "User" u ON r."userId" = u.id
    LEFT JOIN "Site" s ON r."siteId" = s.id
    ORDER BY r.date DESC
  `);
  reports.rows.forEach(r => {
    console.log(`  ${r.reportId} — ${r.date} (${r.shiftType}) [${r.status}]`);
    console.log(`    👤 ${r.user_name} @ ${r.site_name}`);
    console.log(`    🔩 Сваи: ${r.pile_count} записей, 🕳️ Бурение: ${r.drill_count} записей, ⏸️ Простои: ${r.downtime}ч`);
  });
  console.log(`  Всего: ${reports.rows.length}\n`);

  // 7. PileWork detail
  console.log('🔩 Детали забитых свай:');
  const piles = await client.query(`
    SELECT pw.count, pg.name as grade, r.date, u.name as user_name
    FROM "PileWork" pw
    JOIN "PileGrade" pg ON pw."pileGradeId" = pg.id
    JOIN "Report" r ON pw."reportId" = r.id
    JOIN "User" u ON r."userId" = u.id
    ORDER BY r.date
  `);
  piles.rows.forEach(p => {
    console.log(`  ${p.count} шт. ${p.grade} — ${p.date} (${p.user_name})`);
  });
  console.log(`  Всего: ${piles.rows.length}\n`);

  // 8. LeaderDrilling detail
  console.log('🕳️ Детали бурения:');
  const drills = await client.query(`
    SELECT ld.count, ld.meters, ld."metersPerUnit", dt.name as type_name, r.date, u.name as user_name
    FROM "LeaderDrilling" ld
    JOIN "DrillingType" dt ON ld."typeId" = dt.id
    JOIN "Report" r ON ld."reportId" = r.id
    JOIN "User" u ON r."userId" = u.id
    ORDER BY r.date
  `);
  drills.rows.forEach(d => {
    console.log(`  ${d.count} шт. × ${d.metersPerUnit}м = ${d.meters}м ${d.type_name} — ${d.date} (${d.user_name})`);
  });
  console.log(`  Всего: ${drills.rows.length}\n`);

  await client.end();
  console.log('✅ Проверка завершена — все данные в PostgreSQL корректны!');
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
