/**
 * Dev smoke check for getEquipmentDetails.
 *   npx tsx scripts/dev/smoke-equipment-details.ts <equipmentId?>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
  const { getEquipmentDetails } = await import('@/modules/equipment');
  const id = process.argv[2] || 'eq-lrh-100-1';
  const d = await getEquipmentDetails(id);
  console.log(`name: ${d.equipment.name} (${d.equipment.kind})`);
  console.log(`crew: ${d.crew ? `${d.crew.operator.name} @ ${d.crew.site.name}` : 'none'}`);
  console.log(`stats30d:`, d.stats30d);
  console.log(`timeline rows: ${d.timeline.length}`);
  if (d.timeline[0]) {
    const r = d.timeline[0];
    console.log(`  latest: ${r.date} ${r.shiftType} ${r.siteName ?? '—'} / ${r.operatorName ?? '—'} (piles=${r.piles})`);
  }
  console.log(`telematics devices: ${d.telematicsDevices.length}`);
  console.log(`documents: ${d.documents.length}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
