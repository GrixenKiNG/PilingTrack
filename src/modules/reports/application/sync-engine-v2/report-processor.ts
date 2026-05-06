import { db } from '@/lib/db';
import {
  createReportConflictEngine,
  type ConflictContext,
} from '@/core/conflict-resolution';
import { VectorClock, determineConflictType } from '@/core/shared/sync/vector-clock';
import type { Conflict, LocalChange } from '@/core/shared/types/sync';
import { isIdempotent, recordIdempotency } from './idempotency';

export async function processReportChange(
  change: LocalChange,
  tenantId: string
): Promise<{ applied: boolean; conflict?: Conflict }> {
  const { data, baseVersion, op, opId, vectorClock: clientVC } = change;
  const reportData = data as Record<string, unknown>;
  const reportId = reportData.id as string;

  // Idempotency check
  if (await isIdempotent(opId)) {
    return { applied: false };
  }

  const existing = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, version: true, status: true, vectorClock: true },
  });

  // CREATE
  if (!existing) {
    if (op === 'delete') {
      return { applied: false };
    }

    const vc = clientVC || { [reportData.deviceId as string || 'server']: 1 };

    await db.$transaction([
      db.report.create({
        data: {
          id: reportId,
          reportId: (reportData.reportId as string) || reportId,
          tenantId,
          version: 1,
          status: (reportData.status as string) || 'draft',
          userId: reportData.userId as string,
          siteId: reportData.siteId as string,
          date: reportData.date as string,
          shiftType: (reportData.shiftType as string) || 'day',
          shiftStart: (reportData.shiftStart as string) || null,
          shiftEnd: (reportData.shiftEnd as string) || null,
          equipmentId: (reportData.equipmentId as string) || null,
          vectorClock: vc,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      }),
      db.reportVersion.create({
        data: {
          reportId,
          version: 1,
          data: reportData as any,
          actorId: (reportData.userId as string) || 'sync',
        },
      }),
    ]);

    await recordIdempotency(opId, 'report.create');
    return { applied: true };
  }

  // CONFLICT DETECTION — Vector Clock + Conflict Resolution Engine
  const serverVC = (existing.vectorClock || {}) as Record<string, number>;
  const conflictType = clientVC
    ? determineConflictType(clientVC, serverVC)
    : 'no_conflict';

  const hasVersionConflict = baseVersion < existing.version;
  const hasConcurrentConflict = conflictType === 'concurrent';

  if (hasVersionConflict || hasConcurrentConflict) {
    const serverFull = await db.report.findUnique({ where: { id: reportId } });

    if (!serverFull) {
      return { applied: false };
    }

    const engine = createReportConflictEngine();
    const ctx: ConflictContext = {
      entityId: reportId,
      entityType: 'report',
      clientData: reportData,
      serverData: serverFull as Record<string, unknown>,
      clientVectorClock: clientVC,
      serverVectorClock: serverVC,
      clientVersion: baseVersion,
      serverVersion: existing.version,
      deviceId: ((change.data as Record<string, unknown>)?.deviceId as string) || 'unknown',
      tenantId,
      userId: (reportData.userId as string) || 'unknown',
    };

    const resolution = engine.resolve(ctx);
    const resolved = resolution.merged;
    const mergedVC = resolution.vectorClock;

    // Persist conflict audit trail (best-effort)
    try {
      await db.conflictAudit.create({
        data: {
          entityId: reportId,
          entityType: 'report',
          conflictType: hasConcurrentConflict ? 'concurrent' : 'version',
          resolutionStrategy: resolution.strategy,
          fieldsInConflict: resolution.auditEntry.fieldsInConflict as any,
          resolutionDetails: resolution.auditEntry.resolutionDetails as any,
          deviceId: ctx.deviceId,
          tenantId,
          userId: ctx.userId,
          clientVersion: baseVersion,
          serverVersion: existing.version,
          clientVectorClock: clientVC as any,
          serverVectorClock: serverVC as any,
        },
      });
    } catch {
      // Non-fatal — conflict resolution succeeded, audit log best-effort
    }

    const newVersion = existing.version + 1;
    await db.report.update({
      where: { id: reportId },
      data: {
        ...resolved,
        version: newVersion,
        vectorClock: mergedVC,
        updatedAt: new Date(),
      },
    });

    await db.reportVersion.create({
      data: {
        reportId,
        version: newVersion,
        data: {
          ...resolved,
          conflictResolved: true,
          strategy: resolution.strategy,
        } as any,
        actorId: ctx.userId,
      },
    });

    await recordIdempotency(opId, 'report.update.conflict_resolved');
    return {
      applied: true,
      conflict: {
        entity: 'report',
        clientData: reportData,
        serverData: serverFull,
        reason: hasConcurrentConflict ? 'concurrent_modification' : 'version_conflict',
        conflictType: hasConcurrentConflict ? 'concurrent' : 'version_conflict',
        resolvedData: resolved,
        vectorClock: mergedVC,
      },
    };
  }

  // NORMAL UPDATE
  if (op === 'upsert') {
    const newVersion = existing.version + 1;

    let mergedVC: Record<string, number>;
    if (clientVC) {
      mergedVC = VectorClock.mergeClocks(clientVC, serverVC);
      const serverVCObj = new VectorClock('server', mergedVC);
      serverVCObj.increment();
      mergedVC = serverVCObj.snapshot();
    } else {
      mergedVC = serverVC;
    }

    await db.$transaction([
      db.report.update({
        where: { id: reportId },
        data: {
          version: newVersion,
          status: (reportData.status as string) || existing.status,
          vectorClock: mergedVC,
          updatedAt: new Date(),
        },
      }),
      db.reportVersion.create({
        data: {
          reportId,
          version: newVersion,
          data: {
            ...reportData,
            vectorClock: mergedVC,
          } as any,
          actorId: (reportData.userId as string) || 'sync',
        },
      }),
    ]);
  }

  // DELETE
  if (op === 'delete') {
    await db.report.delete({ where: { id: reportId } });
  }

  await recordIdempotency(opId, `report.${op}`);
  return { applied: true };
}
