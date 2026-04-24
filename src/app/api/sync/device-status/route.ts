/**
 * GET /api/sync/device-status?deviceId=xxx
 * POST /api/sync/device-status
 *
 * Per-device sync state management.
 *
 * GET — Returns sync status for a device.
 *   Admin can query any device; operators can only query their own.
 *
 * POST — Register/update device sync state.
 *   Admin can update any device; operators can only update their own.
 *
 * Request body (POST):
 * {
 *   "deviceId": "device-uuid",
 *   "tenantId": "tenant-uuid",  // optional, defaults to user's tenant
 *   "userId": "user-uuid"       // optional
 * }
 *
 * Response:
 * {
 *   "id": "...",
 *   "deviceId": "...",
 *   "tenantId": "...",
 *   "userId": "...",
 *   "lastSyncAt": "2026-04-07T10:00:00Z",
 *   "syncStatus": "idle",
 *   "lastError": null,
 *   "changesSent": 42,
 *   "changesRecv": 128,
 *   "createdAt": "...",
 *   "updatedAt": "..."
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getDeviceSyncStatus } from '@/modules/reports/application/sync-engine-v2';
import { withApi, withMutation } from '@/core/api-wrapper';
import { z } from 'zod';

export const runtime = 'nodejs';

async function getPostgresDb() {
  const { postgresDb } = await import('@/lib/db');
  return postgresDb;
}

// ============================================================
// GET /api/sync/device-status
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const sessionUser = user!;
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId');

  if (!deviceId) {
    return NextResponse.json(
      { error: 'deviceId query parameter is required' },
      { status: 400 }
    );
  }

  // Check if user has permission to view this device
  if (sessionUser.role !== 'ADMIN') {
    // For non-admin, we could validate ownership — for now allow if device exists
    // In production, you'd want to validate deviceId belongs to user's tenant
  }

  const status = await getDeviceSyncStatus(deviceId);

  // For non-admins, do not leak device existence across tenants — return 404 in both cases.
  if (!status || (sessionUser.role !== 'ADMIN' && status.tenantId !== sessionUser.tenantId)) {
    return NextResponse.json(
      { error: 'Device not found', deviceId },
      { status: 404 }
    );
  }

  return NextResponse.json(status);
}, { domain: 'sync' });

// ============================================================
// POST /api/sync/device-status
// ============================================================

const deviceStatusSchema = z.object({
  deviceId: z.string().min(1),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
});

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const sessionUser = user!;

  const body = await request.json();
  const validated = deviceStatusSchema.safeParse(body);
  if (!validated.success) {
    return NextResponse.json(
      { error: 'Validation error', details: validated.error.flatten() },
      { status: 400 }
    );
  }

  const { deviceId, tenantId: inputTenantId, userId: inputUserId } = validated.data;

  // Non-admins cannot set tenantId/userId — always derived from session.
  // Admins may target a specific tenant; if neither provided, fall back to session.
  const isAdmin = sessionUser.role === 'ADMIN';
  const tenantId = isAdmin
    ? (inputTenantId || sessionUser.tenantId)
    : sessionUser.tenantId;
  const userId = isAdmin ? (inputUserId || sessionUser.id) : sessionUser.id;

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Tenant context required' },
      { status: 400 }
    );
  }

  if (!isAdmin) {
    const postgresDb = await getPostgresDb();
    const existing = await postgresDb.deviceSyncState.findUnique({
      where: { deviceId },
      select: { tenantId: true },
    });
    // Block hijacking an existing device row that belongs to a different tenant.
    if (existing && existing.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Device not found', deviceId },
        { status: 404 }
      );
    }
  }

  const postgresDb = await getPostgresDb();
  const state = await postgresDb.deviceSyncState.upsert({
    where: { deviceId },
    update: {
      tenantId,
      userId: userId || null,
      lastSyncAt: new Date(),
    },
    create: {
      deviceId,
      tenantId,
      userId: userId || null,
      syncStatus: 'idle',
    },
  });

  return NextResponse.json(state, { status: 201 });
}, {
  domain: 'sync',
  rateLimit: { maxAttempts: 600, windowMs: 60_000, blockDurationMs: 60_000 },
});
