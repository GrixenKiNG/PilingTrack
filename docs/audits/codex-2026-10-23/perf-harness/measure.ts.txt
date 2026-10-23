import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import assert from 'node:assert/strict';

async function main() {
  const scale = Number(process.argv[2]);
  const config = JSON.parse(readFileSync(`output/perf-1023/config-x${scale}.json`, 'utf8'));
  const url = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test' || url.username !== 'pilingtrack_app') throw Error('Disposable application role required');
  const { PrismaClient } = await import('../../src/generated/postgres-client/client');
  let capture = false;
  let captured: { query: string; params: string; duration: number }[] = [];
  // Real Prisma, real adapter and unchanged lib/db + tenant GUC wrappers.
  // Only query event logging is added; no query/result is substituted.
  class InstrumentedPrismaClient extends PrismaClient {
    constructor(options: ConstructorParameters<typeof PrismaClient>[0]) {
      super({ ...options, log: [{ level: 'query', emit: 'event' }, 'warn', 'error'] });
      this.$on('query' as never, ((event: { query: string; params: string; duration: number }) => {
        if (capture) captured.push(event);
      }) as never);
    }
  }
  (globalThis as unknown as { prismaRuntimeModule: unknown }).prismaRuntimeModule = { PrismaClient: InstrumentedPrismaClient };
  const { runWithTenantContext, setRequestTenantId } = await import('../../src/core/security/tenant-context');
  const { db } = await import('../../src/lib/db');
  const { getFleetSnapshot } = await import('../../src/modules/monitoring/application/queries/fleet-monitoring.service');
  const { getSiteAnalytics } = await import('../../src/modules/analytics/application/queries/site-analytics-service');
  const { getEquipmentAnalytics } = await import('../../src/modules/analytics/application/queries/equipment-analytics-service');
  const { pileJournalTotals } = await import('../../src/modules/reports/application/queries/pile-journal-totals');
  const explainClient = new pg.Client({ connectionString: url.toString(), statement_timeout: 15000 });
  await explainClient.connect();
  const results: unknown[] = [];
  function withTenant<T>(fn: () => T): T {
    return runWithTenantContext(() => { setRequestTenantId(config.tenantId); return fn(); });
  }
  const calls = [
    { name: 'getFleetSnapshot', run: () => getFleetSnapshot({ tenantId: config.tenantId }), check: (r: any) => {
      assert.equal(r.equipment.length, config.equipment);
      assert.equal(r.totals.pilesToday, config.equipment * config.pilesPerReport);
      assert.ok(r.equipment.every((e: any) => e.photoUrl));
    } },
    { name: 'getSiteAnalytics', run: () => getSiteAnalytics({ tenantId: config.tenantId, dateFrom: config.dateFrom, dateTo: config.today }), check: (r: any) => {
      assert.equal(r.length, config.sites);
      assert.equal(r.reduce((sum: number, site: any) => sum + site.actualPiles, 0), config.pileRows);
    } },
    { name: 'getEquipmentAnalytics', run: () => getEquipmentAnalytics({ tenantId: config.tenantId, dateFrom: config.dateFrom, dateTo: config.today, timezone: 'Europe/Moscow' }), check: (r: any) => {
      assert.equal(r.equipment.length, config.equipment);
      assert.equal(r.fleet.piles, config.pileRows);
      assert.equal(r.fleet.fuelLiters, config.equipment * (config.days - 1) * 40);
    } },
    { name: 'pileJournalTotals', run: () => pileJournalTotals({ tenantId: config.tenantId }, undefined, null), check: (r: any) => {
      assert.equal(r.rows, config.pileRows);
      assert.equal(r.piles, config.pileRows);
      assert.equal(r.withoutPassportPiles, 0);
    } },
  ];
  try {
    const dbIdentity = await explainClient.query('SELECT current_user, current_database(), version(), current_setting(\'statement_timeout\') AS statement_timeout');
    for (const item of calls) {
      captured = [];
      capture = true;
      const firstStart = performance.now();
      const firstResult = await withTenant(item.run);
      const firstCallMs = performance.now() - firstStart;
      await new Promise(resolve => setImmediate(resolve));
      capture = false;
      item.check(firstResult);
      const discoveryQueries = captured;
      for (let i = 0; i < 3; i++) item.check(await withTenant(item.run));
      const gc = (globalThis as unknown as { gc?: () => void }).gc;
      gc?.();
      const before = process.memoryUsage();
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const memoryBefore = process.memoryUsage();
        const start = performance.now();
        const result = await withTenant(item.run);
        const elapsedMs = performance.now() - start;
        const memoryAfter = process.memoryUsage();
        item.check(result);
        samples.push({ elapsedMs, memoryBefore, memoryAfter });
      }
      const sorted = samples.map(s => s.elapsedMs).sort((a, b) => a - b);
      const summary = {
        function: item.name, scale, sampleCount: samples.length, firstCallMs,
        p50Ms: sorted[Math.ceil(sorted.length * 0.50) - 1],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        minMs: sorted[0], maxMs: sorted[sorted.length - 1],
        memoryBefore: before, memoryAfter: process.memoryUsage(),
        sampledPeakRss: Math.max(...samples.map(s => s.memoryAfter.rss)),
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        discoveryQueryCount: discoveryQueries.length,
      };
      results.push({ ...summary, samples });
      writeFileSync(`output/perf-1023/results-x${scale}.json`, JSON.stringify({ config, node: process.version, identity: dbIdentity.rows[0], results }, null, 2));
      writeFileSync(`output/perf-1023/queries-x${scale}-${item.name}.json`, JSON.stringify(discoveryQueries, null, 2));
      // Separate EXPLAIN pass: never included in timed service samples.
      const heavy = [...new Map(discoveryQueries.filter(q => /^\s*(SELECT|WITH)\b/i.test(q.query) && !q.query.includes('set_config')).map(q => [q.query, q])).values()]
        .sort((a, b) => b.duration - a.duration).slice(0, 3);
      const plans = [];
      for (const query of heavy) {
        await explainClient.query('BEGIN');
        try {
          await explainClient.query("SELECT set_config('app.current_tenant',$1,true)", [config.tenantId]);
          const plan = await explainClient.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.query, JSON.parse(query.params));
          plans.push({ query, plan: plan.rows[0]['QUERY PLAN'] });
        } finally { await explainClient.query('ROLLBACK'); }
      }
      writeFileSync(`output/perf-1023/plans-x${scale}-${item.name}.json`, JSON.stringify(plans, null, 2));
      console.log(JSON.stringify(summary));
    }
  } finally {
    await db.$disconnect();
    await explainClient.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
