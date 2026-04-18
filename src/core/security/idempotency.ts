/**
 * Idempotency Keys — Prevent Duplicate API Requests
 *
 * Ensures that the same request (identified by a unique key) is only
 * processed once, even if the client retries due to network issues.
 *
 * Flow:
 * 1. Client generates a unique idempotency key (UUID)
 * 2. Server stores the key + result in DB
 * 3. If same key is received again, return cached result
 * 4. Keys expire after TTL (prevents storage growth)
 *
 * Usage:
 *   import { withIdempotency } from '@/core/security/idempotency';
 *
 *   export async function POST(request: NextRequest) {
 *     const idempotencyKey = request.headers.get('idempotency-key');
 *     return withIdempotency(idempotencyKey, 'report-upsert', async () => {
 *       return await upsertReport(input);
 *     });
 *   }
 */

import { db } from '@/lib/db';
import { Prisma } from '@/generated/postgres-client/client';
import { ServiceError } from '@/services/service-error';
import { logger } from '@/lib/logger';

// ============================================================
// Idempotency Store (Prisma-backed)
// ============================================================

interface IdempotencyRecord {
  key: string;
  scope: string;
  status: 'processing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  expiresAt: Date;
  createdAt: Date;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create or get existing idempotency record.
 *
 * If key exists and completed/failed → return cached result.
 * If key exists and processing → wait for completion or timeout.
 * If key doesn't exist → create new record.
 */
export async function acquireIdempotencyKey(
  key: string,
  scope: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<{
  action: 'new' | 'cached';
  result?: unknown;
}> {
  // Try to create a new record
  try {
    const record = await db.idempotencyKey.create({
      data: {
        key,
        scope,
        status: 'processing',
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return { action: 'new' };
  } catch (error: unknown) {
    // Unique constraint violation — key already exists
    const err = error as { code?: string };
    if (err.code === 'P2002') {
      const existing = await db.idempotencyKey.findUnique({
        where: { scope_key: { scope, key } },
      });

      if (!existing) {
        // Race condition — try again
        return acquireIdempotencyKey(key, scope, ttlMs);
      }

      if (existing.status === 'completed' && existing.result) {
        return { action: 'cached', result: existing.result };
      }

      if (existing.status === 'failed' && existing.error) {
        throw new ServiceError(existing.error, existing.statusCode || 500);
      }

      if (existing.status === 'processing') {
        // Check if processing for too long (stale)
        const processingMs = Date.now() - existing.createdAt.getTime();
        if (processingMs > 60000) {
          // > 1 min — assume stale, reset
          await db.idempotencyKey.update({
            where: { id: existing.id },
            data: { status: 'processing', createdAt: new Date() },
          });
          return { action: 'new' };
        }

        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, 500));
        return acquireIdempotencyKey(key, scope, ttlMs);
      }
    }

    throw error;
  }
}

/**
 * Mark idempotency key as completed with result.
 */
export async function completeIdempotencyKey(
  key: string,
  scope: string,
  result: unknown
): Promise<void> {
  await db.idempotencyKey.updateMany({
    where: { key, scope, status: 'processing' },
    data: {
      status: 'completed',
      result: result as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

/**
 * Mark idempotency key as failed.
 */
export async function failIdempotencyKey(
  key: string,
  scope: string,
  error: string,
  statusCode = 500
): Promise<void> {
  await db.idempotencyKey.updateMany({
    where: { key, scope, status: 'processing' },
    data: {
      status: 'failed',
      error: error.substring(0, 1000),
      statusCode,
      completedAt: new Date(),
    },
  });
}

// ============================================================
// High-Level Wrapper
// ============================================================

/**
 * Wrap an async handler with idempotency.
 *
 * If idempotencyKey is null/undefined, runs without idempotency.
 */
export async function withIdempotency<T>(
  idempotencyKey: string | null | undefined,
  scope: string,
  handler: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) {
    return handler();
  }

  const { action, result } = await acquireIdempotencyKey(idempotencyKey, scope);

  if (action === 'cached') {
    return result as T;
  }

  try {
    const result = await handler();
    await completeIdempotencyKey(idempotencyKey, scope, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ServiceError ? error.status : 500;
    await failIdempotencyKey(idempotencyKey, scope, message, status);
    throw error;
  }
}

// ============================================================
// Cleanup — Expired Keys
// ============================================================

/**
 * Delete expired idempotency keys.
 * Run weekly via cron or worker.
 */
export async function cleanupExpiredKeys(): Promise<number> {
  const result = await db.idempotencyKey.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, // Older than 7 days
      ],
    },
  });

  if (result.count > 0) {
    logger.info('Cleaned up expired idempotency keys', { count: result.count });
  }

  return result.count;
}
