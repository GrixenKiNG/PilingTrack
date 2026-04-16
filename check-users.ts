process.env.DATABASE_URL_POSTGRES='postgresql://postgres:postgres@localhost:5432/pilingtrack_test?schema=public';
process.env.DATABASE_PROVIDER='postgres';

import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async()=>{
  const users = await p.user.findMany({
    select: { email: true, password: true }
  });
  users.forEach(u => console.log(u.email, u.password?.substring(0,15), '...'));
  await p.$disconnect();
})();
