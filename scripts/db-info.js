const { Client } = require('pg');

(async () => {
  // Database from .env
  const dbName = 'pilingtrack_test';

  const c = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: dbName
  });

  await c.connect();

  // List tables
  const tables = await c.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);

  console.log(`\n=== Tables in "${dbName}" ===`);
  tables.rows.forEach(r => console.log(`  - ${r.table_name}`));
  console.log(`Total: ${tables.rows.length} tables\n`);

  // Row counts
  console.log('=== Row counts ===');
  for (const row of tables.rows) {
    const count = await c.query(`SELECT COUNT(*) FROM "${row.table_name}"`);
    console.log(`  ${row.table_name}: ${count.rows[0].count} rows`);
  }

  await c.end();
})();
