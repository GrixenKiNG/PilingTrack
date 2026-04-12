const http = require('http');
const BASE = 'http://localhost:3000';

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname, port: url.port || 3000,
      path: url.pathname + url.search, method,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, cookies: res.headers['set-cookie'] || [] }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Login first
  const loginRes = await makeRequest('POST', '/api/auth/login', {}, { email: 'admin@piling.ru', password: 'admin123' });
  const cookie = loginRes.cookies.find(c => c.includes('session'))?.split(';')[0];
  console.log('Cookie:', cookie.substring(0, 50) + '...\n');

  // Check problematic endpoints
  const endpoints = [
    '/api/crews',
    '/api/users',
    '/api/dictionary/all',
  ];

  for (const ep of endpoints) {
    console.log(`GET ${ep}`);
    const res = await makeRequest('GET', ep, { 'Cookie': cookie });
    console.log(`  Status: ${res.status}`);
    if (res.status === 200) {
      try {
        const json = JSON.parse(res.data);
        const keys = Object.keys(json);
        console.log(`  Keys: ${keys.join(', ')}`);
        for (const k of keys) {
          const val = json[k];
          if (Array.isArray(val)) {
            console.log(`    ${k}: Array[${val.length}]`);
            if (val.length > 0) console.log(`      First: ${JSON.stringify(val[0]).substring(0, 100)}`);
          } else {
            console.log(`    ${k}: ${typeof val} = ${JSON.stringify(val).substring(0, 100)}`);
          }
        }
      } catch (e) {
        console.log(`  Raw: ${res.data.substring(0, 200)}`);
      }
    } else {
      console.log(`  Body: ${res.data.substring(0, 200)}`);
    }
    console.log();
  }
}

main();
