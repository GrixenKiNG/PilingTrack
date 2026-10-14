import {beforeEach, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({command: vi.fn()}));
vi.mock('@/core/api-wrapper', () => ({withMutation: (handler: unknown) => handler}));
vi.mock('@/app/api/readiness/_shared/request-context', () => ({resolveReadinessRequestContext: async () => ({context: {
  tenantId: 'tenant-1', actorId: 'dispatcher', actorRole: 'DISPATCHER', actingAs: null, actorName: 'Диспетчер',
  requestId: 'request', correlationId: 'correlation',
}})}));
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessSerializableTransaction: async (_tenant: string, run: (tx: object) => unknown) => run({}),
}));
vi.mock('@/modules/readiness/application/permits/commands', () => ({rejectWorkPermitCommand: mocks.command}));
import {POST} from './route';

const request = (body: string) => new NextRequest('http://localhost/api/readiness/work-permits/permit-1/reject', {
  method: 'POST', headers: {'content-type': 'application/json', 'idempotency-key': 'reject-key-1013-test', 'if-match': '"work-permit-permit-1-v2"'}, body,
});
const params = {params: Promise.resolve({id: 'permit-1'})};
beforeEach(() => {vi.clearAllMocks(); mocks.command.mockResolvedValue({status: 200, body: {data: {state: 'DRAFT'}}, headers: {ETag: '"work-permit-permit-1-v3"'}});});

it('передаёт только проверенные данные, контекст и заголовки в команду', async () => {
  const response = await POST(request(JSON.stringify({expectedVersion: 2, reason: '  Нет ограждения  '})), params);
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe('"work-permit-permit-1-v3"');
  expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({id: 'permit-1', expectedVersion: 2, reason: 'Нет ограждения',
    key: 'reject-key-1013-test', ifMatch: '"work-permit-permit-1-v2"', context: expect.objectContaining({tenantId: 'tenant-1', actorId: 'dispatcher'})}));
});

it.each(['{}', '{"reason":"   "}', '{"reason":"Нет ограждения","tenantId":"other"}'])('отклоняет неполное/чужое тело %s', async (body) => {
  expect((await POST(request(body), params)).status).toBe(422);
  expect(mocks.command).not.toHaveBeenCalled();
});

it('возвращает 400 для сломанного JSON', async () => {
  expect((await POST(request('{'), params)).status).toBe(400);
  expect(mocks.command).not.toHaveBeenCalled();
});
