import { describe, it, expect } from 'vitest';
import { buildMaintenanceQuery, resolveAssigneeName, nextStatusActions } from '../maintenance-helpers';

describe('buildMaintenanceQuery', () => {
  it('omits empty filters', () => {
    expect(buildMaintenanceQuery({})).toBe('');
    expect(buildMaintenanceQuery({ status: 'PLANNED', assigneeId: '' })).toBe('?status=PLANNED');
  });
  it('includes multiple filters', () => {
    const q = buildMaintenanceQuery({ status: 'DONE', priority: 'HIGH' });
    expect(q.startsWith('?')).toBe(true);
    expect(q).toContain('status=DONE');
    expect(q).toContain('priority=HIGH');
  });
});

describe('resolveAssigneeName', () => {
  const map = new Map([['u1', 'Иванов']]);
  it('returns name when known', () => expect(resolveAssigneeName('u1', map)).toBe('Иванов'));
  it('returns dash when null/unknown', () => {
    expect(resolveAssigneeName(null, map)).toBe('—');
    expect(resolveAssigneeName('u9', map)).toBe('—');
  });
});

describe('nextStatusActions', () => {
  it('PLANNED can start and cancel', () => {
    expect(nextStatusActions('PLANNED')).toEqual(['IN_PROGRESS', 'CANCELLED']);
  });
  it('IN_PROGRESS can hold, done, cancel', () => {
    expect(nextStatusActions('IN_PROGRESS')).toEqual(['ON_HOLD', 'DONE', 'CANCELLED']);
  });
  it('DONE and CANCELLED are terminal', () => {
    expect(nextStatusActions('DONE')).toEqual([]);
    expect(nextStatusActions('CANCELLED')).toEqual([]);
  });
});
