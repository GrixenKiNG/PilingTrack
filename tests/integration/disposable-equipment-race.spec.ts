// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture } from './helpers/disposable-db';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { updateEquipment } from '@/modules/equipment';

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('E4 PG equipment optimistic lock', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let tenant: string;
  const scoped = <T>(work: () => Promise<T>) => runWithTenantContext(async () => { setRequestTenantId(tenant); return work(); });
  beforeAll(async () => { fixture = await createFixture(); tenant = fixture.tenants[0]; });
  afterAll(async () => { if(fixture) await fixture.close(); });
  it('отвергает устаревшую карточку целиком, включая паспорт', async () => {
    const id = fixture.id(tenant,'Equipment');
    const row = (await fixture.owner.query('SELECT "updatedAt" FROM "Equipment" WHERE id=$1',[id])).rows[0];
    const expectedUpdatedAt = row.updatedAt.toISOString();
    const command = { equipmentId:id,tenantId:tenant,expectedUpdatedAt };
    await scoped(() => updateEquipment({ ...command,name:'First',metadata:{inventoryNumber:'First passport'} }));
    await expect(scoped(() => updateEquipment({ ...command,name:'Stale',metadata:{inventoryNumber:'Stale passport'} }))).rejects.toMatchObject({ status:409 });
    const saved = (await fixture.owner.query('SELECT name,"inventoryNumber","updatedAt" FROM "Equipment" WHERE id=$1',[id])).rows[0];
    expect(saved.name).toBe('First'); expect(saved.inventoryNumber).toBe('First passport');
    expect(saved.updatedAt.toISOString()).not.toBe(expectedUpdatedAt);
  });
  it('два одновременных сохранения одной версии дают ровно одного победителя', async () => {
    const id = fixture.id(tenant,'Equipment');
    const expectedUpdatedAt = (await fixture.owner.query('SELECT "updatedAt" FROM "Equipment" WHERE id=$1',[id])).rows[0].updatedAt.toISOString();
    const results = await Promise.allSettled(['Winner A','Winner B'].map(name => scoped(() => updateEquipment({equipmentId:id,tenantId:tenant,expectedUpdatedAt,name,metadata:{inventoryNumber:name}}))));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409}});
    const saved = (await fixture.owner.query('SELECT name,"inventoryNumber" FROM "Equipment" WHERE id=$1',[id])).rows[0];
    expect(saved.inventoryNumber).toBe(saved.name);
  });
  it('ошибка показания откатывает основные поля и паспорт', async () => {
    const id = fixture.id(tenant,'Equipment');
    let expectedUpdatedAt = (await fixture.owner.query('SELECT "updatedAt" FROM "Equipment" WHERE id=$1',[id])).rows[0].updatedAt.toISOString();
    await scoped(() => updateEquipment({equipmentId:id,tenantId:tenant,expectedUpdatedAt,metadata:{engineHoursTotal:100}}));
    const before = (await fixture.owner.query('SELECT name,"inventoryNumber","updatedAt" FROM "Equipment" WHERE id=$1',[id])).rows[0];
    expectedUpdatedAt = before.updatedAt.toISOString();
    await expect(scoped(() => updateEquipment({equipmentId:id,tenantId:tenant,expectedUpdatedAt,name:'Rollback',metadata:{inventoryNumber:'Rollback',engineHoursTotal:50}}))).rejects.toMatchObject({status:422});
    const after = (await fixture.owner.query('SELECT name,"inventoryNumber","updatedAt" FROM "Equipment" WHERE id=$1',[id])).rows[0];
    expect(after).toEqual(before);
  });
});
