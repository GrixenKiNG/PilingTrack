import { PrismaClient } from '../src/generated/postgres-client';

const db = new PrismaClient();

async function main() {
  const dbResult = await db.$queryRaw`SELECT current_database() as db`;
  console.log('Database:', dbResult);
  
  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true }
  });
  
  console.log('\n=== Users and Roles ===');
  console.table(users);
}

main().then(() => db.$disconnect()).catch(console.error);
