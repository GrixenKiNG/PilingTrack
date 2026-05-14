/**
 * POST /api/sync/v2
 *
 * FAANG-grade sync engine with:
 * - Version-based conflict resolution
 * - Idempotency (opId deduplication)
 * - Field-level merge for conflict auto-resolution
 * - Device tracking
 *
 * Request:
 * {
 *   "deviceId": "device-uuid",
 *   "tenantId": "tenant-uuid",
 *   "lastSyncAt": "2026-04-07T10:00:00Z",
 *   "changes": [
 *     {
 *       "entity": "report",
 *       "op": "upsert",
 *       "data": { "id": "...", "status": "draft", ... },
 *       "baseVersion": 3,
 *       "opId": "uuid"
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   "serverChanges": [...],
 *   "conflicts": [...],
 *   "newSyncAt": "2026-04-07T11:00:00Z",
 *   "syncStatus": "idle",
 *   "stats": { "applied": 5, "conflicts": 1, "skipped": 2 }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isPrivilegedRole } from '@/services/auth/authorization-service';
import { ServiceError } from '@/services/service-error';
import { handleSync, type SyncRequest } from '@/modules/reports/application/sync-engine-v2';
import { getRequestId } from '@/lib/request-context';
import { logger } from '@/lib/logger';
import { withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // Authorization — any authenticated user may sync. Per-row ownership
  // is enforced inside the sync engine: non-privileged actors can only
  // create/update/delete reports they own; ADMIN/DISPATCHER stay free.
  const isPrivileged = isPrivilegedRole(user!.role);

  const requestId = getRequestId(request);

  try {
    const body = await request.json();
    // Refuse the request if no tenant context can be resolved — silently
    // collapsing every tenant to the literal `'default'` string is how
    // cross-tenant data merging happens.
    const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant context required' },
        { status: 400, headers: { 'X-Request-Id': requestId || '' } }
      );
    }

    const syncRequest: SyncRequest = {
      deviceId: body.deviceId,
      tenantId,
      userId: user!.id,
      isPrivileged,
      lastSyncAt: body.lastSyncAt || '1970-01-01T00:00:00Z',
      changes: body.changes || [],
    };

    // Validate
    if (!syncRequest.deviceId) {
      return NextResponse.json(
        { error: 'deviceId is required' },
        { status: 400, headers: { 'X-Request-Id': requestId || '' } }
      );
    }

    if (!Array.isArray(syncRequest.changes)) {
      return NextResponse.json(
        { error: 'changes must be an array' },
        { status: 400, headers: { 'X-Request-Id': requestId || '' } }
      );
    }

    // Execute sync
    const result = await handleSync(syncRequest);

    return NextResponse.json(result, {
      headers: { 'X-Request-Id': requestId || '' },
    });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json(
        { error: caughtError.message },
        { status: caughtError.status, headers: { 'X-Request-Id': requestId || '' } }
      );
    }

    logger.error('sync v2: internal error', caughtError, { requestId });
    return NextResponse.json(
      { error: 'Internal sync error' },
      { status: 500, headers: { 'X-Request-Id': requestId || '' } }
    );
  }
}, { domain: 'sync', rateLimit: { maxAttempts: 600, windowMs: 60_000, blockDurationMs: 60_000 } });
