import { describe, it, expect } from 'vitest';
import { evaluatePlanDue } from '../pm-due';

const NOW = new Date('2026-06-25T12:00:00.000Z');

describe('evaluatePlanDue — HOURS', () => {
  const base = { triggerType: 'HOURS' as const, leadTimeDays: 7, intervalHours: 250, lastDoneHours: 5000 };

  it('ok when comfortably below the target', () => {
    const r = evaluatePlanDue(base, 5100, NOW); // target 5250, 150 left
    expect(r.status).toBe('ok');
    expect(r.targetHours).toBe(5250);
    expect(r.hoursRemaining).toBe(150);
  });

  it('due_soon within 50h of the target', () => {
    const r = evaluatePlanDue(base, 5210, NOW); // 40 left
    expect(r.status).toBe('due_soon');
    expect(r.hoursRemaining).toBe(40);
  });

  it('overdue at/after the target (negative remaining)', () => {
    const r = evaluatePlanDue(base, 5300, NOW); // 50 over
    expect(r.status).toBe('overdue');
    expect(r.hoursRemaining).toBe(-50);
  });

  it('ok (no false alarm) when data is missing', () => {
    expect(evaluatePlanDue(base, null, NOW).status).toBe('ok');
    expect(evaluatePlanDue({ ...base, lastDoneHours: null }, 9999, NOW).status).toBe('ok');
  });
});

describe('evaluatePlanDue — CALENDAR', () => {
  const base = { triggerType: 'CALENDAR' as const, leadTimeDays: 7, intervalDays: 90 };

  it('overdue when past the due date', () => {
    const r = evaluatePlanDue({ ...base, lastDoneAt: '2026-01-01T00:00:00.000Z' }, null, NOW);
    expect(r.status).toBe('overdue');
    expect(r.daysRemaining).toBeLessThan(0);
  });

  it('due_soon inside the lead window', () => {
    // due 2026-06-29 (lastDone 2026-03-31 + 90d); 4 days from NOW ≤ leadTime 7
    const r = evaluatePlanDue({ ...base, lastDoneAt: '2026-03-31T12:00:00.000Z' }, null, NOW);
    expect(r.status).toBe('due_soon');
    expect(r.daysRemaining).toBeLessThanOrEqual(7);
    expect(r.daysRemaining).toBeGreaterThanOrEqual(0);
  });

  it('ok when the due date is far off', () => {
    const r = evaluatePlanDue({ ...base, lastDoneAt: '2026-06-20T00:00:00.000Z' }, null, NOW);
    expect(r.status).toBe('ok');
  });

  it('ok (no false alarm) when lastDoneAt is missing', () => {
    expect(evaluatePlanDue({ ...base, lastDoneAt: null }, null, NOW).status).toBe('ok');
  });
});
