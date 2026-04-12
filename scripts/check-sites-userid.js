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
  const loginRes = await makeRequest('POST', '/api/auth/login', {}, { email: 'admin@piling.ru', password: 'admin123' });
  const cookie = loginRes.cookies.find(c => c.includes('session'))?.split(';')[0];
  const meRes = await makeRequest('GET', '/api/auth/me', { 'Cookie': cookie });
  const me = JSON.parse(meRes.data);
  const adminId = me.user.id;
  console.log(`Admin ID: ${adminId}\n`);

  // Test with userId parameter (like report form does)
  console.log(`GET /api/sites?userId=${adminId}`);
  const res = await makeRequest('GET', `/api/sites?userId=${adminId}`, { 'Cookie': cookie });
  console.log(`  Status: ${res.status}`);
  if (res.status === 200) {
    const json = JSON.parse(res.data);
    if (json.data && Array.isArray(json.data)) {
      console.log(`  ✅ data: Array[${json.data.length}]`);
      json.data.forEach(s => console.log(`    - ${s.name}`));
    } else {
      console.log(`  Response: ${JSON.stringify(json).substring(0, 200)}`);
    }
  }
}

main();
