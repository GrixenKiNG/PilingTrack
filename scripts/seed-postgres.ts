import { PrismaClient } from '../src/generated/postgres-client/client';
import { hashSync } from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  // Check current state
  const count = await db.user.count();
  console.log('Users in PostgreSQL:', count);

  if (count === 0) {
    // Create users from scratch
    const adminPass = hashSync('admin123', 12);
    const operatorPass = hashSync('operator123', 12);
    const loadtestPass = hashSync('loadtest123', 12);

    const admin = await db.user.create({
      data: { email: 'admin@piling.ru', password: adminPass, name: 'Admin', role: 'ADMIN', phone: '+7-000-000-0001' },
    });
    console.log('Created admin:', admin.email);

    const operator = await db.user.create({
      data: { email: 'operator@piling.ru', password: operatorPass, name: 'Operator', role: 'OPERATOR', phone: '+7-000-000-0002' },
    });
    console.log('Created operator:', operator.email);

    const loadtest = await db.user.create({
      data: { email: 'loadtest@piling.ru', password: loadtestPass, name: 'LoadTest', role: 'ADMIN', phone: '+7-000-000-0003' },
    });
    console.log('Created loadtest:', loadtest.email);
  } else {
    // Update existing users
    const adminPass = hashSync('admin123', 12);
    const loadtestPass = hashSync('loadtest123', 12);

    await db.user.updateMany({ where: { role: 'ADMIN' }, data: { password: adminPass } });
    await db.user.updateMany({ where: { email: 'loadtest@piling.ru' }, data: { password: loadtestPass } });
    console.log('Updated passwords');
  }

  const finalCount = await db.user.count();
  console.log('Final user count:', finalCount);
}

main().then(() => db.$disconnect()).catch(e => { console.error(e.message); process.exit(1); });
