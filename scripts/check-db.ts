import { PrismaClient } from '../src/generated/postgres-client/client';

const db = new PrismaClient();

async function main() {
  const [dbName] = await db.$queryRaw`SELECT current_database()` as any;
  console.log('Connected to:', dbName?.current_database);

  const count = await db.user.count();
  console.log('User count:', count);

  const users = await db.user.findMany({ select: { email: true }, take: 3 });
  console.log('First users:', users.map(u => u.email));
}

main().then(() => db.$disconnect()).catch(console.error);
