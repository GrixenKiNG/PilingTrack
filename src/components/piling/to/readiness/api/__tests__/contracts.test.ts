import { describe, expect, it } from 'vitest';
import {
  isReadinessBootstrapEnvelope,
  parseCurrentReadinessResponse,
  parseReadinessHistoryResponse,
} from '../contracts';
import { bootstrapEnvelope } from './fixtures';

describe('readiness bootstrap contract', () => {
  it('accepts the complete server envelope', () => {
    expect(isReadinessBootstrapEnvelope(bootstrapEnvelope())).toBe(true);
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
    expect(() => parseCurrentReadinessResponse({data: [currentItem(malformed)]})).toThrow();
    const {meterKnown: _meterKnown, ...missingField} = completeFacts;
    expect(() => parseCurrentReadinessResponse({data: [currentItem(missingField)]})).toThrow();
  });
});
