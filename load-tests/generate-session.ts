/**
 * Generate a valid session token for load testing.
 * This creates a session for an existing user in the database.
 * 
 * Run: npx tsx load-tests/generate-session.ts
 */

import { db } from '../src/lib/db';
import { createSessionToken } from '../src/services/auth/session-service';

async function main() {
  // Find first active user
  const user = await db.user.findFirst({
    where: { isActive: true },
    select: { id: true, email: true, name: true, role: true, tenantId: true },
  });

  if (!user) {
    console.error('❌ No active users found in database');
    process.exit(1);
  }

  console.log('👤 Found user:', JSON.stringify(user, null, 2));

  // Create a session token (uses default SESSION_TTL_SECONDS = 12h)
  const token = createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  });

  console.log('\n🔑 Session token generated:');
  console.log(token);
  console.log('\n📋 Use this in k6 as:');
  console.log(`   export const SESSION_COOKIE = 'session=${token}';`);
  console.log(`\n   Or in k6 script: --env SESSION_TOKEN=${token}`);
}

main().catch(console.error);
