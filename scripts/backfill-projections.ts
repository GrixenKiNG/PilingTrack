/**
 * Backfill projections from existing reports.
 *
 * Use case: a projector is added or revived after reports already exist
 * (their outbox events are already marked projected=true). This calls the
 * same code path used by POST /api/admin/projections/rebuild — single
 * source of truth.
 *
 * Run:  npx tsx scripts/backfill-projections.ts [name]
 *   name = operator-performance | site-daily | site-weekly | all (default)
 */
import 'dotenv/config';

async function main() {
  const arg = (process.argv[2] || 'all').trim();
  const { rebuildAll, rebuildOperatorPerformance, rebuildSiteDailySummary, rebuildSiteWeeklyTrend } =
    await import('../src/modules/reports/application/projections/rebuild');

  const results =
    arg === 'all' ? await rebuildAll() :
    arg === 'operator-performance' ? [await rebuildOperatorPerformance()] :
    arg === 'site-daily' ? [await rebuildSiteDailySummary()] :
    arg === 'site-weekly' ? [await rebuildSiteWeeklyTrend()] :
    null;

  if (!results) {
    console.error(`Unknown projection: ${arg}`);
    console.error('Allowed: operator-performance | site-daily | site-weekly | all');
    process.exit(1);
  }

  for (const r of results) {
    console.log(`${r.name}: ${r.rowsWritten} rows in ${r.durationMs}ms`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
