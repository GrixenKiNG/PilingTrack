import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createUserMock,
  deleteUserMock,
  findFirstUserMock,
  findManyUserMock,
  updateUserMock,
} = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  deleteUserMock: vi.fn(),
  findFirstUserMock: vi.fn(),
  findManyUserMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      create: createUserMock,
      delete: deleteUserMock,
      findFirst: findFirstUserMock,
      findMany: findManyUserMock,
      update: updateUserMock,
    },
  },
}));
vi.mock('@/services/auth/auth-service', () => ({
  computePinLookup: vi.fn((pin: string) => `lookup-${pin}`),
  hashPassword: vi.fn(async () => 'password-hash'),
  hashPin: vi.fn(async () => 'pin-hash'),
}));
vi.mock('@/services/auth/authorization-service', () => ({
  assertNotSelfAction: vi.fn(),
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import {
  createUser,
  deleteUser,
  listAssignableUsers,
  listUsers,
  updateUser,
} from '../user-service';

const existingUser = {
  id: 'user-b',
  email: 'user-b@example.com',
  name: 'User B',
  phone: '',
  role: 'OPERATOR',
  isActive: true,
};

describe('listAssignableUsers', () => {
  beforeEach(() => {
    findManyUserMock.mockReset();
    findManyUserMock.mockResolvedValue([]);
  });

  it('scopes to active users of the tenant', async () => {
    await listAssignableUsers('orion');
    const arg = findManyUserMock.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 'orion', isActive: true });
    expect(arg.select).toEqual({ id: true, name: true, role: true });
  });

  it('throws when tenantId empty (fail-closed)', async () => {
    await expect(listAssignableUsers('')).rejects.toThrow();
  });
});

describe('listUsers', () => {
  beforeEach(() => {
    findManyUserMock.mockReset();
    findManyUserMock.mockResolvedValue([]);
  });

  it('lists only users in the requested tenant', async () => {
    await listUsers('tenant-a', null);
    expect(findManyUserMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a' },
    }));
  });

  it('fails closed when tenant context is missing', async () => {
    await expect(listUsers('', null)).rejects.toMatchObject({ status: 400 });
    expect(findManyUserMock).not.toHaveBeenCalled();
  });
});

describe('createUser', () => {
  beforeEach(() => {
    createUserMock.mockReset();
    createUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.ru',
      name: 'A',
      phone: '',
      role: 'OPERATOR',
      isActive: true,
    });
  });

  it('persists the actor tenantId so the NOT NULL column is satisfied', async () => {
    await createUser(
      { email: 'a@b.ru', password: 'pw', name: 'A', role: 'OPERATOR', tenantId: 'orion' },
      'admin-1'
    );
    const arg = createUserMock.mock.calls[0][0];
    expect(arg.data.tenantId).toBe('orion');
  });

  it('rejects create when authenticated tenant context is missing even if DEFAULT_TENANT_ID is set', async () => {
    const prev = process.env.DEFAULT_TENANT_ID;
    process.env.DEFAULT_TENANT_ID = 'orion';

    await expect(
      createUser({ email: 'a@b.ru', password: 'pw', name: 'A', tenantId: null }, 'admin-1')
    ).rejects.toMatchObject({ status: 400 });
    expect(createUserMock).not.toHaveBeenCalled();

    process.env.DEFAULT_TENANT_ID = prev;
  });

  it('stores a PIN-only credential in the PIN columns', async () => {
    await createUser(
      { email: 'a@b.ru', pin: '1234', name: 'A', role: 'OPERATOR', tenantId: 'orion' },
      'admin-1'
    );

    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        password: '',
        pin: 'pin-hash',
        pinLookup: 'lookup-1234',
      }),
    }));
  });
});

describe('updateUser', () => {
  beforeEach(() => {
    findFirstUserMock.mockReset();
    updateUserMock.mockReset();
    findFirstUserMock.mockResolvedValue(null);
    updateUserMock.mockResolvedValue({ ...existingUser, name: 'X' });
  });

  it('updates only a user owned by the tenant', async () => {
    await expect(updateUser('tenant-a', { id: 'user-b', name: 'X' }, 'admin-a'))
      .rejects.toMatchObject({ status: 404 });
    expect(findFirstUserMock).toHaveBeenCalledWith({
      where: { id: 'user-b', tenantId: 'tenant-a' },
      select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('keeps the tenant scope in the successful update mutation', async () => {
    findFirstUserMock.mockResolvedValue(existingUser);

    await updateUser('tenant-a', { id: 'user-b', name: 'X' }, 'admin-a');

    expect(updateUserMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-b', tenantId: 'tenant-a' },
    }));
  });

  it('increments the session version when blocking a user', async () => {
    findFirstUserMock.mockResolvedValue(existingUser);

    await updateUser('tenant-a', { id: 'user-b', isActive: false }, 'admin-a');

    expect(updateUserMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
    }));
  });

  it('increments the session version when changing a password', async () => {
    findFirstUserMock.mockResolvedValue(existingUser);

    await updateUser('tenant-a', { id: 'user-b', password: 'password8' }, 'admin-a');

    expect(updateUserMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
    }));
  });

  it('fails closed when tenant context is missing', async () => {
    await expect(updateUser('', { id: 'user-b', name: 'X' }, 'admin-a'))
      .rejects.toMatchObject({ status: 400 });
    expect(findFirstUserMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('stores a changed PIN in the PIN columns', async () => {
    findFirstUserMock.mockResolvedValue(existingUser);

    await updateUser('tenant-a', { id: 'user-b', pin: '5678' }, 'admin-a');

    expect(updateUserMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pin: 'pin-hash',
        pinLookup: 'lookup-5678',
        sessionVersion: { increment: 1 },
      }),
    }));
  });
});

describe('deleteUser', () => {
  beforeEach(() => {
    deleteUserMock.mockReset();
    findFirstUserMock.mockReset();
    deleteUserMock.mockResolvedValue(existingUser);
    findFirstUserMock.mockResolvedValue(null);
  });

  it('deletes only an unused user owned by the tenant', async () => {
    await expect(deleteUser('tenant-a', 'admin-a', 'user-b'))
      .rejects.toMatchObject({ status: 404 });
    expect(findFirstUserMock).toHaveBeenCalledWith({
      where: { id: 'user-b', tenantId: 'tenant-a' },
    });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('keeps the tenant scope in the successful delete mutation', async () => {
    findFirstUserMock.mockResolvedValue(existingUser);

    await deleteUser('tenant-a', 'admin-a', 'user-b');

    expect(deleteUserMock).toHaveBeenCalledWith({
      where: { id: 'user-b', tenantId: 'tenant-a' },
    });
  });

  it('fails closed when tenant context is missing', async () => {
    await expect(deleteUser('', 'admin-a', 'user-b'))
      .rejects.toMatchObject({ status: 400 });
    expect(findFirstUserMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});
