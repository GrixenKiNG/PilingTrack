import { authenticateUserByEmailPassword } from '../src/services/auth/auth-service';

async function main() {
  const r = await authenticateUserByEmailPassword('loadtest@piling.ru', 'loadtest123');
  console.log(JSON.stringify({ user: !!r.user, rateLimited: r.rateLimited, reason: r.user ? 'ok' : 'no user' }, null, 2));
}

main().catch(console.error);
