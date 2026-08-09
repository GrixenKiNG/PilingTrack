import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withTransaction: vi.fn(),
  queryBootstrap: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessRequestTransaction: mocks.withTransaction,
}));
vi.mock('@/modules/readiness/application/bootstrap-query', () => ({
  queryReadinessBootstrap: mocks.queryBootstrap,
}));

import { GET } from '../route';

function request(query = '') {
  return new NextRequest(`http://localhost/api/readiness/bootstrap${query}`);
}

describe('GET /api/readiness/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      user: { id: 'mechanic-1', name: 'Mechanic', role: 'MECHANIC', tenantId: 'tenant-a' },
      error: null,
    });
    mocks.queryBootstrap.mockResolvedValue({ tenant: { timezone: 'Europe/Moscow', name: 'ОРИОН' } });
    mocks.withTransaction.mockImplementation(
      async (_tenantId: string, work: (tx: object) => Promise<unknown>) => work({})
    );
  });

  it('uses only the tenant from the authenticated session', async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(mocks.withTransaction).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(mocks.queryBootstrap).toHaveBeenCalledWith({}, {
      id: 'mechanic-1',
      name: 'Mechanic',
      role: 'MECHANIC',
      tenantId: 'tenant-a',
    }, undefined, null, expect.any(String));
  });

  it('rejects spoofed tenant/timezone context', async () => {
    const result = await GET(request('?tenantId=tenant-b&timezone=UTC'));
    expect(result.status).toBe(400);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows only authenticated ADMIN to request the audited mechanic execution context', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: { id: 'admin-1', name: 'Admin', role: 'ADMIN', tenantId: 'tenant-a' },
      error: null,
    });
    const result = await GET(request('?actingAs=MECHANIC'));
    expect(result.status).toBe(200);
    expect(mocks.queryBootstrap).toHaveBeenCalledWith({}, {
      id: 'admin-1',
      name: 'Admin',
      role: 'ADMIN',
      tenantId: 'tenant-a',
    }, undefined, 'MECHANIC', expect.any(String));
  });

  it('rejects actingAs for non-admin and rejects unknown acting roles', async () => {
    expect((await GET(request('?actingAs=MECHANIC'))).status).toBe(403);
    expect((await GET(request('?actingAs=DISPATCHER'))).status).toBe(400);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated session has no tenant', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: { id: 'mechanic-1', name: 'Mechanic', role: 'MECHANIC', tenantId: null },
      error: null,
    });
    const result = await GET(request());
    expect(result.status).toBe(403);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('preserves an authentication error', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const result = await GET(request());
    expect(result.status).toBe(401);
  });
});
