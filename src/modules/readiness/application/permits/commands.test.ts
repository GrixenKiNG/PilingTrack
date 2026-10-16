import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {closeWorkPermitCommand, rejectWorkPermitCommand, type PermitCommandContext} from './commands';
import {closeWorkPermitSchema, rejectWorkPermitSchema} from './schemas';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {DEFAULT_ACCESS_MATRIX} from '../../domain/access-matrix';

const mocks = vi.hoisted(() => ({audit: vi.fn(), claim: vi.fn(), complete: vi.fn(), find: vi.fn()}));
vi.mock('../../infrastructure/audit/record-audit', () => ({recordChainedReadinessAudit: mocks.audit}));
vi.mock('../../infrastructure/command-pipeline/idempotency-repository', () => ({
  PrismaCommandIdempotencyRepository: class {
    tryClaim = mocks.claim;
    complete = mocks.complete;
    find = mocks.find;
  },
}));

const context: PermitCommandContext = {tenantId: 'tenant-1', actorId: 'dispatcher', actorName: 'Диспетчер',
  actorRole: 'DISPATCHER', actingAs: null, requestId: 'request', correlationId: 'correlation'};

function fixture(overrides: Record<string, unknown> = {}) {
  const row = {id: 'permit-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', shiftId: null,
    state: 'PENDING_APPROVAL', risk: 'ELEVATED', version: 2, authorId: 'author', lastEditedById: 'author',
    workTypeId: 'work-1', workType: {name: 'Свайные работы'}, requiredApprovals: ['DISPATCHER', 'ADMIN'], allowAuthorApproval: false,
    title: 'Работы', scope: 'Описание', location: 'Куст', objectName: 'Объект', hazards: [],
    producerUserId: null, producerName: 'Производитель', observerUserId: null, observerName: '', safetyUserId: null, safetyName: '',
    validFrom: new Date('2099-01-01'), validTo: new Date('2099-01-02'), timezone: 'Europe/Moscow',
    submittedAt: new Date(), approvedAt: null, revokedAt: null, revokeReason: null,
    rejectedAt: null, rejectedById: null, rejectReason: null, createdAt: new Date(), updatedAt: new Date(),
    approvals: [{role: 'ADMIN', approvedById: 'admin', approvedAt: new Date(), valid: true, permitVersion: 2}], ...overrides};
  const tx = {
    user: {findFirst: vi.fn().mockResolvedValue({id: 'dispatcher', name: 'Диспетчер'})},
    workPermit: {findFirst: vi.fn().mockImplementation(async () => row), updateMany: vi.fn().mockImplementation(async ({data}) => {
      Object.assign(row, data); return {count: 1};
    })},
    workPermitApproval: {updateMany: vi.fn().mockResolvedValue({count: 1})},
    outboxEvent: {create: vi.fn()}, $queryRaw: vi.fn().mockResolvedValue([{id: 'permit-1'}]),
  };
  const run = (options: {context?: PermitCommandContext; reason?: string; expectedVersion?: number} = {}) => rejectWorkPermitCommand({
    tx: tx as unknown as ReadinessTransaction, context, id: 'permit-1', key: 'reject-key-1013-test', ifMatch: null,
    expectedVersion: 2, reason: 'Нет ограждения', ...options,
  });
  return {row, tx, run};
}

describe('отказ в согласовании', () => {
  beforeEach(() => {vi.clearAllMocks(); mocks.claim.mockResolvedValue(true);});

  it('возвращает в черновик, увеличивает версию, аннулирует подписи, пишет аудит и снимок', async () => {
    const {row, tx, run} = fixture();
    const result = await run();
    expect(result).toMatchObject({status: 200, headers: {ETag: '"work-permit-permit-1-v3"'}});
    expect(row).toMatchObject({state: 'DRAFT', version: 3, rejectedAt: expect.any(Date), rejectedById: 'dispatcher', rejectReason: 'Нет ограждения'});
    expect(tx.workPermit.updateMany).toHaveBeenCalledWith(expect.objectContaining({where: {tenantId: 'tenant-1', id: 'permit-1', version: 2, state: 'PENDING_APPROVAL'}}));
    expect(tx.workPermitApproval.updateMany).toHaveBeenCalledWith({where: {tenantId: 'tenant-1', permitId: 'permit-1', permitVersion: 2, valid: true},
      data: {valid: false, invalidatedAt: expect.any(Date), invalidationReason: 'Отказ: Нет ограждения'}});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({action: 'work-permit.reject', entityVersion: 3,
      after: expect.objectContaining({rejectReason: 'Нет ограждения'})}));
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it('возвращает 409 для старой версии без записи', async () => {
    const {tx, run} = fixture();
    await expect(run({expectedVersion: 1})).rejects.toMatchObject({status: 409});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'APPROVED', 'REVOKED', 'EXPIRED'])('не меняет %s', async (state) => {
    const {tx, run} = fixture({state});
    await expect(run()).rejects.toMatchObject({status: 422});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(1001)])('отклоняет недопустимую причину', async (reason) => {
    const {tx, run} = fixture();
    expect(rejectWorkPermitSchema.safeParse({expectedVersion: 2, reason}).success).toBe(false);
    await expect(run({reason})).rejects.toMatchObject({status: 422});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it.each(['OPERATOR', 'MECHANIC'])('отказывает роли %s с 403', async (actorRole) => {
    const {tx, run} = fixture();
    await expect(run({context: {...context, actorRole}})).rejects.toMatchObject({status: 403});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('не позволяет автору отказать себе даже при разрешённой авторской подписи', async () => {
    const {run} = fixture({authorId: 'dispatcher', allowAuthorApproval: true});
    await expect(run()).rejects.toMatchObject({status: 403});
  });

  it('не допускает согласующего, чья роль не требуется', async () => {
    const {run} = fixture({requiredApprovals: ['ADMIN']});
    await expect(run()).rejects.toMatchObject({status: 403});
  });

  it('разрешает второму согласующему ADMIN отказать после первой подписи', async () => {
    const {run} = fixture({approvals: [{role: 'DISPATCHER', approvedById: 'dispatcher', approvedAt: new Date(), valid: true, permitVersion: 2}]});
    await expect(run({context: {...context, actorId: 'admin', actorRole: 'ADMIN'}})).resolves.toMatchObject({status: 200});
  });

  it('читает снятое право согласования из опубликованной матрицы', async () => {
    const {run} = fixture();
    await expect(run({context: {...context, accessMatrix: {...DEFAULT_ACCESS_MATRIX,
      grants: {...DEFAULT_ACCESS_MATRIX.grants, DISPATCHER: ['readiness.read']}}}})).rejects.toMatchObject({status: 403});
  });

  it('повторяет сохранённый результат без повторного отказа и аудита', async () => {
    const {run, tx} = fixture();
    const first = await run();
    const hash = mocks.claim.mock.calls[0][0].requestHash;
    mocks.claim.mockResolvedValue(false);
    mocks.find.mockResolvedValue({status: 'completed', requestHash: hash, statusCode: first.status, result: first.body, responseHeaders: first.headers});
    expect(await run()).toMatchObject({body: first.body, replayed: true});
    expect(tx.workPermit.updateMany).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
});

const CLOSE_NOW = new Date('2026-10-15T07:00:00.000Z');
const closeContext: PermitCommandContext = {...context, actorId: 'mechanic', actorName: 'Механик', actorRole: 'MECHANIC'};

function closeFixture(overrides: Record<string, unknown> = {}) {
  const setup = fixture({state: 'APPROVED', validFrom: new Date('2026-10-15T06:00:00.000Z'),
    closedAt: null, closedById: null, closeReason: null, ...overrides});
  setup.tx.workPermit.findFirst.mockImplementation(async ({where}) =>
    where.tenantId === setup.row.tenantId && where.id === setup.row.id ? setup.row : null);
  const run = async (options: {context?: PermitCommandContext; reason?: string; expectedVersion?: number; key?: string | null} = {}) =>
    closeWorkPermitCommand({tx: setup.tx as unknown as ReadinessTransaction,
      context: closeContext, id: 'permit-1', key: 'close-key-1015-test', ifMatch: null, expectedVersion: 2, ...options});
  return {...setup, run};
}

describe('закрытие согласованного наряда', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(CLOSE_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('закрывает начавшийся наряд, увеличивает версию и сохраняет доказательства и комментарий', async () => {
    const {row, tx, run} = closeFixture({validFrom: CLOSE_NOW});
    const result = await run({reason: '  Работы завершены  '});
    expect(result).toMatchObject({status: 200, headers: {ETag: '"work-permit-permit-1-v3"'},
      body: {data: {state: 'CLOSED', closedAt: CLOSE_NOW.toISOString(), closedById: 'mechanic', closeReason: 'WORK_DONE'}}});
    expect(row).toMatchObject({state: 'CLOSED', version: 3, closedAt: CLOSE_NOW, closedById: 'mechanic', closeReason: 'WORK_DONE'});
    expect(tx.workPermit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({tenantId: 'tenant-1', id: 'permit-1', version: 2, state: 'APPROVED', validFrom: {lte: CLOSE_NOW}}),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'work-permit.closed', before: expect.objectContaining({state: 'APPROVED'}),
      after: expect.objectContaining({state: 'CLOSED', closedById: 'mechanic', closeReason: 'WORK_DONE'}),
      metadata: expect.objectContaining({comment: 'Работы завершены'}),
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
    expect(tx.workPermitApproval.updateMany).not.toHaveBeenCalled();
  });

  it.each(['MECHANIC', 'SAFETY_ENGINEER', 'ADMIN'])('право правки разрешает закрытие роли %s без комментария', async (actorRole) => {
    const {run} = closeFixture({authorId: 'mechanic'});
    await expect(run({context: {...closeContext, actorRole}})).resolves.toMatchObject({status: 200});
  });

  it.each(['DISPATCHER', 'OPERATOR', 'ASSISTANT', 'FOREMAN'])('отказывает роли %s без права правки', async (actorRole) => {
    const {tx, run} = closeFixture();
    await expect(run({context: {...closeContext, actorRole}})).rejects.toMatchObject({status: 403});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('администратор действует с правами исполняемой роли', async () => {
    const denied = closeFixture();
    await expect(denied.run({context: {...closeContext, actorRole: 'ADMIN', actingAs: 'DISPATCHER'}}))
      .rejects.toMatchObject({status: 403});
    const allowed = closeFixture();
    await expect(allowed.run({context: {...closeContext, actorRole: 'ADMIN', actingAs: 'MECHANIC'}}))
      .resolves.toMatchObject({status: 200});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: expect.objectContaining({role: 'ADMIN', actingAs: 'MECHANIC'}),
    }));
  });

  it('учитывает снятое право в опубликованной матрице', async () => {
    const {tx, run} = closeFixture();
    await expect(run({context: {...closeContext, accessMatrix: {...DEFAULT_ACCESS_MATRIX,
      grants: {...DEFAULT_ACCESS_MATRIX.grants, MECHANIC: ['readiness.read']}}}})).rejects.toMatchObject({status: 403});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('будущий наряд предлагает отозвать', async () => {
    const {tx, run} = closeFixture({validFrom: new Date(CLOSE_NOW.getTime() + 1)});
    await expect(run()).rejects.toMatchObject({status: 422, message: expect.stringMatching(/отозв/i)});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('начавшийся согласованный наряд можно закрыть и после окончания срока', async () => {
    const {run} = closeFixture({validTo: new Date(CLOSE_NOW.getTime() - 1)});
    await expect(run()).resolves.toMatchObject({status: 200});
  });

  it.each(['DRAFT', 'PENDING_APPROVAL', 'REVOKED', 'EXPIRED', 'CLOSED'])('отклоняет состояние %s без мутации', async (state) => {
    const {tx, run} = closeFixture({state});
    await expect(run()).rejects.toMatchObject({status: 422, message: expect.stringMatching(/недоступно/)});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('старая версия и проигранный CAS возвращают 409 без аудита', async () => {
    const stale = closeFixture();
    await expect(stale.run({expectedVersion: 1})).rejects.toMatchObject({status: 409});
    expect(stale.tx.workPermit.updateMany).not.toHaveBeenCalled();
    const concurrent = closeFixture();
    concurrent.tx.workPermit.updateMany.mockResolvedValue({count: 0});
    await expect(concurrent.run()).rejects.toMatchObject({status: 409});
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ''])('отсутствующая организация %s не доходит до записи/идемпотентности', async (tenantId) => {
    const {tx, run} = closeFixture();
    await expect(run({context: {...closeContext, tenantId} as PermitCommandContext})).rejects.toMatchObject({status: 403});
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(tx.workPermit.findFirst).not.toHaveBeenCalled();
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('чужой наряд не читается и не закрывается', async () => {
    const {tx, run} = closeFixture();
    await expect(run({context: {...closeContext, tenantId: 'other'}})).rejects.toMatchObject({status: 404});
    expect(tx.workPermit.findFirst).toHaveBeenCalledWith(expect.objectContaining({where: {tenantId: 'other', id: 'permit-1'}}));
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('комментарий ограничен 500 символами и тело не принимает tenantId', async () => {
    expect(closeWorkPermitSchema.safeParse({reason: 'я'.repeat(500)}).success).toBe(true);
    expect(closeWorkPermitSchema.safeParse({tenantId: 'other'}).success).toBe(false);
    const {tx, run} = closeFixture();
    await expect(run({reason: 'я'.repeat(501)})).rejects.toMatchObject({status: 422});
    expect(tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('повтор ключа возвращает сохранённое закрытие без нового аудита', async () => {
    const {tx, run} = closeFixture();
    const first = await run();
    const requestHash = mocks.claim.mock.calls[0][0].requestHash;
    mocks.claim.mockResolvedValue(false);
    mocks.find.mockResolvedValue({status: 'completed', requestHash, statusCode: first.status,
      result: first.body, responseHeaders: first.headers});
    await expect(run()).resolves.toMatchObject({body: first.body, replayed: true});
    expect(tx.workPermit.updateMany).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
});
