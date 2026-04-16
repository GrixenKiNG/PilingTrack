const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const EXCLUDE_DIRS = ['node_modules', 'generated', '.next', '__tests__'];

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

function walkDir(dir, files = []) {
  if (EXCLUDE_DIRS.some(d => dir.includes(d))) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = walkDir(SRC_DIR);
const withSizes = allFiles.map(f => ({
  file: path.relative(SRC_DIR, f).replace(/\\/g, '/'),
  lines: countLines(f),
  sizeKB: Math.round(fs.statSync(f).size / 1024)
})).filter(f => f.lines > 50)
  .sort((a, b) => b.lines - a.lines);

console.log('='.repeat(90));
console.log('📏 БОЛЬШИЕ ФАЙЛЫ В ПРИЛОЖЕНИИ (src/)');
console.log('='.repeat(90));
console.log(`\nВсего файлов >50 строк: ${withSizes.length}\n`);

console.log('┌──────┬──────┬────────┬────────────────────────────────────────────────────────────┐');
console.log('│  #   │ Строк│ Размер │ Файл                                                     │');
console.log('├──────┼──────┼────────┼────────────────────────────────────────────────────────────┤');

// Top 40
withSizes.slice(0, 40).forEach((f, i) => {
  const num = `${i + 1}`.padStart(4);
  const lines = f.lines.toString().padStart(5);
  const size = f.sizeKB.toString().padStart(5) + ' KB';
  const file = f.file.length > 56 ? f.file.substring(0, 53) + '...' : f.file.padEnd(56);
  console.log(`│ ${num}  │ ${lines} │ ${size} │ ${file} │`);
});

console.log('└──────┴──────┴────────┴────────────────────────────────────────────────────────────┘');

// By category
console.log('\n\n📂 ПО КАТЕГОРИЯМ:\n');

const categories = {
  'UI Components': [],
  'Core/Infrastructure': [],
  'Modules/Domain': [],
  'Services': [],
  'Mobile/Sync': [],
  'Workers': [],
  'Realtime/WS': [],
  'Lib/Utils': [],
};

withSizes.forEach(f => {
  const p = f.file;
  if (p.startsWith('components/')) categories['UI Components'].push(f);
  else if (p.startsWith('core/')) categories['Core/Infrastructure'].push(f);
  else if (p.startsWith('modules/')) categories['Modules/Domain'].push(f);
  else if (p.startsWith('services/')) categories['Services'].push(f);
  else if (p.startsWith('mobile/')) categories['Mobile/Sync'].push(f);
  else if (p.startsWith('workers/')) categories['Workers'].push(f);
  else if (p.startsWith('realtime/')) categories['Realtime/WS'].push(f);
  else if (p.startsWith('lib/')) categories['Lib/Utils'].push(f);
});

for (const [cat, files] of Object.entries(categories)) {
  if (files.length === 0) continue;
  const totalLines = files.reduce((s, f) => s + f.lines, 0);
  console.log(`${cat} — ${files.length} файлов, ${totalLines.toLocaleString()} строк`);
  files.slice(0, 5).forEach(f => {
    console.log(`  ${f.lines.toString().padStart(5)} строк  ${f.file}`);
  });
  if (files.length > 5) console.log(`  ... и ещё ${files.length - 5}`);
  console.log();
}

// Summary
const totalLines = withSizes.reduce((s, f) => s + f.lines, 0);
const hugeFiles = withSizes.filter(f => f.lines >= 500);
const veryHuge = withSizes.filter(f => f.lines >= 1000);

console.log('═'.repeat(90));
console.log('📊 СВОДКА');
console.log('═'.repeat(90));
console.log(`Файлов >50 строк:    ${withSizes.length}`);
console.log(`Файлов >200 строк:   ${withSizes.filter(f => f.lines >= 200).length}`);
console.log(`Файлов >500 строк:   ${hugeFiles.length}`);
console.log(`Файлов >1000 строк:  ${veryHuge.length}`);
console.log(`Общий объём:         ${totalLines.toLocaleString()} строк`);
console.log(`Средний размер:      ${Math.round(totalLines / withSizes.length)} строк/файл`);

if (veryHuge.length > 0) {
  console.log(`\n⚠️  ФАЙЛЫ >1000 СТРОК (требуют разбиения):`);
  veryHuge.forEach(f => {
    console.log(`  ${f.lines} строк  ${f.file}`);
  });
}
