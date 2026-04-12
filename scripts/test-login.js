const { Client } = require('pg');
const { compare: bcryptCompare } = require('bcryptjs');
const { createHash } = require('crypto');

async function main() {
  const email = 'admin@piling.ru';
  const password = 'admin123';

  const c = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'pilingtrack_test'
  });

  await c.connect();

  console.log(`\nTesting login for: ${email}`);

  const result = await c.query(`
    SELECT id, email, password, pin, name, role, "isActive"
    FROM "User"
    WHERE email = $1
  `, [email.toLowerCase()]);

  if (result.rows.length === 0) {
    console.log('User NOT FOUND');
    await c.end();
    return;
  }

  const user = result.rows[0];
  console.log('\nUser found:');
  console.log('  id:', user.id);
  console.log('  email:', user.email);
  console.log('  name:', user.name);
  console.log('  role:', user.role);
  console.log('  isActive:', user.isActive);
  console.log('  password (type):', typeof user.password);
  console.log('  password (length):', user.password?.length || 0);
  console.log('  password (first 60):', user.password?.substring(0, 60));

  // Try bcrypt
  try {
    const bcryptResult = await bcryptCompare(password, user.password);
    console.log('\n  bcrypt compare:', bcryptResult);
  } catch (e) {
    console.log('\n  bcrypt compare ERROR:', e.message);

    // Try SHA-256
    const sha256Hash = createHash('sha256').update(password).digest('hex');
    console.log('  SHA-256 of password:', sha256Hash);
    console.log('  Stored hash:', user.password);
    console.log('  SHA-256 match:', sha256Hash === user.password);

    // Try plain text
    console.log('  Plain text match:', password === user.password);
  }

  await c.end();
}

main().catch(console.error);
