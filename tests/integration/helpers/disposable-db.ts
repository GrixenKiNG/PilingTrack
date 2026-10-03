import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

export const tables = ['Report', 'Site', 'Equipment', 'Inspection', 'Shift', 'AuditLog', 'BriefingRecord'] as const;
export type FixtureTable = typeof tables[number];

export async function inTenant<T>(client: Client, tenant: string, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
    return await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

function disposableUrl(key: string, role: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for disposable integration tests`);
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/codex_test' || url.username !== role) {
    throw new Error(`${key} must point to local codex_test as ${role}`);
  }
  return value;
}

export async function createFixture() {
  const owner = new Client({ connectionString: disposableUrl('INTEGRATION_DATABASE_URL_OWNER', 'piling') });
  const app = new Client({ connectionString: disposableUrl('INTEGRATION_DATABASE_URL_APP', 'pilingtrack_app') });
  const suffix = randomBytes(6).toString('hex');
  const tenants = [`codex-${suffix}-a`, `codex-${suffix}-b`];
  const id = (tenant: string, table: string) => `${tenant}-${table.toLowerCase()}`;
  const row = (table: FixtureTable, tenant: string, extra = ''): Record<string, unknown> => {
    const base = { id: id(tenant, table) + extra, tenantId: tenant };
    switch (table) {
      case 'Site': return { ...base, name: 'Disposable site', updatedAt: new Date() };
      case 'Equipment': return { ...base, name: 'Disposable equipment', updatedAt: new Date() };
      case 'Report': return { ...base, reportId: base.id, userId: id(tenant, 'User'), siteId: id(tenant, 'Site'), date: '2026-10-02', updatedAt: new Date() };
      case 'Inspection': return { ...base, equipmentId: id(tenant, 'Equipment'), templateId: id(tenant, 'ChecklistTemplate'), level: 'EO', performedById: id(tenant, 'User'), inspectionDate: new Date(), templateSnapshot: '[]', updatedAt: new Date() };
      case 'Shift': return { ...base, equipmentId: id(tenant, 'Equipment'), type: 'DAY', productionDate: '2026-10-02', timezone: 'Europe/Moscow', createdById: id(tenant, 'User'), lastEditedById: id(tenant, 'User'), updatedAt: new Date() };
      case 'BriefingRecord': return { ...base, userId: id(tenant, 'User'), kind: 'INSTRUCTION', userName: 'Disposable operator', userRole: 'OPERATOR', documentCode: 'codex', documentTitle: 'Disposable briefing', documentVersion: '1', recordedAt: new Date() };
      case 'AuditLog': return { ...base, entity: 'Report', entityId: id(tenant, 'Report'), action: 'codex.fixture' };
    }
  };
  const insertRow = (client: Client, table: string, values: Record<string, unknown>) => {
    const columns = Object.keys(values);
    return client.query(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  };
  let seeded = false;
  const close = async () => {
    try {
      if (seeded) {
        await owner.query('BEGIN');
        try {
          for (const tenant of tenants) {
            for (const table of ['BriefingRecord', 'AuditLog', 'Report', 'Shift', 'Inspection', 'ChecklistTemplate', 'Equipment', 'Site', 'User']) {
              await owner.query(`DELETE FROM "${table}" WHERE id = $1`, [id(tenant, table)]);
            }
            await owner.query('DELETE FROM "Tenant" WHERE id = $1', [tenant]);
          }
          await owner.query('COMMIT');
        } catch (error) { await owner.query('ROLLBACK'); throw error; }
      }
    } finally { await Promise.all([app.end(), owner.end()]); }
  };
  try {
    await owner.connect();
    await app.connect();
    await owner.query('BEGIN');
    try {
      for (const tenant of tenants) {
        await insertRow(owner, 'Tenant', { id: tenant, slug: tenant, name: 'Disposable tenant', updatedAt: new Date() });
        await insertRow(owner, 'User', { id: id(tenant, 'User'), tenantId: tenant, email: `${tenant}@example.invalid`, name: 'Disposable operator', updatedAt: new Date() });
        await insertRow(owner, 'ChecklistTemplate', { id: id(tenant, 'ChecklistTemplate'), tenantId: tenant, name: 'Disposable EO', level: 'EO', updatedAt: new Date() });
        for (const table of ['Site', 'Equipment', 'Report', 'Inspection', 'Shift', 'AuditLog', 'BriefingRecord'] as const) await insertRow(owner, table, row(table, tenant));
      }
      await owner.query('COMMIT');
      seeded = true;
    } catch (error) { await owner.query('ROLLBACK'); throw error; }
  } catch (error) { await close(); throw error; }
  return { owner, app, tenants, id, close, insert: (table: FixtureTable, tenant: string, extra: string) => insertRow(app, table, row(table, tenant, extra)) };
}
