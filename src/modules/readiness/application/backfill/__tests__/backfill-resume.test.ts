import {beforeEach, describe, expect, it, vi} from 'vitest';

/**
 * Возобновление прогона готовности после смены правил (разбор XP38).
 *
 * Контрольная точка (lastEquipmentId) пишется вместе с пересчётом пачки. Если
 * прогон упал, а новые правила опубликованы до повтора, оборудование до точки
 * посчитано по старым правилам. Возобновление с точки такое оборудование не
 * трогает, поэтому курсор сбрасывается, если точка посчитана не по текущим правилам.
 */

type Row = {id: string};

type Progress = {
  status: string; lastEquipmentId: string | null; processedCount: number;
  errorCount: number; lastError: string | null; completedAt: Date | null;
};

const state = vi.hoisted(() => ({
  progress: null as Progress | null,
  equipment: [] as Row[],
  publishedRuleSetId: 'rules-new',
  snapshots: [] as Array<{equipmentId: string; ruleSetId: string; triggerType: string}>,
  equipmentQueries: [] as Array<Record<string, unknown>>,
  evaluated: [] as string[],
}));

vi.mock('../../../infrastructure/tenant-transaction', () => ({
  withReadinessWorkerTransaction: async (_tenantId: string, work: (tx: unknown) => unknown) => work(fakeTx),
}));

vi.mock('../../readiness-score', () => ({
  evaluateAuthoritativeReadiness: async ({equipmentId}: {equipmentId: string}) => {
    state.evaluated.push(equipmentId);
    return {ruleSetId: state.publishedRuleSetId, status: 'OK', verdict: 'READY', score: 100, calculatedAt: new Date(0)};
  },
}));

vi.mock('../../../infrastructure/snapshots/snapshot-repository', () => ({
  createDeduplicatedSnapshot: async () => ({id: 'snap', status: 'OK', verdict: 'READY', score: 100, calculatedAt: new Date(0)}),
}));

vi.mock('../../projection/current-read-model', () => ({
  advanceCurrentReadiness: async () => undefined,
}));

const fakeTx = {
  readinessBackfillProgress: {
    findUnique: async () => state.progress,
    upsert: async ({create, update}: {create: Record<string, unknown>; update: Record<string, unknown>}) => {
      state.progress = state.progress
        ? {...state.progress, ...update} as Progress
        : {lastEquipmentId: null, processedCount: 0, errorCount: 0, lastError: null, completedAt: null, ...create} as unknown as Progress;
      return state.progress;
    },
    update: async ({data}: {data: Record<string, unknown>}) => {
      const current = state.progress as Progress;
      const next: Record<string, unknown> = {...current, ...data};
      const inc = data.processedCount as {increment: number} | undefined;
      if (inc) next.processedCount = current.processedCount + inc.increment;
      const errs = data.errorCount as {increment: number} | undefined;
      if (errs) next.errorCount = current.errorCount + errs.increment;
      state.progress = next as unknown as Progress;
      return state.progress;
    },
  },
  equipment: {
    findMany: async (args: {where: Record<string, unknown>}) => {
      state.equipmentQueries.push(args.where);
      const gt = (args.where.id as {gt?: string} | undefined)?.gt;
      return state.equipment.filter((row) => (gt ? row.id > gt : true)).slice(0, 200);
    },
  },
  tenantSettings: {findUnique: async () => ({timezone: 'Europe/Moscow'})},
  readinessRuleSet: {findFirst: async () => ({id: state.publishedRuleSetId})},
  readinessScoreSnapshot: {
    findFirst: async ({where}: {where: {equipmentId: string; ruleSetId: string; triggerType: string}}) =>
      state.snapshots.find((s) => s.equipmentId === where.equipmentId
        && s.ruleSetId === where.ruleSetId && s.triggerType === where.triggerType) ?? null,
    groupBy: async () => [],
  },
  currentReadiness: {count: async () => 0},
};

import {backfillTenantReadiness} from '../backfill-service';

beforeEach(() => {
  state.progress = {status: 'FAILED', lastEquipmentId: 'eq-2', processedCount: 2, errorCount: 1, lastError: 'boom', completedAt: null};
  state.equipment = [{id: 'eq-1'}, {id: 'eq-2'}, {id: 'eq-3'}];
  state.publishedRuleSetId = 'rules-new';
  state.snapshots = [];
  state.equipmentQueries = [];
  state.evaluated = [];
});

describe('возобновление прогона готовности', () => {
  it('сбрасывает курсор, если точка посчитана по прежним правилам', async () => {
    state.snapshots = [{equipmentId: 'eq-2', ruleSetId: 'rules-old', triggerType: 'MIGRATION'}];

    await backfillTenantReadiness({tenantId: 'orion'});

    expect(state.evaluated).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(state.equipmentQueries[0]).not.toHaveProperty('id');
  });

  it('продолжает с точки, если она посчитана по текущим правилам', async () => {
    state.snapshots = [{equipmentId: 'eq-2', ruleSetId: 'rules-new', triggerType: 'MIGRATION'}];

    await backfillTenantReadiness({tenantId: 'orion'});

    expect(state.evaluated).toEqual(['eq-3']);
    expect(state.equipmentQueries[0]).toEqual({tenantId: 'orion', isActive: true, id: {gt: 'eq-2'}});
  });
});
