// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createFixture } from './helpers/disposable-db';

describe.skipIf(!process.env.CODEX_STAND_URL || !process.env.INTEGRATION_DATABASE_URL_OWNER)('E3 real concurrent report saves', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let tenant: string; let base: string; let cookie: string; let grade: string;
  beforeAll(async () => {
    const url = new URL(process.env.CODEX_STAND_URL || 'http://invalid');
    if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Disposable localhost only');
    base = url.origin;
    fixture = await createFixture(); tenant = fixture.tenants[0]; grade = tenant + '-grade';
    const user = fixture.id(tenant,'User'); const password = randomBytes(20).toString('hex'); const email = tenant + '@example.invalid';
    await fixture.owner.query('UPDATE "User" SET password=$1 WHERE id=$2',[await bcrypt.hash(password,10),user]);
    await fixture.owner.query('INSERT INTO "UserSiteAssignment" (id,"userId","siteId","updatedAt") VALUES ($1,$2,$3,now())',[tenant+'-assignment',user,fixture.id(tenant,'Site')]);
    await fixture.owner.query('INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","lengthMm","updatedAt") VALUES ($1,$2,$1,$1,6000,now())',[grade,tenant]);
    const response = await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    expect(response.status).toBe(200);
    cookie = response.headers.getSetCookie().find(v=>v.startsWith('pt-session='))?.split(';')[0] || '';
    expect(cookie).not.toBe('');
  });
  afterAll(async () => {
    if (!fixture) return;
    await fixture.owner.query('DELETE FROM "MeterReading" WHERE "equipmentId"=$1',[fixture.id(tenant,'Equipment')]);
    await fixture.owner.query('DELETE FROM "Report" WHERE id=$1',[fixture.id(tenant,'Report')]);
    await fixture.owner.query('DELETE FROM "PileGrade" WHERE id=$1',[grade]);
    await fixture.owner.query('DELETE FROM "UserSiteAssignment" WHERE id=$1',[tenant+'-assignment']);
    await fixture.close();
  });
  it('один победитель, второй 409; данные победителя сохранены', async () => {
    const missingVersion = await fetch(base+'/api/reports/upsert', {
      method:'POST', headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
      body:JSON.stringify({reportId:fixture.id(tenant,'Report'),siteId:fixture.id(tenant,'Site'),date:'2026-10-02',piles:[{pileGradeId:grade,count:99}]}),
    });
    expect(missingVersion.status, JSON.stringify(await missingVersion.json())).toBe(400);
    const save = (count: number) => fetch(base+'/api/reports/upsert',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({reportId:fixture.id(tenant,'Report'),siteId:fixture.id(tenant,'Site'),date:'2026-10-02',version:1,piles:[{pileGradeId:grade,count}]})});
    const results = await Promise.all([save(5),save(7)]);
    const bodies = await Promise.all(results.map(r=>r.json()));
    expect(results.map(r=>r.status).sort(),JSON.stringify(bodies)).toEqual([200,409]);
    const saved = await fixture.owner.query('SELECT version FROM "Report" WHERE id=$1',[fixture.id(tenant,'Report')]);
    expect(saved.rows[0].version).toBe(2);
    const piles = await fixture.owner.query('SELECT sum(count)::int AS count FROM "PileWork" WHERE "reportId"=$1',[fixture.id(tenant,'Report')]);
    expect(piles.rows[0].count).toBe(results[0].status===200?5:7);
  });
  it('X6: web report snapshots only accepted engine hours, preserving a rejected decrease', async () => {
    const save = (version: number, engineHours: number) => fetch(base+'/api/reports/upsert', {
      method:'POST', headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
      body:JSON.stringify({reportId:fixture.id(tenant,'Report'),siteId:fixture.id(tenant,'Site'),date:'2026-10-02',version,equipmentId:fixture.id(tenant,'Equipment'),engineHours,piles:[{pileGradeId:grade,count:5}]}),
    });
    const accepted = await save(2,1234);
    const acceptedBody = await accepted.json();
    expect(accepted.status,JSON.stringify(acceptedBody)).toBe(200);
    expect(acceptedBody.meterError).toBeNull();
    expect(acceptedBody.report.report.endingEngineHours).toBe(1234);
    const rejected = await save(3,1230);
    const rejectedBody = await rejected.json();
    expect(rejected.status,JSON.stringify(rejectedBody)).toBe(200);
    expect(rejectedBody.meterError).toBeTruthy();
    const stored = await fixture.owner.query('SELECT "endingEngineHours", "endingFuelPercent" FROM "Report" WHERE id=$1',[fixture.id(tenant,'Report')]);
    expect(stored.rows[0]).toEqual({endingEngineHours:1234,endingFuelPercent:null});
  });
});
