import fs from 'node:fs';
const base = 'output/perf-1023/';
const summary = [];
const plans = [];
function walk(node, result = []) {
  result.push(node);
  for (const child of node.Plans || []) walk(child, result);
  return result;
}
for (const scale of [1, 5, 20]) {
  const data = JSON.parse(fs.readFileSync(base + `results-x${scale}.json`, 'utf8'));
  for (const row of data.results) {
    summary.push({ scale, function: row.function, n: row.sampleCount,
      p50Ms: row.p50Ms, p95Ms: row.p95Ms, firstCallMs: row.firstCallMs,
      sampledPeakRssMiB: row.sampledPeakRss / 1048576,
      processPeakRssMiB: row.processPeakRssBytes / 1048576,
      heapBeforeMiB: row.memoryBefore.heapUsed / 1048576,
      heapAfterMiB: row.memoryAfter.heapUsed / 1048576,
      databaseBytes: data.config.actual.databaseBytes,
    });
    const file = `plans-x${scale}-${row.function}.json`;
    for (const [index, value] of JSON.parse(fs.readFileSync(base + file, 'utf8')).entries()) {
      const document = value.plan[0];
      const nodes = walk(document.Plan);
      plans.push({ scale, function: row.function, file, planIndex: index,
        executionMs: document['Execution Time'], planningMs: document['Planning Time'],
        sharedHitBlocks: document.Plan['Shared Hit Blocks'], sharedReadBlocks: document.Plan['Shared Read Blocks'],
        tempReadBlocks: document.Plan['Temp Read Blocks'], tempWrittenBlocks: document.Plan['Temp Written Blocks'],
        scans: nodes.filter(n => n['Relation Name']).map(n => ({
          type: n['Node Type'], relation: n['Relation Name'], rows: n['Actual Rows'], loops: n['Actual Loops'],
          removed: n['Rows Removed by Filter'], index: n['Index Name'],
        })),
      });
    }
  }
}
fs.writeFileSync(base + 'summary.json', JSON.stringify({ summary, plans }, null, 2));
console.log('| Масштаб | Функция | p50, мс | p95, мс | Первый вызов, мс | RSS, MiB |');
console.log('| --- | --- | ---: | ---: | ---: | ---: |');
for (const r of summary) console.log(`| x${r.scale} | ${r.function} | ${r.p50Ms.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.firstCallMs.toFixed(1)} | ${r.sampledPeakRssMiB.toFixed(1)} |`);
console.log('\nLargest EXPLAIN executions:');
console.log(plans.sort((a, b) => b.executionMs - a.executionMs).slice(0, 6));
