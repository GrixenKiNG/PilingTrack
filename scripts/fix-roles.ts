import { PrismaClient } from '../src/generated/postgres-client';

const db = new PrismaClient();

async function main() {
  const result = await db.user.updateMany({
    where: {
      email: { in: ['sas@piling.ru', 'tr@piling.ru', 'kn@piling.ru'] }
    },
    data: { role: 'ASSISTANT' }
  });
  
  console.log(`✅ Updated ${result.count} users to ASSISTANT role`);
  
  // Verify
  const users = await db.user.findMany({
    where: {
      email: { in: ['sas@piling.ru', 'tr@piling.ru', 'kn@piling.ru'] }
    },
    select: { email: true, name: true, role: true }
  });
  
  console.log('\nUpdated users:');
  for (const u of users) {
    console.log(`  ${u.email} → ${u.name} → ${u.role}`);
  }
}

main().then(() => db.$disconnect()).catch(console.error);
