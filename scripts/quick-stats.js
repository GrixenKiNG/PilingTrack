const fs = require('fs');
const path = require('path');
const SRC_DIR = path.join(__dirname, '..', 'src');
const EXCLUDE = ['node_modules', 'generated', '.next', '__tests__'];

function walk(dir, files = []) {
  if (EXCLUDE.some(d => dir.includes(d))) return files;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, files);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(full);
    }
  } catch {}
  return files;
}

const all = walk(SRC_DIR);
const lines = all.map(f => ({ file: path.relative(SRC_DIR, f).replace(/\\/g, '/'), lines: fs.readFileSync(f, 'utf-8').split('\n').length })).filter(f => f.lines > 50);
const total = lines.reduce((s, f) => s + f.lines, 0);
const gt500 = lines.filter(f => f.lines >= 500);
const gt1000 = lines.filter(f => f.lines >= 1000);

console.log('SUMMARY:');
console.log(`  Files >50 lines: ${lines.length}`);
console.log(`  Files >200 lines: ${lines.filter(f => f.lines >= 200).length}`);
console.log(`  Files >500 lines: ${gt500.length}`);
console.log(`  Files >1000 lines: ${gt1000.length}`);
console.log(`  Total lines: ${total.toLocaleString()}`);
console.log(`  Average: ${Math.round(total / lines.length)} lines/file`);
if (gt1000.length) console.log(`\n  FILES >1000: ${gt1000.map(f => `${f.lines} ${f.file}`).join(', ')}`);
console.log(`\n  TOP 10:`);
lines.sort((a, b) => b.lines - a.lines).slice(0, 10).forEach(f => console.log(`    ${f.lines.toString().padStart(5)}  ${f.file}`));
