/**
 * Reset user passwords to known defaults.
 */
import { PrismaClient } from '../src/generated/postgres-client';
import { hashSync } from 'bcryptjs';

const db = new PrismaClient();

const users = [
  { email: 'admin@piling.ru', password: 'admin123' },
  { email: 'dispatch@piling.ru', password: '2222' },
  { email: 'operator@piling.ru', password: '0000' },
  { email: 'helper@piling.ru', password: '3333' },
  { email: 'sas02@rambler.ru', password: '1111' },
  { email: 'mag@piling.ru', password: 'mag123' },
  { email: 'kn@piling.ru', password: 'kn123' },
  { email: 'ivv@piling.ru', password: 'ivv123' },
  { email: 'tr@piling.ru', password: 'tr123' },
  { email: 'sas@piling.ru', password: 'sas123' },
  { email: 'loadtest@piling.ru', password: 'loadtest123' },
  { email: 'apj@piling.ru', password: 'apj123' },
];

async function main() {
  console.log('🔑 Resetting user passwords...\n');
  
  for (const u of users) {
    const hashed = hashSync(u.password, 12);
    await db.user.update({
      where: { email: u.email },
      data: { password: hashed },
    });
    console.log(`   ✅ ${u.email} -> "${u.password}"`);
  }
  
  console.log('\n✅ All passwords reset!');
}

main()
  .then(() => db.$disconnect())
  .catch((e) => { console.error(e); process.exit(1); });
