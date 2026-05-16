/**
 * Dev smoke check for the fleet-monitoring service.
 * Invokes getFleetSnapshot() directly with the local tenantId and
 * prints a one-line summary plus the first card — enough to confirm
 * the SQL works and the shape matches the API contract.
 *
 *   npx tsx scripts/dev/smoke-fleet-monitoring.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (same pattern as the now-removed simulator).
(function loadDotenv() {
  const envPath = resolve(__dirname, '..', '..', '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
})();

async function main() {
  const { getFleetSnapshot } = await import('@/modules/monitoring');
  const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
  const snap = await getFleetSnapshot({ tenantId });

  console.log(`asOf: ${snap.asOf}`);
  console.log(`today: ${snap.today}`);
  console.log(`totals:`, snap.totals);
  console.log(`---`);
  for (const c of snap.equipment) {
    const last = c.latestReport
      ? `${c.latestReport.date} @ ${c.latestReport.siteName ?? '—'} / ${c.latestReport.operatorName ?? '—'} (${c.latestReport.shiftType})`
      : '(нет отчётов 7д)';
    const today = c.todayTotals
      ? `сегодня: ${c.todayTotals.piles}свай ${c.todayTotals.drillingMeters.toFixed(1)}м downtime=${c.todayTotals.downtimeMinutes}мин`
      : '';
    console.log(`[${c.status.padEnd(8)}] ${c.name.padEnd(40)} ${last} ${today}`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
