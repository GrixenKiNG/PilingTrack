import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  acceptHandoverCommand,
  cancelShiftCommand,
  createShiftCommand,
  declineShiftCommand,
  requestShiftAcceptanceCommand,
  reworkHandoverCommand,
  startShiftCommand,
  submitHandoverCommand,
  updateShiftCommand,
  waiveShiftStartCommand,
  type ShiftCommandContext,
} from '../commands';
import {queryHandover, queryShift, queryShifts} from '../queries';
import {evaluateAuthoritativeShiftStart} from '../start-decision';
import type {ReadinessTransaction} from '../../../infrastructure/tenant-transaction';

/**
 * Оркестрация команд смены: права, версии, переходы состояний и побочные
 * эффекты. Репозитории подменены целиком: SQL проверяют интеграционные наборы
 * в CI, здесь доказывается, что команда вызывает их в правильном порядке и не
 * идёт дальше при отказе.
 */
const mocks = vi.hoisted(() => ({
  audit: vi.fn(), claim: vi.fn(), complete: vi.fn(), find: vi.fn(),
  shift: {
    requireActor: vi.fn(), requireEquipment: vi.fn(), requireOperatorAssignment: vi.fn(), tenantTimezone: vi.fn(),
    create: vi.fn(), get: vi.fn(), updatePlanned: vi.fn(), start: vi.fn(), requestAcceptance: vi.fn(),
    decline: vi.fn(), cancel: vi.fn(), markHandoverPending: vi.fn(), close: vi.fn(), reopen: vi.fn(),
    crewOperatorId: vi.fn(), list: vi.fn(),
  },
  handover: {get: vi.fn(), findLive: vi.fn(), createSubmitted: vi.fn(), resubmit: vi.fn(), accept: vi.fn(), rework: vi.fn()},
  clearance: vi.fn(),
  diff: vi.fn(),
}));

vi.mock('../../../infrastructure/audit/record-audit', () => ({recordChainedReadinessAudit: mocks.audit}));
vi.mock('../../../infrastructure/command-pipeline/idempotency-repository', () => ({
  PrismaCommandIdempotencyRepository: class {
    tryClaim = mocks.claim; complete = mocks.complete; find = mocks.find;
  },
}));
vi.mock('../../../infrastructure/shifts/shift-repository', () => ({
  ShiftRepository: class { constructor() { return mocks.shift as never; } },
}));
vi.mock('../../../infrastructure/shifts/handover-repository', () => ({
  HandoverRepository: class { constructor() { return mocks.handover as never; } },
}));
vi.mock('../start-decision', () => ({evaluateAuthoritativeShiftStart: vi.fn()}));
vi.mock('@/modules/users', () => ({getOperatorClearance: mocks.clearance}));
vi.mock('@/modules/inspections/client', () => ({diffInspectionStates: mocks.diff}));

const KEY = 'shift-flow-key-1234567890';
const ctx = (actorRole: string, actingAs: string | null = null, actorId = 'actor'): ShiftCommandContext => ({
  tenantId: 'tenant-1', actorId, actorName: 'Актор', actorRole, actingAs, requestId: 'req', correlationId: 'corr',
});
const operator = ctx('OPERATOR', null, 'operator-1');
const dispatcher = ctx('DISPATCHER', null, 'dispatcher-1');
const admin = ctx('ADMIN', null, 'admin-1');

const NOW = new Date('2099-03-01T08:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'shift-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', state: 'PLANNED', version: 1, type: 'DAY',
  timezone: 'Europe/Moscow', productionDate: new Date('2099-03-01'), plannedStartAt: null, plannedEndAt: null,
  requestedAt: null, declinedAt: null, startedAt: null, closedAt: null, cancelledAt: null, autoClosedAt: null,
  createdAt: NOW, updatedAt: NOW, handovers: [], ...over,
});
const handoverRow = (over: Record<string, unknown> = {}) => ({
  id: 'handover-1', tenantId: 'tenant-1', shiftId: 'shift-1', state: 'SUBMITTED', version: 1, summary: 'Состояние норм',
  evidence: {}, submittedById: 'operator-1', submittedAt: NOW, acceptedAt: null, reworkedAt: null,
  createdAt: NOW, updatedAt: NOW, ...over,
});

const createTx = () => ({
  outboxEvent: {createMany: vi.fn()},
  report: {findFirst: vi.fn().mockResolvedValue({id: 'report-1'})},
  inspection: {findMany: vi.fn().mockResolvedValue([])},
  readinessScoreSnapshot: {findFirst: vi.fn()},
  shiftStartWaiver: {upsert: vi.fn()},
});
let tx: ReturnType<typeof createTx>;
const asTx = () => tx as unknown as ReadinessTransaction;

beforeEach(() => {
  vi.clearAllMocks();
  for (const group of [mocks.shift, mocks.handover]) Object.values(group).forEach((fn) => fn.mockReset());
  mocks.claim.mockResolvedValue(true);
  mocks.clearance.mockReset();
  mocks.diff.mockReset();
  mocks.shift.tenantTimezone.mockResolvedValue('Europe/Moscow');
  mocks.shift.crewOperatorId.mockResolvedValue(null);
  tx = createTx();
});

const actionNames = () => mocks.audit.mock.calls.map(([, event]) => event.action);

describe('создание и правка смены', () => {
  it('оператор открывает смену на своей машине', async () => {
    mocks.shift.create.mockResolvedValue(row());
    const result = await createShiftCommand({tx: asTx(), context: operator, key: KEY,
      payload: {equipmentId: 'equipment-1', type: 'DAY'}, now: NOW});
    expect(result.status).toBe(201);
    expect(result.headers).toMatchObject({Location: '/api/readiness/shifts/shift-1'});
    expect(mocks.shift.requireOperatorAssignment).toHaveBeenCalledWith('operator-1', 'equipment-1');
    expect(actionNames()).toEqual(['shift.created']);
    expect(tx.outboxEvent.createMany).toHaveBeenCalledOnce();
  });

  it('диспетчер/админ заводят смену на любой машине без проверки закрепления', async () => {
    mocks.shift.create.mockResolvedValue(row());
    await createShiftCommand({tx: asTx(), context: admin, key: KEY, payload: {equipmentId: 'equipment-1', type: 'NIGHT'}, now: NOW});
    expect(mocks.shift.requireOperatorAssignment).not.toHaveBeenCalled();
  });

  it('администратор в режиме оператора проверяется как оператор', async () => {
    mocks.shift.create.mockResolvedValue(row());
    await createShiftCommand({tx: asTx(), context: ctx('ADMIN', 'OPERATOR', 'admin-1'), key: KEY,
      payload: {equipmentId: 'equipment-1', type: 'DAY'}, now: NOW});
    expect(mocks.shift.requireOperatorAssignment).toHaveBeenCalled();
  });

  it('чужая машина оператора останавливает команду', async () => {
    mocks.shift.requireOperatorAssignment.mockRejectedValue(Object.assign(new Error('not yours'), {status: 403}));
    await expect(createShiftCommand({tx: asTx(), context: operator, key: KEY,
      payload: {equipmentId: 'equipment-9', type: 'DAY'}, now: NOW})).rejects.toThrow('not yours');
    expect(mocks.shift.create).not.toHaveBeenCalled();
  });

  it('окончание раньше начала отклоняется до записи', async () => {
    await expect(createShiftCommand({tx: asTx(), context: admin, key: KEY, now: NOW,
      payload: {equipmentId: 'equipment-1', type: 'DAY', plannedStartAt: '2099-03-01T10:00:00Z', plannedEndAt: '2099-03-01T09:00:00Z'}}))
      .rejects.toMatchObject({status: 422});
    expect(mocks.shift.create).not.toHaveBeenCalled();
  });

  it('роль без права управлять сменой получает отказ сразу', () => {
    expect(() => createShiftCommand({tx: asTx(), context: dispatcher, key: KEY, payload: {equipmentId: 'e', type: 'DAY'}}))
      .toThrow(/shift\.manage/);
  });

  it('правит плановые часы только у запланированной смены', async () => {
    mocks.shift.get.mockResolvedValue(row());
    mocks.shift.updatePlanned.mockResolvedValue(row({version: 2, type: 'NIGHT'}));
    const result = await updateShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, type: 'NIGHT', plannedStartAt: '2099-03-01T10:00:00Z', plannedEndAt: null}});
    expect(result.status).toBe(200);
    expect(mocks.shift.updatePlanned).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NIGHT', plannedStartAt: new Date('2099-03-01T10:00:00Z'), plannedEndAt: null}));
    expect(actionNames()).toEqual(['shift.updated']);
  });

  it('смену в работе править нельзя', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'STARTED'}));
    await expect(updateShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, type: 'NIGHT'}})).rejects.toMatchObject({status: 409});
    expect(mocks.shift.updatePlanned).not.toHaveBeenCalled();
  });

  it('оставляет прежние часы, когда они не присланы', async () => {
    const planned = new Date('2099-03-01T10:00:00Z');
    mocks.shift.get.mockResolvedValue(row({plannedStartAt: planned, plannedEndAt: new Date('2099-03-01T20:00:00Z')}));
    mocks.shift.updatePlanned.mockResolvedValue(row({version: 2}));
    await updateShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, type: 'NIGHT'}});
    expect(mocks.shift.updatePlanned).toHaveBeenCalledWith(expect.objectContaining({plannedStartAt: undefined, plannedEndAt: undefined}));
  });
});

describe('запрос допуска, отказ и отмена', () => {
  it('оператор просит допуск у запланированной смены', async () => {
    mocks.shift.get.mockResolvedValue(row());
    mocks.shift.requestAcceptance.mockResolvedValue(row({state: 'PENDING_ACCEPTANCE', version: 2, requestedAt: NOW}));
    const result = await requestShiftAcceptanceCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1, now: NOW});
    expect(result.status).toBe(200);
    expect(actionNames()).toEqual(['shift.acceptance-requested']);
  });

  it('просить повторно нельзя', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'PENDING_ACCEPTANCE'}));
    await expect(requestShiftAcceptanceCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 409});
  });

  it('диспетчер отказывает в допуске с причиной и возвращает смену оператору', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'PENDING_ACCEPTANCE'}));
    mocks.shift.decline.mockResolvedValue(row({state: 'PLANNED', version: 2, declinedAt: NOW}));
    const result = await declineShiftCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: '  Нет допуска по документам  ', now: NOW});
    expect(result.status).toBe(200);
    expect(mocks.shift.decline).toHaveBeenCalledWith(expect.objectContaining({reason: 'Нет допуска по документам'}));
    expect(actionNames()).toEqual(['shift.acceptance-declined']);
  });

  it('отказ без причины не принимается', () => {
    expect(() => declineShiftCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: 'ab'})).toThrow(/Причина/);
  });

  it('отказать можно только в ожидающем допуска', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'STARTED'}));
    await expect(declineShiftCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: 'Нет допуска'})).rejects.toMatchObject({status: 409});
  });

  it('отмена с причиной пишет событие', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'STARTED'}));
    mocks.shift.cancel.mockResolvedValue(row({state: 'CANCELLED', version: 2, cancelledAt: NOW}));
    await cancelShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: 'Дождь', now: NOW});
    expect(actionNames()).toEqual(['shift.cancelled']);
  });

  it.each(['CLOSED', 'CANCELLED', 'HANDOVER_PENDING'])('смену в состоянии %s отменить нельзя', async (state) => {
    mocks.shift.get.mockResolvedValue(row({state}));
    await expect(cancelShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: 'Дождь'})).rejects.toMatchObject({status: 409});
    expect(mocks.shift.cancel).not.toHaveBeenCalled();
  });
});

describe('пуск смены', () => {
  const pending = () => row({state: 'PENDING_ACCEPTANCE'});
  const allowed = {allowed: true, score: 100, blockers: [], warnings: [], snapshotId: 's1', ruleSetId: 'r', ruleSetVersion: 1, evidence: {}};

  it('запускает смену при чистой готовности и допуске по документам', async () => {
    mocks.shift.get.mockResolvedValue(pending());
    mocks.shift.crewOperatorId.mockResolvedValue('operator-1');
    mocks.clearance.mockResolvedValue({cleared: true, blockers: []});
    vi.mocked(evaluateAuthoritativeShiftStart).mockResolvedValue(allowed as never);
    mocks.shift.start.mockResolvedValue(row({state: 'STARTED', version: 2, startedAt: NOW}));
    const result = await startShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1, now: NOW});
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ETag: '"shift-shift-1-v2"'});
    expect(actionNames()).toEqual(['shift.started']);
  });

  it('просроченные документы машиниста закрывают пуск и не зависят от готовности машины', async () => {
    mocks.shift.get.mockResolvedValue(pending());
    mocks.shift.crewOperatorId.mockResolvedValue('operator-1');
    mocks.clearance.mockResolvedValue({cleared: false, blockers: [{label: 'Удостоверение просрочено'}]});
    const result = await startShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1, now: NOW});
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({error: {code: 'OPERATOR_NOT_CLEARED', details: {blockers: ['Удостоверение просрочено']}}});
    expect(evaluateAuthoritativeShiftStart).not.toHaveBeenCalled();
    expect(mocks.shift.start).not.toHaveBeenCalled();
    expect(actionNames()).toEqual(['shift.start-blocked']);
  });

  it('блокировка по правилам готовности возвращает 422 с причинами и снимком', async () => {
    mocks.shift.get.mockResolvedValue(pending());
    vi.mocked(evaluateAuthoritativeShiftStart).mockResolvedValue({...allowed, allowed: false,
      blockers: [{condition: 'OPEN_CRITICAL_DEFECT'}]} as never);
    const result = await startShiftCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1, now: NOW});
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({error: {code: 'SHIFT_START_BLOCKED', details: {snapshotId: 's1'}}});
    expect(mocks.shift.start).not.toHaveBeenCalled();
    expect(actionNames()).toEqual(['shift.start-blocked']);
  });

  it('устаревшая версия возвращает 409 с текущим состоянием', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'PENDING_ACCEPTANCE', version: 4}));
    await expect(startShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 409, details: {current: expect.anything()}});
  });

  it('запустить можно только смену, ждущую допуска', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'PLANNED'}));
    await expect(startShiftCommand({tx: asTx(), context: operator, id: 'shift-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 409});
  });
});

describe('письменное разрешение на пуск', () => {
  const REASON = 'Течь небольшая, дотянем до базы';

  it('выдаётся на набор препятствий последнего снимка', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'PENDING_ACCEPTANCE'}));
    tx.readinessScoreSnapshot.findFirst.mockResolvedValue({id: 'snap-1', status: 'BLOCKED',
      blockers: [{condition: 'B'}, {code: 'A'}]});
    tx.shiftStartWaiver.upsert.mockResolvedValue({id: 'w1', blockerFingerprint: 'A,B', issuedAt: NOW});
    const result = await waiveShiftStartCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, reason: REASON, now: NOW});
    expect(result.status).toBe(201);
    expect(tx.shiftStartWaiver.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({blockerFingerprint: 'A,B', snapshotId: 'snap-1', issuedById: 'dispatcher-1'})}));
    expect(actionNames()).toEqual(['shift.start-waived']);
  });

  it('без рассчитанной готовности разрешать нечего', async () => {
    mocks.shift.get.mockResolvedValue(row());
    tx.readinessScoreSnapshot.findFirst.mockResolvedValue(null);
    await expect(waiveShiftStartCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, reason: REASON}))
      .rejects.toMatchObject({status: 409});
  });

  it('когда препятствий нет, разрешение не нужно', async () => {
    mocks.shift.get.mockResolvedValue(row());
    tx.readinessScoreSnapshot.findFirst.mockResolvedValue({id: 'snap-1', status: 'OK', blockers: []});
    await expect(waiveShiftStartCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, reason: REASON}))
      .rejects.toMatchObject({status: 409});
    tx.readinessScoreSnapshot.findFirst.mockResolvedValue({id: 'snap-1', status: 'OK', blockers: null});
    await expect(waiveShiftStartCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, reason: REASON}))
      .rejects.toMatchObject({status: 409});
    expect(tx.shiftStartWaiver.upsert).not.toHaveBeenCalled();
  });

  it('короткая причина отклоняется', () => {
    expect(() => waiveShiftStartCommand({tx: asTx(), context: dispatcher, id: 'shift-1', key: KEY, reason: 'коротко'}))
      .toThrow(/от 10 до 1000/);
  });
});

describe('передача смены', () => {
  const started = () => row({state: 'STARTED'});

  beforeEach(() => {
    mocks.handover.findLive.mockResolvedValue(null);
    mocks.handover.createSubmitted.mockResolvedValue(handoverRow());
    mocks.shift.markHandoverPending.mockResolvedValue(row({state: 'HANDOVER_PENDING', version: 2}));
  });

  it('оператор сдаёт смену после отправки сменного отчёта', async () => {
    mocks.shift.get.mockResolvedValue(started());
    const result = await submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: '  Машина в порядке  '}, now: NOW});
    expect(result.status).toBe(201);
    expect(mocks.handover.createSubmitted).toHaveBeenCalledWith(expect.objectContaining({summary: 'Машина в порядке'}));
    expect(actionNames()).toEqual(['handover.submitted']);
  });

  it('оператор не сдаёт смену без отправленного отчёта', async () => {
    mocks.shift.get.mockResolvedValue(started());
    tx.report.findFirst.mockResolvedValue(null);
    await expect(submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: 'Машина в порядке'}})).rejects.toMatchObject({status: 409});
    expect(mocks.handover.createSubmitted).not.toHaveBeenCalled();
  });

  it('механик возвращает технику без сменного отчёта', async () => {
    mocks.shift.get.mockResolvedValue(started());
    tx.report.findFirst.mockResolvedValue(null);
    const result = await submitHandoverCommand({tx: asTx(), context: ctx('MECHANIC'), shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: 'Ремонт завершён'}, now: NOW});
    expect(result.status).toBe(201);
  });

  it('ухудшения состояния машины попадают в передачу сами', async () => {
    mocks.shift.get.mockResolvedValue(started());
    tx.inspection.findMany.mockResolvedValue([
      {phase: 'PRE_SHIFT', templateSnapshot: [{id: 'i1', text: 'Масло'}], answers: [{itemId: 'i1', result: 'OK'}]},
      {phase: 'POST_SHIFT', templateSnapshot: [{id: 'i1', text: 'Масло'}], answers: [{itemId: 'i1', result: 'FAULT'}]},
    ]);
    mocks.diff.mockReturnValue([{text: 'Масло', worsened: true}, {text: 'Фара', worsened: false}]);
    await submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: 'Масло потекло', evidence: {note: 'x'}}, now: NOW});
    expect(mocks.handover.createSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      evidence: {note: 'x', stateChanges: [{text: 'Масло', worsened: true}]}}));
  });

  it('без осмотра после работ сравнивать нечего: изменений в передачу не добавляется', async () => {
    mocks.shift.get.mockResolvedValue(started());
    tx.inspection.findMany.mockResolvedValue([
      {phase: 'PRE_SHIFT', templateSnapshot: 'не список', answers: [{itemId: 'i1', result: 'OK'}]},
    ]);
    await submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: 'Всё в порядке'}, now: NOW});
    expect(mocks.diff).not.toHaveBeenCalled();
    expect(mocks.handover.createSubmitted).toHaveBeenCalledWith(expect.objectContaining({evidence: {}}));
  });

  it('возвращённая на доработку передача переоформляется той же записью', async () => {
    mocks.shift.get.mockResolvedValue(started());
    const live = handoverRow({state: 'REWORK_REQUIRED', version: 3});
    mocks.handover.findLive.mockResolvedValue(live);
    mocks.handover.resubmit.mockResolvedValue(handoverRow({version: 4}));
    await submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: 'Исправил'}, now: NOW});
    expect(mocks.handover.resubmit).toHaveBeenCalledWith(expect.objectContaining({id: 'handover-1', version: 3}));
    expect(mocks.handover.createSubmitted).not.toHaveBeenCalled();
    expect(actionNames()).toEqual(['handover.resubmitted']);
  });

  it('смену не в работе сдать нельзя', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'PLANNED'}));
    await expect(submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: 'Машина в порядке'}})).rejects.toMatchObject({status: 409});
  });

  it('пустое описание состояния отклоняется', async () => {
    mocks.shift.get.mockResolvedValue(started());
    await expect(submitHandoverCommand({tx: asTx(), context: operator, shiftId: 'shift-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, summary: ' '}})).rejects.toMatchObject({status: 422});
  });
});

describe('приёмка и возврат передачи', () => {
  beforeEach(() => {
    mocks.shift.get.mockResolvedValue(row({state: 'HANDOVER_PENDING', version: 2}));
    mocks.shift.close.mockResolvedValue(row({state: 'CLOSED', version: 3, closedAt: NOW}));
    mocks.shift.reopen.mockResolvedValue(row({state: 'STARTED', version: 3}));
  });

  it('приёмка закрывает смену', async () => {
    mocks.handover.get.mockResolvedValue(handoverRow());
    mocks.handover.accept.mockResolvedValue(handoverRow({state: 'ACCEPTED', version: 2, acceptedAt: NOW}));
    const result = await acceptHandoverCommand({tx: asTx(), context: dispatcher, id: 'handover-1', key: KEY,
      ifMatch: null, expectedVersion: 1, now: NOW});
    expect(result.status).toBe(200);
    expect(mocks.shift.close).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'handover.accepted', after: expect.not.objectContaining({selfAccepted: true})}));
  });

  it('приёмка собственной передачи разрешена, но помечается в журнале', async () => {
    mocks.handover.get.mockResolvedValue(handoverRow({submittedById: 'operator-1'}));
    mocks.handover.accept.mockResolvedValue(handoverRow({state: 'ACCEPTED', version: 2, acceptedAt: NOW}));
    await acceptHandoverCommand({tx: asTx(), context: operator, id: 'handover-1', key: KEY,
      ifMatch: null, expectedVersion: 1, now: NOW});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      after: expect.objectContaining({selfAccepted: true})}));
  });

  it('возврат на доработку требует причину и снова открывает смену', async () => {
    mocks.handover.get.mockResolvedValue(handoverRow());
    mocks.handover.rework.mockResolvedValue(handoverRow({state: 'REWORK_REQUIRED', version: 2, reworkedAt: NOW}));
    await reworkHandoverCommand({tx: asTx(), context: dispatcher, id: 'handover-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: 'Не указан расход', now: NOW});
    expect(mocks.shift.reopen).toHaveBeenCalledOnce();
    expect(mocks.shift.close).not.toHaveBeenCalled();
    expect(actionNames()).toEqual(['handover.rework-requested']);
  });

  it('возврат без причины отклоняется до записи', async () => {
    mocks.handover.get.mockResolvedValue(handoverRow());
    await expect(reworkHandoverCommand({tx: asTx(), context: dispatcher, id: 'handover-1', key: KEY, ifMatch: null,
      expectedVersion: 1, reason: ''})).rejects.toMatchObject({status: 422});
    expect(mocks.handover.rework).not.toHaveBeenCalled();
  });

  it.each([['устаревшая версия', {version: 5}], ['уже принята', {state: 'ACCEPTED'}]])('%s — 409 с текущим состоянием', async (_name, over) => {
    mocks.handover.get.mockResolvedValue(handoverRow(over));
    await expect(acceptHandoverCommand({tx: asTx(), context: dispatcher, id: 'handover-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 409, details: {current: expect.anything()}});
    expect(mocks.handover.accept).not.toHaveBeenCalled();
  });

  it('мастер без права решать приёмку получает 403', async () => {
    await expect(acceptHandoverCommand({tx: asTx(), context: ctx('FOREMAN'), id: 'handover-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 403});
    expect(mocks.handover.get).not.toHaveBeenCalled();
  });
});

describe('повтор команды и чтение', () => {
  it('повтор с тем же ключом возвращает сохранённый ответ без второй записи', async () => {
    mocks.shift.get.mockResolvedValue(row({state: 'STARTED'}));
    mocks.shift.cancel.mockResolvedValue(row({state: 'CANCELLED', version: 2, cancelledAt: NOW}));
    const input = {tx: asTx(), context: operator, id: 'shift-1', key: KEY, ifMatch: null, expectedVersion: 1, reason: 'Дождь', now: NOW};
    const first = await cancelShiftCommand(input);
    const hash = mocks.claim.mock.calls[0][0].requestHash;
    mocks.claim.mockResolvedValue(false);
    mocks.find.mockResolvedValue({status: 'completed', requestHash: hash, statusCode: first.status,
      result: first.body, responseHeaders: first.headers});
    expect(await cancelShiftCommand(input)).toMatchObject({replayed: true});
    expect(mocks.shift.cancel).toHaveBeenCalledOnce();
  });

  it('списки и карточки отдают сериализованные записи', async () => {
    mocks.shift.list.mockResolvedValue({rows: [row({handovers: [handoverRow()]})], total: 1});
    const list = await queryShifts(asTx(), {tenantId: 'tenant-1', limit: 10});
    expect(list).toMatchObject({page: {limit: 10, total: 1}});
    expect(list.data[0]).toMatchObject({productionDate: '2099-03-01', handovers: [{submittedAt: NOW.toISOString()}]});
    mocks.shift.get.mockResolvedValue(row());
    expect(await queryShift(asTx(), 'tenant-1', 'shift-1')).toMatchObject({id: 'shift-1'});
    mocks.handover.get.mockResolvedValue(handoverRow());
    expect(await queryHandover(asTx(), 'tenant-1', 'handover-1')).toMatchObject({id: 'handover-1'});
  });
});
