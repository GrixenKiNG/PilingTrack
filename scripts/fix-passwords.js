const { PrismaClient } = require('@prisma/client');
const { hashSync } = require('bcryptjs');

const db = new PrismaClient();

async function main() {
  // Update all admin passwords
  const h = hashSync('admin123', 12);
  const r1 = await db.user.updateMany({
    where: { role: 'ADMIN' },
    data: { password: h },
  });
  console.log('Updated', r1.count, 'admin users → admin123');

  // Update loadtest user
  const h2 = hashSync('loadtest123', 12);
  const r2 = await db.user.updateMany({
    where: { email: 'loadtest@piling.ru' },
    data: { password: h2 },
  });
  console.log('Updated', r2.count, 'loadtest users → loadtest123');
}

main().then(() => db.$disconnect()).catch(e => { console.error(e.message); process.exit(1); });
