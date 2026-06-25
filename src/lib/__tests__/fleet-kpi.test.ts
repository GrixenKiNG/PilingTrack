import { describe, it, expect } from 'vitest';
import { computeFleetKpi, type KpiRecord } from '../fleet-kpi';

const FROM = new Date('2026-06-01T00:00:00.000Z');
const TO = new Date('2026-06-11T00:00:00.000Z'); // 10 days = 240h

function rec(over: Partial<KpiRecord>): KpiRecord {
  return {
    equipmentId: 'eq1', equipmentName: 'Копёр-1', type: 'REPAIR', status: 'DONE',
    startedAt: null, completedAt: null, cost: null, ...over,
  };
}

describe('computeFleetKpi', () => {
  it('computes MTTR as mean repair duration in hours', () => {
    const k = computeFleetKpi(
      [
        rec({ startedAt: '2026-06-02T00:00:00Z', completedAt: '2026-06-02T04:00:00Z' }), // 4h
        rec({ startedAt: '2026-06-03T00:00:00Z', completedAt: '2026-06-03T08:00:00Z' }), // 8h
      ],
      { from: FROM, to: TO, equipmentCount: 1 },
    );
    expect(k.mttrHours).toBe(6);
    expect(k.failureCount).toBe(2);
    expect(k.downtimeHours).toBe(12);
  });

  it('MTBF = operating hours / failures; availability excludes downtime', () => {
    // fleet hours = 240h × 1 rig; downtime 12h → operating 228h, 2 failures
    const k = computeFleetKpi(
      [
        rec({ startedAt: '2026-06-02T00:00:00Z', completedAt: '2026-06-02T04:00:00Z' }),
        rec({ startedAt: '2026-06-03T00:00:00Z', completedAt: '2026-06-03T08:00:00Z' }),
      ],
      { from: FROM, to: TO, equipmentCount: 1 },
    );
    expect(k.mtbfHours).toBe(114); // 228 / 2
    expect(k.availability).toBeCloseTo(228 / 240, 5);
  });

  it('returns null MTBF/MTTR when there are no failures', () => {
    const k = computeFleetKpi(
      [rec({ type: 'TO1', status: 'DONE' })],
      { from: FROM, to: TO, equipmentCount: 2 },
    );
    expect(k.failureCount).toBe(0);
    expect(k.mtbfHours).toBeNull();
    expect(k.mttrHours).toBeNull();
    expect(k.availability).toBe(1); // no downtime
  });

  it('PM compliance = scheduled closed / scheduled planned', () => {
    const k = computeFleetKpi(
      [
        rec({ type: 'TO1', status: 'DONE' }),
        rec({ type: 'TO2', status: 'PLANNED' }),
        rec({ type: 'EO', status: 'DONE' }),
        rec({ type: 'REPAIR', status: 'IN_PROGRESS' }), // not scheduled
      ],
      { from: FROM, to: TO, equipmentCount: 1 },
    );
    expect(k.pmPlanned).toBe(3);
    expect(k.pmClosed).toBe(2);
    expect(k.pmCompliance).toBeCloseTo(2 / 3, 5);
  });

  it('sums cost and ranks top problem rigs by failures then cost', () => {
    const k = computeFleetKpi(
      [
        rec({ equipmentId: 'a', equipmentName: 'A', type: 'REPAIR', cost: 100 }),
        rec({ equipmentId: 'a', equipmentName: 'A', type: 'FAULT', cost: 50 }),
        rec({ equipmentId: 'b', equipmentName: 'B', type: 'REPAIR', cost: 999 }),
      ],
      { from: FROM, to: TO, equipmentCount: 2 },
    );
    expect(k.totalCost).toBe(1149);
    expect(k.topProblemRigs[0]).toMatchObject({ equipmentId: 'a', failures: 2, cost: 150 });
    expect(k.topProblemRigs[1]).toMatchObject({ equipmentId: 'b', failures: 1, cost: 999 });
  });

  it('ignores repairs missing a start/finish stamp for MTTR/downtime', () => {
    const k = computeFleetKpi(
      [rec({ startedAt: '2026-06-02T00:00:00Z', completedAt: null })],
      { from: FROM, to: TO, equipmentCount: 1 },
    );
    expect(k.failureCount).toBe(1);
    expect(k.mttrHours).toBeNull();
    expect(k.downtimeHours).toBe(0);
  });
});
