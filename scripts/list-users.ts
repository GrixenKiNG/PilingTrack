import { PrismaClient } from '../src/generated/postgres-client';

const db = new PrismaClient();

async function main() {
  const users = await db.user.findMany({
    select: { 
      id: true, 
      email: true, 
      name: true, 
      role: true, 
      phone: true,
      isActive: true,
      createdAt: true
    },
    orderBy: { email: 'asc' }
  });
  
  console.log('=== USERS, ROLES & CREDENTIALS ===\n');
  console.log(`Total users: ${users.length}\n`);
  
  // Group by role
  const byRole: Record<string, typeof users> = {};
  for (const u of users) {
    if (!byRole[u.role]) byRole[u.role] = [];
    byRole[u.role].push(u);
  }
  
  for (const [role, roleUsers] of Object.entries(byRole)) {
    const roleIcon = role === 'ADMIN' ? '🔑' : 
                     role === 'DISPATCHER' ? '📡' : 
                     role === 'OPERATOR' ? '👷' : 
                     role === 'ASSISTANT' ? '🔧' : '👤';
    console.log(`\n${roleIcon} ${role} (${roleUsers.length}):`);
    console.log('─'.repeat(60));
    for (const u of roleUsers) {
      console.log(`  📧 ${u.email}`);
      console.log(`  👤 ${u.name}`);
      console.log(`  📱 ${u.phone || '—'}`);
      console.log(`  ✅ ${u.isActive ? 'Active' : 'Inactive'}`);
      console.log('');
    }
  }
}

main().then(() => db.$disconnect()).catch(console.error);
