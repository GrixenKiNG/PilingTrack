import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import {
  READINESS_ABILITIES,
  isReadinessBootstrapEnvelope,
  parseCurrentReadinessResponse,
  parseReadinessHistoryResponse,
} from '../contracts';
import { READINESS_ABILITIES as SERVER_ABILITIES } from '@/modules/readiness/application/capabilities';
import { bootstrapEnvelope } from './fixtures';

const historyMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));
vi.mock('@/core/api-wrapper', () => ({
  withApi: <T,>(handler: T) => handler,
}));
vi.mock('@/app/api/readiness/_shared/request-context', () => ({
  resolveReadinessRequestContext: async () => ({context: {
    tenantId: 'tenant-1', correlationId: 'history-correlation', requestId: 'history-request',
    capabilities: new Set(['readiness.read']),
  }}),
}));
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessRequestTransaction: async (_tenantId: string, callback: (tx: unknown) => unknown) => callback({
    tenantSettings: {findUnique: async () => ({timezone: 'Europe/Moscow'})},
    readinessScoreSnapshot: {findMany: historyMocks.findMany},
  }),
}));
import { GET } from '@/app/api/readiness/history/route';

describe('readiness bootstrap contract', () => {
  it('accepts the complete server envelope', () => {
    expect(isReadinessBootstrapEnvelope(bootstrapEnvelope())).toBe(true);
  });

  // Клиент отвергает весь ответ, встретив незнакомое право, и модуль
  // не открывается совсем. Списки обязаны совпадать до последнего значения.
  it('knows exactly the abilities the server can send', () => {
    expect([...READINESS_ABILITIES].sort()).toEqual([...SERVER_ABILITIES].sort());
  });

  it('rejects missing capabilities and unknown abilities', () => {
    const missing = bootstrapEnvelope() as unknown as Record<string, unknown>;
    delete ((missing.data as Record<string, unknown>).capabilities);
    expect(isReadinessBootstrapEnvelope(missing)).toBe(false);

    const unknown = bootstrapEnvelope();
    unknown.data.capabilities.abilities = ['readiness.unknown' as never];
    expect(isReadinessBootstrapEnvelope(unknown)).toBe(false);
  });
});

const completeFacts = {
  inspectionCompleted: true,
  inspectionProgress: 1,
  healthScore: 97,
  meterKnown: true,
  permitValid: true,
  permitExpired: false,
  maintenanceConfigured: true,
  maintenanceOverdueHours: 0,
  maintenanceOverdueDays: 0,
  accepted: true,
  criticalDefect: false,
  findings: 0,
};

const currentItem = (facts: unknown) => ({
  equipmentId: 'equipment-1',
  snapshotId: 'snapshot-1',
  status: 'READY',
  score: 97,
  calculatedAt: '2026-08-08T12:00:00.000Z',
  blockers: [],
  warnings: [],
  evidence: {equipmentId: 'equipment-1'},
  facts,
  triggerType: 'INSPECTION_COMPLETED',
  ruleSetVersion: 'v1',
});

describe('authoritative readiness response contracts', () => {
  it('actual history GET preserves saved verdicts and legacy null through the parser', async () => {
    const verdicts = ['DENIED', 'RETURN_TO_OPERATOR', 'CONFIRMATION_REQUIRED', 'ALLOWED', null];
    historyMocks.findMany.mockResolvedValue(verdicts.map((verdict, index) => ({
      ...currentItem(null), id: `snapshot-${index}`, shiftId: null, triggerId: `inspection-${index}`,
      verdict, status: verdict === 'ALLOWED' ? 'READY' : 'BLOCKED',
      calculatedAt: new Date('2026-08-08T12:00:00.000Z'), factsHash: Buffer.alloc(32),
    })));
    const response = await GET(new NextRequest('http://localhost/api/readiness/history'));
    expect(response.status).toBe(200);
    const snapshots = parseReadinessHistoryResponse(await response.json());
    expect(snapshots.map((snapshot) => snapshot.verdict)).toEqual(verdicts);
    expect(snapshots.every((snapshot) => snapshot.facts === null)).toBe(true);
  });
  it('accepts complete facts and nullable legacy facts', () => {
    expect(parseCurrentReadinessResponse({data: [currentItem(completeFacts)]})[0]?.facts)
      .toEqual(completeFacts);
    expect(parseCurrentReadinessResponse({data: [currentItem(null)]})[0]?.facts).toBeNull();
    const {snapshotId: _snapshotId, ...historyBase} = currentItem(null);
    expect(parseReadinessHistoryResponse({
      data: [{
        ...historyBase,
        id: 'snapshot-1',
        shiftId: null,
        triggerId: 'inspection-1',
        factsHash: '00'.repeat(32),
      }],
      page: {limit: 500, total: 1},
      filters: {},
    })[0]?.facts).toBeNull();
  });

  it('rejects malformed authoritative facts', () => {
    const malformed = {...completeFacts, inspectionProgress: '1'};
    expect(() => parseCurrentReadinessResponse({data: [currentItem(malformed)]})).toThrow(ZodError);
    const {meterKnown: _meterKnown, ...missingField} = completeFacts;
    expect(() => parseCurrentReadinessResponse({data: [currentItem(missingField)]})).toThrow(ZodError);
  });
});
