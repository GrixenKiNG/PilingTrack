import pg from 'pg';
import fs from 'node:fs';
const url = new URL(process.env.INTEGRATION_DATABASE_URL_APP || 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test' || url.username !== 'pilingtrack_app') throw Error('Own disposable app role required');
const client = new pg.Client({ connectionString: url.toString(), statement_timeout: 15000 });
const capture = JSON.parse(fs.readFileSync('output/perf-1023/queries-x20-getFleetSnapshot.json', 'utf8'));
const selects = capture.filter(q => /^\s*(SELECT|WITH)\b/i.test(q.query) && !q.query.includes('set_config'));
await client.connect();
const plans = [];
try {
  for (const query of selects) {
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.current_tenant',$1,true)", ['codex-perf-1023']);
      const result = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.query, JSON.parse(query.params));
      plans.push({ query, plan: result.rows[0]['QUERY PLAN'] });
    } finally { await client.query('ROLLBACK'); }
  }
  fs.writeFileSync('output/perf-1023/plans-x20-getFleetSnapshot-all-selects.json', JSON.stringify(plans, null, 2));
  console.log(`EXPLAIN ${plans.length} actual fleet SELECTs completed on identically seeded fresh disposable DB`);
} finally { await client.end(); }
