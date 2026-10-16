import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({findUnique: vi.fn()}));
vi.mock('@/lib/db', () => ({db: {userSiteAssignment: {findUnique: mocks.findUnique}}}));

import {
  assertCanAccessReportOwner,
  assertCanAccessSite,
  assertCanManageUserScope,
  assertUserAssignedToSite,
  resolveAccessibleUserId,
} from '../resource-access-service';

const operator = {id: 'op-1', role: 'OPERATOR'};
const dispatcher = {id: 'disp-1', role: 'DISPATCHER'};
const admin = {id: 'adm-1', role: 'ADMIN'};

beforeEach(() => mocks.findUnique.mockReset());

describe('чьи данные можно запрашивать', () => {
  it('без указания пользователя возвращает самого себя', () => {
    expect(resolveAccessibleUserId(operator)).toBe('op-1');
    expect(resolveAccessibleUserId(operator, null)).toBe('op-1');
  });

  it('собственный идентификатор разрешён всем', () => {
    expect(resolveAccessibleUserId(operator, 'op-1')).toBe('op-1');
  });

  it('чужой идентификатор запрещён машинисту и разрешён диспетчеру', () => {
    expect(() => resolveAccessibleUserId(operator, 'someone')).toThrow(expect.objectContaining({status: 403}));
    expect(resolveAccessibleUserId(dispatcher, 'someone')).toBe('someone');
  });

  it('«Действую как» урезает права администратора до исполняемой роли', () => {
    expect(() => resolveAccessibleUserId({...admin, actingAs: 'OPERATOR'}, 'someone'))
      .toThrow(expect.objectContaining({status: 403}));
  });

  it('владелец отчёта: свой — можно, чужой — только с правом', () => {
    expect(() => assertCanAccessReportOwner(operator, 'op-1')).not.toThrow();
    expect(() => assertCanAccessReportOwner(operator, 'other')).toThrow(expect.objectContaining({status: 403}));
    expect(() => assertCanAccessReportOwner(dispatcher, 'other')).not.toThrow();
  });

  it('управлять чужой областью может только тот, у кого есть право', () => {
    expect(() => assertCanManageUserScope(operator, 'op-1')).not.toThrow();
    expect(() => assertCanManageUserScope(operator, 'other')).toThrow(expect.objectContaining({status: 403}));
    expect(() => assertCanManageUserScope(dispatcher, 'other')).not.toThrow();
    expect(() => assertCanManageUserScope(dispatcher, 'other', 'users.manage')).toThrow(expect.objectContaining({status: 403}));
  });
});

describe('доступ к объекту', () => {
  it('закреплённый за объектом пользователь проходит', async () => {
    mocks.findUnique.mockResolvedValueOnce({id: 'assignment'});
    await expect(assertUserAssignedToSite('op-1', 'site-1')).resolves.toBeUndefined();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {userId_siteId: {userId: 'op-1', siteId: 'site-1'}}, select: {id: true},
    });
  });

  it('не закреплённый получает 403', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(assertUserAssignedToSite('op-1', 'site-1')).rejects.toMatchObject({status: 403});
  });

  it('привилегированная роль проходит без обращения к базе', async () => {
    await expect(assertCanAccessSite(dispatcher, 'site-1')).resolves.toBeUndefined();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('машинист допускается только по закреплению', async () => {
    mocks.findUnique.mockResolvedValueOnce({id: 'a'});
    await expect(assertCanAccessSite(operator, 'site-1')).resolves.toBeUndefined();
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(assertCanAccessSite(operator, 'site-2')).rejects.toMatchObject({status: 403});
  });

  it('администратор в режиме «Действую как» машинист тоже проверяется по закреплению', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(assertCanAccessSite({...admin, actingAs: 'OPERATOR'}, 'site-1')).rejects.toMatchObject({status: 403});
  });
});
