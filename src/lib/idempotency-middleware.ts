/**
 * Idempotency Middleware for Next.js API Routes
 *
 * Prevents duplicate processing of retried requests.
 * Clients send `Idempotency-Key` header with a unique value per operation.
 *
 * Usage in route handler:
 *   export async function POST(request: NextRequest) {
 *     const idempotencyCheck = await withIdempotency(request);
 *     if (idempotencyCheck) return idempotencyCheck; // cached response
 *
 *     const result = await doSomething();
 *     return cacheIdempotentResponse(request, result);
 *   }
 *
 * Flow:
 * 1. Client sends: POST /api/reports/upsert
 *    Headers: Idempotency-Key: abc-123-uuid
 * 2. Server checks IdempotencyKey table
 *    - If completed → return cached response
 *    - If processing → return 409 Conflict
 *    - If not found → create "processing" record
 * 3. Handler executes
 * 4. Response cached + status set to "completed"
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@/generated/postgres-client/client';
import { logger } from '@/lib/logger';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check idempotency key.
 * Returns cached response if key exists, or null if first request.
 */
export async function withIdempotency(
  request: NextRequest
): Promise<NextResponse | null> {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return null; // No key — proceed normally
  }

  const url = new URL(request.url);
  const scope = url.pathname;

  // Check for existing key
  const existing = await db.idempotencyKey.findUnique({
    where: { scope_key: { scope, key: idempotencyKey } },
  });

  if (!existing) {
    // First request — create processing record
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
    await db.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        scope,
        status: 'processing',
        expiresAt,
      },
    });
    return null; // Proceed with handler
  }

  // Already completed — return cached response
  if (existing.status === 'completed' && existing.result) {
    return NextResponse.json(existing.result, { status: existing.statusCode || 200 });
  }

  // Still processing — conflict
  if (existing.status === 'processing') {
    return NextResponse.json(
      { error: 'Request already in progress', retryAfter: 5 },
      { status: 409 }
    );
  }

  // Failed — allow retry
  return null;
}

/**
 * Cache the response for idempotent replay.
 */
export async function cacheIdempotentResponse(
  request: NextRequest,
  response: NextResponse,
  statusCode = 200
): Promise<NextResponse> {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return response;

  const url = new URL(request.url);
  const scope = url.pathname;

  try {
    // Clone response to read body without consuming
    const clonedResponse = response.clone();
    let body: unknown;
    try {
      body = await clonedResponse.json();
    } catch {
      body = null;
    }

    await db.idempotencyKey.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: {
        status: 'completed',
        result: body ? (body as Prisma.InputJsonValue) : Prisma.JsonNull,
        statusCode,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Idempotency: failed to cache response', error);
  }

  return response;
}

/**
 * Mark idempotency key as failed (for error handlers).
 */
export async function markIdempotencyFailed(
  request: NextRequest,
  error: string
): Promise<void> {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return;

  const url = new URL(request.url);
  const scope = url.pathname;

  try {
    await db.idempotencyKey.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
    });
  } catch {
    // Ignore — not critical
  }
}
