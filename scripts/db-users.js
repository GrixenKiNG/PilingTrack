const { Client } = require('pg');
const bcrypt = require('bcryptjs');

(async () => {
  const c = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'pilingtrack_test'
  });

  await c.connect();

  const users = await c.query(`SELECT email, name, role, password FROM "User" ORDER BY email`);

  console.log('=== Password verification ===\n');

  const passwordsToTest = [
    'admin123', 'operator123', 'loadtest123',
    '1234', '0000', '2222', '3333', '1111'
  ];

  for (const u of users.rows) {
    console.log(`\n  ${u.email} (${u.name}) — role: ${u.role}`);
    if (!u.password || u.password.length < 5) {
      console.log(`    → NO PASSWORD`);
      continue;
    }
    let found = false;
    for (const testPass of passwordsToTest) {
      try {
        const valid = await bcrypt.compare(testPass, u.password);
        if (valid) {
          console.log(`    → ✅ "${testPass}"`);
          found = true;
          break;
        }
      } catch (e) { /* skip */ }
    }
    if (!found) {
      console.log(`    → ❌ none of the test passwords match`);
      console.log(`    Hash: ${u.password.substring(0, 50)}...`);
    }
  }

  console.log('\n\n=== ROLES available in schema ===');
  console.log('  From schema: ADMIN, DISPATCHER, OPERATOR, ASSISTANT');
  console.log('\n=== ROLES in DB ===');
  const roles = await c.query(`SELECT role, COUNT(*) as cnt FROM "User" GROUP BY role`);
  roles.rows.forEach(r => console.log(`  ${r.role}: ${r.cnt} users`));

  await c.end();
})();
