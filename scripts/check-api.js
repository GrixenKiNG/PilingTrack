const http = require('http');

const BASE = 'http://localhost:3000';

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + path, { headers: { 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
  });
}

async function main() {
  console.log('Проверка API endpoints...\n');

  const endpoints = [
    '/api/equipment',
    '/api/crews',
    '/api/users',
    '/api/dictionary/all',
    '/api/sites',
    '/api/reports',
  ];

  for (const ep of endpoints) {
    console.log(`GET ${ep}`);
    try {
      const res = await get(ep);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        try {
          const json = JSON.parse(res.data);
          if (Array.isArray(json)) {
            console.log(`  Data: Array[${json.length}]`);
            if (json.length > 0) console.log(`  First: ${JSON.stringify(json[0]).substring(0, 150)}`);
          } else if (json.data && Array.isArray(json.data)) {
            console.log(`  Data: {data: [${json.data.length}]}`);
            if (json.data.length > 0) console.log(`  First: ${JSON.stringify(json.data[0]).substring(0, 150)}`);
          } else {
            console.log(`  Data: ${JSON.stringify(json).substring(0, 150)}`);
          }
        } catch (e) {
          console.log(`  Data: ${res.data.substring(0, 200)}`);
        }
      } else {
        console.log(`  Body: ${res.data.substring(0, 200)}`);
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
    console.log();
  }
}

main();
