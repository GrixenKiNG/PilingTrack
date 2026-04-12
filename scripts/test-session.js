// Test session token creation
require('dotenv').config({ path: '.env' });

async function main() {
  console.log('Testing session token creation...\n');

  const { createSessionToken, attachSessionCookie } = await import('./src/services/auth/session-service');
  const { NextResponse } = await import('next/server');

  const user = {
    id: 'cmnhx8zbt0000nsemnfsm8dxj',
    email: 'admin@piling.ru',
    name: 'Администратор',
    role: 'OPERATOR',
  };

  console.log('Creating session token...');
  const token = await createSessionToken(user);
  console.log('Token created, length:', token.length);
  console.log('Token (first 50):', token.substring(0, 50));

  console.log('\nCreating response with cookie...');
  const response = NextResponse.json({ user });
  attachSessionCookie(response, token);

  const cookie = response.cookies.get('pt-session');
  console.log('Cookie set:', cookie?.name, '- length:', cookie?.value?.length);

  console.log('\n✅ Session token creation works!');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
