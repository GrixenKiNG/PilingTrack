import { compare } from 'bcryptjs';

async function main() {
  const hash = '$2b$12$XDcXL8yEN5mGY7N./FelWu8WSpU2Lv0foB8E9piOA4f2afTwWZMi.';
  const ok = await compare('loadtest123', hash);
  console.log('bcrypt compare:', ok);
}

main().catch(console.error);
