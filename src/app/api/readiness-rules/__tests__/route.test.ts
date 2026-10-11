import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  getRulesMock,
  saveDraftMock,
  publishMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getRulesMock: vi.fn(),
  saveDraftMock: vi.fn(),
  publishMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/readiness/application/readiness-rules-service', () => ({
  getReadinessRules: getRulesMock,
  saveReadinessDraft: saveDraftMock,
  publishReadinessRules: publishMock,
}));

const { saveTemplateMock } = vi.hoisted(() => ({ saveTemplateMock: vi.fn() }));
vi.mock('@/modules/monitoring', () => ({ getTemplate: vi.fn(), saveTemplate: saveTemplateMock }));
import { PUT as putMonitoringTemplate } from '../../monitoring/template/route';

const { saveLayoutMock, deleteLayoutMock } = vi.hoisted(() => ({ saveLayoutMock: vi.fn(), deleteLayoutMock: vi.fn() }));
vi.mock('@/modules/layout', () => ({
  getLayout: vi.fn(), getLayoutSet: vi.fn(), saveLayout: saveLayoutMock, deleteLayout: deleteLayoutMock,
  BASE_ENTITY: '', UnknownSurfaceError: class extends Error {},
}));
import { PUT as putLayout, DELETE as deleteLayout } from '../../layout/[surfaceId]/route';

it.each(['PUT', 'DELETE'])('администратор за механика не изменяет раскладку мониторинга через %s', async (method) => {
  saveLayoutMock.mockReset().mockResolvedValue({});
  deleteLayoutMock.mockReset().mockResolvedValue({});
  requireAuthMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', actingAs: 'MECHANIC', tenantId: 'tenant-1' }, error: null });
  const handler = method === 'PUT' ? putLayout : deleteLayout;
  const response = await handler(request(method, method === 'PUT' ? '{}' : undefined), { params: Promise.resolve({ surfaceId: 'monitoring-equipment-tile' }) });
  expect(response.status).toBe(403);
  expect(saveLayoutMock).not.toHaveBeenCalled();
  expect(deleteLayoutMock).not.toHaveBeenCalled();
});

it('администратор за механика не сохраняет шаблон мониторинга', async () => {
  saveTemplateMock.mockReset().mockResolvedValue({});
  requireAuthMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', actingAs: 'MECHANIC', tenantId: 'tenant-1' }, error: null });
  const response = await putMonitoringTemplate(request('PUT', '{}'));
  expect(response.status).toBe(403);
  expect(saveTemplateMock).not.toHaveBeenCalled();
});

import { GET, PUT } from '../route';
import { POST } from '../publish/route';

const request = (method = 'GET', body?: string) => new NextRequest(
  'http://localhost/api/readiness-rules',
  {
    method,
    body,
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
      ...(body == null ? {} : { 'content-type': 'application/json' }),
    },
  },
);

describe('readiness rules API', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    getRulesMock.mockReset();
    saveDraftMock.mockReset();
    publishMock.mockReset();
  });

  it('requires a session', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      error: new Response(null, { status: 401 }),
    });
    expect((await GET(request())).status).toBe(401);
  });

  it('loads rules inside the session tenant', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin', name: 'Администратор', role: 'ADMIN', tenantId: 'tenant-1' },
      error: null,
    });
    getRulesMock.mockResolvedValue({ published: { version: 'v1.0' }, draft: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(getRulesMock).toHaveBeenCalledWith('tenant-1');
  });

  it('forbids draft changes for a dispatcher', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'dispatcher', name: 'Диспетчер', role: 'DISPATCHER', tenantId: 'tenant-1' },
      error: null,
    });
    expect((await PUT(request('PUT', '{}'))).status).toBe(403);
    expect(saveDraftMock).not.toHaveBeenCalled();
  });

  it('saves an admin draft with actor metadata', async () => {
    const user = {
      id: 'admin',
      name: 'Администратор',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    };
    requireAuthMock.mockResolvedValue({ user, error: null });
    saveDraftMock.mockResolvedValue({ published: { version: 'v1.0' }, draft: { version: 'v1.1' } });
    const response = await PUT(request('PUT', JSON.stringify({ criteria: [] })));
    expect({ status: response.status, body: await response.clone().json() }).toEqual({
      status: 200,
      body: { published: { version: 'v1.0' }, draft: { version: 'v1.1' } },
    });
    expect(saveDraftMock).toHaveBeenCalledWith(
      'tenant-1',
      { criteria: [] },
      { id: user.id, name: user.name, role: user.role },
    );
  });

  it('publishes an admin draft inside the session tenant', async () => {
    const user = {
      id: 'admin',
      name: 'Администратор',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    };
    requireAuthMock.mockResolvedValue({ user, error: null });
    publishMock.mockResolvedValue({ published: { version: 'v1.1' }, draft: null });
    const response = await POST(request('POST'));
    expect({ status: response.status, body: await response.clone().json() }).toEqual({
      status: 200,
      body: { published: { version: 'v1.1' }, draft: null },
    });
    expect(publishMock).toHaveBeenCalledWith(
      'tenant-1',
      { id: user.id, name: user.name, role: user.role },
    );
  });
});
