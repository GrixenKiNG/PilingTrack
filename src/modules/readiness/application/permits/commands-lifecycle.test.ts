import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  approveWorkPermitCommand,
  createWorkPermitCommand,
  revokeWorkPermitCommand,
  submitWorkPermitCommand,
  updateWorkPermitCommand,
  type PermitCommandContext,
} from './commands';
import {queryWorkPermit, queryWorkPermits} from './queries';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';

const mocks = vi.hoisted(() => ({audit: vi.fn(), claim: vi.fn(), complete: vi.fn(), find: vi.fn()}));
vi.mock('../../infrastructure/audit/record-audit', () => ({recordChainedReadinessAudit: mocks.audit}));
vi.mock('../../infrastructure/command-pipeline/idempotency-repository', () => ({
  PrismaCommandIdempotencyRepository: class {
    tryClaim = mocks.claim;
    complete = mocks.complete;
    find = mocks.find;
  },
}));

const KEY = 'lifecycle-key-1234567890';
const dispatcher: PermitCommandContext = {tenantId: 'tenant-1', actorId: 'dispatcher', actorName: 'Диспетчер',
  actorRole: 'DISPATCHER', actingAs: null, requestId: 'request', correlationId: 'correlation'};
const admin: PermitCommandContext = {...dispatcher, actorId: 'admin', actorName: 'Админ', actorRole: 'ADMIN'};
// Оформляет и отзывает наряды инженер ОТ; диспетчер только согласует.
const editor: PermitCommandContext = {...dispatcher, actorId: 'safety', actorName: 'Инженер ОТ', actorRole: 'SAFETY_ENGINEER'};

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- нестрогая подмена строки Prisma

function baseRow(overrides: Row = {}): Row {
  return {id: 'permit-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', shiftId: null,
    state: 'DRAFT', risk: 'ELEVATED', version: 1, authorId: 'author', lastEditedById: 'author',
    workTypeId: 'work-1', workType: {name: 'Свайные работы'}, requiredApprovals: ['DISPATCHER', 'ADMIN'],
    allowAuthorApproval: false, title: 'Работы', scope: 'Описание работ', location: 'Куст 5',
    objectName: 'Объект', hazards: [], producerUserId: null, producerName: 'Производитель',
    observerUserId: null, observerName: '', safetyUserId: null, safetyName: '',
    validFrom: new Date('2099-01-01'), validTo: new Date('2099-01-02'), timezone: 'Europe/Moscow',
    submittedAt: null, approvedAt: null, revokedAt: null, revokeReason: null,
    rejectedAt: null, rejectedById: null, rejectReason: null,
    createdAt: new Date('2098-12-01'), updatedAt: new Date('2098-12-01'), approvals: [], ...overrides};
}

/** Состояние хранится в замыкании: команды видят то, что записали предыдущие шаги. */
function makeTx(initial: Row | null) {
  let row: Row | null = initial;
  const applyData = (target: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      target[key] = value && typeof value === 'object' && 'set' in value ? value.set : value;
    }
  };
  const tx = {
    user: {findFirst: vi.fn(async () => ({id: 'someone', name: 'Иван Петров'}))},
    equipment: {findFirst: vi.fn(async () => ({id: 'equipment-1'}))},
    tenantSettings: {findUnique: vi.fn(async () => ({timezone: 'Europe/Moscow'}))},
    permitWorkType: {findFirst: vi.fn(async () => ({defaultRisk: 'ELEVATED', name: 'Свайные работы',
      requiredApprovals: ['DISPATCHER', 'ADMIN'], allowAuthorApproval: false}))},
    workPermit: {
      create: vi.fn(async ({data}: {data: Row}) => {
        row = baseRow({...data, state: 'DRAFT', version: 1, approvals: [], workType: {name: 'Свайные работы'}});
        return row;
      }),
      findFirst: vi.fn(async () => row),
      findMany: vi.fn(async () => (row ? [row] : [])),
      count: vi.fn(async () => (row ? 1 : 0)),
      updateMany: vi.fn(async ({where, data}: {where: Row; data: Row}) => {
        if (!row) return {count: 0};
        if (where.version !== undefined && where.version !== row.version) return {count: 0};
        if (where.state !== undefined && where.state !== row.state) return {count: 0};
        applyData(row, data);
        return {count: 1};
      }),
    },
    workPermitApproval: {
      create: vi.fn(async ({data}: {data: Row}) => {
        row?.approvals.push({role: data.role, approvedById: data.approvedById,
          approvedAt: new Date(), valid: true, permitVersion: data.permitVersion});
      }),
      updateMany: vi.fn(async () => {
        let count = 0;
        for (const item of row?.approvals ?? []) { if (item.valid) { item.valid = false; count += 1; } }
        return {count};
      }),
    },
    outboxEvent: {create: vi.fn()},
    $queryRaw: vi.fn(async () => (row ? [{id: row.id}] : [])),
  };
  return {tx, get row() { return row; }, asTx: tx as unknown as ReadinessTransaction};
}

const createPayload = {equipmentId: 'equipment-1', workTypeId: 'work-1', risk: 'ELEVATED' as const,
  title: 'Свайные работы на кусту 5', scope: 'Погружение свай', location: 'Куст 5',
  producerName: 'Иванов И.И.', validFrom: '2099-01-01T08:00:00+03:00', validTo: '2099-01-02T08:00:00+03:00'};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue(true);
});

describe('создание наряда-допуска', () => {
  it('создаёт черновик, берёт правило согласования из вида работ и пишет аудит и снимок', async () => {
    const s = makeTx(null);
    const result = await createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY, payload: createPayload});
    expect(result.status).toBe(201);
    expect(result.headers).toMatchObject({Location: expect.stringContaining('/api/readiness/work-permits/')});
    expect(s.tx.workPermit.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      requiredApprovals: ['DISPATCHER', 'ADMIN'], allowAuthorApproval: false, authorId: 'safety', timezone: 'Europe/Moscow',
    })}));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({action: 'work-permit.created'}));
    expect(s.tx.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it('подставляет ФИО ответственного из базы, а не из присланного тела', async () => {
    const s = makeTx(null);
    await createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY,
      payload: {...createPayload, producerUserId: 'user-9', producerName: 'Подмена'}});
    expect(s.tx.workPermit.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      producerUserId: 'user-9', producerName: 'Иван Петров',
    })}));
  });

  it('отказывает роли без права оформлять наряд и ничего не пишет', async () => {
    const s = makeTx(null);
    await expect(createWorkPermitCommand({tx: s.asTx, context: {...dispatcher, actorRole: 'OPERATOR'}, key: KEY, payload: createPayload}))
      .rejects.toMatchObject({status: 403});
    expect(s.tx.workPermit.create).not.toHaveBeenCalled();
  });

  it('требует ключ повторной отправки', async () => {
    const s = makeTx(null);
    await expect(createWorkPermitCommand({tx: s.asTx, context: editor, key: null, payload: createPayload}))
      .rejects.toMatchObject({status: 400});
  });

  it('отклоняет окончание раньше начала', async () => {
    const s = makeTx(null);
    await expect(createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY,
      payload: {...createPayload, validTo: '2098-12-31T08:00:00+03:00'}})).rejects.toMatchObject({status: 422});
    expect(s.tx.workPermit.create).not.toHaveBeenCalled();
  });

  it('отказывает, когда техники нет или она неактивна', async () => {
    const s = makeTx(null);
    s.tx.equipment.findFirst.mockResolvedValueOnce(null as never);
    await expect(createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY, payload: createPayload}))
      .rejects.toMatchObject({status: 404});
  });

  it('отказывает, когда у организации не задан часовой пояс', async () => {
    const s = makeTx(null);
    s.tx.tenantSettings.findUnique.mockResolvedValueOnce(null as never);
    await expect(createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY, payload: createPayload}))
      .rejects.toMatchObject({status: 422});
  });

  it('отказывает, когда вид работ архивирован', async () => {
    const s = makeTx(null);
    s.tx.permitWorkType.findFirst.mockResolvedValueOnce(null as never);
    await expect(createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY, payload: createPayload}))
      .rejects.toMatchObject({status: 404});
  });

  it('отказывает, когда учётная запись исполнителя неактивна', async () => {
    const s = makeTx(null);
    s.tx.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(createWorkPermitCommand({tx: s.asTx, context: editor, key: KEY, payload: createPayload}))
      .rejects.toMatchObject({status: 403});
  });
});

describe('правка наряда', () => {
  it('сохраняет изменение, поднимает версию и пишет аудит', async () => {
    const s = makeTx(baseRow());
    const result = await updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {expectedVersion: 1, title: 'Новое название работ'}});
    expect(result.status).toBe(200);
    expect(s.row).toMatchObject({title: 'Новое название работ', state: 'DRAFT'});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({action: 'work-permit.updated'}));
  });

  it('принимает версию из If-Match', async () => {
    const s = makeTx(baseRow());
    await expect(updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: '"work-permit-permit-1-v1"', payload: {location: 'Куст 7'}})).resolves.toMatchObject({status: 200});
  });

  it('требует версию', async () => {
    const s = makeTx(baseRow());
    await expect(updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {title: 'Новое название работ'}})).rejects.toMatchObject({status: 428});
  });

  it('возвращает 409 для устаревшей версии', async () => {
    const s = makeTx(baseRow({version: 3}));
    await expect(updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {expectedVersion: 1, title: 'Новое название работ'}})).rejects.toMatchObject({status: 409});
    expect(s.tx.workPermit.updateMany).not.toHaveBeenCalled();
  });

  it('не принимает правку без изменений', async () => {
    const s = makeTx(baseRow());
    await expect(updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {expectedVersion: 1, title: 'Работы'}})).rejects.toMatchObject({status: 422});
  });

  it('правка согласованного наряда возвращает его в черновик и аннулирует подписи', async () => {
    const s = makeTx(baseRow({state: 'APPROVED', version: 4, approvals: [
      {role: 'DISPATCHER', approvedById: 'dispatcher', approvedAt: new Date(), valid: true, permitVersion: 4},
      {role: 'ADMIN', approvedById: 'admin', approvedAt: new Date(), valid: true, permitVersion: 4},
    ]}));
    await updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {expectedVersion: 4, scope: 'Другой состав работ'}});
    expect(s.row?.state).toBe('DRAFT');
    expect(s.tx.workPermitApproval.updateMany).toHaveBeenCalledOnce();
    expect(s.row?.approvals.every((item: Row) => item.valid === false)).toBe(true);
  });

  it('не позволяет править отозванный наряд', async () => {
    const s = makeTx(baseRow({state: 'REVOKED'}));
    await expect(updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {expectedVersion: 1, title: 'Новое название работ'}})).rejects.toMatchObject({status: 422});
  });

  it('отказывает роли без права править', async () => {
    const s = makeTx(baseRow());
    await expect(updateWorkPermitCommand({tx: s.asTx, context: {...editor, actorRole: 'DISPATCHER'}, id: 'permit-1', key: KEY,
      ifMatch: null, payload: {expectedVersion: 1, title: 'Новое название работ'}})).rejects.toMatchObject({status: 403});
  });

  it('пересчитывает правило согласования по новому виду работ и меняет ответственного', async () => {
    const s = makeTx(baseRow());
    s.tx.permitWorkType.findFirst.mockResolvedValue({defaultRisk: 'NORMAL', name: 'Земляные',
      requiredApprovals: ['DISPATCHER'], allowAuthorApproval: true} as never);
    await updateWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, workTypeId: 'work-2', producerUserId: 'user-2', observerName: 'Сидоров'}});
    expect(s.row).toMatchObject({requiredApprovals: ['DISPATCHER'], allowAuthorApproval: true,
      producerName: 'Иван Петров', observerName: 'Сидоров'});
  });
});

describe('отправка на согласование', () => {
  it('переводит черновик на согласование', async () => {
    const s = makeTx(baseRow());
    const result = await submitWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, expectedVersion: 1});
    expect(result.status).toBe(200);
    expect(s.row).toMatchObject({state: 'PENDING_APPROVAL', submittedAt: expect.any(Date)});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({action: 'work-permit.submit'}));
  });

  it.each(['PENDING_APPROVAL', 'APPROVED', 'REVOKED'])('не отправляет наряд в состоянии %s', async (state) => {
    const s = makeTx(baseRow({state}));
    await expect(submitWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 422});
  });

  it('не отправляет по старой версии', async () => {
    const s = makeTx(baseRow({version: 2}));
    await expect(submitWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 409});
  });

  it('не показывает чужой наряд: нет строки — 404', async () => {
    const s = makeTx(null);
    await expect(submitWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY,
      ifMatch: null, expectedVersion: 1})).rejects.toMatchObject({status: 404});
  });
});

describe('согласование', () => {
  const pending = (overrides: Row = {}) => baseRow({state: 'PENDING_APPROVAL', version: 2, ...overrides});

  it('первая подпись оставляет наряд на согласовании, вторая от другого человека согласует', async () => {
    const s = makeTx(pending());
    await approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2});
    expect(s.row).toMatchObject({state: 'PENDING_APPROVAL'});
    expect(s.row?.approvals).toHaveLength(1);
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({action: 'work-permit.approved-dispatcher'}));

    await approveWorkPermitCommand({tx: s.asTx, context: admin, id: 'permit-1', key: 'lifecycle-key-second-9876', ifMatch: null, expectedVersion: 2});
    expect(s.row).toMatchObject({state: 'APPROVED', approvedAt: expect.any(Date)});
    expect(s.row?.approvals).toHaveLength(2);
  });

  it('одна требуемая подпись согласует наряд сразу', async () => {
    const s = makeTx(pending({requiredApprovals: ['DISPATCHER']}));
    await approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2});
    expect(s.row?.state).toBe('APPROVED');
  });

  it('не принимает вторую подпись той же роли', async () => {
    const s = makeTx(pending({approvals: [{role: 'DISPATCHER', approvedById: 'other', approvedAt: new Date(), valid: true, permitVersion: 2}]}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 409});
  });

  it('обе подписи одного человека не засчитываются', async () => {
    const s = makeTx(pending({approvals: [{role: 'DISPATCHER', approvedById: 'admin', approvedAt: new Date(), valid: true, permitVersion: 2}]}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: admin, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 422});
  });

  it('автор не согласует собственный наряд', async () => {
    const s = makeTx(pending({authorId: 'dispatcher'}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 422});
    expect(s.tx.workPermitApproval.create).not.toHaveBeenCalled();
  });

  it('просроченный наряд согласовать нельзя', async () => {
    const s = makeTx(pending({validTo: new Date('2020-01-01')}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 422});
  });

  it.each(['DRAFT', 'APPROVED', 'REVOKED'])('не согласует наряд в состоянии %s', async (state) => {
    const s = makeTx(pending({state}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 422});
  });

  it.each(['OPERATOR', 'MECHANIC', 'FOREMAN'])('не даёт роли %s подписать', async (actorRole) => {
    const s = makeTx(pending());
    await expect(approveWorkPermitCommand({tx: s.asTx, context: {...dispatcher, actorRole}, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 403});
  });

  it('вид работ без согласующих делает наряд несогласуемым', async () => {
    const s = makeTx(pending({requiredApprovals: []}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 422});
  });

  it('гонка двух подписей одной роли превращается в 409, а не в двойную запись', async () => {
    const s = makeTx(pending());
    s.tx.workPermitApproval.create.mockRejectedValueOnce(Object.assign(new Error('unique'), {code: 'P2002'}));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 409});
  });

  it('прочие ошибки записи подписи не маскируются', async () => {
    const s = makeTx(pending());
    s.tx.workPermitApproval.create.mockRejectedValueOnce(new Error('disk'));
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toThrow('disk');
  });

  it('несуществующий наряд — 404 ещё на блокировке строки', async () => {
    const s = makeTx(null);
    await expect(approveWorkPermitCommand({tx: s.asTx, context: dispatcher, id: 'permit-1', key: KEY, ifMatch: null, expectedVersion: 2}))
      .rejects.toMatchObject({status: 404});
  });
});

describe('отзыв наряда', () => {
  const approved = () => baseRow({state: 'APPROVED', version: 5});

  it('отзывает согласованный наряд с причиной', async () => {
    const s = makeTx(approved());
    await revokeWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY, ifMatch: null,
      expectedVersion: 5, reason: 'Изменились условия'});
    expect(s.row).toMatchObject({state: 'REVOKED', revokeReason: 'Изменились условия', revokedAt: expect.any(Date)});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({action: 'work-permit.revoke'}));
  });

  it('не отзывает без причины', async () => {
    const s = makeTx(approved());
    await expect(revokeWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY, ifMatch: null,
      expectedVersion: 5, reason: ''})).rejects.toMatchObject({status: 422});
    expect(s.row?.state).toBe('APPROVED');
  });

  it.each(['DRAFT', 'PENDING_APPROVAL', 'REVOKED'])('не отзывает наряд в состоянии %s', async (state) => {
    const s = makeTx(baseRow({state, version: 5}));
    await expect(revokeWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY, ifMatch: null,
      expectedVersion: 5, reason: 'Изменились условия'})).rejects.toMatchObject({status: 422});
  });

  it('отказывает роли без права на наряды', async () => {
    const s = makeTx(approved());
    await expect(revokeWorkPermitCommand({tx: s.asTx, context: {...dispatcher, actorRole: 'OPERATOR'}, id: 'permit-1', key: KEY,
      ifMatch: null, expectedVersion: 5, reason: 'Изменились условия'})).rejects.toMatchObject({status: 403});
  });

  it('неактивная учётная запись не отзывает', async () => {
    const s = makeTx(approved());
    s.tx.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(revokeWorkPermitCommand({tx: s.asTx, context: editor, id: 'permit-1', key: KEY, ifMatch: null,
      expectedVersion: 5, reason: 'Изменились условия'})).rejects.toMatchObject({status: 403});
  });
});

describe('чтение нарядов', () => {
  it('отдаёт список с постраничной ссылкой и общим числом', async () => {
    const s = makeTx(baseRow());
    s.tx.workPermit.findMany.mockResolvedValueOnce([baseRow({id: 'a'}), baseRow({id: 'b', updatedAt: new Date('2098-11-01')})] as never);
    s.tx.workPermit.count.mockResolvedValueOnce(7 as never);
    const result = await queryWorkPermits(s.asTx, 'tenant-1', {limit: 1});
    expect(result.data).toHaveLength(1);
    expect(result.page).toMatchObject({limit: 1, hasMore: true, total: 7, nextCursor: expect.any(String)});
  });

  it('продолжает список по ссылке и фильтрует по периоду', async () => {
    const s = makeTx(baseRow());
    const first = await queryWorkPermits(s.asTx, 'tenant-1', {limit: 1});
    expect(first.page.nextCursor).toBeNull();
    const cursor = Buffer.from(JSON.stringify({updatedAt: '2098-12-01T00:00:00.000Z', id: 'permit-1'})).toString('base64url');
    await queryWorkPermits(s.asTx, 'tenant-1', {limit: 5, cursor, state: 'DRAFT', risk: 'ELEVATED',
      equipmentId: 'equipment-1', from: new Date('2099-01-01'), to: new Date('2099-02-01')});
    expect(s.tx.workPermit.findMany).toHaveBeenLastCalledWith(expect.objectContaining({where: expect.objectContaining({
      tenantId: 'tenant-1', state: 'DRAFT', risk: 'ELEVATED', equipmentId: 'equipment-1',
      OR: expect.any(Array),
    })}));
  });

  it('отклоняет испорченную ссылку на страницу', async () => {
    const s = makeTx(baseRow());
    await expect(queryWorkPermits(s.asTx, 'tenant-1', {limit: 5, cursor: 'не-ссылка'})).rejects.toMatchObject({status: 400});
  });

  it('читает один наряд своей организации и не находит чужой', async () => {
    const s = makeTx(baseRow());
    expect(await queryWorkPermit(s.asTx, 'tenant-1', 'permit-1')).toMatchObject({id: 'permit-1', state: 'DRAFT'});
    const empty = makeTx(null);
    await expect(queryWorkPermit(empty.asTx, 'tenant-1', 'permit-1')).rejects.toMatchObject({status: 404});
  });
});
