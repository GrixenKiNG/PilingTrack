/**
 * Копирует в outDir ровно те файлы, которые нужны точкам входа во время работы.
 *
 * Использование: node scripts/trace-runtime-deps.cjs <outDir> <entry> [entry...]
 *
 * ЗАЧЕМ. Образ ws клал в себя весь production node_modules (~1.1 ГБ) и сборку
 * сайта ради бандла в 300 КБ, которому снаружи нужны единицы пакетов. На VPS с
 * диском 30 ГБ это стоило места при каждой сборке и в каждом откатном образе.
 *
 * ЧЕМ. @vercel/nft — тот же трассировщик, которым Next собирает standalone;
 * берём копию, вшитую в next, чтобы не заводить отдельную зависимость. Если
 * будущий Next её уберёт, require упадёт и сборка образа остановится явно —
 * молча пустой образ не получится.
 */
const fs = require('fs');
const path = require('path');
const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');

async function main() {
  const [outDir, ...entries] = process.argv.slice(2);
  if (!outDir || entries.length === 0) {
    console.error('usage: trace-runtime-deps.cjs <outDir> <entry> [entry...]');
    process.exit(2);
  }

  const base = process.cwd();
  const { fileList } = await nodeFileTrace(entries, { base });

  let copied = 0;
  for (const file of fileList) {
    const source = path.join(base, file);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) continue;
    const target = path.join(outDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied += 1;
  }

  console.log(`trace-runtime-deps: ${copied} files → ${outDir}`);
  if (copied === 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
