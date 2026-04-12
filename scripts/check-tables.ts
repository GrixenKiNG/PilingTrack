import { PrismaClient } from '../src/generated/postgres-client/client';

const db = new PrismaClient();

async function main() {
  const tables: any = await db.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log('Tables:', tables.map((t: any) => t.tablename));

  const userCount: any = await db.$queryRawUnsafe("SELECT COUNT(*) FROM \"User\"");
  console.log('User table count:', userCount[0]?.count);
}

main().then(() => db.$disconnect()).catch(console.error);
