import {describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({context: vi.fn(), transaction: vi.fn()}));
vi.mock('@/core/api-wrapper', () => ({withMutation: (handler: unknown) => handler}));
vi.mock('@/app/api/readiness/_shared/request-context', () => ({resolveReadinessRequestContext: mocks.context}));
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({withReadinessSerializableTransaction: mocks.transaction}));

import {POST as approvePermit} from '@/app/api/readiness/work-permits/[id]/approve/route';
import {ROLE_ABILITIES} from '@/modules/readiness/domain/capability-defaults';
import {
  TECH_READINESS_ENTITIES,
  TECH_READINESS_FOREIGN_TENANT,
  TECH_READINESS_USERS,
} from '../fixtures/tech-readiness.fixture';

type Role = 'ADMIN' | 'MECHANIC' | 'DISPATCHER' | 'OPERATOR';

interface ContractResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  text?: string;
}

interface ApiContractHarness {
  request(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT';
    path: string;
    actor: {id: string; role: Role; tenantId: string};
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  }): Promise<ContractResponse>;
}

const api = {
  request: async (input): Promise<ContractResponse> => {
    // Only the approve route is bound. Auth/DB are replaced; the real route,
    // strict schema and error adapter produce the response.
    const match = input.path.match(/^\/api\/readiness\/work-permits\/([^/]+)\/approve$/);
    if (input.method !== 'POST' || !match) throw new Error('Unbound API contract scenario');
    mocks.context.mockResolvedValue({context: {
      tenantId: input.actor.tenantId, actorId: input.actor.id, actorRole: input.actor.role,
      actorName: input.actor.id, actingAs: null, requestId: 'contract-request', correlationId: 'contract-correlation',
      capabilities: new Set(ROLE_ABILITIES[input.actor.role]),
    }});
    const response = await approvePermit(new NextRequest(`http://localhost${input.path}`, {
      method: input.method, headers: input.headers, body: JSON.stringify(input.body),
    }), {params: Promise.resolve({id: match[1]})});
    return {status: response.status, headers: Object.fromEntries(response.headers), body: await response.json()};
  },
} satisfies ApiContractHarness;

describe('Tech Readiness API contract [PRD §8, backend design §10]', () => {
  it('does not trust tenantId, timezone, actor, or approval role from input', async () => {
    mocks.transaction.mockClear();
    const response = await api.request({
      method: 'POST',
      path: `/api/readiness/work-permits/${TECH_READINESS_ENTITIES.normalPermitId}/approve`,
      actor: TECH_READINESS_USERS.dispatcher,
      headers: {
        'Idempotency-Key': 'test-readiness-spoofed-context',
        'If-Match': `"work-permit-${TECH_READINESS_ENTITIES.normalPermitId}-v1"`,
      },
      body: {
        expectedVersion: 1,
        tenantId: TECH_READINESS_FOREIGN_TENANT.id,
        timezone: TECH_READINESS_FOREIGN_TENANT.timezone,
        actorId: TECH_READINESS_USERS.admin.id,
        role: 'ADMIN',
      },
    });

    expect(response).toMatchObject({
      status: 422,
      body: {error: {code: expect.stringMatching(/VALIDATION|UNKNOWN_FIELD/)}},
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
