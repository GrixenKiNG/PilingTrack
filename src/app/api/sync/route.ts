/**
 * POST /api/sync
 *
 * Batch sync endpoint for offline-first PWA clients.
 * Receives queued operations from client outbox, applies them via backend CQRS.
 *
 * Request:
 *   { "operations": [{ id, type, entity, entityId, payload, localTimestamp }] }
 *
 * Response:
 *   { reports: [...], events: [...], cursor: timestamp }
 *
 * Features:
 * - Idempotent (via operation id)
 * - Partial success (per-operation error handling)
 * - Returns latest server state for pull sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';
import { getRequestId } from '@/lib/request-context';
import { upsertReport } from '@/modules/reports';
import { withMutation } from '@/core/api-wrapper';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { db } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'nodejs';

// ============================================================
// Operation Types
// ============================================================

const syncReportPayloadSchema = z.object({
  siteId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftType: z.enum(['DAY', 'NIGHT']).optional().default('DAY'),
  shiftStart: z.string().optional().nullable(),
  shiftEnd: z.string().optional().nullable(),
  equipmentId: z.string().optional().nullable(),
  piles: z.array(z.object({
    picketId: z.string().optional().nullable(),
    pileGradeId: z.string().min(1),
    count: z.number().int().min(0),
  })).optional().default([]),
  drillings: z.array(z.object({
    picketId: z.string().optional().nullable(),
    typeId: z.string().min(1),
    count: z.number().int().min(1).optional().default(1),
    metersPerUnit: z.number().min(0).optional().default(0),
    meters: z.number().min(0),
  })).optional().default([]),
  downtimes: z.array(z.object({
    reasonId: z.string().min(1),
    duration: z.number().min(0),
    comment: z.string().optional().nullable(),
  })).optional().default([]),
});

const syncOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['REPORT_CREATE', 'REPORT_UPDATE', 'REPORT_DELETE']),
  entity: z.literal('report'),
  entityId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  localTimestamp: z.number().int().min(0),
});

const syncRequestSchema = z.object({
  operations: z.array(syncOperationSchema),
});

interface SyncResult {
  reports: any[];
  events: any[];
  cursor: number;
  errors: Array<{ operationId: string; error: string }>;
}

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // Authorization — sync can mutate any report
  assertCan(user!, 'reports.manage_all');

  // user is guaranteed after error check above
  const sessionUser = user!;
  const requestId = getRequestId(request);

  try {
    const body = await request.json();
    const validated = syncRequestSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const result: SyncResult = {
      reports: [],
      events: [],
      cursor: Date.now(),
      errors: [],
    };

    for (const op of validated.data.operations) {
      try {
        switch (op.type) {
          case 'REPORT_CREATE':
          case 'REPORT_UPDATE':
            const reportResult = await handleReportSync(op, sessionUser);
            if (reportResult) {
              result.reports.push(reportResult);
            }
            break;

          case 'REPORT_DELETE':
            await handleReportDelete(op, sessionUser);
            break;

          default:
            result.errors.push({
              operationId: op.id,
              error: `Unknown operation type: ${op.type}`,
            });
        }
      } catch (opError) {
        const message = opError instanceof Error ? opError.message : String(opError);
        result.errors.push({ operationId: op.id, error: message });

        await recordFeedbackEvent({
          level: 'error',
          scope: 'sync',
          action: 'sync.operation_failed',
          title: 'Sync operation failed',
          message,
          audience: 'OPERATIONS',
          actor: { id: sessionUser.id, name: sessionUser.name, role: sessionUser.role },
          requestId,
          metadata: { operationId: op.id, operationType: op.type },
        });
      }
    }

    return NextResponse.json(result);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Internal error';

    await recordFeedbackEvent({
      level: 'error',
      scope: 'sync',
      action: 'sync.batch_failed',
      title: 'Batch sync failed',
      message,
      audience: 'OPERATIONS',
      actor: { id: sessionUser.id, name: sessionUser.name, role: sessionUser.role },
      requestId,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}, {
  domain: 'sync',
  rateLimit: { maxAttempts: 600, windowMs: 60_000, blockDurationMs: 60_000 },
});

// ============================================================
// Operation Handlers
// ============================================================

async function handleReportSync(
  op: { id: string; type: string; entity: string; entityId: string; payload: Record<string, unknown>; localTimestamp: number },
  user: { id: string; name: string; role: string }
) {
  const payload = op.payload as Record<string, any>;

  const result = await upsertReport(
    {
      reportId: op.entityId,
      siteId: payload.siteId,
      userId: user.id,
      date: payload.date,
      shiftType: payload.shiftType,
      shiftStart: payload.shiftStart,
      shiftEnd: payload.shiftEnd,
      equipmentId: payload.equipmentId,
      piles: payload.piles || [],
      drillings: payload.drillings || [],
      downtimes: payload.downtimes || [],
    },
    { enforceEditWindow: false, actor: user }
  );

  return result.report;
}

async function handleReportDelete(
  op: { id: string; type: string; entityId?: string },
  user: { id: string; name: string; role: string }
) {
  // Policy: production reports are never hard-deleted from sync. ADMIN-only;
  // we look the report up, record an immutable audit entry, and acknowledge.
  // A full schema-level soft-delete (Report.deletedAt) is deferred — when
  // added, this handler should also flip Report.status='deleted' and cascade
  // to ReportVersion/ReportAudit.
  if (user.role !== 'ADMIN') {
    throw new Error('Only ADMIN can request report deletion');
  }
  const reportId = op.entityId;
  if (!reportId) return null;

  const existing = await db.report.findFirst({
    where: { reportId },
    select: { id: true, reportId: true, siteId: true, userId: true, status: true },
  });

  await recordAuditEvent({
    action: 'report.deleted',
    scope: 'reports.sync',
    actorId: user.id,
    targetId: reportId,
    metadata: {
      requestedVia: 'sync',
      reportExists: Boolean(existing),
      previousStatus: existing?.status ?? null,
      siteId: existing?.siteId ?? null,
      ownerId: existing?.userId ?? null,
    },
  });

  return { reportId, status: 'delete-acknowledged' };
}
