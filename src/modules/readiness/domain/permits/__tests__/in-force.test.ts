import {describe, expect, it} from 'vitest';
import {isPermitInForce} from '../in-force';

const NOW = new Date('2026-10-17T10:00:00.000Z');
const permit = (over: Record<string, unknown> = {}) => ({state: 'APPROVED' as const,
  validFrom: new Date('2026-10-17T06:00:00.000Z'), validTo: new Date('2026-10-17T18:00:00.000Z'), ...over});

describe('isPermitInForce — наряд даёт допуск', () => {
  it('согласованный наряд внутри окна действует', () => {
    expect(isPermitInForce(permit(), NOW)).toBe(true);
  });
  it('граница validFrom включена, validTo — нет (как у планировщика)', () => {
    expect(isPermitInForce(permit({validFrom: NOW}), NOW)).toBe(true);
    expect(isPermitInForce(permit({validTo: NOW}), NOW)).toBe(false);
  });
  it('ещё не начавшийся и просроченный не действуют', () => {
    expect(isPermitInForce(permit({validFrom: new Date(NOW.getTime() + 1)}), NOW)).toBe(false);
    expect(isPermitInForce(permit({validTo: new Date(NOW.getTime() - 1)}), NOW)).toBe(false);
  });
  it.each(['DRAFT', 'PENDING_APPROVAL', 'EXPIRED', 'REVOKED', 'CLOSED'] as const)('%s не действует', (state) => {
    expect(isPermitInForce(permit({state}), NOW)).toBe(false);
  });
  it('принимает даты строками, как приходят в экран', () => {
    expect(isPermitInForce({state: 'APPROVED', validFrom: '2026-10-17T06:00:00Z', validTo: '2026-10-17T18:00:00Z'}, NOW)).toBe(true);
    expect(isPermitInForce({state: 'APPROVED', validFrom: '2026-10-17T06:00:00Z', validTo: '2026-10-17T09:00:00Z'}, NOW)).toBe(false);
  });
});
