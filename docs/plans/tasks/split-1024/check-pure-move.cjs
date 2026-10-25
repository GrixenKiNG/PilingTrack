#!/usr/bin/env node
// Проверка «чистого переноса»: строки кода до и после разделения файла совпадают
// как множество; отличаться могут только import/export. Любая другая разница —
// это правка, а не перенос: её надо назвать в отчёте и обосновать.
//
// Запуск: node docs/plans/tasks/split-1024/check-pure-move.cjs <ref> <путь исходного файла> <новый файл>...
// <ref> — коммит ДО разделения; сам исходный файл (уже урезанный) тоже указывать в списке новых.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');

const [ref, original, ...after] = process.argv.slice(2);
if (!ref || !original || after.length === 0) {
  console.error('usage: check-pure-move.cjs <ref> <original> <file>...');
  process.exit(2);
}

function normalize(text) {
  const stripped = text
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(type\s+)?(\{[^}]*\}|\*(\s+as\s+\w+)?)\s*from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(default\s+)?/gm, '');
  return stripped.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
}

const before = normalize(execFileSync('git', ['show', `${ref}:${original}`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
const now = after.flatMap((file) => normalize(fs.readFileSync(file, 'utf8')));

const count = (lines) => lines.reduce((map, line) => map.set(line, (map.get(line) ?? 0) + 1), new Map());
const a = count(before);
const b = count(now);
const removed = [];
const added = [];
for (const [line, n] of a) if ((b.get(line) ?? 0) < n) removed.push(`${n - (b.get(line) ?? 0)}× ${line}`);
for (const [line, n] of b) if ((a.get(line) ?? 0) < n) added.push(`${n - (a.get(line) ?? 0)}× ${line}`);

console.log(`строк кода до: ${before.length}, после: ${now.length}`);
if (removed.length === 0 && added.length === 0) {
  console.log('OK: чистый перенос, отличаются только import/export');
  process.exit(0);
}
console.log(`ПРОПАЛО (${removed.length}):`); removed.forEach((l) => console.log('  - ' + l));
console.log(`ПОЯВИЛОСЬ (${added.length}):`); added.forEach((l) => console.log('  + ' + l));
process.exit(1);
