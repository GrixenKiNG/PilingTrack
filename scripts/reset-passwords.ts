/**
 * Reset user passwords to known defaults.
 */
import { PrismaClient } from '../src/generated/postgres-client/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashSync } from 'bcryptjs';

const connectionString = process.env.DATABASE_URL_POSTGRES;

if (!connectionString) {
  throw new Error('DATABASE_URL_POSTGRES is required to reset passwords.');
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const users = [
  { email: 'admin@piling.ru', password: 'admin123' },
  { email: 'dispatch@piling.ru', password: 'dispatch123' },
  { email: 'operator@piling.ru', password: 'operator123' },
  { email: 'helper@piling.ru', password: 'helper123' },
  { email: 'sas02@rambler.ru', password: 'sas02password' },
  { email: 'mag@piling.ru', password: 'mag123' },
  { email: 'kn@piling.ru', password: 'kn123' },
  { email: 'ivv@piling.ru', password: 'ivv123' },
  { email: 'tr@piling.ru', password: 'tr123' },
  { email: 'sas@piling.ru', password: 'sas123' },
  { email: 'loadtest@piling.ru', password: 'loadtest123' },
  { email: 'apj@piling.ru', password: 'apj123' },
];

async function main() {
  console.log('Resetting user passwords...');

  for (const user of users) {
    const result = await db.user.updateMany({
      where: { email: user.email },
      data: {
        password: hashSync(user.password, 12),
        isActive: true,
      },
    });

    if (result.count === 0) {
      console.log(`${user.email} -> skipped (user not found)`);
    } else {
      console.log(`${user.email} -> ${user.password}`);
    }
  }

  console.log('All passwords reset.');
}

main()
  .then(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
