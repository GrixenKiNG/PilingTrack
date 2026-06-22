/**
 * Idempotency middleware tests.
 *
 * Sync v2 and external integrations rely on this for retry safety. If
 * idempotency breaks, retried POSTs duplicate side effects (double
 * report submissions, double notifications). The contract under test:
 *
 *   no header                     → pass through (null)
 *   first request                 → DB insert(status=processing), pass through
 *   second request, completed     → cached response replayed verbatim
 *   second request, processing    → 409 Conflict + retryAfter
 *   second request, failed        → pass through (retry allowed)
 *
 *   cacheIdempotentResponse: update DB with body + statusCode on success
 *   markIdempotencyFailed: update DB with status=failed (best-effort)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/db', () => ({
  db: {
    idempotencyKey: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
    },
  },
}));

vi.mock('@/generated/postgres-client/client', () => ({
  Prisma: { JsonNull: Symbol('JsonNull') },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  withIdempotency,
  cacheIdempotentResponse,
  markIdempotencyFailed,
} from '../idempotency-middleware';

function makeRequest(opts: { key?: string; path?: string } = {}) {
  const headers = new Headers();
  if (opts.key) headers.set('idempotency-key', opts.key);
  return new NextRequest(`http://localhost${opts.path || '/api/reports/upsert'}`, {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockReset();
  mocks.create.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
});

// ============================================================
// withIdempotency — entry path
// ============================================================

describe('withIdempotency — pass-through cases', () => {
  it('returns null when no Idempotency-Key header is present', async () => {
    const result = await withIdempotency(makeRequest());
    expect(result).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('creates a "processing" record on first request and passes through', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const result = await withIdempotency(makeRequest({ key: 'op-abc' }));

    expect(result).toBeNull();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { scope_key: { scope: '/api/reports/upsert', key: 'op-abc' } },
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      key: 'op-abc',
      scope: '/api/reports/upsert',
      status: 'processing',
    });
    expect(mocks.create.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date);
  });

  it('uses the request pathname as the scope (not the host or query)', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await withIdempotency(
      new NextRequest('http://localhost/api/reports/upsert?device=abc', {
        method: 'POST',
        headers: { 'idempotency-key': 'k-1' },
      }),
    );

    expect(mocks.findUnique.mock.calls[0][0].where.scope_key.scope).toBe('/api/reports/upsert');
  });

  it('lets retries through when the previous attempt was marked failed', async () => {
    mocks.findUnique.mockResolvedValue({
      key: 'op-x',
      scope: '/api/reports/upsert',
      status: 'failed',
      result: null,
    });

    const result = await withIdempotency(makeRequest({ key: 'op-x' }));

    expect(result).toBeNull();
    // We deliberately do NOT create a new "processing" row here — the
    // existing failed row remains, and a successful response will be
    // cached over it via cacheIdempotentResponse. This matches current
    // behaviour; if it changes the test must update with the rationale.
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

// ============================================================
// withIdempotency — replay path
// ============================================================

describe('withIdempotency — replay cases', () => {
  it('replays the cached response when the previous attempt completed', async () => {
    mocks.findUnique.mockResolvedValue({
      key: 'op-1',
      scope: '/api/reports/upsert',
      status: 'completed',
      result: { reportId: 'rep-1', _action: 'created' },
      statusCode: 201,
    });

    const result = await withIdempotency(makeRequest({ key: 'op-1' }));

    expect(result).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    expect(result!.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await result!.json();
    expect(body).toEqual({ reportId: 'rep-1', _action: 'created' });
    expect(mocks.create).not.toHaveBeenCalled(); // no new row written
  });

  it('defaults to status 200 if statusCode was not persisted', async () => {
    mocks.findUnique.mockResolvedValue({
      key: 'op-2',
      scope: '/api/reports/upsert',
      status: 'completed',
      result: { ok: true },
      statusCode: null,
    });

    const result = await withIdempotency(makeRequest({ key: 'op-2' }));

    expect(result?.status).toBe(200);
  });

  it('returns 409 Conflict + retryAfter when the same key is mid-flight', async () => {
    mocks.findUnique.mockResolvedValue({
      key: 'op-3',
      scope: '/api/reports/upsert',
      status: 'processing',
      result: null,
    });

    const result = await withIdempotency(makeRequest({ key: 'op-3' }));

    expect(result?.status).toBe(409);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await result!.json();
    expect(body).toMatchObject({
      error: expect.stringMatching(/in progress/i),
      retryAfter: 5,
    });
  });
});

// ============================================================
// cacheIdempotentResponse
// ============================================================

describe('cacheIdempotentResponse', () => {
  it('updates the row with the JSON body and status code', async () => {
    const response = NextResponse.json({ reportId: 'r-1' }, { status: 201 });
    await cacheIdempotentResponse(makeRequest({ key: 'op-cache' }), response, 201);

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const args = mocks.update.mock.calls[0][0];
    expect(args.where).toEqual({
      scope_key: { scope: '/api/reports/upsert', key: 'op-cache' },
    });
    expect(args.data.status).toBe('completed');
    expect(args.data.result).toEqual({ reportId: 'r-1' });
    expect(args.data.statusCode).toBe(201);
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('is a no-op when no Idempotency-Key header is set', async () => {
    const response = NextResponse.json({ ok: true });
    const result = await cacheIdempotentResponse(makeRequest(), response);

    expect(result).toBe(response);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('survives DB failure during cache write (does not throw)', async () => {
    mocks.update.mockRejectedValueOnce(new Error('db down'));
    const response = NextResponse.json({ ok: true });

    await expect(
      cacheIdempotentResponse(makeRequest({ key: 'op-x' }), response),
    ).resolves.toBe(response);
  });
});

// ============================================================
// markIdempotencyFailed
// ============================================================

describe('markIdempotencyFailed', () => {
  it('updates the row with status=failed and the error message', async () => {
    await markIdempotencyFailed(makeRequest({ key: 'op-fail' }), 'boom');

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
  });

  it('is a no-op without an Idempotency-Key header', async () => {
    await markIdempotencyFailed(makeRequest(), 'boom');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('swallows DB errors so error handlers do not crash', async () => {
    mocks.update.mockRejectedValueOnce(new Error('db down'));
    await expect(
      markIdempotencyFailed(makeRequest({ key: 'op-x' }), 'boom'),
    ).resolves.toBeUndefined();
  });
});
