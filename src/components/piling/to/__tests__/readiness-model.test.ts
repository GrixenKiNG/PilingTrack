import { describe, expect, it } from 'vitest';
import {
  computeReadinessSummary,
  deriveEquipmentReadiness,
  type ReadinessEquipment,
} from '../readiness-model';
import type { JournalRecord } from '../to-stats';

const NOW = new Date('2026-07-28T12:00:00');

const equipment = (overrides: Partial<ReadinessEquipment> = {}): ReadinessEquipment => ({
  id: 'eq-1',
  name: 'Установка 1',
  model: 'M1',
  isActive: true,
  crewCount: 1,
  engineHoursTotal: 1_200,
  nextMaintenanceAtHours: 1_500,
  nextMaintenanceDate: '2026-08-20T00:00:00',
  ...overrides,
});

const record = (overrides: Partial<JournalRecord> = {}): JournalRecord => ({
  id: 'record-1',
  type: 'EO',
  status: 'DONE',
  title: 'Ежесменный осмотр',
  scheduledAt: null,
  completedAt: '2026-07-28T07:30:00',
  createdAt: '2026-07-28T07:00:00',
  engineHoursAtService: 1_200,
  inspection: { id: 'inspection-1', healthScore: 96, status: 'COMPLETED', level: 'EO' },
  ...overrides,
});

describe('deriveEquipmentReadiness', () => {
  it('allows operation only with current evidence and no blockers', () => {
    const result = deriveEquipmentReadiness(equipment(), [record()], true, NOW);
    expect(result.status).toBe('READY');
    expect(result.canOperate).toBe(true);
  });

  it('prioritises active repair over missing data and overdue maintenance', () => {
    const result = deriveEquipmentReadiness(
      equipment({ crewCount: 0, nextMaintenanceAtHours: 1_000 }),
      [record({ type: 'REPAIR', status: 'IN_PROGRESS', inspection: null, title: 'Ремонт гидролинии' })],
      true,
      NOW,
    );
    expect(result.status).toBe('IN_REPAIR');
    expect(result.nextActionHref).toBe('/admin/maintenance');
  });

  it('blocks operation when maintenance is overdue', () => {
    const result = deriveEquipmentReadiness(
      equipment({ nextMaintenanceAtHours: 1_000 }),
      [record()],
      true,
      NOW,
    );
    expect(result.status).toBe('OVERDUE');
    expect(result.canOperate).toBe(false);
  });

  it('does not treat an old inspection as current-shift evidence', () => {
    const result = deriveEquipmentReadiness(
      equipment(),
      [record({ completedAt: '2026-07-27T07:30:00', createdAt: '2026-07-27T07:00:00' })],
      true,
      NOW,
    );
    expect(result.status).toBe('NO_DATA');
    expect(result.reason).toContain('Осмотр текущей смены');
  });

  it('requires dispatcher attention for a low non-blocking score', () => {
    const result = deriveEquipmentReadiness(
      equipment(),
      [record({ inspection: { id: 'inspection-1', healthScore: 72, status: 'COMPLETED', level: 'EO' } })],
      true,
      NOW,
    );
    expect(result.status).toBe('ATTENTION');
    expect(result.canOperate).toBe(false);
  });
});

describe('computeReadinessSummary', () => {
  it('keeps blocked and missing data separate', () => {
    const ready = deriveEquipmentReadiness(equipment(), [record()], true, NOW);
    const overdue = deriveEquipmentReadiness(
      equipment({ id: 'eq-2', nextMaintenanceAtHours: 1_000 }),
      [record()],
      true,
      NOW,
    );
    const missing = deriveEquipmentReadiness(
      equipment({ id: 'eq-3', crewCount: 0 }),
      [record()],
      true,
      NOW,
    );
    expect(computeReadinessSummary([ready, overdue, missing])).toEqual({
      total: 3,
      ready: 1,
      attention: 0,
      blocked: 1,
      noData: 1,
      readinessPercent: 33,
    });
  });
});
