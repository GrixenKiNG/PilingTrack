import {beforeEach, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({command: vi.fn()}));
vi.mock('@/core/api-wrapper', () => ({withMutation: (handler: unknown) => handler}));
vi.mock('@/app/api/readiness/_shared/request-context', () => ({resolveReadinessRequestContext: async () => ({context: {
  tenantId: 'tenant-1', actorId: 'mechanic', actorRole: 'MECHANIC', actingAs: null, actorName: 'Механик',
  requestId: 'request', correlationId: 'correlation',
}})}));
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessSerializableTransaction: async (_tenant: string, run: (tx: object) => unknown) => run({}),
}));
vi.mock('@/modules/readiness/application/permits/commands', () => ({closeWorkPermitCommand: mocks.command}));
import {POST} from './route';

const request = (body: string) => new NextRequest('http://localhost/api/readiness/work-permits/permit-1/close', {
  method: 'POST', headers: {'content-type': 'application/json', 'idempotency-key': 'close-key-1015-test', 'if-match': '"work-permit-permit-1-v2"'}, body,
});
const params = {params: Promise.resolve({id: 'permit-1'})};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.command.mockResolvedValue({status: 200, body: {data: {state: 'CLOSED'}}, headers: {ETag: '"work-permit-permit-1-v3"'}});
});

it.each([{}, {expectedVersion: 2, reason: '  Работы завершены  '}])('передаёт проверенное закрытие %j вместе с контекстом и заголовками', async (body) => {
  const response = await POST(request(JSON.stringify(body)), params);
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe('"work-permit-permit-1-v3"');
  expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({id: 'permit-1',
    reason: 'reason' in body ? 'Работы завершены' : undefined,
    key: 'close-key-1015-test', ifMatch: '"work-permit-permit-1-v2"',
    context: expect.objectContaining({tenantId: 'tenant-1', actorId: 'mechanic'})}));
});

it.each([{reason: 'я'.repeat(501)}, {tenantId: 'other'}, {closeReason: 'VALIDITY_ELAPSED'}, {expectedVersion: 0}])(
  'отклоняет некорректное/чужое тело %j до команды', async (body) => {
    expect((await POST(request(JSON.stringify(body)), params)).status).toBe(400);
    expect(mocks.command).not.toHaveBeenCalled();
  },
);

it('возвращает 400 для сломанного JSON', async () => {
  expect((await POST(request('{'), params)).status).toBe(400);
  expect(mocks.command).not.toHaveBeenCalled();
});
