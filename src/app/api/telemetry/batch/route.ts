import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ingestTelemetryBatch, telemetryBuffer } from '@/services/telemetry/telemetry-ingestion-service';
import { dbHealthCircuitBreaker, CircuitOpenError } from '@/core/infrastructure/circuit-breaker';
import { logger } from '@/lib/logger';
import { withApi } from '@/core/api-wrapper';
import { z } from 'zod';

const telemetryRecordSchema = z.object({
  type: z.string().max(50),
  equipmentId: z.string().min(1),
  siteId: z.string().optional().nullable(),
  value: z.number(),
  unit: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  timestamp: z.string().datetime().optional(),
});

const telemetryBatchSchema = z.array(telemetryRecordSchema);

export const runtime = 'nodejs';

const TELEMETRY_RATE_LIMIT = {
  maxAttempts: 1000,
  windowMs: 60_000,
  blockDurationMs: 60_000,
};

const MAX_BATCH_SIZE = 100;

function checkCircuitBreaker(): NextResponse | null {
  const state = dbHealthCircuitBreaker.getState();

  if (state === 'OPEN') {
    const stats = dbHealthCircuitBreaker.getStats();
    const retryAfter = stats.timeUntilRetry
      ? Math.ceil(stats.timeUntilRetry / 1000)
      : 30;

    return NextResponse.json(
      {
        error: 'Service temporarily unavailable — database circuit breaker is OPEN',
        circuitBreaker: {
          state: stats.state,
          timeUntilRetryMs: stats.timeUntilRetry,
          failures: stats.failures,
          failureThreshold: stats.failureThreshold,
        },
      },
      {
        status: 503,
        headers: { 'Retry-After': String(retryAfter) },
      }
    );
  }

  return null;
}

export const POST = withApi(async (request: NextRequest) => {
  const csrfCheck = withCsrf(request);
  if (csrfCheck) return csrfCheck;

  const identifier = getRateLimitIdentifier(request);
  const rl = await rateLimiter.check(identifier, TELEMETRY_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Telemetry rate limit exceeded', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
    );
  }

  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    // Only ADMIN, DISPATCHER, and OPERATOR can submit telemetry
    if (!['ADMIN', 'DISPATCHER', 'OPERATOR'].includes(user!.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check circuit breaker
    const circuitResponse = checkCircuitBreaker();
    if (circuitResponse) return circuitResponse;

    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be an array of telemetry records' },
        { status: 400 }
      );
    }

    if (body.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        {
          error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} records`,
          maxBatchSize: MAX_BATCH_SIZE,
          receivedCount: body.length,
        },
        { status: 400 }
      );
    }

    const validated = telemetryBatchSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const count = await ingestTelemetryBatch(
      validated.data.map((d) => ({
        ...d,
        type: d.type as any,
        siteId: d.siteId ?? undefined,
        unit: d.unit ?? undefined,
        latitude: d.latitude ?? undefined,
        longitude: d.longitude ?? undefined,
        metadata: d.metadata ?? undefined,
      })) as any
    );

    return NextResponse.json({
      success: true,
      ingested: count,
      sampled: body.length - count,
      buffer: telemetryBuffer.getStats(),
    });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      const retryAfter = Math.ceil(err.retryAfterMs / 1000);
      logger.warn('Telemetry batch: database circuit breaker open', {
        retryAfterMs: err.retryAfterMs,
      });
      return NextResponse.json(
        {
          error: 'Database unavailable — circuit breaker is OPEN',
          retryAfter,
          circuitBreaker: dbHealthCircuitBreaker.getStats(),
        },
        {
          status: 503,
          headers: { 'Retry-After': String(retryAfter) },
        }
      );
    }

    throw err;
  }
}, { domain: 'telemetry' });
