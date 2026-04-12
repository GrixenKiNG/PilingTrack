const http = require('http');

const BASE = 'http://localhost:3000';

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const cookies = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, data, cookies });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('🔐 Логин для получения cookies...\n');

  // 1. Login
  const loginRes = await makeRequest('POST', '/api/auth/login', {}, {
    email: 'admin@piling.ru',
    password: 'admin123'
  });
  console.log(`Login status: ${loginRes.status}`);
  console.log(`Login cookies: ${loginRes.cookies.length}`);

  const sessionCookie = loginRes.cookies.find(c => c.includes('session')) || '';
  if (!sessionCookie) {
    console.log('❌ Не найден session cookie');
    console.log('All cookies:', loginRes.cookies);
    return;
  }
  console.log(`✓ Session cookie получен`);

  const cookieHeader = sessionCookie.split(';')[0];
  console.log(`  Cookie: ${cookieHeader}\n`);

  // 2. Проверка API с cookies
  console.log('=== API с авторизацией ===\n');

  const endpoints = [
    '/api/equipment',
    '/api/crews',
    '/api/users',
    '/api/dictionary/all',
    '/api/sites?limit=10',
  ];

  for (const ep of endpoints) {
    console.log(`GET ${ep}`);
    try {
      const res = await makeRequest('GET', ep, { 'Cookie': cookieHeader });
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        try {
          const json = JSON.parse(res.data);
          if (Array.isArray(json)) {
            console.log(`  ✅ Array[${json.length}]`);
            if (json.length > 0) {
              const item = json[0];
              const preview = JSON.stringify(item).substring(0, 120);
              console.log(`     ${preview}...`);
            }
          } else if (json.data && Array.isArray(json.data)) {
            console.log(`  ✅ {data: [${json.data.length}]}`);
            if (json.data.length > 0) {
              const item = json.data[0];
              const preview = JSON.stringify(item).substring(0, 120);
              console.log(`     ${preview}...`);
            }
          } else if (json.items && Array.isArray(json.items)) {
            console.log(`  ✅ {items: [${json.items.length}]}`);
          } else {
            console.log(`  JSON: ${JSON.stringify(json).substring(0, 150)}`);
          }
        } catch (e) {
          console.log(`  Raw: ${res.data.substring(0, 200)}`);
        }
      } else {
        console.log(`  ❌ Body: ${res.data.substring(0, 200)}`);
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
    console.log();
  }

  // 3. Проверка /api/auth/me
  console.log('👤 /api/auth/me:');
  const meRes = await makeRequest('GET', '/api/auth/me', { 'Cookie': cookieHeader });
  if (meRes.status === 200) {
    const me = JSON.parse(meRes.data);
    console.log(`  ✅ ${me.user?.name} (${me.user?.role})`);
  }
}

main().catch(console.error);
