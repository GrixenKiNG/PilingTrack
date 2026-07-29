import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READINESS_RULES,
  bumpVersion,
  computeReadinessScore,
  normalizeWeights,
  sanitizeRuleSet,
  type ReadinessFacts,
} from '@/modules/readiness';

const facts = (overrides: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  inspectionCompleted: true,
  inspectionProgress: 1,
  healthScore: 100,
  meterKnown: true,
  permitValid: true,
  permitExpired: false,
  maintenanceConfigured: true,
  maintenanceOverdueHours: 0,
  maintenanceOverdueDays: 0,
  accepted: true,
  criticalDefect: false,
  findings: 0,
  ...overrides,
});

describe('readiness rules', () => {
  it('normalizes weights to 100 and preserves a valid locked weight', () => {
    const result = normalizeWeights([
      { key: 'INSPECTION', weight: 40, locked: true },
      { key: 'ENGINE_HOURS', weight: 10, locked: false },
      { key: 'PERMIT', weight: 10, locked: false },
      { key: 'MAINTENANCE', weight: 10, locked: false },
      { key: 'ACCEPTANCE', weight: 10, locked: false },
    ]);
    expect(result.find((item) => item.key === 'INSPECTION')?.weight).toBe(40);
    expect(result.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('recovers from impossible locked totals', () => {
    const result = normalizeWeights(DEFAULT_READINESS_RULES.criteria.map((item) => ({
      ...item,
      weight: 80,
      locked: true,
    })));
    expect(result.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('restores missing criteria and blockers', () => {
    const result = sanitizeRuleSet({ criteria: [{ key: 'INSPECTION', weight: 999 }] });
    expect(result.criteria).toHaveLength(5);
    expect(result.blockers).toHaveLength(4);
    expect(result.criteria.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('bumps the minor version', () => {
    expect(bumpVersion('v2.4')).toBe('v2.5');
    expect(bumpVersion('invalid')).toBe('v1.0');
  });
});

describe('readiness score', () => {
  it('allows a complete and healthy equipment set', () => {
    const result = computeReadinessScore(facts());
    expect(result.score).toBe(100);
    expect(result.verdict).toBe('ALLOWED');
    expect(result.canStart).toBe(true);
  });

  it('denies start for a critical defect', () => {
    const result = computeReadinessScore(facts({ criticalDefect: true }));
    expect(result.verdict).toBe('DENIED');
    expect(result.criticalBlockers).toBe(1);
  });

  it('requires confirmation after more than 50 overdue engine hours', () => {
    const result = computeReadinessScore(facts({ maintenanceOverdueHours: 60 }));
    expect(result.verdict).toBe('CONFIRMATION_REQUIRED');
    expect(result.score).toBeLessThan(100);
  });

  it('uses configured criterion weights', () => {
    const rules = {
      ...DEFAULT_READINESS_RULES,
      criteria: [
        { key: 'INSPECTION' as const, weight: 50, locked: false },
        { key: 'ENGINE_HOURS' as const, weight: 20, locked: false },
        { key: 'PERMIT' as const, weight: 10, locked: false },
        { key: 'MAINTENANCE' as const, weight: 10, locked: false },
        { key: 'ACCEPTANCE' as const, weight: 10, locked: false },
      ],
    };
    const result = computeReadinessScore(
      facts({ inspectionCompleted: false, inspectionProgress: 0 }),
      rules,
    );
    expect(result.score).toBe(50);
  });
});
