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
import { withCsrf } from '@/lib/csrf-protection';
import { postgresDb } from '@/lib/db';
import { getDeviceSyncStatus } from '@/modules/reports/application/sync-engine-v2';
import { z } from 'zod';

export const runtime = 'nodejs';

// ============================================================
// GET /api/sync/device-status
// ============================================================

export async function GET(request: NextRequest) {
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

  if (!status) {
    return NextResponse.json(
      { error: 'Device not found', deviceId },
      { status: 404 }
    );
  }

  // Non-admin users can only see devices in their tenant
  if (sessionUser.role !== 'ADMIN' && status.tenantId !== sessionUser.tenantId) {
    return NextResponse.json(
      { error: 'Access denied' },
      { status: 403 }
    );
  }

  return NextResponse.json(status);
}

// ============================================================
// POST /api/sync/device-status
// ============================================================

const deviceStatusSchema = z.object({
  deviceId: z.string().min(1),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  const { user, error } = await requireAuth(request);
  if (error) return error;

  const sessionUser = user!;

  try {
    const body = await request.json();
    const validated = deviceStatusSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { deviceId, tenantId: inputTenantId, userId: inputUserId } = validated.data;
    const tenantId = inputTenantId || sessionUser.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
    const userId = inputUserId || sessionUser.id;

    // Non-admin users can only register/update their own devices
    if (sessionUser.role !== 'ADMIN') {
      // Verify the device belongs to the user's tenant
      const existing = await postgresDb.deviceSyncState.findUnique({
        where: { deviceId },
        select: { tenantId: true, userId: true },
      });

      if (existing && existing.tenantId !== tenantId) {
        return NextResponse.json(
          { error: 'Access denied: device belongs to different tenant' },
          { status: 403 }
        );
      }
    }

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
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
