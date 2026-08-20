import {describe, expect, it} from 'vitest';
import {startShiftCommand, waiveShiftStartCommand, type ShiftCommandContext} from '../commands';

const context = (actorRole: string): ShiftCommandContext => ({
  tenantId: 'tenant-a', actorId: 'actor-a', actorName: 'Actor', actorRole,
  actingAs: null, requestId: 'request-a', correlationId: 'correlation-a',
});

describe('shift command contract', () => {
  // Пуск даёт тот, кто выходит в смену: оператор запускает чистую готовность
  // сам. Механик машину не пускает — он её обслуживает, и права допуска у него
  // нет. Заблокированную машину не пускает никто без письменного разрешения.
  it('denies shift start to MECHANIC without shift.authorize', () => {
    expect(() => startShiftCommand({tx: null as never, context: context('MECHANIC'), id: 'shift-a',
      key: 'task04-mechanic-denied', ifMatch: '"shift-shift-a-v1"', expectedVersion: 1}))
      .toThrow(/Недостаточно прав: readiness\.shift\.authorize/i);
  });

  // Разрешение выпустить заблокированную машину — не операторское решение.
  it('denies a start waiver to the operator who needs it', () => {
    expect(() => waiveShiftStartCommand({tx: null as never, context: context('OPERATOR'), id: 'shift-a',
      key: 'task07-operator-waiver-denied', reason: 'Течь небольшая, доедем до базы'}))
      .toThrow(/Недостаточно прав: readiness\.shift\.waive/i);
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
