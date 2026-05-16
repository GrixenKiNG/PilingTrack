/**
 * IoT Telemetry Ingestion — MQTT Gateway
 *
 * Provides HTTP endpoint for IoT devices to push telemetry data.
 * Designed for future MQTT broker integration (Mosquitto, EMQX).
 *
 * Current flow:
 *   Device → HTTP POST /api/telemetry/ingest → Validate → Store → Ack
 *
 * Future flow (MQTT):
 *   Device → MQTT Publish → MQTT Broker → Webhook → Ingestion
 *
 * Supports:
 * - Pile strike detection
 * - Drilling depth monitoring
 * - Equipment GPS tracking
 * - Cycle time measurement
 * - Pressure & vibration sensors
 *
 * Authentication:
 * - Device API key (X-Device-Key header)
 * - Or JWT token from device identity provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, createJsonResponse } from '@/lib/request-context';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { withApi } from '@/core/api-wrapper';
import { authenticateDeviceByKey } from '@/services/telemetry/device-key-service';

export const runtime = 'nodejs';

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

// ============================================================
// Rate Limiting — High throughput for IoT devices
// ============================================================

const TELEMETRY_RATE_LIMIT = {
  maxAttempts: 500,
  windowMs: 60_000, // 500 requests per minute per device
  blockDurationMs: 300_000, // 5 minutes block
};

// ============================================================
// Device Authentication
// ============================================================

interface DeviceIdentity {
  deviceKeyId: string;
  equipmentId: string;
  siteId: string | null;
  tenantId: string | null;
}

async function authenticateDevice(
  request: NextRequest
): Promise<{ identity: DeviceIdentity | null; error?: Response }> {
  const deviceKey = request.headers.get('x-device-key');

  if (!deviceKey) {
    return {
      identity: null,
      error: createJsonResponse(
        { error: 'Device authentication required (X-Device-Key header)' },
        { status: 401 },
        getRequestId(request)
      ),
    };
  }

  const authed = await authenticateDeviceByKey(deviceKey);
  if (!authed) {
    return {
      identity: null,
      error: createJsonResponse(
        { error: 'Invalid or revoked device key' },
        { status: 403 },
        getRequestId(request)
      ),
    };
  }

  return { identity: authed };
}

// ============================================================
// Telemetry Ingestion
// ============================================================

export const POST = withApi(async (request: NextRequest) => {
  const requestId = getRequestId(request);

  // Rate limiting (device-specific, higher than default)
  const identifier = getRateLimitIdentifier(request);
  const rl = await rateLimiter.check(identifier, TELEMETRY_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
    );
  }

  // Device authentication
  const { identity, error } = await authenticateDevice(request);
  if (!identity) return error as NextResponse;

  const body = await request.json();

  // Validate telemetry payload
  const validation = validateTelemetry(body);
  if (!validation.valid) {
    return createJsonResponse(
      { error: 'Invalid telemetry data', details: validation.errors, requestId },
      { status: 400 },
      requestId
    );
  }

  // Store telemetry records
  const records = await ingestTelemetry(identity, body);

  return createJsonResponse(
    { accepted: records.length, requestId },
    { status: 202 },
    requestId
  );
}, { domain: 'telemetry' });

// ============================================================
// Batch Ingestion
// ============================================================

export const PATCH = withApi(async (request: NextRequest) => {
  const requestId = getRequestId(request);

  const identifier = getRateLimitIdentifier(request);
  const rl = await rateLimiter.check(identifier, TELEMETRY_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
    );
  }

  const { identity, error } = await authenticateDevice(request);
  if (!identity) return error as NextResponse;

  const body = await request.json();

  if (!Array.isArray(body)) {
    return createJsonResponse(
      { error: 'Expected array of telemetry records' },
      { status: 400 },
      requestId
    );
  }

  if (body.length > 1000) {
    return createJsonResponse(
      { error: 'Batch too large: max 1000 records per request', count: body.length },
      { status: 413 },
      requestId
    );
  }

  const errors: Array<{ index: number; errors: string[] }> = [];
  for (let i = 0; i < body.length; i++) {
    const validation = validateTelemetry(body[i]);
    if (!validation.valid) {
      errors.push({ index: i, errors: validation.errors });
    }
  }

  if (errors.length > 0) {
    return createJsonResponse(
      { error: `${errors.length} invalid records`, details: errors.slice(0, 5), requestId },
      { status: 400 },
      requestId
    );
  }

  const records = await ingestTelemetry(identity, body);

  return createJsonResponse(
    { accepted: records.length, total: body.length, requestId },
    { status: 202 },
    requestId
  );
}, { domain: 'telemetry' });

// ============================================================
// Telemetry Validation
// ============================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateTelemetry(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid data structure'] };
  }

  const telemetry = data as Record<string, unknown>;

  // Required fields
  if (!telemetry.type || typeof telemetry.type !== 'string') {
    errors.push('type is required and must be string');
  }

  if (telemetry.value === undefined || telemetry.value === null) {
    errors.push('value is required');
  } else if (typeof telemetry.value !== 'number') {
    errors.push('value must be a number');
  }

  // Valid telemetry types.
  // The first block is pile/drilling-specific data we already accept.
  // The second block was added for aftermarket Teltonika / Galileosky
  // boxes that decode J1939 from the carrier machine — we'll see those
  // as soon as a TelematicsDevice ships its first batch.
  const validTypes = [
    // Domain-specific
    'pile_strike',
    'drilling_depth',
    'equipment_gps',
    'cycle_time',
    'pressure',
    'vibration',
    'temperature',
    'fuel_level',
    'engine_hours',
    'impact_force',
    // Aftermarket box / J1939 / engine ECU
    'engine_on',
    'engine_load',
    'coolant_temp',
    'oil_pressure',
    'idle_time',
    'dtc_code',
  ];

  if (telemetry.type && !validTypes.includes(telemetry.type as string)) {
    errors.push(`Invalid type: ${telemetry.type}. Valid types: ${validTypes.join(', ')}`);
  }

  // GPS coordinates validation
  if (telemetry.latitude !== undefined) {
    const lat = Number(telemetry.latitude);
    if (lat < -90 || lat > 90) {
      errors.push('latitude must be between -90 and 90');
    }
  }

  if (telemetry.longitude !== undefined) {
    const lon = Number(telemetry.longitude);
    if (lon < -180 || lon > 180) {
      errors.push('longitude must be between -180 and 180');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================
// Telemetry Ingestion
// ============================================================

async function ingestTelemetry(identity: DeviceIdentity, data: unknown | unknown[]) {
  const records = Array.isArray(data) ? data : [data];

  // equipmentId and siteId are derived from authenticated device identity,
  // never from the request body — otherwise an attacker holding a single
  // device key could write telemetry against any equipment/site.
  const telemetryRecords = records.map((record: unknown) => {
    const r = record as Record<string, unknown>;
    return {
      type: r.type as string,
      equipmentId: identity.equipmentId,
      siteId: identity.siteId,
      value: Number(r.value),
      unit: (r.unit as string) || null,
      latitude: r.latitude ? Number(r.latitude) : null,
      longitude: r.longitude ? Number(r.longitude) : null,
      metadata: r.metadata ?? null,
      timestamp: r.timestamp ? new Date(r.timestamp as string) : undefined,
    };
  });

  // Prisma's InputJsonValue/NullableJsonNullValueInput typing is too strict for
  // dynamic JSON metadata; values are already validated at the route boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = await getDbClient();
  await db.telemetryRecord.createMany({ data: telemetryRecords as any });

  return telemetryRecords;
}

// ============================================================
// Health Check for IoT Devices
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
  const requestId = getRequestId(request);

  return createJsonResponse({
    status: 'ok',
    service: 'iot-telemetry',
    version: '1.0.0',
    endpoints: {
      ingest: 'POST /api/telemetry/ingest',
      batch: 'PATCH /api/telemetry/ingest',
    },
    requestId,
  }, { status: 200 }, requestId);
}, { domain: 'telemetry' });
