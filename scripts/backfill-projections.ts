/**
 * Backfill projections from existing reports.
 *
 * Use case: a projector is added or revived after reports already exist
 * (their outbox events are already marked projected=true). This walks
 * every report in the DB and replays the relevant projection logic.
 *
 * Run:  npx tsx scripts/backfill-projections.ts
 */
import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const reports = await db.report.findMany({
    select: { id: true, userId: true, siteId: true, date: true },
    orderBy: { date: 'asc' },
  });
  console.log(`Found ${reports.length} reports`);

  // Collect distinct (userId, siteId, date) triples — projection key.
  const triples = new Map<string, { userId: string; siteId: string; date: string }>();
  for (const r of reports) {
    triples.set(`${r.userId}|${r.siteId}|${r.date}`, {
      userId: r.userId, siteId: r.siteId, date: r.date,
    });
  }
  console.log(`Distinct (userId, siteId, date) keys: ${triples.size}`);

  // Lazy-import the projection module so dotenv runs first.
  const { projectOperatorPerformanceFull } = await import(
    '../src/modules/reports/application/projections/projection-worker'
  ) as { projectOperatorPerformanceFull?: (u: string, s: string, d: string) => Promise<void> };

  if (!projectOperatorPerformanceFull) {
    throw new Error('projectOperatorPerformanceFull is not exported from projection-worker.ts');
  }

  let i = 0;
  for (const t of triples.values()) {
    i += 1;
    process.stdout.write(`\r[${i}/${triples.size}] ${t.userId.slice(0, 6)}…/${t.siteId.slice(0, 6)}…/${t.date}     `);
    await projectOperatorPerformanceFull(t.userId, t.siteId, t.date);
  }
  console.log('\nDone.');

  const count = await db.operatorPerformance.count();
  console.log(`OperatorPerformance now has ${count} rows.`);
  process.exit(0);
}

main().catch((e) => { console.error('\nERROR', e); process.exit(1); });
