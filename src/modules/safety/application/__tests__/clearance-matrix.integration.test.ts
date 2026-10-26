// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/postgres-client/client';
import { applyTenantGuc, wrapTransaction } from '@/core/security/tenant-rls';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { createFixture } from '../../../../../tests/integration/helpers/disposable-db';
import { checkOperatorDocuments, isIdentityValid } from '@/modules/operator-mobile/domain/operator-admission';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));

const base = new Date('2026-10-26T09:00:00Z');
const day = 86_400_000;
const cases = [
  { name: 'missing required document', held: false, requiresExpiry: true, expiry: null, now: base, allowed: false },
  { name: 'perpetual document', held: true, requiresExpiry: false, expiry: null, now: base, allowed: true },
  { name: 'required expiry in future', held: true, requiresExpiry: true, expiry: new Date(+base + 60 * day), now: base, allowed: true },
  { name: 'required expiry in past', held: true, requiresExpiry: true, expiry: new Date(+base - day), now: base, allowed: false },
  { name: 'optional expired date is reminder only', held: true, requiresExpiry: false, expiry: new Date(+base - day), now: base, allowed: true },
  { name: 'warning boundary at 30.5 days', held: true, requiresExpiry: true, expiry: new Date(+base + 30.5 * day), now: base, allowed: true },
  { name: 'expiry is same instant across UTC and Moscow', held: true, requiresExpiry: true, expiry: new Date('2026-10-27T00:00:00+03:00'), now: new Date('2026-10-26T21:00:00Z'), allowed: true },
  { name: 'one second expired across UTC and Moscow', held: true, requiresExpiry: true, expiry: new Date('2026-10-27T00:00:00+03:00'), now: new Date('2026-10-26T21:00:01Z'), allowed: false },
  { name: 'optional future date remains advisory', held: true, requiresExpiry: false, expiry: new Date(+base + day), now: base, allowed: true },
  { name: 'optional expiry does not make the document optional', held: false, requiresExpiry: false, expiry: null, now: base, allowed: false },
];

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER || !process.env.INTEGRATION_DATABASE_URL_APP)('same document decision across users, safety and operator-mobile', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let raw: PrismaClient;
  let tenant: string;
  let userId: string;
  let typeId: string;
  let users: typeof import('@/modules/users');
  let overview: typeof import('../clearance-overview-query').querySafetyClearanceOverview;
  let self: typeof import('../self-clearance-query').querySelfSafetyView;
  beforeAll(async () => {
    fixture = await createFixture();
    tenant = fixture.tenants[0];
    userId = fixture.id(tenant, 'User');
    typeId = tenant + '-matrix-type';
    await fixture.owner.query('INSERT INTO "UserDocumentType" (id,"tenantId",name,"normalizedName","requiredForOperator","requiresExpiry","updatedAt") VALUES ($1,$2,$3,$3,true,true,now())', [typeId, tenant, 'Night matrix document']);
    raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.INTEGRATION_DATABASE_URL_APP, max: 5 }) });
    const scoped = applyTenantGuc(raw);
    state.db = new Proxy(scoped, { get(client, key) {
      if (key === '$transaction') return (...args: unknown[]) => wrapTransaction(client, client.$transaction as never, args);
      return Reflect.get(client, key);
    } });
    users = await import('@/modules/users');
    ({ querySafetyClearanceOverview: overview } = await import('../clearance-overview-query'));
    ({ querySelfSafetyView: self } = await import('../self-clearance-query'));
  });
  afterAll(async () => {
    if (fixture) {
      await fixture.owner.query('DELETE FROM "UserDocument" WHERE "typeId"=$1', [typeId]);
      await fixture.owner.query('DELETE FROM "UserDocumentType" WHERE id=$1', [typeId]);
    }
    if (raw) await raw.$disconnect();
    if (fixture) await fixture.close();
  });

  it.each(cases)('$name', async example => {
    await fixture.owner.query('UPDATE "UserDocumentType" SET "requiresExpiry"=$2 WHERE id=$1', [typeId, example.requiresExpiry]);
    await fixture.owner.query('DELETE FROM "UserDocument" WHERE "typeId"=$1', [typeId]);
    if (example.held) await fixture.owner.query('INSERT INTO "UserDocument" (id,"tenantId","userId","typeId",number,"expiresAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [typeId + '-document', tenant, userId, typeId, 'matrix', example.expiry]);
    const type = { id: typeId, name: 'Night matrix document', leadTimeDays: 30, requiresExpiry: example.requiresExpiry, requiredForOperator: true };
    const held = example.held ? [{ typeId, expiresAt: example.expiry, number: 'matrix' }] : [];
    const direct = users.evaluateOperatorClearance([type], held, example.now);
    const mobile = checkOperatorDocuments([type], held, example.now);
    await runWithTenantContext(async () => {
      setRequestTenantId(tenant);
      const [query, all, personal] = await Promise.all([
        users.getOperatorClearance(tenant, userId, example.now),
        overview({ tenantId: tenant, mayReadAllDocuments: true, now: example.now }),
        self({ tenantId: tenant, userId, now: example.now }),
      ]);
      const decisions = { users: direct.cleared, usersQuery: query.cleared, safetyOverview: all.rows.find(row => row.userId === userId)?.cleared, safetySelf: personal.clearance.cleared, mobile: isIdentityValid(mobile) };
      expect(decisions).toEqual({ users: example.allowed, usersQuery: example.allowed, safetyOverview: example.allowed, safetySelf: example.allowed, mobile: example.allowed });
      process.stdout.write(JSON.stringify({ case: example.name, decisions, usersWarnings: direct.warnings, usersDays: direct.documents[0]?.daysLeft, mobileVerdict: mobile[0]?.verdict, mobileDays: mobile[0]?.daysLeft }) + '\n');
    });
  });
});
