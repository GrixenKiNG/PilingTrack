/**
 * Check if test users exist in database
 */

import { db } from './src/lib/db';

async function checkTestUsers() {
  console.log('\n🔍 Checking test users in database...\n');

  const testEmails = [
    'admin@pilingtrack.local',
    'dispatcher@pilingtrack.local',
    'operator@pilingtrack.local',
    'assistant@pilingtrack.local',
  ];

  for (const email of testEmails) {
    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        password: true,
      },
    });

    if (user) {
      console.log(`✅ Found: ${email}`);
      console.log(`   Name: ${user.name}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Active: ${user.isActive}`);
      console.log(`   Password hash: ${user.password.substring(0, 20)}...`);
    } else {
      console.log(`❌ NOT FOUND: ${email}`);
    }
    console.log();
  }

  // Show total users
  const allUsers = await db.user.count();
  console.log(`Total users in database: ${allUsers}`);

  // Show first few users
  const users = await db.user.findMany({
    take: 5,
    select: {
      email: true,
      name: true,
      role: true,
    },
  });

  if (users.length > 0) {
    console.log('\nFirst users in database:');
    users.forEach(u => {
      console.log(`  - ${u.email} (${u.role})`);
    });
  }

  process.exit(0);
}

checkTestUsers().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
