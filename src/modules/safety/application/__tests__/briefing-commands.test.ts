// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  Подпись под записью журнала: кто и за кого может расписаться. Кнопка
  «Подтвердить инструктаж» в «Моём допуске» (аудит 16.10.2026, P1 R78-41) ходит
  именно сюда, поэтому границы подписи закреплены тестом: работник подписывает
  свою отметку, инструктор — свою, остальные не подписывают ничего, и ничьё
  время первой отметки не переписывается.
*/
const mocks = vi.hoisted(() => ({find: vi.fn(), update: vi.fn(), userFind: vi.fn(), create: vi.fn()}));
vi.mock('@/lib/db', () => ({
  db: {briefingRecord: {findFirst: mocks.find, update: mocks.update, create: mocks.create}, user: {findFirst: mocks.userFind}},
}));

import {conductBriefing, signBriefingRecord} from '../briefing-commands';

const record = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1', userId: 'worker-1', instructorId: 'safety-1',
  employeeSignedAt: null, instructorSignedAt: new Date('2026-10-16T05:00:00Z'), ...over,
});
const sign = (actorId: string, tenantId = 'tenant-a') => signBriefingRecord({tenantId, actorId, recordId: 'rec-1'});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(record());
  mocks.update.mockResolvedValue({});
});

describe('подпись под записью журнала', () => {
  it('работник ставит отметку работника, а не инструктора', async () => {
    expect(await sign('worker-1')).toEqual({alreadySigned: false});
    expect(mocks.update).toHaveBeenCalledWith({where: {id: 'rec-1'}, data: {employeeSignedAt: expect.any(Date)}});
  });

  it('инструктор ставит только свою отметку', async () => {
    mocks.find.mockResolvedValue(record({instructorSignedAt: null}));
    await sign('safety-1');
    expect(mocks.update).toHaveBeenCalledWith({where: {id: 'rec-1'}, data: {instructorSignedAt: expect.any(Date)}});
  });

  it('посторонний, в том числе диспетчер, расписаться за работника не может', async () => {
    await expect(sign('dispatcher-1')).rejects.toMatchObject({status: 403});
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('повторное нажатие время первой отметки не переписывает', async () => {
    mocks.find.mockResolvedValue(record({employeeSignedAt: new Date('2026-10-16T06:00:00Z')}));
    expect(await sign('worker-1')).toEqual({alreadySigned: true});
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('запись ищется только в своей организации; чужая выглядит как отсутствующая', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(sign('worker-1', 'tenant-b')).rejects.toMatchObject({status: 404});
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where: {id: 'rec-1', tenantId: 'tenant-b'}}));
  });

  it('без организации не работает', async () => {
    await expect(sign('worker-1', '')).rejects.toMatchObject({status: 400});
    expect(mocks.find).not.toHaveBeenCalled();
  });
});

describe('проведение инструктажа', () => {
  const payload = {
    userId: 'worker-1', type: 'REPEAT' as const, documentCode: 'И-СМ-04', documentTitle: 'Свайные работы',
    documentVersion: '1.0', reason: 'Плановый',
  };
  const conduct = (over: Record<string, unknown> = {}) => conductBriefing({
    tenantId: 'tenant-a', actor: {id: 'safety-1', name: 'Петров П.П.'}, mayManageBriefings: true, payload, ...over,
  } as Parameters<typeof conductBriefing>[0]);

  beforeEach(() => {
    mocks.userFind.mockResolvedValue({id: 'worker-1', name: 'Иванов И.И.', role: 'OPERATOR', isActive: true});
    mocks.create.mockResolvedValue({id: 'rec-9'});
  });

  it('записывает инструктаж с отметкой инструктора и без отметки работника', async () => {
    await conduct();
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({tenantId: 'tenant-a', userId: 'worker-1', instructorId: 'safety-1', kind: 'INSTRUCTION'});
    expect(data.instructorSignedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('employeeSignedAt');
  });

  it.each([
    ['без права на журнал', {mayManageBriefings: false}, 403],
    ['без организации', {tenantId: ''}, 400],
    ['без инструкции', {payload: {...payload, documentCode: ''}}, 400],
    ['будущей датой', {payload: {...payload, recordedAt: new Date(Date.now() + 3_600_000)}}, 400],
  ])('отказывает %s', async (_name, over, status) => {
    await expect(conduct(over)).rejects.toMatchObject({status});
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('работник из другой организации или отключённый не принимается', async () => {
    mocks.userFind.mockResolvedValueOnce(null);
    await expect(conduct()).rejects.toMatchObject({status: 404});
    mocks.userFind.mockResolvedValueOnce({id: 'worker-1', name: 'И', role: 'OPERATOR', isActive: false});
    await expect(conduct()).rejects.toMatchObject({status: 400});
    expect(mocks.userFind).toHaveBeenCalledWith(expect.objectContaining({where: {id: 'worker-1', tenantId: 'tenant-a'}}));
  });
});
