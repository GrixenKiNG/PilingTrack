// Run: node reproduce.cjs D:/PillingR/my-project
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.argv[2];
if (!root) throw Error('Explicit source root required');
const ts = require(path.join(root, 'node_modules/typescript'));
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/modules/reports/application/event-handlers.ts'), 'utf8'), {compilerOptions:{module:1,target:7}}).outputText;
const handlers = {}; let reads = 0; let release; let daily; let analytics;
const held = new Promise(resolve => { release = resolve; });
const db = {
  report: {
    findMany: async () => [{piles:[{count:++reads === 1 ? 5 : 9}], drillings:[], downtimes:[]}],
    findUnique: async () => ({siteId:'site', userId:'user', tenantId:'tenant', status:'submitted'}),
  },
  siteDailySummary: {
    upsert: async q => { if(q.update.totalPiles===5) await held; daily=q.update; },
    deleteMany: async () => { daily=null; },
  },
  reportAnalytics: {upsert:async q=>{analytics=q.update;}},
};
const out = {};
vm.runInNewContext(code, {exports:out, require:id => {
  if(id==='@/lib/db') return {db};
  if(id==='@/lib/report-status') return {SUBMITTED_REPORT_STATUS:'submitted'};
  if(id==='@/lib/logger') return {logger:{info(){},warn(){},error(){}}};
  if(id==='./domain-events') return {on:(t,f)=>{(handlers[t]??=[]).push(f);}};
  if(id==='../domain') return {REPORT_DOMAIN_EVENT_TYPES:{REPORT_CREATED:'ReportCreated',REPORT_UPDATED:'ReportUpdated',REPORT_SUBMITTED:'ReportSubmitted',REPORT_DELETED:'ReportDeleted'}};
  return {};
}, process:{env:{}},Date,Promise});
(async()=>{
  const old=out.recomputeSiteDailySummary('site','2026-10-24');
  await new Promise(resolve=>setImmediate(resolve));
  await out.recomputeSiteDailySummary('site','2026-10-24');
  assert.equal(daily.totalPiles,9); release(); await old;
  assert.equal(daily.totalPiles,5);
  console.log('REPRODUCED daily: new=9 overwritten by old=5');
  out.registerAnalyticsEventHandler();
  const update=handlers.ReportUpdated[0];
  await update({type:'ReportUpdated',aggregateId:'report',tenantId:'tenant',occurredAt:'2026-10-24T12:00:00Z',data:{totalPiles:9}});
  await update({type:'ReportUpdated',aggregateId:'report',tenantId:'tenant',occurredAt:'2026-10-24T11:00:00Z',data:{totalPiles:5}});
  assert.equal(analytics.totalPiles,5);
  console.log('REPRODUCED analytics: replay old=5 overwrites new=9');
  console.log('Scope: real transpiled functions, DB mocks; not PostgreSQL or HTTP');
})().catch(e=>{console.error(e);process.exitCode=1;});
