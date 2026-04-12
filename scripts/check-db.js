const { Client } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL_POSTGRES;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✓ Подключено к PostgreSQL\n');

  // 1. Список всех таблиц
  console.log('=== ТАБЛИЦЫ ===');
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  
  const tableNames = tables.rows.map(r => r.table_name);
  console.log(`Всего таблиц: ${tableNames.length}\n`);
  
  // 2. Подсчёт строк в каждой таблице
  console.log('=== КОЛИЧЕСТВО ЗАПИСЕЙ ===');
  const rowCountMap = {};
  for (const table of tableNames) {
    try {
      const res = await client.query(`SELECT COUNT(*) as count FROM "${table}"`);
      const count = parseInt(res.rows[0].count);
      rowCountMap[table] = count;
      if (count > 0) {
        console.log(`  ${table}: ${count}`);
      }
    } catch (e) {
      // skip views
    }
  }
  
  // 3. Данные из ключевых таблиц
  console.log('\n=== ПОЛЬЗОВАТЕЛИ (User) ===');
  const users = await client.query('SELECT id, email, name, role, "isActive", "createdAt" FROM "User" LIMIT 10');
  users.rows.forEach(u => {
    console.log(`  [${u.role}] ${u.name} (${u.email}) — ${u.isActive ? 'active' : 'inactive'}`);
  });
  
  console.log('\n=== ОБЪЕКТЫ (Site) ===');
  const sites = await client.query('SELECT id, name, "plannedPiles", "plannedDrilling", status, "isActive" FROM "Site" LIMIT 10');
  sites.rows.forEach(s => {
    console.log(`  📍 ${s.name} — план: ${s.plannedPiles} свай, ${s.plannedDrilling}м бурения [${s.status}]`);
  });
  
  console.log('\n=== ОБОРУДОВАНИЕ (Equipment) ===');
  const equipment = await client.query('SELECT id, name, model, qty, "isActive" FROM "Equipment" LIMIT 10');
  equipment.rows.forEach(e => {
    console.log(`  🔧 ${e.name} (${e.model}) — кол-во: ${e.qty}`);
  });
  
  console.log('\n=== БРИГАДЫ (Crew) ===');
  const crews = await client.query(`
    SELECT c.id, c.name, c."isActive", u.name as operator_name, e.name as equip_name
    FROM "Crew" c
    LEFT JOIN "User" u ON c."operatorId" = u.id
    LEFT JOIN "Equipment" e ON c."equipmentId" = e.id
    LIMIT 10
  `);
  crews.rows.forEach(c => {
    console.log(`  👷 ${c.operator_name || c.name} — установка: ${c.equip_name || 'N/A'}`);
  });
  
  console.log('\n=== СПРАВОЧНИКИ ===');
  
  // Pile grades
  const pileGrades = await client.query('SELECT id, name, "isActive" FROM "PileGrade"');
  console.log(`  Марки свай (${pileGrades.rows.length}): ${pileGrades.rows.map(p => p.name).join(', ')}`);
  
  // Drilling types
  const drillingTypes = await client.query('SELECT id, name, "isActive" FROM "DrillingType"');
  console.log(`  Типы бурения (${drillingTypes.rows.length}): ${drillingTypes.rows.map(d => d.name).join(', ')}`);
  
  // Downtime reasons
  const downtimeReasons = await client.query('SELECT id, name, "isActive" FROM "DowntimeReason"');
  console.log(`  Причины простоев (${downtimeReasons.rows.length}): ${downtimeReasons.rows.map(d => d.name).join(', ')}`);
  
  console.log('\n=== ОТЧЁТЫ (Report) ===');
  const reports = await client.query(`
    SELECT r."reportId", r.date, r."shiftType", r.status, r.version,
           u.name as user_name, s.name as site_name
    FROM "Report" r
    LEFT JOIN "User" u ON r."userId" = u.id
    LEFT JOIN "Site" s ON r."siteId" = s.id
    ORDER BY r."createdAt" DESC
    LIMIT 10
  `);
  if (reports.rows.length === 0) {
    console.log('  (нет отчётов)');
  } else {
    reports.rows.forEach(r => {
      console.log(`  📋 ${r.reportId} — ${r.date} (${r.shiftType}) [${r.status}] — ${r.user_name} @ ${r.site_name}`);
    });
  }
  
  console.log('\n=== PILE WORK ===');
  const pileWork = await client.query(`
    SELECT pw.count, pg.name as grade_name, r.date, u.name as user_name
    FROM "PileWork" pw
    JOIN "PileGrade" pg ON pw."pileGradeId" = pg.id
    JOIN "Report" r ON pw."reportId" = r.id
    JOIN "User" u ON r."userId" = u.id
    LIMIT 10
  `);
  if (pileWork.rows.length === 0) {
    console.log('  (нет записей о забитых сваях)');
  } else {
    pileWork.rows.forEach(p => {
      console.log(`  ${p.count} шт. ${p.grade_name} — ${p.date} (${p.user_name})`);
    });
  }
  
  console.log('\n=== LEADER DRILLING ===');
  const drillings = await client.query(`
    SELECT ld.count, ld.meters, dt.name as type_name, r.date, u.name as user_name
    FROM "LeaderDrilling" ld
    JOIN "DrillingType" dt ON ld."typeId" = dt.id
    JOIN "Report" r ON ld."reportId" = r.id
    JOIN "User" u ON r."userId" = u.id
    LIMIT 10
  `);
  if (drillings.rows.length === 0) {
    console.log('  (нет записей о бурении)');
  } else {
    drillings.rows.forEach(d => {
      console.log(`  ${d.count} шт. × ${d.meters}м ${d.type_name} — ${d.date} (${d.user_name})`);
    });
  }
  
  console.log('\n=== DOWNTIME ===');
  const downtimes = await client.query(`
    SELECT rd.duration, rd.comment, dr.name as reason_name, r.date, u.name as user_name
    FROM "ReportDowntime" rd
    JOIN "DowntimeReason" dr ON rd."reasonId" = dr.id
    JOIN "Report" r ON rd."reportId" = r.id
    JOIN "User" u ON r."userId" = u.id
    LIMIT 10
  `);
  if (downtimes.rows.length === 0) {
    console.log('  (нет записей о простоях)');
  } else {
    downtimes.rows.forEach(d => {
      console.log(`  ${d.duration}ч — ${d.reason_name} — ${d.date} (${d.user_name})`);
    });
  }
  
  console.log('\n=== СИНХРОНИЗАЦИЯ (DeviceSyncState) ===');
  const syncStates = await client.query('SELECT "deviceId", "syncStatus", "lastSyncAt", "changesSent", "changesRecv" FROM "DeviceSyncState" LIMIT 10');
  if (syncStates.rows.length === 0) {
    console.log('  (нет устройств синхронизации)');
  } else {
    syncStates.rows.forEach(s => {
      console.log(`  📱 ${s.deviceId} — ${s.syncStatus} (отправлено: ${s.changesSent}, получено: ${s.changesRecv})`);
    });
  }
  
  console.log('\n=== АУДИТ (AuditLog) ===');
  const auditLogs = await client.query('SELECT entity, action, "entityId", "userName", timestamp FROM "AuditLog" ORDER BY timestamp DESC LIMIT 10');
  if (auditLogs.rows.length === 0) {
    console.log('  (нет записей аудита)');
  } else {
    auditLogs.rows.forEach(a => {
      console.log(`  🔍 ${a.timestamp.toISOString().split('T')[0]} — ${a.userName || 'system'}: ${a.action} ${a.entity} #${a.entityId}`);
    });
  }
  
  console.log('\n=== TELEGRAM CONFIG ===');
  const telegramConfigs = await client.query('SELECT label, enabled FROM "TelegramConfig"');
  if (telegramConfigs.rows.length === 0) {
    console.log('  (не настроено)');
  } else {
    telegramConfigs.rows.forEach(t => {
      console.log(`  📢 ${t.label} — ${t.enabled ? 'включено' : 'выключено'}`);
    });
  }
  
  // 4. Итоговая сводка
  console.log('\n========================================');
  console.log('📊 СВОДКА ПО БАЗЕ ДАННЫХ');
  console.log('========================================');
  console.log(`Таблиц: ${tableNames.length}`);
  console.log(`Пользователей: ${users.rows.length}`);
  console.log(`Объектов: ${sites.rows.length}`);
  console.log(`Оборудования: ${equipment.rows.length}`);
  console.log(`Бригад: ${crews.rows.length}`);
  console.log(`Марок свай: ${pileGrades.rows.length}`);
  console.log(`Типов бурения: ${drillingTypes.rows.length}`);
  console.log(`Причин простоев: ${downtimeReasons.rows.length}`);
  console.log(`Отчётов: ${reports.rows.length}`);
  console.log(`Записей о сваях: ${pileWork.rows.length}`);
  console.log(`Записей о бурении: ${drillings.rows.length}`);
  console.log(`Записей о простоях: ${downtimes.rows.length}`);
  console.log(`Устройств синхронизации: ${syncStates.rows.length}`);
  console.log(`Записей аудита: ${auditLogs.rows.length}`);
  console.log(`Конфигов Telegram: ${telegramConfigs.rows.length}`);
  
  await client.end();
  console.log('\n✓ Отключено от базы данных');
}

main().catch(err => {
  console.error('✗ Ошибка:', err.message);
  process.exit(1);
});
