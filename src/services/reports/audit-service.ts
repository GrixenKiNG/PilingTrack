/**
 * Audit Trail Service
 * Records report changes via structured audit events.
 */

import { db } from '@/lib/db';
import { recordAuditEvent } from '@/services/audit/audit-service';

export interface AuditRecord {
  reportId: string;
  action: 'created' | 'updated' | 'submitted' | 'deleted';
  userId: string;
  userName?: string;
  userRole?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  diff?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  tenantId?: string | null;
}

/**
 * Write the structured ReportAudit row.
 * Pass `tx` when this must be atomic with the report save — otherwise uses
 * the default client (fire-and-forget for callers outside a transaction).
 */
export async function writeReportAuditRow(
  record: AuditRecord,
  tx?: { reportAudit?: { create: (args: unknown) => Promise<unknown> } },
): Promise<void> {
  const client = (tx ?? db) as any;
  // The reportAudit model may not yet be in the generated Prisma client in
  // some environments — skip silently if so.
  if (!client.reportAudit) return;
  await client.reportAudit.create({
    data: {
      reportId: record.reportId,
      actorId: record.userId,
      actorName: record.userName || null,
      actorRole: record.userRole || null,
      action: record.action,
      diff: record.diff || null,
      beforeHash: record.oldData ? hashState(record.oldData) : null,
      afterHash: record.newData ? hashState(record.newData) : null,
      ipAddress: record.ipAddress || null,
      userAgent: record.userAgent || null,
      requestId: record.requestId || null,
    },
  });
}

export async function recordAudit(record: AuditRecord): Promise<void> {
  // Non-transactional path — used when the caller couldn't hook into the
  // saving transaction. Prefer writeReportAuditRow(tx, record) when possible.
  await writeReportAuditRow(record);

  // General AuditLog + feedback events — best-effort, always post-commit.
  await recordAuditEvent({
    action: `report.${record.action}`,
    scope: 'reports',
    actorId: record.userId,
    targetId: record.reportId,
    tenantId: record.tenantId || null,
    metadata: {
      oldData: record.oldData || null,
      newData: record.newData || null,
      diff: record.diff || null,
      ipAddress: record.ipAddress || null,
      userAgent: record.userAgent || null,
    },
  });
}

/**
 * Post-commit side-effects for auditing (log trail + feedback events).
 * These are NOT in-transaction and may run after repo.save() resolves.
 */
export async function recordPostCommitAuditEvent(record: AuditRecord): Promise<void> {
  await recordAuditEvent({
    action: `report.${record.action}`,
    scope: 'reports',
    actorId: record.userId,
    targetId: record.reportId,
    tenantId: record.tenantId || null,
    metadata: {
      oldData: record.oldData || null,
      newData: record.newData || null,
      diff: record.diff || null,
      ipAddress: record.ipAddress || null,
      userAgent: record.userAgent || null,
    },
  });
}

/**
 * Compute a simple hash of a JSON object for integrity verification.
 */
function hashState(obj: Record<string, unknown>): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

export function computeDiff(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown> | null
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  const allKeys = new Set([
    ...(oldObj ? Object.keys(oldObj) : []),
    ...(newObj ? Object.keys(newObj) : []),
  ]);

  for (const key of allKeys) {
    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return diff;
}
