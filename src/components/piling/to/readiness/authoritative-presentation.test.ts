import {describe, expect, it} from 'vitest';
import type {CurrentReadinessDto} from './api/contracts';
import {buildAuthoritativeReadinessPresentation} from './authoritative-presentation';

const facts = {
  inspectionCompleted: true,
  inspectionProgress: 1,
  healthScore: 96,
  meterKnown: true,
  permitValid: true,
  permitExpired: false,
  maintenanceConfigured: true,
  maintenanceOverdueHours: 0,
  maintenanceOverdueDays: 0,
  accepted: true,
  criticalDefect: false,
  findings: 0,
} as const;

function snapshot(overrides: Partial<CurrentReadinessDto> = {}): CurrentReadinessDto {
  return {
    equipmentId: 'equipment-1',
    snapshotId: 'snapshot-1',
    status: 'READY',
    score: 96,
    calculatedAt: '2026-08-08T12:00:00.000Z',
    blockers: [],
    warnings: [],
    evidence: {
      equipmentId: 'equipment-1',
      inspectionId: 'inspection-1',
      permitId: 'permit-1',
      maintenanceRecordIds: [],
      evaluatedAt: '2026-08-08T12:00:00.000Z',
    },
    facts,
    triggerType: 'INSPECTION_COMPLETED',
    ruleSetVersion: 'v1',
    ...overrides,
  };
}

describe('buildAuthoritativeReadinessPresentation', () => {
  it('builds READY status, five stages and evidence only from the snapshot', () => {
    const result = buildAuthoritativeReadinessPresentation(snapshot());
    expect(result).toMatchObject({
      mode: 'authoritative', status: 'READY', score: 96,
      nextAction: 'Авторитетная оценка подтверждает готовность к работе',
    });
    expect(result.stages.map((stage) => stage.key)).toEqual([
      'INSPECTION', 'ENGINE_HOURS', 'PERMIT', 'MAINTENANCE', 'ACCEPTANCE',
    ]);
    expect(result.stages.every((stage) => stage.state === 'pass')).toBe(true);
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key: 'inspection', reference: 'inspection-1'}),
      expect.objectContaining({key: 'permit', reference: 'permit-1'}),
    ]));
  });

  it('builds BLOCKED notices and next action from persisted blockers', () => {
    const result = buildAuthoritativeReadinessPresentation(snapshot({
      status: 'BLOCKED', score: 42,
      facts: {...facts, permitValid: false, accepted: false},
      blockers: [{condition: 'VALID_WORK_PERMIT_REQUIRED', action: 'DENY_START',
        label: 'Требуется действующий допуск', actionLabel: 'Оформить допуск'}],
    }));
    expect(result).toMatchObject({
      mode: 'authoritative', status: 'BLOCKED', score: 42,
      nextAction: 'Оформить допуск',
      blockers: [expect.objectContaining({label: 'Требуется действующий допуск'})],
    });
    expect(result.stages.find((stage) => stage.key === 'PERMIT')?.state).toBe('fail');
  });

  it('marks a legacy snapshot without facts as incomplete history', () => {
    expect(buildAuthoritativeReadinessPresentation(snapshot({facts: null}))).toMatchObject({
      mode: 'historical-incomplete',
      status: 'UNCONFIRMED',
      score: null,
      title: 'Исторические доказательства неполны',
    });
  });

  it('uses safe states for missing and malformed snapshots', () => {
    expect(buildAuthoritativeReadinessPresentation(null)).toMatchObject({
      mode: 'missing', status: 'UNCONFIRMED', score: null,
      title: 'Авторитетная оценка ещё не выполнена',
    });
    expect(buildAuthoritativeReadinessPresentation(snapshot({evidence: []}))).toMatchObject({
      mode: 'malformed', status: 'UNCONFIRMED', score: null,
      title: 'Авторитетная оценка недоступна',
    });
  });
});
