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

  it('PM compliance = scheduled closed / scheduled planned (dated WOs only)', () => {
    const k = computeFleetKpi(
      [
        rec({ type: 'TO1', status: 'DONE', scheduledAt: '2026-06-02T00:00:00Z' }),
        rec({ type: 'TO2', status: 'PLANNED', scheduledAt: '2026-06-05T00:00:00Z' }),
        rec({ type: 'EO', status: 'DONE', scheduledAt: '2026-06-03T00:00:00Z' }),
        rec({ type: 'REPAIR', status: 'IN_PROGRESS' }), // not scheduled
      ],
      { from: FROM, to: TO, equipmentCount: 1 },
    );
    expect(k.pmPlanned).toBe(3);
    expect(k.pmClosed).toBe(2);
    expect(k.pmCompliance).toBeCloseTo(2 / 3, 5);
  });

  it('excludes undated (zombie) scheduled WOs from PM compliance', () => {
    const k = computeFleetKpi(
      [
        rec({ type: 'TO1', status: 'DONE', scheduledAt: '2026-06-02T00:00:00Z' }),
        // Undated orders sitting "В работе" forever must not drag compliance down.
        rec({ type: 'EO', status: 'IN_PROGRESS', scheduledAt: null }),
        rec({ type: 'EO', status: 'IN_PROGRESS', scheduledAt: null }),
      ],
      { from: FROM, to: TO, equipmentCount: 1 },
    );
    expect(k.pmPlanned).toBe(1);
    expect(k.pmClosed).toBe(1);
    expect(k.pmCompliance).toBe(1);
  });

  it('counts the running time of an OPEN failure as downtime (availability < 100%)', () => {
    // Repair started 2 days before "now" and never closed.
    const now = new Date('2026-06-10T00:00:00.000Z');
    const k = computeFleetKpi(
      [rec({ status: 'IN_PROGRESS', startedAt: '2026-06-08T00:00:00Z', completedAt: null })],
      { from: FROM, to: TO, equipmentCount: 1, now },
    );
    expect(k.downtimeHours).toBe(48);
    expect(k.availability).toBeCloseTo((240 - 48) / 240, 5);
    expect(k.mttrHours).toBeNull(); // MTTR stays closed-repairs-only
  });

  it('falls back to createdAt when an open failure has no startedAt', () => {
    const now = new Date('2026-06-10T00:00:00.000Z');
    const k = computeFleetKpi(
      [rec({ status: 'PLANNED', startedAt: null, completedAt: null, createdAt: '2026-06-09T00:00:00Z' })],
      { from: FROM, to: TO, equipmentCount: 1, now },
    );
    expect(k.downtimeHours).toBe(24);
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
