/**
 * Audit Log Service — Immutable, Append-Only
 *
 * Records every significant action as an immutable audit trail.
 * Supports legal/compliance requirements for data integrity.
 *
 * Properties:
 * - Append-only (no UPDATE, no DELETE from application layer)
 * - Correlated via requestId (distributed tracing)
 * - Tenant-isolated for multi-tenant SaaS
 * - Queryable by entity, user, date range, action
 */

import { db } from '@/lib/db';

export interface AuditLogEntry {
  entity: string;
  action: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  tenantId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Record an immutable audit event.
 *
 * This is append-only — no updates, no deletes.
 * Safe to call from event handlers, API routes, workers.
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      entity: entry.entity,
      action: entry.action,
      entityId: entry.entityId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
      before: entry.before as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
      after: entry.after as any,
      userId: entry.userId || null,
      userName: entry.userName || null,
      userRole: entry.userRole || null,
      tenantId: entry.tenantId || null,
      requestId: entry.requestId || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
    },
  });
}

/**
 * Record audit log with before/after diff.
 */
export async function recordAuditLogWithDiff(entry: AuditLogEntry): Promise<void> {
  const diff = computeDiff(entry.before || null, entry.after || null);

  await recordAuditLog({
    ...entry,
    after: diff,
  });
}

/**
 * Query audit logs by entity.
 */
export async function getAuditLogsByEntity(
  entity: string,
  entityId: string,
  limit = 50
) {
  return db.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

/**
 * Query audit logs by user.
 */
export async function getAuditLogsByUser(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
  limit = 50
) {
  const where: Record<string, unknown> = { userId };

  if (dateFrom || dateTo) {
    where.timestamp = {};
    if (dateFrom) (where.timestamp as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.timestamp as Record<string, unknown>).lte = new Date(dateTo);
  }

  return db.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

/**
 * Query audit logs by tenant (admin).
 */
export async function getAuditLogsByTenant(
  tenantId: string,
  options?: {
    entity?: string;
    action?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }
) {
  const where: Record<string, unknown> = { tenantId };

  if (options?.entity) where.entity = options.entity;
  if (options?.action) where.action = options.action;

  if (options?.dateFrom || options?.dateTo) {
    where.timestamp = {};
    if (options.dateFrom) (where.timestamp as Record<string, unknown>).gte = new Date(options.dateFrom);
    if (options.dateTo) (where.timestamp as Record<string, unknown>).lte = new Date(options.dateTo);
  }

  return db.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: options?.limit || 100,
  });
}

/**
 * Get audit log stats for a tenant.
 */
export async function getAuditLogStats(tenantId?: string | null) {
  const where = tenantId ? { tenantId } : {};

  const [total, todayCount, actionBreakdown] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.count({
      where: {
        ...where,
        timestamp: { gte: new Date(new Date().toISOString().split('T')[0]) },
      },
    }),
    db.auditLog.groupBy({
      by: ['action'],
      where,
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take: 20,
    }),
  ]);

  return {
    total,
    todayCount,
    actionBreakdown: actionBreakdown.map((a) => ({
      action: a.action,
      count: a._count,
    })),
  };
}

/**
 * Compute shallow diff between two objects.
 */
function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  const allKeys = new Set([
    ...(before ? Object.keys(before) : []),
    ...(after ? Object.keys(after) : []),
  ]);

  for (const key of allKeys) {
    const oldVal = before?.[key];
    const newVal = after?.[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return diff;
}
