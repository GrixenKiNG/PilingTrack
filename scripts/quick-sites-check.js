const http = require('http');

async function main() {
  // Login
  const loginData = JSON.stringify({ email: 'admin@piling.ru', password: 'admin123' });
  const loginRes = await new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, cookies: res.headers['set-cookie'] || [] }));
    });
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  const cookie = loginRes.cookies.find(c => c.includes('session'))?.split(';')[0];
  console.log('Cookie:', cookie.substring(0, 60) + '...');

  // Get sites with userId
  const sitesRes = await new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/sites?userId=cmnhx8zbt0000nsemnfsm8dxj', {
      method: 'GET',
      headers: { 'Cookie': cookie, 'Accept': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end();
  });

  console.log('\nGET /api/sites?userId=... Status:', sitesRes.status);
  const json = JSON.parse(sitesRes.data);
  if (json.data && Array.isArray(json.data)) {
    console.log(`✅ data: Array[${json.data.length}]`);
    json.data.forEach(s => console.log(`   - ${s.name}`));
  } else {
    console.log('Response:', JSON.stringify(json).substring(0, 300));
  }
}

main();
