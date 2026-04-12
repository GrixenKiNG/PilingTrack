import { authenticateUserByEmailPassword } from '../src/services/auth/auth-service';

const testUsers = [
  { email: 'admin@piling.ru', passwords: ['1234', 'admin123', 'password'] },
  { email: 'operator@piling.ru', passwords: ['0000', 'operator123', 'password'] },
  { email: 'dispatch@piling.ru', passwords: ['2222', 'password'] },
  { email: 'helper@piling.ru', passwords: ['3333', 'password'] },
  { email: 'sas02@rambler.ru', passwords: ['1111', 'password'] },
];

async function main() {
  console.log('=== Testing user credentials ===\n');
  
  for (const user of testUsers) {
    console.log(`\n👤 ${user.email}:`);
    for (const password of user.passwords) {
      try {
        const result = await authenticateUserByEmailPassword(user.email, password);
        if (result.user) {
          console.log(`   ✅ password: "${password}" -> role: ${result.user.role}`);
        } else if (result.rateLimited) {
          console.log(`   ⏰ Rate limited`);
        } else {
          console.log(`   ❌ "${password}" -> invalid`);
        }
      } catch (e: any) {
        console.log(`   ⚠️ Error: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
