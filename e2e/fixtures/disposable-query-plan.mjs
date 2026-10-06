import fs from 'node:fs';
import pg from 'pg';
const url=new URL(process.env.INTEGRATION_DATABASE_URL_APP||'http://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/codex_test'||url.username!=='pilingtrack_app')throw Error('Disposable app only');
const client=new pg.Client({connectionString:url.toString()});await client.connect();
try {
  const source=fs.readFileSync('src/services/analytics/site-analytics-service.ts','utf8');
  const marker='const rows = await db.$queryRaw<SiteAnalyticsRow[]>';const start=source.indexOf(marker)+marker.length+1;const end=source.indexOf(String.fromCharCode(96)+';',start);
  const values=[];const binds={dateFrom:'2025-10-04',dateTo:'2026-10-03',SUBMITTED_REPORT_STATUS:'submitted',tenantId:'codex-e1-a',siteId:null};
  const query=source.slice(start,end).replace(/\$\{(\w+)\}/g,(_,key)=>{if(!(key in binds))throw Error('Unknown bind '+key);values.push(binds[key]);return '$'+values.length;});
  await client.query('BEGIN');await client.query("SELECT set_config('app.current_tenant',$1,true)",['codex-e1-a']);
  const result=await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,values);
  fs.writeFileSync('output/codex-t5/e5-analytics-plan.json',JSON.stringify(result.rows[0]['QUERY PLAN'],null,2));
  console.log('Actual analytics SQL as non-BYPASS app: '+result.rows[0]['QUERY PLAN'][0]['Execution Time']+' ms');
  await client.query('ROLLBACK');
}finally{await client.end();}
