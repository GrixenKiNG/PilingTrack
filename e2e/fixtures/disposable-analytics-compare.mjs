import fs from 'node:fs';import pg from 'pg';
const url=new URL(process.env.INTEGRATION_DATABASE_URL_APP||'http://invalid');if(url.hostname!=='127.0.0.1'||url.pathname!=='/codex_test'||url.username!=='pilingtrack_app')throw Error('Disposable only');
const client=new pg.Client({connectionString:url.toString()});await client.connect();
const extract=source=>{const marker='const rows = await db.$queryRaw<SiteAnalyticsRow[]>';const start=source.indexOf(marker)+marker.length+1;const end=source.indexOf(String.fromCharCode(96)+';',start);return source.slice(start,end);};
const sources=[fs.readFileSync('output/codex-t5/e5-analytics-before-source.txt','utf8'),fs.readFileSync('src/services/analytics/site-analytics-service.ts','utf8')].map(extract);
const build=(source,from)=>{const values=[];const binds={dateFrom:from,dateTo:'2026-10-03',SUBMITTED_REPORT_STATUS:'submitted',tenantId:'codex-e1-a',siteId:null};return {text:source.replace(/\$\{(\w+)\}/g,(_,key)=>{if(!(key in binds))throw Error('Unknown bind');values.push(binds[key]);return '$'+values.length;}),values};};
try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.current_tenant',$1,true)",['codex-e1-a']);
  const timings=[[],[]];let equal=true;
  for(let n=0;n<31;n++)for(const j of [n%2,(n+1)%2]) {const query=build(sources[j],'2025-10-04');const start=performance.now();await client.query(query);if(n>0)timings[j].push(performance.now()-start);}
  for(const from of ['2025-10-04','2026-09-01']) {const rows=await Promise.all(sources.map(source=>client.query(build(source,from))));if(JSON.stringify(rows[0].rows)!==JSON.stringify(rows[1].rows))equal=false;}
  const results=[];
  for(let j=0;j<2;j++){timings[j].sort((a,b)=>a-b);const query=build(sources[j],'2025-10-04');const result=await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query.text,query.values);results.push({phase:j?'after':'before',n:30,p50:timings[j][14],p95:timings[j][28],plan:result.rows[0]['QUERY PLAN']});}
  if(!equal)throw Error('Old/new KPI differ');
  fs.writeFileSync('output/codex-t5/e5-analytics-compare.json',JSON.stringify({equal,results},null,2));console.log(JSON.stringify({equal,results:results.map(({plan,...x})=>({...x,explainMs:plan[0]['Execution Time']}))},null,2));
}finally{await client.query('ROLLBACK');await client.end();}
