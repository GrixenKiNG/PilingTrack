import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({requireAuth: vi.fn()}));

vi.mock('@/lib/auth', () => ({requireAuth: mocks.requireAuth}));

import {resolveReadinessRequestContext} from '../request-context';

const request = (headers: Record<string, string> = {}) => new NextRequest(
  'http://localhost/api/readiness/work-permits',
  {headers},
);

describe('readiness request context trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      user: {
        id: 'dispatcher-session',
        name: 'Dispatcher',
        role: 'DISPATCHER',
        tenantId: 'tenant-session',
      },
      error: null,
    });
  });

  it('takes tenant, actor and role only from the authenticated session', async () => {
    const result = await resolveReadinessRequestContext(request({
      'x-tenant-id': 'tenant-foreign',
      'x-actor-id': 'admin-foreign',
      'x-role': 'ADMIN',
      'x-timezone': 'UTC',
    }));

    expect(result.context).toMatchObject({
      tenantId: 'tenant-session',
      actorId: 'dispatcher-session',
      actorRole: 'DISPATCHER',
      actingAs: null,
    });
  });

  it('rejects a non-admin attempt to act as mechanic', async () => {
    const result = await resolveReadinessRequestContext(request({
      'x-readiness-acting-as': 'MECHANIC',
    }));
    expect(result.context).toBeUndefined();
    expect(result.response?.status).toBe(403);
  });
});
