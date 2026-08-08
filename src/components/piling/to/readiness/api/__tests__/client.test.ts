import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '@/lib/api';
import { fetchCurrentReadiness, fetchReadinessBootstrap, readinessFilterQuery } from '../client';
import { isReadinessRequestCancelled, ReadinessRequestCancelledError } from '../errors';
import { READINESS_REQUEST_ID_HEADER } from '../idempotency';
import { readinessQueryKeys } from '../query-keys';
import { bootstrapEnvelope } from './fixtures';

vi.mock('@/lib/api', () => ({ authFetch: vi.fn() }));

const mockedAuthFetch = vi.mocked(authFetch);

function jsonResponse(body: unknown, status = 200, requestId = 'request-test'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      [READINESS_REQUEST_ID_HEADER]: requestId,
    },
  });
}

describe('fetchReadinessBootstrap', () => {
  beforeEach(() => mockedAuthFetch.mockReset());

  it('propagates a stable request correlation id and returns validated data', async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse(bootstrapEnvelope()));

    const result = await fetchReadinessBootstrap({ requestId: 'request-test' });

    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/readiness/bootstrap', {
      method: 'GET',
      signal: undefined,
      headers: { [READINESS_REQUEST_ID_HEADER]: 'request-test' },
    });
    expect(result.tenant.timezone).toBe('Europe/Moscow');
    expect(readinessQueryKeys.bootstrap).toEqual(['readiness', 'bootstrap']);
  });

  it('maps forbidden responses to a typed non-retryable error', async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ error: 'denied' }, 403));
    await expect(fetchReadinessBootstrap({ requestId: 'request-test' }))
      .rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
        requestId: 'request-test',
        retryable: false,
      });
  });

  it('rejects invalid and uncorrelated successful responses', async () => {
    mockedAuthFetch.mockResolvedValueOnce(jsonResponse({ data: {} }));
    await expect(fetchReadinessBootstrap({ requestId: 'request-test' }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    mockedAuthFetch.mockResolvedValueOnce(
      jsonResponse(bootstrapEnvelope('another-request'), 200, 'request-test'),
    );
    await expect(fetchReadinessBootstrap({ requestId: 'request-test' }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('propagates cancellation as a typed cancellation error', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    expect(isReadinessRequestCancelled(abortError)).toBe(true);

    await expect(fetchReadinessBootstrap({
      requestId: 'request-test',
      signal: controller.signal,
    })).rejects.toBeInstanceOf(ReadinessRequestCancelledError);
    expect(mockedAuthFetch).not.toHaveBeenCalled();
  });
});

describe('readinessFilterQuery', () => {
  it('serializes the shared screen, API and export filter contract', () => {
    const query = readinessFilterQuery({
      status: 'APPROVED',
      from: '2026-08-01',
      to: '2026-08-02',
      shiftType: 'DAY',
      risk: 'ELEVATED',
      eventType: 'work-permit.approved',
      actor: 'Иванов',
    });
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      status: 'APPROVED',
      from: '2026-08-01',
      to: '2026-08-02',
      shiftType: 'DAY',
      risk: 'ELEVATED',
      eventType: 'work-permit.approved',
      actor: 'Иванов',
    });
  });
});

describe('fetchCurrentReadiness', () => {
  beforeEach(() => mockedAuthFetch.mockReset());

  it('returns runtime-validated authoritative facts', async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({data: [{
      equipmentId: 'equipment-1', snapshotId: 'snapshot-1', status: 'READY', score: 100,
      calculatedAt: '2026-08-08T12:00:00.000Z', blockers: [], warnings: [], evidence: {},
      triggerType: 'INSPECTION_COMPLETED', ruleSetVersion: 'v1', facts: {
        inspectionCompleted: true, inspectionProgress: 1, healthScore: 100, meterKnown: true,
        permitValid: true, permitExpired: false, maintenanceConfigured: true,
        maintenanceOverdueHours: 0, maintenanceOverdueDays: 0, accepted: true,
        criticalDefect: false, findings: 0,
      },
    }]}));
    await expect(fetchCurrentReadiness()).resolves.toMatchObject([{facts: {inspectionCompleted: true}}]);
  });

  it('rejects malformed facts instead of returning unchecked data', async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({data: [{
      equipmentId: 'equipment-1', snapshotId: 'snapshot-1', status: 'READY', score: 100,
      calculatedAt: '2026-08-08T12:00:00.000Z', blockers: [], warnings: [], evidence: {},
      triggerType: null, ruleSetVersion: null, facts: {inspectionCompleted: true},
    }]}));
    await expect(fetchCurrentReadiness()).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  });
});
