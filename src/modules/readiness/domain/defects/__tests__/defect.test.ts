import {describe, expect, it} from 'vitest';
import {
  DEFECT_OPEN_STATUSES,
  blocksOperation,
  summarizeDefects,
  transitionDefect,
} from '../defect';
import type {DefectRecord} from '../types';

const defect = (overrides: Partial<DefectRecord> = {}): DefectRecord => ({
  id: 'defect-1',
  tenantId: 'tenant-1',
  equipmentId: 'equipment-1',
  severity: 'NORMAL',
  status: 'OPEN',
  title: 'Подтекание гидравлики',
  node: 'Гидросистема — распределитель вращения',
  maintenanceRecordId: null,
  version: 1,
  ...overrides,
});

describe('серьёзность дефекта', () => {
  // Владелец 2026-08-08: останавливаем работу только там, где иначе опасно.
  // Всё остальное — предупреждение, иначе систему начнут обходить.
  it('останавливает работу только на критическом дефекте', () => {
    expect(blocksOperation('CRITICAL')).toBe(true);
    expect(blocksOperation('HIGH')).toBe(false);
    expect(blocksOperation('NORMAL')).toBe(false);
    expect(blocksOperation('LOW')).toBe(false);
  });
});

describe('сводка по дефектам установки', () => {
  it('считает открытыми только незакрытые записи', () => {
    const summary = summarizeDefects([
      defect({id: 'd1', status: 'OPEN'}),
      defect({id: 'd2', status: 'IN_WORK'}),
      defect({id: 'd3', status: 'CLOSED'}),
      defect({id: 'd4', status: 'REJECTED'}),
    ]);
    expect(summary.openCount).toBe(2);
  });

  it('видит блокировку по открытому критическому дефекту', () => {
    const summary = summarizeDefects([
      defect({id: 'd1', severity: 'HIGH'}),
      defect({id: 'd2', severity: 'CRITICAL'}),
    ]);
    expect(summary.blockingCount).toBe(1);
    expect(summary.highestSeverity).toBe('CRITICAL');
  });

  // Закрытый критический дефект не должен держать установку заблокированной.
  it('не блокирует, когда критический дефект уже устранён', () => {
    const summary = summarizeDefects([
      defect({id: 'd1', severity: 'CRITICAL', status: 'CLOSED'}),
    ]);
    expect(summary.blockingCount).toBe(0);
    expect(summary.openCount).toBe(0);
  });

  it('на пустом журнале ничего не выдумывает', () => {
    const summary = summarizeDefects([]);
    expect(summary).toEqual({openCount: 0, blockingCount: 0, highestSeverity: null});
  });
});

describe('переходы дефекта', () => {
  it('ведёт по обычному маршруту: разбор, работа, закрытие', () => {
    expect(transitionDefect('OPEN', 'TRIAGE')).toBe('IN_WORK');
    expect(transitionDefect('IN_WORK', 'RESOLVE')).toBe('CLOSED');
  });

  it('позволяет отклонить только неразобранный дефект', () => {
    expect(transitionDefect('OPEN', 'REJECT')).toBe('REJECTED');
    expect(transitionDefect('IN_WORK', 'REJECT')).toBeNull();
  });

  // Закрытый и отклонённый — конечные состояния: журнал не переписывается
  // задним числом, для возврата заводится новый дефект.
  it('не выпускает дефект из конечного состояния', () => {
    expect(transitionDefect('CLOSED', 'TRIAGE')).toBeNull();
    expect(transitionDefect('CLOSED', 'RESOLVE')).toBeNull();
    expect(transitionDefect('REJECTED', 'TRIAGE')).toBeNull();
  });

  it('не даёт закрыть дефект в обход разбора', () => {
    expect(transitionDefect('OPEN', 'RESOLVE')).toBeNull();
  });

  it('перечисляет открытые статусы', () => {
    expect([...DEFECT_OPEN_STATUSES].sort()).toEqual(['IN_WORK', 'OPEN']);
  });
});
