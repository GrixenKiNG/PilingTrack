import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const HTML_ATTACK = '<script>G3HTML</script><img src="https://example.invalid/g3" onerror="alert(7)">';
export const FORMULA_ATTACKS = ['=HYPERLINK("https://example.invalid/g3","G3FORMULA")', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '\t=1+2', '\n=1+2'];

// Every write/delete is guarded by the disposable database identity and a
// random fixture prefix. Existing E1 users, sites and settings remain intact.
export async function createSecurityExportFixture() {
  const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test' || url.username !== 'piling' || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw Error('Owned disposable database required');
  const db = new pg.Client({ connectionString: url.toString() });
  const prefix = 'codex-g3-export-' + randomUUID();
  const siteId = prefix + '-site';
  const reportId = prefix + '-report';
  const equipmentId = prefix + '-equipment';
  await db.connect();
  async function cleanup() {
    try {
      await db.query('DELETE FROM "Media" WHERE "tenantId"=$1 AND "entityType"=$2 AND "entityId"=$3', ['codex-e1-a', 'report', reportId]);
      await db.query('DELETE FROM "Report" WHERE id=$1 AND "tenantId"=$2', [reportId, 'codex-e1-a']);
      await db.query('DELETE FROM "Site" WHERE id=$1 AND "tenantId"=$2', [siteId, 'codex-e1-a']);
      await db.query('DELETE FROM "Equipment" WHERE id=$1 AND "tenantId"=$2', [equipmentId, 'codex-e1-a']);
    } finally { await db.end(); }
  }
  try {
    await db.query('BEGIN');
    await db.query('INSERT INTO "Site" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [siteId, 'codex-e1-a', HTML_ATTACK]);
    await db.query('INSERT INTO "Report" (id,"reportId","tenantId","userId","siteId",date,status,"updatedAt") VALUES ($1,$1,$2,$3,$4,$5,$6,now())', [reportId, 'codex-e1-a', 'codex-e1-admin', siteId, '2026-10-01', 'submitted']);
    await db.query('INSERT INTO "Equipment" (id,"tenantId",name,"engineHoursTotal","updatedAt") VALUES ($1,$2,$3,200,now())', [equipmentId, 'codex-e1-a', prefix]);
    await db.query('INSERT INTO "MeterReading" (id,"tenantId","equipmentId","recordedAt","engineHours") VALUES ($1,$2,$3,$4,200)', [prefix + '-baseline', 'codex-e1-a', equipmentId, '2026-09-01']);
    for (const [index, comment] of [...FORMULA_ATTACKS, HTML_ATTACK].entries()) {
      await db.query('INSERT INTO "ReportDowntime" (id,"reportId","tenantId",duration,comment) VALUES ($1,$2,$3,1,$4)', [prefix + '-downtime-' + index, reportId, 'codex-e1-a', comment]);
    }
    await db.query('COMMIT');
    return { db, reportId, siteId, equipmentId, cleanup };
  } catch (error) {
    await db.query('ROLLBACK');
    await db.end();
    throw error;
  }
}
