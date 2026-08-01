import {describe, expect, it} from 'vitest';
import {capturedClock} from '../clock';
import {evaluateReadiness} from '../evaluator';
import {immutablePublishedRules} from '../rules';
import {DEFAULT_READINESS_RULES} from '../../readiness-rules';

const facts = {
  inspectionCompleted: true, inspectionProgress: 1, healthScore: 100,
  meterKnown: true, permitValid: false, permitExpired: false,
  maintenanceConfigured: true, maintenanceOverdueHours: 0, maintenanceOverdueDays: 0,
  accepted: true, criticalDefect: false, findings: 0,
} as const;
const evidence = {equipmentId: 'eq-1', inspectionId: 'in-1', permitId: null, maintenanceRecordIds: []};

describe('authoritative readiness evaluator', () => {
  it('fails closed when published rules are absent', () => {
    const result = evaluateReadiness({facts, rules: null, evidence,
      clock: capturedClock(new Date('2026-10-25T00:30:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({code: 'READINESS_RULES_NOT_PUBLISHED'}));
  });

  it('warns but allows a missing optional permit', () => {
    const rules = immutablePublishedRules(DEFAULT_READINESS_RULES)!;
    const result = evaluateReadiness({facts, rules, evidence,
      clock: capturedClock(new Date('2026-03-29T00:30:00.000Z'))});
    expect(result.allowed).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({code: 'WORK_PERMIT_MISSING_OPTIONAL'}));
  });

  it('blocks a missing permit when the published rule enables it', () => {
    const rules = immutablePublishedRules({...DEFAULT_READINESS_RULES,
      blockers: DEFAULT_READINESS_RULES.blockers.map((item) => item.condition === 'VALID_WORK_PERMIT_REQUIRED'
        ? {...item, isActive: true} : item)})!;
    const result = evaluateReadiness({facts, rules, evidence,
      clock: capturedClock(new Date('2026-07-01T09:00:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({condition: 'VALID_WORK_PERMIT_REQUIRED'}));
  });

  it('blocks an expired permit under the published default blocker', () => {
    const result = evaluateReadiness({facts: {...facts, permitExpired: true},
      rules: immutablePublishedRules(DEFAULT_READINESS_RULES), evidence,
      clock: capturedClock(new Date('2026-07-01T09:00:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({condition: 'PERMIT_EXPIRED'}));
  });

  it('uses the captured event instant across DST boundaries', () => {
    const instant = new Date('2026-10-25T00:30:00.000Z');
    const result = evaluateReadiness({facts, rules: immutablePublishedRules(DEFAULT_READINESS_RULES), evidence,
      clock: capturedClock(instant)});
    expect(result.calculatedAt.toISOString()).toBe(instant.toISOString());
    expect(result.evidence.evaluatedAt).toBe(instant.toISOString());
  });
});
