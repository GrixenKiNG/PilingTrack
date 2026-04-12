import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const r: any = await db.$queryRawUnsafe('SELECT current_database()');
  console.log('@prisma/client database:', r[0].current_database);
  const count = await db.user.count();
  console.log('User count:', count);
}

main().then(() => db.$disconnect()).catch(console.error);
