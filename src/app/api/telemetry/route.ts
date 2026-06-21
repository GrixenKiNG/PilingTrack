/**
 * Telemetry API — Single record endpoint
 * POST /api/telemetry  — single or auto-detect batch
 * GET  /api/telemetry  — query records or ?action=stats
 *
 * For dedicated batch endpoint: POST /api/telemetry/batch
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { assertCan } from '@/services/auth/authorization-service';
import {
  ingestTelemetry,
  ingestTelemetryBatch,
  telemetryBuffer,
  getSamplingConfig,
  getIngestStats,
} from '@/services/telemetry/telemetry-ingestion-service';
import { databaseCircuitBreaker, CircuitOpenError } from '@/core/infrastructure/circuit-breakers';
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

// Telemetry-specific rate limiter: 1000 req/min
const TELEMETRY_RATE_LIMIT = {
  maxAttempts: 1000,
  windowMs: 60_000,
  blockDurationMs: 60_000,
};

// Max batch size for batch endpoint
const MAX_BATCH_SIZE = 100;

/**
 * Check circuit breaker and return 503 if DB is unavailable.
 */
function checkCircuitBreaker(): NextResponse | null {
  const stats = databaseCircuitBreaker.getStats();

  if (stats.state === 'OPEN') {
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

  // Telemetry-specific rate limiting
  const identifier = getRateLimitIdentifier(request);
  const rl = await rateLimiter.check(identifier, TELEMETRY_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: 'Telemetry rate limit exceeded. Try again later.',
        retryAfter: rl.retryAfter,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter || 60) },
      }
    );
  }

  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const roleCheck = assertAnyRole(user!, ['ADMIN', 'DISPATCHER', 'OPERATOR']);
    if (roleCheck) return roleCheck;

    // Check circuit breaker before accepting data
    const circuitResponse = checkCircuitBreaker();
    if (circuitResponse) return circuitResponse;

    // Check if this is a batch or single record
    const body = await request.json();

    if (Array.isArray(body)) {
      // Batch ingestion — enforce max batch size
      if (body.length > MAX_BATCH_SIZE) {
        return NextResponse.json(
          {
            error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} records`,
            maxBatchSize: MAX_BATCH_SIZE,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
          type: d.type as any,
          siteId: d.siteId ?? undefined,
          unit: d.unit ?? undefined,
          latitude: d.latitude ?? undefined,
          longitude: d.longitude ?? undefined,
          metadata: d.metadata ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
        })) as any
      );
      return NextResponse.json({
        success: true,
        ingested: count,
        sampled: validated.data.length - count,
        buffer: telemetryBuffer.getStats(),
      });
    }

    // Single record
    const validated = telemetryRecordSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const id = await ingestTelemetry({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
      type: validated.data.type as any,
      equipmentId: validated.data.equipmentId,
      value: validated.data.value,
      siteId: validated.data.siteId || undefined,
      unit: validated.data.unit || undefined,
      latitude: validated.data.latitude || undefined,
      longitude: validated.data.longitude || undefined,
      metadata: validated.data.metadata || undefined,
      timestamp: validated.data.timestamp
        ? new Date(validated.data.timestamp)
        : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
    } as any);

    const isSampledOut = id.startsWith('sampled-out-');

    return NextResponse.json({
      success: true,
      id,
      sampled: isSampledOut,
      buffer: telemetryBuffer.getStats(),
    });
  } catch (err) {
    // If circuit breaker is open, return 503
    if (err instanceof CircuitOpenError) {
      const retryAfter = Math.ceil(err.retryAfterMs / 1000);
      return NextResponse.json(
        {
          error: 'Database unavailable — circuit breaker is OPEN',
          retryAfter,
          circuitBreaker: databaseCircuitBreaker.getStats(),
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

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

    const { searchParams } = request.nextUrl;
    const action = searchParams.get('action');

    // Stats endpoint is admin-only — keep behind analytics.read.
    if (action === 'stats') {
      assertCan(user!, 'analytics.read');
      const ingestStats = getIngestStats();
      const samplingConfig = getSamplingConfig();
      const bufferDetailedStats = telemetryBuffer.getDetailedStats();

      return NextResponse.json({
        ingest: ingestStats,
        sampling: samplingConfig,
        buffer: bufferDetailedStats,
        circuitBreaker: databaseCircuitBreaker.getStats(),
      });
    }

    // Read scope by role:
    // - OPERATOR / ASSISTANT see only telemetry for equipment they're
    //   crew-assigned to. We resolve the equipment ids up front and pass
    //   them as an explicit filter — never trust the client to scope itself.
    // - DISPATCHER / ADMIN keep the existing analytics.read gate.
    const role = user!.role;
    let allowedEquipmentIds: string[] | null = null;
    if (role === 'OPERATOR' || role === 'ASSISTANT') {
      const { listAllEquipment } = await import('@/modules/equipment');
      // Page through accessible equipment — typically small for an operator.
      const owned = await listAllEquipment(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
        { limit: 200, getNextCursor: () => null } as any,
        null,
        user!.id
      );
      allowedEquipmentIds = (owned as Array<{ id: string }>).map((e) => e.id);
      if (allowedEquipmentIds.length === 0) {
        return NextResponse.json({ records: [] });
      }
    } else {
      assertCan(user!, 'analytics.read');
    }

    // Default: query telemetry records
    const equipmentId = searchParams.get('equipmentId') || undefined;
    const siteId = searchParams.get('siteId') || undefined;
    const type = searchParams.get('type') || undefined;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from and to parameters required (ISO date)' },
        { status: 400 }
      );
    }

    if (allowedEquipmentIds && equipmentId && !allowedEquipmentIds.includes(equipmentId)) {
      return NextResponse.json(action === 'analysis' ? { analysis: [] } : { records: [] });
    }

    // Per-parameter aggregated analysis over the range (engine/hydraulics/etc.)
    if (action === 'analysis') {
      if (!equipmentId) {
        return NextResponse.json({ error: 'equipmentId required for analysis' }, { status: 400 });
      }
      const { getTelemetryAnalysis } = await import(
        '@/services/telemetry/telemetry-ingestion-service'
      );
      const analysis = await getTelemetryAnalysis({
        equipmentId,
        from: new Date(from),
        to: new Date(to),
      });
      return NextResponse.json({ analysis });
    }

    const { getTelemetryByRange } = await import(
      '@/services/telemetry/telemetry-ingestion-service'
    );
    const records = await getTelemetryByRange({
      equipmentId,
      siteId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
      type: type as any,
      from: new Date(from),
      to: new Date(to),
      limit,
      ...(allowedEquipmentIds && !equipmentId ? { equipmentIds: allowedEquipmentIds } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
    } as any);

    return NextResponse.json({ records });
}, { domain: 'telemetry' });

function assertAnyRole(user: { role: string }, roles: string[]) {
  if (!roles.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}
