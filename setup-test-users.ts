/**
 * Create test users with password123
 */

import { db } from './src/lib/db';
import { hashPassword } from './src/services/auth/auth-service';

async function setupTestUsers() {
  console.log('\n🔧 Setting up test users...\n');

  const testUsers = [
    {
      email: 'admin@piling.ru',
      name: 'Admin User',
      role: 'ADMIN',
    },
    {
      email: 'dispatch@piling.ru',
      name: 'Dispatcher',
      role: 'DISPATCHER',
    },
    {
      email: 'operator@piling.ru',
      name: 'Operator',
      role: 'OPERATOR',
    },
    {
      email: 'helper@piling.ru',
      name: 'Assistant',
      role: 'ASSISTANT',
    },
  ];

  const hashedPassword = await hashPassword('password123');

  for (const testUser of testUsers) {
    const existing = await db.user.findUnique({
      where: { email: testUser.email },
    });

    if (existing) {
      // Update password
      await db.user.update({
        where: { email: testUser.email },
        data: {
          password: hashedPassword,
          name: testUser.name,
          role: testUser.role as any,
          isActive: true,
        },
      });
      console.log(`✅ Updated: ${testUser.email}`);
    } else {
      // Create new user
      await db.user.create({
        data: {
          email: testUser.email,
          name: testUser.name,
          password: hashedPassword,
          role: testUser.role as any,
          isActive: true,
          tenantId: 'default',
        },
      });
      console.log(`✨ Created: ${testUser.email}`);
    }
  }

  console.log('\n✅ Test users ready!\n');
  process.exit(0);
}

setupTestUsers().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
