import {describe, expect, it} from 'vitest';
import {startShiftCommand, type ShiftCommandContext} from '../commands';

const context = (actorRole: string): ShiftCommandContext => ({
  tenantId: 'tenant-a', actorId: 'actor-a', actorName: 'Actor', actorRole,
  actingAs: null, requestId: 'request-a', correlationId: 'correlation-a',
});

describe('shift command contract', () => {
  // Допуск к работе даёт диспетчер: ни механик, ни оператор смену не запускают.
  it.each(['MECHANIC', 'OPERATOR'] as const)('denies shift start to %s without handover.decide', (role) => {
    expect(() => startShiftCommand({tx: null as never, context: context(role), id: 'shift-a',
      key: `task04-${role.toLowerCase()}-denied`, ifMatch: '"shift-shift-a-v1"', expectedVersion: 1}))
      .toThrow(/handover\.decide capability/i);
  });

  it('requires a strong matching aggregate ETag', () => {
    expect(() => startShiftCommand({tx: null as never, context: context('DISPATCHER'), id: 'shift-a',
      key: 'task04-weak-etag-check', ifMatch: 'W/"shift-shift-a-v1"', expectedVersion: 1}))
      .toThrow(/weak etags/i);
    expect(() => startShiftCommand({tx: null as never, context: context('DISPATCHER'), id: 'shift-a',
      key: 'task04-wrong-etag-check', ifMatch: '"shift-other-v1"', expectedVersion: 1}))
      .toThrow(/requested aggregate/i);
  });
});
