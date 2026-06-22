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

  it('passes a valid PIN to the user service without treating it as a password', async () => {
    const { password: _password, ...body } = validCreateBody();

    const response = await POST(req('POST', { ...body, pin: '1234' }));

    expect(response.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ pin: '1234', password: undefined, tenantId: 'tenant-a' }),
      'admin-a'
    );
  });

  it('passes a valid PIN through the update endpoint', async () => {
    const response = await PUT(req('PUT', { id: 'user-a', pin: '5678' }));

    expect(response.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ id: 'user-a', pin: '5678' }),
      'admin-a'
    );
  });

  it.each([
    ['POST', () => POST(invalidJsonReq('POST'))],
    ['PUT', () => PUT(invalidJsonReq('PUT'))],
    ['DELETE', () => DELETE(invalidJsonReq('DELETE'))],
  ])('returns 400 for invalid JSON in %s', async (_method, call) => {
    expect((await call()).status).toBe(400);
  });

  it.each(['123', '12345678901', '12a4'])(
    'rejects a PIN that is not 4 to 10 digits',
    async (pin) => {
      const { password: _password, ...body } = validCreateBody();
      const response = await POST(req('POST', { ...body, pin }));

      expect(response.status).toBe(400);
      expect(createUserMock).not.toHaveBeenCalled();
    }
  );
});

function validCreateBody() {
  return {
    name: 'Ivan Ivanov',
    email: 'ivan@example.test',
    role: 'OPERATOR',
    password: 'password8',
  };
}
