import {describe, expect, it} from 'vitest';
import {startShiftCommand, type ShiftCommandContext} from '../commands';

const context = (actorRole: string): ShiftCommandContext => ({
  tenantId: 'tenant-a', actorId: 'actor-a', actorName: 'Actor', actorRole,
  actingAs: null, requestId: 'request-a', correlationId: 'correlation-a',
});

describe('shift command contract', () => {
  it('denies shift start to a mechanic without shift.manage', () => {
    expect(() => startShiftCommand({tx: null as never, context: context('MECHANIC'), id: 'shift-a',
      key: 'task04-mechanic-denied', ifMatch: '"shift-shift-a-v1"', expectedVersion: 1}))
      .toThrow(/shift\.manage capability/i);
  });

  it('requires a strong matching aggregate ETag', () => {
    expect(() => startShiftCommand({tx: null as never, context: context('OPERATOR'), id: 'shift-a',
      key: 'task04-weak-etag-check', ifMatch: 'W/"shift-shift-a-v1"', expectedVersion: 1}))
      .toThrow(/weak etags/i);
    expect(() => startShiftCommand({tx: null as never, context: context('OPERATOR'), id: 'shift-a',
      key: 'task04-wrong-etag-check', ifMatch: '"shift-other-v1"', expectedVersion: 1}))
      .toThrow(/requested aggregate/i);
  });
});
