const users = [
  { email: 'admin@piling.ru', passwords: ['1234', 'admin123', 'Admin123!', 'admin'] },
  { email: 'operator@piling.ru', passwords: ['0000', 'operator123', 'Operator123!', 'operator'] },
  { email: 'dispatch@piling.ru', passwords: ['2222', 'Dispatch123!', 'dispatch', '2222'] },
  { email: 'helper@piling.ru', passwords: ['3333', 'Helper123!', 'helper', '3333'] },
  { email: 'sas02@rambler.ru', passwords: ['1111', 'Sas02!123', 'sas02', '1111'] },
  { email: 'mag@piling.ru', passwords: ['mag', 'Mag123!', 'password', '123456'] },
  { email: 'kn@piling.ru', passwords: ['kn', 'Kn123!', 'password', '123456'] },
  { email: 'ivv@piling.ru', passwords: ['ivv', 'Ivv123!', 'password', '123456'] },
  { email: 'tr@piling.ru', passwords: ['tr', 'Tr123!', 'password', '123456'] },
  { email: 'sas@piling.ru', passwords: ['sas', 'Sas123!', 'password', '123456'] },
  { email: 'loadtest@piling.ru', passwords: ['loadtest123', 'loadtest', '123456'] },
  { email: 'apj@piling.ru', passwords: ['apj', 'Apj123!', 'password', '123456'] },
];

async function main() {
  console.log('=== Testing login credentials via API ===\n');
  
  for (const user of users) {
    console.log(`\n👤 ${user.email}:`);
    for (const password of user.passwords) {
      try {
        const res = await fetch('http://localhost:3000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, password }),
        });
        const data = await res.json();
        if (res.ok && data.user) {
          console.log(`   ✅ "${password}" -> role: ${data.user.role}, name: ${data.user.name}`);
        } else {
          console.log(`   ❌ "${password}" -> ${data.error || 'invalid'}`);
        }
      } catch (e) {
        console.log(`   ⚠️ Error: ${e.message}`);
      }
    }
  }
}

main();
