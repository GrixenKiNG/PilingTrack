import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  listUsersMock,
  createUserMock,
  updateUserMock,
  deleteUserMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  listUsersMock: vi.fn(),
  createUserMock: vi.fn(),
  updateUserMock: vi.fn(),
  deleteUserMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/users', () => ({
  listUsers: listUsersMock,
  createUser: createUserMock,
  updateUser: updateUserMock,
  deleteUser: deleteUserMock,
}));

import { DELETE, GET, POST, PUT } from '../route';

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/users?_ts=${Math.random()}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function invalidJsonReq(method: string): NextRequest {
  return new NextRequest('http://localhost/api/users', {
    method,
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

const authenticatedAdmin = {
  id: 'admin-a',
  role: 'ADMIN',
  tenantId: 'tenant-a',
};

describe('/api/users tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: authenticatedAdmin, error: null });
    listUsersMock.mockResolvedValue([]);
    createUserMock.mockResolvedValue({ id: 'user-a' });
    updateUserMock.mockResolvedValue({ id: 'user-a' });
    deleteUserMock.mockResolvedValue({ success: true });
  });

  it('passes the authenticated tenant to listUsers', async () => {
    const response = await GET(req('GET'));

    expect(response.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith('tenant-a', null, expect.anything());
  });

  const fullRow = {
    id: 'u-1',
    email: 'op@example.com',
    name: 'Иванов',
    phone: '+79990000000',
    role: 'OPERATOR',
    isActive: true,
    lastReportAt: '2026-10-20T10:00:00.000Z',
    lastLoginAt: '2026-10-21T10:00:00.000Z',
    lastActivityAt: '2026-10-21T10:00:00.000Z',
    lastActivitySource: 'login',
  };

  it('does not expose contacts and activity to a reader without users.manage', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'disp-a', role: 'DISPATCHER', tenantId: 'tenant-a' },
      error: null,
    });
    listUsersMock.mockResolvedValue([fullRow]);

    const response = await GET(req('GET'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users[0]).toMatchObject({ id: 'u-1', name: 'Иванов', role: 'OPERATOR' });
    expect(body.users[0]).toMatchObject({
      email: '',
      phone: '',
      lastReportAt: null,
      lastLoginAt: null,
      lastActivityAt: null,
      lastActivitySource: null,
    });
  });

  it('returns the full catalog to an administrator', async () => {
    listUsersMock.mockResolvedValue([fullRow]);

    const body = await (await GET(req('GET'))).json();

    expect(body.users[0]).toMatchObject({ email: 'op@example.com', phone: '+79990000000' });
  });

  it.each([
    ['GET', () => GET(req('GET'))],
    ['POST', () => POST(req('POST', validCreateBody()))],
    ['PUT', () => PUT(req('PUT', { id: 'user-a', name: 'Updated' }))],
    ['DELETE', () => DELETE(req('DELETE', { id: 'user-a' }))],
  ])('fails closed for %s when the authenticated admin has no tenant', async (_method, call) => {
    requireAuthMock.mockResolvedValue({
      user: { ...authenticatedAdmin, tenantId: null },
      error: null,
    });

    expect((await call()).status).toBe(400);
  });

  // ПИН-вход удалён 27.09.2026: присланный ПИН не заменяет пароль.
  it('refuses to create a user with a PIN instead of a password', async () => {
    const { password: _password, ...body } = validCreateBody();
    const response = await POST(req('POST', { ...body, pin: '1234' }));

    expect(response.status).toBe(400);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated tenant when creating a user', async () => {
    const response = await POST(req('POST', {
      ...validCreateBody(),
      tenantId: 'tenant-b',
    }));

    expect(response.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'admin-a'
    );
  });

  it('passes the authenticated tenant first when updating a user', async () => {
    const response = await PUT(req('PUT', {
      id: 'user-a',
      name: 'Updated',
      tenantId: 'tenant-b',
    }));

    expect(response.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(
      'tenant-a',
      expect.not.objectContaining({ tenantId: expect.anything() }),
      'admin-a'
    );
  });

  it('passes the authenticated tenant first when deleting a user', async () => {
    const response = await DELETE(req('DELETE', {
      id: 'user-a',
      tenantId: 'tenant-b',
    }));

    expect(response.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledWith('tenant-a', 'admin-a', 'user-a');
  });

  it.each(['1234567', '1234567 ', 'x'.repeat(101)])(
    'rejects an out-of-range password',
    async (password) => {
      const response = await POST(req('POST', { ...validCreateBody(), password }));

      expect(response.status).toBe(400);
      expect(createUserMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['POST', () => POST(invalidJsonReq('POST'))],
    ['PUT', () => PUT(invalidJsonReq('PUT'))],
    ['DELETE', () => DELETE(invalidJsonReq('DELETE'))],
  ])('returns 400 for invalid JSON in %s', async (_method, call) => {
    expect((await call()).status).toBe(400);
  });


});

function validCreateBody() {
  return {
    name: 'Ivan Ivanov',
    email: 'ivan@example.test',
    role: 'OPERATOR',
    password: 'password8',
  };
}
