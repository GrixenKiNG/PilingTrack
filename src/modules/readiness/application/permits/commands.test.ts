import {beforeEach, describe, expect, it, vi} from 'vitest';
import {rejectWorkPermitCommand, type PermitCommandContext} from './commands';
import {rejectWorkPermitSchema} from './schemas';
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
