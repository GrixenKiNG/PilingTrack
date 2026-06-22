const fs = require('fs');
const path = require('path');

const routes = [
  'src/app/api/route.ts',
  'src/app/api/ready/route.ts',
  'src/app/api/auth/login/route.ts',
  'src/app/api/auth/logout/route.ts',
  'src/app/api/auth/me/route.ts',
  'src/app/api/auth/pin/route.ts',
  'src/app/api/crews/route.ts',
  'src/app/api/crews/[id]/route.ts',
  'src/app/api/crews/all/route.ts',
  'src/app/api/crews/my/route.ts',
  'src/app/api/dictionary/all/route.ts',
  'src/app/api/dictionary/manage/route.ts',
  'src/app/api/equipment/route.ts',
  'src/app/api/equipment/[id]/route.ts',
  'src/app/api/equipment/all/route.ts',
  'src/app/api/equipment/manage/route.ts',
  'src/app/api/feedback/events/route.ts',
  'src/app/api/feedback/stream/route.ts',
  'src/app/api/recognize/route.ts',
  'src/app/api/reports/admin-upsert/route.ts',
  'src/app/api/reports/all/route.ts',
  'src/app/api/reports/edit/route.ts',
  'src/app/api/reports/export/route.ts',
  'src/app/api/reports/my/route.ts',
  'src/app/api/reports/period/route.ts',
  'src/app/api/reports/upsert/route.ts',
  'src/app/api/sites/route.ts',
  'src/app/api/sites/[id]/route.ts',
  'src/app/api/sites/[id]/assign/route.ts',
  'src/app/api/sites/[id]/hierarchy/route.ts',
  'src/app/api/sites/all/route.ts',
  'src/app/api/sites/create/route.ts',
  'src/app/api/system/route.ts',
  'src/app/api/telegram/configs/route.ts',
  'src/app/api/users/route.ts',
  'src/app/api/users/manage/route.ts',
  'src/app/api/analytics/sites/route.ts',
];

let updated = 0;
let skipped = 0;
let missing = 0;

for (const r of routes) {
  const fp = path.join(process.cwd(), r);
  if (!fs.existsSync(fp)) {
    console.log('MISSING:', r);
    missing++;
    continue;
  }

  let content = fs.readFileSync(fp, 'utf8');
  if (content.includes('export const runtime')) {
    console.log('SKIP (has runtime):', r);
    skipped++;
    continue;
  }

  // Insert after the last import statement, before first export
  const lines = content.split('\n');
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('import ') || line.match(/^import \{/)) {
      insertIdx = i + 1;
    } else if (line.trim() === '' && insertIdx > 0) {
      insertIdx = i + 1;
    } else if (line.startsWith('export ')) {
      break;
    }
  }

  lines.splice(insertIdx, 0, '', "export const runtime = 'nodejs';", '');
  fs.writeFileSync(fp, lines.join('\n'), 'utf8');
  updated++;
  console.log('UPDATED:', r);
}

console.log('\nDone:', updated, 'updated |', skipped, 'skipped |', missing, 'missing');
