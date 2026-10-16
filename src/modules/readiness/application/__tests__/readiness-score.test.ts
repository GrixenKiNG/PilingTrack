import {describe, expect, it, vi} from 'vitest';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {DEFAULT_READINESS_RULES} from '../../domain/readiness-rules';
import {capturedClock} from '../../domain/evaluation/clock';
import {evaluateAuthoritativeReadiness} from '../readiness-score';

const now = new Date('2026-10-15T09:00:00.000Z');
type Permit = {
  id: string; tenantId: string; equipmentId: string; shiftId: string | null;
  state: 'APPROVED' | 'EXPIRED' | 'CLOSED';
  validFrom: Date; validTo: Date; closeReason: 'WORK_DONE' | 'VALIDITY_ELAPSED' | null;
};
const permit = (overrides: Partial<Permit> = {}): Permit => ({
  id: 'permit-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', shiftId: null,
  state: 'CLOSED', validFrom: new Date('2026-10-14T05:00:00.000Z'),
  validTo: new Date('2026-10-15T08:00:00.000Z'), closeReason: 'WORK_DONE', ...overrides,
});

function transaction(permits: Permit[], permitsInUse = true) {
  const findFirst = vi.fn(async ({where}: {where: {
    tenantId: string; equipmentId: string; state: string | {in: string[]};
    validFrom: {lte: Date}; validTo?: {gt: Date}; OR: Array<{shiftId: string | null}>;
  }}) => permits.filter((item) => item.tenantId === where.tenantId
    && item.equipmentId === where.equipmentId
    && (typeof where.state === 'string' ? item.state === where.state : where.state.in.includes(item.state))
    && item.validFrom <= where.validFrom.lte
    && (!where.validTo || item.validTo > where.validTo.gt)
    && where.OR.some((alternative) => alternative.shiftId === item.shiftId))
    .sort((a, b) => b.validTo.getTime() - a.validTo.getTime())[0] ?? null);
  const tx = {
    equipment: {findFirst: async () => ({id: 'equipment-1', engineHoursTotal: 100,
      nextMaintenanceAtHours: 200, nextMaintenanceDate: null})},
    inspection: {findFirst: async () => ({id: 'inspection-1', inspectionDate: now, healthScore: 100})},
    operatorChecklistExecution: {findFirst: async () => null},
    maintenanceRecord: {findMany: async () => []},
    workPermit: {findFirst},
    readinessRuleSet: {findFirst: async () => ({...DEFAULT_READINESS_RULES, id: 'rules-1',
      criteria: DEFAULT_READINESS_RULES.criteria.map((item) => item.key === 'PERMIT' && permitsInUse
        ? {...item, weight: 25} : item), updatedAt: now, publishedAt: now})},
    equipmentDefect: {findFirst: async () => null},
  } as unknown as ReadinessTransaction;
  return {tx, findFirst};
}

async function evaluate(permits: Permit[], permitsInUse = true) {
  const {tx} = transaction(permits, permitsInUse);
  return evaluateAuthoritativeReadiness({tx, tenantId: 'tenant-1', equipmentId: 'equipment-1',
    timezone: 'Europe/Moscow', clock: capturedClock(now)});
}

describe('authoritative permit facts', () => {
  it('recognizes scheduled closure as expired and preserves its evidence', async () => {
    const result = await evaluate([permit({closeReason: 'VALIDITY_ELAPSED'})]);
    expect(result.facts).toMatchObject({permitValid: false, permitExpired: true, permitCloseReason: 'VALIDITY_ELAPSED'});
    expect(result.evidence.permitId).toBe('permit-1');
  });

  it.each(['2026-10-15T08:00:00.000Z', '2026-10-16T08:00:00.000Z'])(
    'does not call manually completed work expired, validTo=%s', async (validTo) => {
      const result = await evaluate([permit({validTo: new Date(validTo)})]);
      expect(result.facts).toMatchObject({permitValid: false, permitExpired: false, permitCloseReason: 'WORK_DONE'});
    });

  it('prefers a current replacement to a closed permit with a later end', async () => {
    const result = await evaluate([permit({validTo: new Date('2026-10-20T08:00:00.000Z')}),
      permit({id: 'replacement', state: 'APPROVED', closeReason: null, validTo: new Date('2026-10-16T08:00:00.000Z')})]);
    expect(result.facts).toMatchObject({permitValid: true, permitExpired: false, permitCloseReason: null});
    expect(result.evidence.permitId).toBe('replacement');
  });

  it('keeps legacy expired permits and overdue approved permits expired', async () => {
    for (const state of ['EXPIRED', 'APPROVED'] as const) {
      expect((await evaluate([permit({state, closeReason: null})])).facts)
        .toMatchObject({permitValid: false, permitExpired: true, permitCloseReason: null});
    }
  });

  it('does not consider a foreign tenant, other shift or future permit', async () => {
    const result = await evaluate([permit({tenantId: 'foreign'}), permit({shiftId: 'other-shift'}),
      permit({validFrom: new Date('2026-10-16T08:00:00.000Z')})]);
    expect(result.facts).toMatchObject({permitValid: false, permitExpired: false, permitCloseReason: null});
    expect(result.evidence.permitId).toBeNull();
  });

  it('preserves the published policy that does not use permits', async () => {
    const result = await evaluate([permit({closeReason: 'VALIDITY_ELAPSED'})], false);
    expect(result.facts).toMatchObject({permitValid: null, permitExpired: false, permitCloseReason: null});
    expect(result.warnings).toEqual([]);
  });
});
