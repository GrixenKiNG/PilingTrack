import { db } from '../src/lib/db';
import { compare } from 'bcryptjs';

async function main() {
  const email = 'loadtest@piling.ru';
  const password = 'loadtest123';

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      password: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  console.log('User found:', !!user);
  if (user) {
    console.log('isActive:', user.isActive);
    const ok = await compare(password, user.password);
    console.log('Password valid:', ok);
  }
}

main().catch(console.error);
