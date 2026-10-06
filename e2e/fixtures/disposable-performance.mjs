import pg from 'pg';
import Redis from 'ioredis';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
const owner = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
const base = new URL(process.env.BASE_URL || 'http://invalid');
const redisUrl = new URL(process.env.REDIS_URL_CACHE || 'http://invalid');
if(owner.hostname!=='127.0.0.1'||owner.pathname!=='/codex_test'||owner.username!=='piling'||base.hostname!=='127.0.0.1'||redisUrl.hostname!=='127.0.0.1'||!/^codex-pg-[a-f0-9]+$/.test(process.env.INTEGRATION_DB_CONTAINER||'')) throw Error('Disposable stand only');
const db=new pg.Client({connectionString:owner.toString()});
const redis=new Redis(redisUrl.toString());
let prefix='codex-perf-'+randomBytes(6).toString('hex'); const tenant='codex-e1-a';
await db.connect();
try {
  if (process.argv.includes('--reuse')) {
    const existing = await db.query(`SELECT id FROM "Site" WHERE "tenantId"=$1 AND id LIKE 'codex-perf-%-site-0' ORDER BY id LIMIT 1`,[tenant]);
    const match = existing.rows[0]?.id.match(/^(codex-perf-[a-f0-9]+)-site-0$/);
    if(!match) throw Error('No own benchmark seed'); prefix=match[1];
  } else {
  await db.query('BEGIN');
  await db.query(`INSERT INTO "Site" (id,"tenantId",name,"updatedAt") SELECT $1||'-site-'||i,$2,'Codex perf site '||i,now() FROM generate_series(0,9)i`,[prefix,tenant]);
  await db.query(`INSERT INTO "Equipment" (id,"tenantId",name,"updatedAt") SELECT $1||'-eq-'||i,$2,'Codex perf rig '||i,now() FROM generate_series(0,29)i`,[prefix,tenant]);
  await db.query(`INSERT INTO "Report" (id,"reportId","tenantId","userId","siteId","equipmentId",date,status,"shiftStart","shiftEnd","updatedAt") SELECT $1||'-report-'||i,$1||'-report-'||i,$2,'codex-e1-operator',$1||'-site-'||(i%10),$1||'-eq-'||(i%30),to_char(date '2025-10-04'+((i/10*31)%365),'YYYY-MM-DD'),'submitted','08:00','20:00',now() FROM generate_series(0,1999)i`,[prefix,tenant]);
  await db.query(`INSERT INTO "PileWork" (id,"reportId","tenantId","pileGradeId",count) SELECT $1||'-pile-'||i,$1||'-report-'||(i/10),$2,'codex-e1-a-grade',1 FROM generate_series(0,19999)i`,[prefix,tenant]);
  await db.query(`INSERT INTO "PilePassport" (id,"tenantId","pileWorkId","clientCommandId","pileNumber","drivenAt","recordedById","updatedAt") SELECT $1||'-passport-'||i,$2,$1||'-pile-'||i,$1||'-command-'||i,'С-'||i,date '2025-10-04'+((i/100*31)%365)+interval '10 hours'+(i%10)*interval '1 minute','codex-e1-operator',now() FROM generate_series(0,19999)i`,[prefix,tenant]);
  await db.query(`INSERT INTO "ReportAnalytics" (id,"reportId","tenantId","userId","siteId",status,"totalPiles") SELECT $1||'-analytics-'||i,$1||'-report-'||i,$2,'codex-e1-operator',$1||'-site-'||(i%10),'submitted',10 FROM generate_series(0,1999)i`,[prefix,tenant]);
  await db.query('COMMIT');
  }
  for(const table of ['Site','Equipment','Report','PileWork','PilePassport','ReportAnalytics']) await db.query('ANALYZE "'+table+'"');
  const login=await fetch(base.origin+'/api/auth/login',{method:'POST',headers:{Origin:base.origin,'Content-Type':'application/json'},body:JSON.stringify({email:process.env.E2E_ADMIN_EMAIL,password:process.env.E2E_ADMIN_PASSWORD})});
  if(login.status!==200) throw Error('Own ADMIN login failed '+login.status);
  const cookie=login.headers.getSetCookie().find(v=>v.startsWith('pt-session='))?.split(';')[0];
  const routes=[['Главная','/api/monitoring/fleet'],['Отчёты список','/api/reports/all?limit=25'],['Отчёты год/объект','/api/reports/period?dateFrom=2025-10-04&dateTo=2026-10-03&siteId='+prefix+'-site-0'],['Журнал','/api/pile-passports'],['Парк','/api/equipment'],['План-факт','/api/analytics/sites?dateFrom=2025-10-04&dateTo=2026-10-03'],['Аналитика','/api/admin/analytics/overview?dateFrom=2025-10-04&dateTo=2026-10-03']];
  const guard = await fetch(base.origin+'/api/reports/period?dateFrom=2025-10-04&dateTo=2026-10-03',{headers:{Cookie:cookie}});
  console.log('Year all-sites guard HTTP '+guard.status);
  const measurements=[];
  for(const [name,path] of routes) {
    const times=[];let bytes=0;
    for(let i=0;i<31;i++) {
      const keys=await redis.keys('pilingtrack:*analytics:sites:*'); if(keys.length)await redis.del(...keys);
      const start=performance.now();const response=await fetch(base.origin+path+(path.includes('?')?'&':'?')+'_ts='+Date.now()+'-'+i,{headers:{Cookie:cookie}});const data=await response.text();
      if(response.status!==200)throw Error(name+' HTTP '+response.status+' '+data.slice(0,100));
      bytes=Buffer.byteLength(data);if(i>0)times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);measurements.push({name,path,n:times.length,p50:times[14],p95:times[28],bytes});
  }
  const plans=[];
  for(const [name,query,params] of [
    ['Journal ordered page',`SELECT id FROM "PilePassport" WHERE "tenantId"=$1 ORDER BY "drivenAt" DESC LIMIT 501`,[tenant]],
    ['Reports page',`SELECT id FROM "Report" WHERE "tenantId"=$1 AND status='submitted' ORDER BY date DESC LIMIT 25`,[tenant]],
    ['Pile aggregation',`SELECT "reportId",sum(count) FROM "PileWork" WHERE "tenantId"=$1 GROUP BY "reportId"`,[tenant]],
    ['Fleet',`SELECT id FROM "Equipment" WHERE "tenantId"=$1 ORDER BY name LIMIT 51`,[tenant]],
  ]) {
    const result=await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query,params);plans.push({name,plan:result.rows[0]['QUERY PLAN']});
  }
  const result={prefix,allSitesYearStatus:guard.status,seed:{sites:10,equipment:30,reports:2000,piles:20000,passports:20000},method:'30 serial samples after one warm-up; _ts bypasses process cache; own Redis analytics entries deleted between samples; full response consumed',measurements,plans};
  fs.writeFileSync('output/codex-t5/e5-performance.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({seed:result.seed,measurements},null,2));
} catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;} finally { await db.end();await redis.quit(); }
