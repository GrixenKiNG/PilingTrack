process.env.DATABASE_LOG_QUERIES = 'true';
import fs from 'node:fs';
const run = async () => {
  const url = new URL(process.env.INTEGRATION_DATABASE_URL_APP || 'http://invalid');
  if(url.hostname!=='127.0.0.1'||url.pathname!=='/codex_test'||url.username!=='pilingtrack_app')throw Error('Disposable only');
  const { runWithTenantContext, setRequestTenantId } = await import('@/core/security/tenant-context');
  const { getFleetSnapshot } = await import('@/modules/monitoring');
  const { listPilePassports } = await import('@/modules/reports/application/queries/pile-passport.service');
  const { getReportsByPeriod } = await import('@/modules/reports/application/queries/report-query.service');
  const original = process.stdout.write.bind(process.stdout);
  let queries = 0;
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => { if(String(chunk).includes('prisma:query'))queries++;return Reflect.apply(original, process.stdout, [chunk,...args]); }) as typeof process.stdout.write;
  const results = [];
  try {
    for(const [name,work] of [
      ['Fleet30', () => getFleetSnapshot({tenantId:'codex-e1-a'})],
      ['Journal10', () => listPilePassports({tenantId:'codex-e1-a',limit:10})],
      ['Journal500', () => listPilePassports({tenantId:'codex-e1-a',limit:500})],
      ['Reports200', () => getReportsByPeriod('2025-10-04','2026-10-03',JSON.parse(fs.readFileSync('output/codex-t5/e5-performance.json','utf8')).prefix+'-site-0','codex-e1-a')],
    ] as const) {
      queries=0;
      await runWithTenantContext(async()=>{setRequestTenantId('codex-e1-a');await work();});
      results.push({name,queries});
    }
  } finally {process.stdout.write=original;}
  fs.writeFileSync('output/codex-t5/e5-query-counts.json',JSON.stringify(results,null,2));
};
run().then(()=>process.exit(0)).catch(e=>{process.stderr.write(String(e));process.exit(1);});
