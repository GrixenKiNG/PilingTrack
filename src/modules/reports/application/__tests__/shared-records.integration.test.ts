// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/postgres-client/client';
import { NextRequest } from 'next/server';
import { createFixture } from '../../../../../tests/integration/helpers/disposable-db';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined, tenant: '', user: '', afterEnsure: undefined as (() => Promise<void>) | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; }, DEFAULT_TX_OPTIONS: {maxWait: 10000, timeout: 30000} }));
// Session and HTTP middleware are outside this DB-concurrency test. The handler,
// permission matrix and its deletion transaction remain real.
vi.mock('@/lib/auth', () => ({requireAuth: async () => ({user: {id: state.user, role: 'ADMIN', tenantId: state.tenant}, error: null})}));
vi.mock('@/core/api-wrapper', () => ({withMutation: (handler: unknown) => handler}));
vi.mock('@/lib/cached-queries', () => ({invalidateReports: vi.fn()}));
vi.mock('@/services/feedback/feedback-event-service', () => ({recordFeedbackEvent: vi.fn()}));

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('общие записи: конкуренция на отдельном PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let db: PrismaClient;
  let tenant: string;
  let user: string;
  let shift: string;
  let report: string;
  let log: typeof import('@/modules/operator-mobile/application/commands/production').logProduction;
  let close: typeof import('@/modules/operator-mobile/application/commands/shift-close').closeShift;
  const now = new Date();
  const insert = async (table: string, values: Record<string, unknown>) => {
    const keys = Object.keys(values);
    await fixture.owner.query(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  };
  const production = (key: string, passport = false) => log({
    tenantId: tenant, operatorId: user, shiftId: shift, clientCommandId: `${tenant}-${key}`, now,
    entry: passport ? {kind: 'PILE_PASSPORT', pileGradeId: `${tenant}-grade`, passport: {pileNumber: 'С-1', joints: [{welderName: 'Сварщик', electrode: 'УОНИ'}]}}
      : {kind: 'DOWNTIME', reasonId: `${tenant}-reason`, hours: 1},
  });
  const closing = () => close({tenantId: tenant, operatorId: user, shiftId: shift, comment: 'Завершено', now});
  const failures = (results: PromiseSettledResult<unknown>[]) => results.flatMap(r => r.status === 'rejected' ? [r.reason] : []);

  beforeEach(async () => {
    fixture = await createFixture();
    tenant = fixture.tenants[0];
    user = fixture.id(tenant, 'User'); shift = fixture.id(tenant, 'Shift'); report = fixture.id(tenant, 'Report');
    state.tenant = tenant; state.user = user;
    const equipment = fixture.id(tenant, 'Equipment');
    await fixture.owner.query('UPDATE "User" SET role=\'OPERATOR\' WHERE id=$1', [user]);
    await fixture.owner.query('UPDATE "Shift" SET state=\'STARTED\', "startedById"=$1, "startedAt"=$2 WHERE id=$3', [user, now, shift]);
    await insert('Crew', {id: `${tenant}-crew`, operatorId: user, equipmentId: equipment, siteId: fixture.id(tenant, 'Site'), updatedAt: now});
    await fixture.owner.query('UPDATE "Report" SET "shiftId"=$1, "equipmentId"=$2, "crewId"=$3 WHERE id=$4', [shift, equipment, `${tenant}-crew`, report]);
    await insert('PileGrade', {id: `${tenant}-grade`, tenantId: tenant, name: 'С120.35', normalizedName: 'с120.35', lengthMm: 12000, updatedAt: now});
    await insert('DowntimeReason', {id: `${tenant}-reason`, tenantId: tenant, name: 'Ожидание', normalizedName: 'ожидание', updatedAt: now});
    for (const key of ['TB_PILING', 'EO_AFTER']) {
      await insert('OperatorChecklistTemplate', {id: `${tenant}-${key}`, tenantId: tenant, templateKey: key, version: '1', stage: key, equipmentModel: '*', definition: '{}', createdById: user});
      await insert('OperatorChecklistExecution', {id: `${tenant}-${key}-done`, tenantId: tenant, shiftId: shift, equipmentId: equipment, templateId: `${tenant}-${key}`, clientCommandId: `${tenant}-${key}`, status: 'COMPLETED', templateSnapshot: '{}', startedById: user, startedAt: now, completedAt: now});
    }
    const raw = new PrismaClient({adapter: new PrismaPg({connectionString: process.env.INTEGRATION_DATABASE_URL_APP, options: `-c app.current_tenant=${tenant}`, max: 4})});
    db = raw.$extends({query: {report: {async upsert({args, query}) {
      const result = await query(args);
      const hook = state.afterEnsure;
      state.afterEnsure = undefined;
      if (hook) await hook();
      return result;
    }}}}) as unknown as PrismaClient;
    state.db = db;
    ({logProduction: log} = await import('@/modules/operator-mobile/application/commands/production'));
    ({closeShift: close} = await import('@/modules/operator-mobile/application/commands/shift-close'));
    expect(await db.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`)
      .toEqual([{name: 'pilingtrack_app', rolsuper: false, rolbypassrls: false}]);
  }, 30000);
  afterEach(async () => {
    state.afterEnsure = undefined;
    if (db) await db.$disconnect();
    // Container is exclusively owned and removed by the runner. Retain rows
    // until then, so fixture cleanup cannot conceal a lost child record.
    if (fixture) await Promise.all([fixture.app.end(), fixture.owner.end()]);
  });

  it.each([false, true])('веб-правка открытой смены против мобильной записи (паспорт=%s): отказ409 и сохранённые строки', async passport => {
    const {upsertReport} = await import('../commands/report-command.service');
    const initial = await db.report.findUniqueOrThrow({where: {id: report}});
    const results = await Promise.allSettled([
      upsertReport({reportId: report, tenantId: tenant, userId: user, siteId: fixture.id(tenant, 'Site'), date: '2026-10-02', expectedVersion: initial.version}, {enforceEditWindow: false}),
      production('mobile', passport),
    ]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(failures(results)).toHaveLength(1);
    expect(failures(results)[0]).toMatchObject({status: 409});
    expect(await db.report.findUnique({where: {id: report}, select: {version: true}})).toEqual({version: initial.version + 1});
    expect(passport ? await db.pilePassport.count() : await db.reportDowntime.count()).toBe(1);
    if (passport) expect(await db.pileJoint.count()).toBe(1);
  });

  it('два одинаковых паспорта со стыком одновременно: одна запись, оба повтора безопасны', async () => {
    await Promise.all([production('same', true), production('same', true)]);
    expect(await db.pilePassport.count()).toBe(1);
    expect(await db.pileJoint.count()).toBe(1);
    expect(await db.pileWork.count()).toBe(1);
  });

  it('уникальность двух одинаковых стыков держится на двух PostgreSQL-соединениях', async () => {
    await production('passport', true);
    const passport = await db.pilePassport.findFirstOrThrow();
    const results = await Promise.allSettled([1, 2].map(() => db.pileJoint.create({data: {
      tenantId: tenant, passportId: passport.id, ordinal: 2, weldedAt: now, welderName: 'Сварщик', electrode: 'УОНИ',
    }})));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(failures(results)[0]).toMatchObject({code: 'P2002'});
    expect(await db.pileJoint.count()).toBe(2);
  });

  it('удаление отчёта против нового паспорта: существующий паспорт и его отчёт не теряются', async () => {
    const {DELETE} = await import('@/app/api/reports/delete/route');
    const request = () => new NextRequest('http://localhost/api/reports/delete', {method: 'DELETE', headers: {'content-type': 'application/json'}, body: JSON.stringify({reportId: report})});
    const results = await Promise.allSettled([DELETE(request()), production('delete-race', true)]);
    const passport = await db.pilePassport.findFirst();
    if (passport) {
      expect(await db.pileWork.findUnique({where: {id: passport.pileWorkId}, include: {report: true}})).toMatchObject({report: {tenantId: tenant}});
      expect(await db.pileJoint.count()).toBe(1);
    }
    for (const failure of failures(results)) expect(failure).toMatchObject({status: 409});
    if (results[0].status === 'fulfilled') expect([200, 404, 409]).toContain(results[0].value.status);
    if (results[1].status === 'fulfilled') expect(passport).not.toBeNull();
    // Once a passport exists, the user-facing prohibition also holds.
    if (passport && (await db.report.findUnique({where: {id: report}}))) {
      expect((await DELETE(request())).status).toBe(409);
    }
  });

  it('отчёт удалён строго после ensureReport: мобильная запись получает409, а не Prisma500', async () => {
    const {DELETE} = await import('@/app/api/reports/delete/route');
    state.afterEnsure = async () => {
      const response = await DELETE(new NextRequest('http://localhost/api/reports/delete', {method: 'DELETE', headers: {'content-type': 'application/json'}, body: JSON.stringify({reportId: report})}));
      expect(response.status).toBe(200);
    };
    await expect(production('controlled-delete', true)).rejects.toMatchObject({status: 409});
    expect(await db.report.findUnique({where: {id: report}})).toBeNull();
    expect(await db.pileWork.count()).toBe(0);
    expect(await db.pilePassport.count()).toBe(0);
    expect(await db.pileJoint.count()).toBe(0);
  });

  it('закрытие смены дважды: одна сдача и409 второму, один outbox', async () => {
    const results = await Promise.allSettled([closing(), closing()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(failures(results)[0]).toMatchObject({status: 409});
    expect(await db.shift.findUnique({where: {id: shift}, select: {state: true}})).toEqual({state: 'CLOSED'});
    expect(await db.outboxEvent.count({where: {type: 'ReportSubmitted', aggregateId: report}})).toBe(1);
  });

  it('два осмотра с одним HIGH-дефектом: один дефект и одна заявка ремонта', async () => {
    const {completeInspectionWithOutcome} = await import('@/modules/inspections/application/commands/inspection-commands');
    const {recordDefectInTx} = await import('@/modules/readiness/infrastructure/defects/record-defect');
    const snapshot = [{id: 'same-item', text: 'Течь гидравлики', answerType: 'YES_NO', required: true, photoRequired: false, createsDefect: true, defectSeverity: 'HIGH'}];
    const ids = [fixture.id(tenant, 'Inspection'), `${tenant}-inspection-other`];
    await fixture.owner.query('UPDATE "Inspection" SET "templateSnapshot"=$1::jsonb WHERE id=$2', [JSON.stringify(snapshot), ids[0]]);
    await insert('Inspection', {id: ids[1], tenantId: tenant, equipmentId: fixture.id(tenant, 'Equipment'), templateId: fixture.id(tenant, 'ChecklistTemplate'), level: 'EO', performedById: user, inspectionDate: now, templateSnapshot: JSON.stringify(snapshot), updatedAt: now});
    for (const id of ids) await insert('InspectionAnswer', {id: `${id}-answer`, tenantId: tenant, inspectionId: id, itemId: 'same-item', result: 'NO'});
    await Promise.all(ids.map(id => completeInspectionWithOutcome(id, {tenantId: tenant, signedByName: 'Оператор', actorId: user, recordDefect: recordDefectInTx})));
    const defects = await db.equipmentDefect.findMany({where: {severity: 'HIGH'}});
    expect(defects).toHaveLength(1);
    expect(defects[0].maintenanceRecordId).not.toBeNull();
    expect(await db.maintenanceRecord.count({where: {type: 'REPAIR'}})).toBe(1);
    expect(await db.inspection.count({where: {id: {in: ids}, status: 'COMPLETED'}})).toBe(2);
  });

  it('закрытие смены против записи: запись включена в сдачу либо отвергнута409', async () => {
    const results = await Promise.allSettled([closing(), production('last')]);
    expect(results[0].status).toBe('fulfilled');
    const count = await db.reportDowntime.count();
    if (results[1].status === 'fulfilled') expect(count).toBe(1);
    else { expect(results[1].reason).toMatchObject({status: 409}); expect(count).toBe(0); }
    const event = await db.outboxEvent.findFirstOrThrow({where: {type: 'ReportSubmitted', aggregateId: report}});
    expect(event.payload).toMatchObject({totalDowntime: count});
  });
});
