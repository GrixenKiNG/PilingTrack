import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({query: vi.fn(), context: vi.fn(), transaction: vi.fn()}));
vi.mock('@/core/api-wrapper', () => ({withApi: <T,>(handler: T) => handler}));
vi.mock('@/app/api/readiness/_shared/route-adapter', () => ({withReadinessCommand: <T,>(handler: T) => handler}));
vi.mock('@/app/api/readiness/_shared/request-context', () => ({resolveReadinessRequestContext: mocks.context}));
vi.mock('@/modules/readiness/application/permits/commands', () => ({createWorkPermitCommand: vi.fn()}));
vi.mock('@/modules/readiness/application/permits/queries', () => ({queryWorkPermits: mocks.query}));
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessRequestTransaction: mocks.transaction, withReadinessSerializableTransaction: vi.fn(),
}));
import {GET} from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({context: {tenantId: 'own-tenant', capabilities: new Set(['readiness.read']),
    requestId: 'request', correlationId: 'correlation'}});
  mocks.transaction.mockImplementation(async (_tenant: string, callback: (tx: unknown) => unknown) =>
    callback({tenantSettings: {findUnique: async () => ({timezone: 'Europe/Moscow'})}}));
  mocks.query.mockResolvedValue({data: [], page: {total: 0}});
});

describe('work permit history filters', () => {
  it.each(['CLOSED', 'EXPIRED', 'REVOKED'])('accepts %s for the session tenant', async (state) => {
    const response = await GET(new NextRequest(`http://localhost/api/readiness/work-permits?state=${state}`));
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.anything(), 'own-tenant', expect.objectContaining({state}));
  });

  it('rejects unknown permit states', async () => {
    const response = await GET(new NextRequest('http://localhost/api/readiness/work-permits?state=UNKNOWN'));
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
