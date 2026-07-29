import {describe, expect, it} from 'vitest';
import {
  TECH_READINESS_ENTITIES,
  TECH_READINESS_FILTERS,
  TECH_READINESS_FOREIGN_TENANT,
  TECH_READINESS_TEST_TENANT,
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
  seedFixture(): Promise<void>;
  resetFixture(): Promise<void>;
}

const api = {
  request: async (): Promise<ContractResponse> => {
    throw new Error('Bind ApiContractHarness to the implemented readiness routes');
  },
  seedFixture: async () => {
    throw new Error('Bind isolated test tenant seed');
  },
  resetFixture: async () => {
    throw new Error('Bind isolated test tenant cleanup');
  },
} as ApiContractHarness;

const commandHeaders = (version = 1) => ({
  'Idempotency-Key': `test-readiness-command-${version}`.padEnd(24, 'x'),
  'If-Match': `"shift-${TECH_READINESS_ENTITIES.shiftId}-v${version}"`,
});

describe.skip('Tech Readiness API contract [PRD §8, backend design §10]', () => {
  it('returns list envelope, exact page total, normalized filters and opaque cursor', async () => {
    const response = await api.request({
      method: 'GET',
      path: '/api/readiness/shifts',
      actor: TECH_READINESS_USERS.dispatcher,
      query: {
        equipmentId: TECH_READINESS_FILTERS.equipmentId,
        status: 'STARTED',
        limit: '1',
        sort: 'updatedAt.desc',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: expect.any(Array),
      page: {
        limit: 1,
        nextCursor: expect.anything(),
        hasMore: expect.any(Boolean),
        total: expect.any(Number),
      },
      meta: {
        timezone: TECH_READINESS_TEST_TENANT.timezone,
        correlationId: expect.any(String),
        filters: {
          equipmentId: TECH_READINESS_ENTITIES.equipmentId,
          status: 'STARTED',
          sort: 'updatedAt.desc',
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(TECH_READINESS_FOREIGN_TENANT.id);
  });

  it('returns a strong ETag and rejects weak/missing/mismatched preconditions', async () => {
    const detail = await api.request({
      method: 'GET',
      path: `/api/readiness/shifts/${TECH_READINESS_ENTITIES.shiftId}`,
      actor: TECH_READINESS_USERS.dispatcher,
    });
    expect(detail.headers.etag).toMatch(/^"shift-.+-v\d+"$/);
    expect(detail.headers.etag).not.toMatch(/^W\//);

    const missing = await api.request({
      method: 'POST',
      path: `/api/readiness/shifts/${TECH_READINESS_ENTITIES.shiftId}/start`,
      actor: TECH_READINESS_USERS.mechanic,
      headers: {'Idempotency-Key': 'test-readiness-missing-precondition'},
      body: {},
    });
    expect(missing).toMatchObject({
      status: 428,
      body: {error: {code: 'PRECONDITION_REQUIRED', correlationId: expect.any(String)}},
    });

    const weak = await api.request({
      method: 'POST',
      path: `/api/readiness/shifts/${TECH_READINESS_ENTITIES.shiftId}/start`,
      actor: TECH_READINESS_USERS.mechanic,
      headers: {
        'Idempotency-Key': 'test-readiness-weak-etag',
        'If-Match': `W/"shift-${TECH_READINESS_ENTITIES.shiftId}-v1"`,
      },
      body: {expectedVersion: 1},
    });
    expect(weak).toMatchObject({
      status: 400,
      body: {error: {code: 'INVALID_PRECONDITION'}},
    });
  });

  it.each([
    ['ADMIN', 200],
    ['MECHANIC', 200],
    ['DISPATCHER', 403],
    ['OPERATOR', 403],
  ] as const)('enforces mechanic command RBAC for %s', async (role, expectedStatus) => {
    const actor = {
      id: `test-user-rbac-${role.toLowerCase()}`,
      role,
      tenantId: TECH_READINESS_TEST_TENANT.id,
    };
    const response = await api.request({
      method: 'POST',
      path: `/api/readiness/shifts/${TECH_READINESS_ENTITIES.shiftId}/handover`,
      actor,
      headers: commandHeaders(),
      body: {expectedVersion: 1, summary: 'Test handover'},
    });

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 403) {
      expect(response.body).toMatchObject({
        error: {code: 'FORBIDDEN', correlationId: expect.any(String)},
      });
    }
  });

  it('does not trust tenantId, timezone, actor, or approval role from input', async () => {
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
  });

  it('returns the same safe 404 for missing and cross-tenant resources', async () => {
    const missing = await api.request({
      method: 'GET',
      path: '/api/readiness/shifts/test-shift-missing',
      actor: TECH_READINESS_USERS.admin,
    });
    const foreign = await api.request({
      method: 'GET',
      path: `/api/readiness/equipment/${TECH_READINESS_ENTITIES.foreignEquipmentId}/current`,
      actor: TECH_READINESS_USERS.admin,
    });

    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(JSON.stringify(foreign.body)).not.toContain(TECH_READINESS_FOREIGN_TENANT.id);
  });

  it('returns a current safe resource on stale handover accept conflict', async () => {
    const response = await api.request({
      method: 'POST',
      path: `/api/readiness/handovers/${TECH_READINESS_ENTITIES.handoverId}/accept`,
      actor: TECH_READINESS_USERS.secondDispatcher,
      headers: {
        'Idempotency-Key': 'test-readiness-stale-handover',
        'If-Match': `"handover-${TECH_READINESS_ENTITIES.handoverId}-v1"`,
      },
      body: {expectedVersion: 1},
    });

    expect(response).toMatchObject({
      status: 409,
      body: {
        error: {
          code: expect.stringMatching(/HANDOVER_(VERSION_CONFLICT|ALREADY_ACCEPTED)/),
          details: {
            submittedVersion: 1,
            currentVersion: expect.any(Number),
            current: expect.objectContaining({state: 'ACCEPTED'}),
            actions: expect.any(Array),
          },
          correlationId: expect.any(String),
        },
      },
    });
  });

  it('returns explainable 422 blockers and correcting actions', async () => {
    const response = await api.request({
      method: 'POST',
      path: `/api/readiness/shifts/${TECH_READINESS_ENTITIES.shiftId}/start`,
      actor: TECH_READINESS_USERS.mechanic,
      headers: commandHeaders(),
      body: {expectedVersion: 1},
    });

    expect(response).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'SHIFT_START_BLOCKED',
          details: {
            blockers: [
              expect.objectContaining({
                code: 'VALID_WORK_PERMIT_REQUIRED',
                action: expect.anything(),
              }),
            ],
            actions: expect.any(Array),
          },
          correlationId: expect.any(String),
        },
      },
    });
  });

  it('replays identical idempotent command and rejects key reuse with another payload', async () => {
    const headers = {
      'Idempotency-Key': 'test-readiness-idempotency-replay',
      'If-Match': `"work-permit-${TECH_READINESS_ENTITIES.normalPermitId}-v1"`,
    };
    const request = {
      method: 'POST' as const,
      path: `/api/readiness/work-permits/${TECH_READINESS_ENTITIES.normalPermitId}/submit`,
      actor: TECH_READINESS_USERS.mechanic,
      headers,
      body: {expectedVersion: 1},
    };
    const first = await api.request(request);
    const replay = await api.request(request);
    const mismatch = await api.request({...request, body: {expectedVersion: 1, scope: 'changed'}});

    expect(replay).toEqual(first);
    expect(mismatch).toMatchObject({
      status: 409,
      body: {error: {code: 'IDEMPOTENCY_KEY_REUSED'}},
    });
  });

  it('rejects a cursor generated for different canonical filters', async () => {
    const response = await api.request({
      method: 'GET',
      path: '/api/audit',
      actor: TECH_READINESS_USERS.admin,
      query: {
        equipmentId: TECH_READINESS_ENTITIES.equipmentId,
        status: 'REVOKED',
        cursor: 'opaque-cursor-for-other-filter-hash',
      },
    });

    expect(response).toMatchObject({
      status: 400,
      body: {error: {code: 'CURSOR_FILTER_MISMATCH'}},
    });
  });

  it('keeps JSON audit filters and CSV export filter hash in parity', async () => {
    const query = {...TECH_READINESS_FILTERS};
    const json = await api.request({
      method: 'GET',
      path: '/api/audit',
      actor: TECH_READINESS_USERS.admin,
      query,
    });
    const csv = await api.request({
      method: 'GET',
      path: '/api/audit/export.csv',
      actor: TECH_READINESS_USERS.admin,
      query,
    });

    expect(json.status).toBe(200);
    expect(json.body).toMatchObject({
      meta: {
        filters: query,
        filterHash: expect.any(String),
        timezone: TECH_READINESS_TEST_TENANT.timezone,
      },
    });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['x-filter-hash']).toBe(
      (json.body as {meta: {filterHash: string}}).meta.filterHash,
    );
    expect(csv.headers['x-timezone']).toBe(TECH_READINESS_TEST_TENANT.timezone);
    expect(csv.headers['x-content-type-options']).toBe('nosniff');
    expect(csv.text?.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('\r\n');
    expect(csv.text).not.toContain('=HYPERLINK(');
    expect(csv.text).toContain(`"'=HYPERLINK(`);
  });
});
