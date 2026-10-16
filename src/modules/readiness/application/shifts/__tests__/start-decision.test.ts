import {beforeEach, describe, expect, it, vi} from 'vitest';
import {evaluateAuthoritativeShiftStart} from '../start-decision';
import {
  acceptHandoverSchema,
  cancelShiftSchema,
  createShiftSchema,
  declineShiftSchema,
  reworkHandoverSchema,
  submitHandoverSchema,
  updateShiftSchema,
  versionedShiftSchema,
} from '../schemas';
import type {ReadinessTransaction} from '../../../infrastructure/tenant-transaction';

const mocks = vi.hoisted(() => ({evaluate: vi.fn(), snapshot: vi.fn()}));
vi.mock('../../readiness-score', () => ({evaluateAuthoritativeReadiness: mocks.evaluate}));
vi.mock('../../../infrastructure/snapshots/snapshot-repository', () => ({createDeduplicatedSnapshot: mocks.snapshot}));

const NOW = new Date('2099-03-01T08:00:00Z');
const evaluation = (over: Record<string, unknown> = {}) => ({
  allowed: true, score: 92, blockers: [], warnings: [{condition: 'W'}], ruleSetId: 'rules-1',
  evidence: {source: 'test'}, ...over,
});

function setup(waiver: unknown) {
  const tx = {
    shiftStartWaiver: {findFirst: vi.fn().mockResolvedValue(waiver)},
    shift: {updateMany: vi.fn()},
  };
  const run = () => evaluateAuthoritativeShiftStart({tx: tx as unknown as ReadinessTransaction,
    tenantId: 'tenant-1', equipmentId: 'equipment-1', shiftId: 'shift-1', now: NOW, timezone: 'Europe/Moscow'});
  return {tx, run};
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue({id: 'snap-1', ruleSetId: 'rules-1', ruleSetVersion: 7});
});

describe('решение о пуске смены', () => {
  it('чистая готовность разрешает пуск и закрепляет снимок за сменой один раз', async () => {
    mocks.evaluate.mockResolvedValue(evaluation());
    const {tx, run} = setup(null);
    const decision = await run();
    expect(decision).toMatchObject({allowed: true, score: 92, snapshotId: 'snap-1', ruleSetVersion: 7, evidence: {source: 'test'}});
    expect(tx.shift.updateMany).toHaveBeenCalledWith({
      where: {tenantId: 'tenant-1', id: 'shift-1', startSnapshotId: null}, data: {startSnapshotId: 'snap-1'}});
    expect(tx.shiftStartWaiver.findFirst).not.toHaveBeenCalled();
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      triggerType: 'SHIFT_START_DECISION', triggerId: `shift-1:start:${NOW.toISOString()}`}), expect.anything());
  });

  it('блокировка без разрешения закрывает пуск и снимок за сменой не закрепляется', async () => {
    mocks.evaluate.mockResolvedValue(evaluation({allowed: false, blockers: [{condition: 'LEAK'}]}));
    const {tx, run} = setup(null);
    const decision = await run();
    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toEqual([{condition: 'LEAK'}]);
    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });

  it('письменное разрешение диспетчера открывает пуск и попадает в доказательства', async () => {
    mocks.evaluate.mockResolvedValue(evaluation({allowed: false, blockers: [{condition: 'LEAK'}, {code: 'TO_OVERDUE'}]}));
    const {tx, run} = setup({id: 'w1', reason: 'Дотянем до базы', blockerFingerprint: 'LEAK,TO_OVERDUE'});
    const decision = await run();
    expect(decision.allowed).toBe(true);
    expect(decision.evidence).toEqual({source: 'test', startWaiver: {id: 'w1', reason: 'Дотянем до базы'}});
    expect(tx.shift.updateMany).toHaveBeenCalledOnce();
  });

  it('новое препятствие после выдачи разрешения закрывает пуск снова', async () => {
    mocks.evaluate.mockResolvedValue(evaluation({allowed: false, blockers: [{condition: 'LEAK'}, {condition: 'BRAKES'}]}));
    const {tx, run} = setup({id: 'w1', reason: 'Дотянем до базы', blockerFingerprint: 'LEAK'});
    const decision = await run();
    expect(decision.allowed).toBe(false);
    expect(decision.evidence).toEqual({source: 'test'});
    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });

  it('если часть препятствий исчезла, прежнее разрешение всё ещё действует', async () => {
    mocks.evaluate.mockResolvedValue(evaluation({allowed: false, blockers: [{condition: 'LEAK'}]}));
    const {run} = setup({id: 'w1', reason: 'Дотянем до базы', blockerFingerprint: 'LEAK,BRAKES'});
    expect((await run()).allowed).toBe(true);
  });
});

describe('схемы команд смены', () => {
  it('создание: тип смены и идентификатор обязательны, лишние поля запрещены', () => {
    expect(createShiftSchema.safeParse({equipmentId: 'e1', type: 'DAY'}).success).toBe(true);
    expect(createShiftSchema.safeParse({equipmentId: 'e1', type: 'EVENING'}).success).toBe(false);
    expect(createShiftSchema.safeParse({equipmentId: '', type: 'DAY'}).success).toBe(false);
    expect(createShiftSchema.safeParse({equipmentId: 'e1', type: 'DAY', state: 'STARTED'}).success).toBe(false);
    expect(createShiftSchema.safeParse({equipmentId: 'e1', type: 'DAY', plannedStartAt: 'вчера'}).success).toBe(false);
    expect(createShiftSchema.safeParse({equipmentId: 'e1', type: 'NIGHT', plannedStartAt: '2099-03-01T08:00:00+03:00', plannedEndAt: null}).success).toBe(true);
  });

  it('правка: нужно хоть одно содержательное поле', () => {
    expect(updateShiftSchema.safeParse({expectedVersion: 2}).success).toBe(false);
    expect(updateShiftSchema.safeParse({expectedVersion: 2, type: 'NIGHT'}).success).toBe(true);
    expect(updateShiftSchema.safeParse({expectedVersion: 0, type: 'NIGHT'}).success).toBe(false);
  });

  it('причины отмены, отказа и возврата: от 3 до 1000 символов', () => {
    for (const schema of [cancelShiftSchema, declineShiftSchema, reworkHandoverSchema]) {
      expect(schema.safeParse({reason: 'ab'}).success).toBe(false);
      expect(schema.safeParse({reason: 'abc'}).success).toBe(true);
      expect(schema.safeParse({reason: 'x'.repeat(1001)}).success).toBe(false);
    }
  });

  it('передача: описание обязательно, доказательства произвольные', () => {
    expect(submitHandoverSchema.safeParse({summary: 'ab'}).success).toBe(false);
    expect(submitHandoverSchema.safeParse({summary: 'Состояние норм', evidence: {a: 1}}).success).toBe(true);
    expect(submitHandoverSchema.safeParse({summary: 'x'.repeat(4001)}).success).toBe(false);
  });

  it('версионные команды принимают только положительную версию и ничего лишнего', () => {
    expect(versionedShiftSchema.safeParse({}).success).toBe(true);
    expect(versionedShiftSchema.safeParse({expectedVersion: 3}).success).toBe(true);
    expect(versionedShiftSchema.safeParse({expectedVersion: 1.5}).success).toBe(false);
    expect(acceptHandoverSchema.safeParse({expectedVersion: 1, extra: true}).success).toBe(false);
  });
});
