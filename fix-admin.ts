process.env.DATABASE_URL_POSTGRES='postgresql://postgres:postgres@localhost:5432/pilingtrack_test?schema=public';
process.env.DATABASE_PROVIDER='postgres';

import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const p = new PrismaClient();
(async()=>{
  const hash = hashSync('admin123', 12);
  await p.user.updateMany({
    where: { email: 'admin@piling.ru' },
    data: { password: hash }
  });
  console.log('Password for admin@piling.ru set to: admin123');

  const users = await p.user.findMany({
    select: { id: true, email: true, role: true, isActive: true }
  });
  users.forEach(u => console.log(u.email, u.role, u.isActive));
  await p.$disconnect();
})();
