/**
 * Report Command Service — CQRS Write Side
 *
 * The repository is the SINGLE write path. No duplicate persistence.
 *
 * Flow:
 * 1. Validation (fast, no DB)
 * 2. Authorization checks
 * 3. Load existing aggregate OR create new
 * 4. Apply commands through aggregate (business rules enforced)
 * 5. Submit (state transition: draft → submitted)
 * 6. Persist via repository (single transaction: data + outbox)
 * 7. Return persisted report with relations
 *
 * All business rules enforced by ReportAggregate.
 * No direct Prisma calls — repository owns persistence.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import {
  assertUserAssignedToSite,
  resolveAccessibleUserId,
  assertCanManageUserScope,
} from '@/services/auth/resource-access-service';
import { ReportAggregate } from '../../domain';
import { getReportRepository } from '../../infrastructure';
import { UpsertReportCommand, UpsertReportResult } from './upsert-report.command';
import { validateReportInput, validateAgainstSitePlans } from './report-validation.service';
import {
  writeReportAuditRow,
  recordPostCommitAuditEvent,
  computeDiff,
  type AuditRecord,
} from '@/services/reports/audit-service';

const EDIT_WINDOW_HOURS = 24;

// ============================================================
// Authorization helpers
// ============================================================

export function resolveReportUserId(
  sessionUser: { id: string; role: string },
  requestedUserId?: string | null
) {
  return resolveAccessibleUserId(sessionUser, requestedUserId, 'reports.read_cross_user');
}

export function assertCanActForUser(
  sessionUser: { id: string; role: string },
  targetUserId: string
) {
  assertCanManageUserScope(sessionUser, targetUserId, 'reports.manage_all');
}

// ============================================================
// Command
// ============================================================

/**
 * Report detail include for API responses.
 */
const REPORT_DETAIL_INCLUDE = {
  user: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  equipment: { select: { id: true, name: true } },
  crew: { select: { name: true } },
  piles: { include: { pileGrade: true } },
  drillings: { include: { type: true } },
  downtimes: { include: { reason: true } },
} as const;

/**
 * Create or update a report.
 *
 * The repository is the SINGLE write path — no duplicate persistence.
 */
export async function upsertReport(
  input: UpsertReportCommand,
  options: {
    enforceEditWindow: boolean;
    actor?: { id: string; name: string; role: string } | null;
  } = { enforceEditWindow: true }
): Promise<UpsertReportResult> {
  // Phase 1: Validation (fast, no DB)
  validateReportInput(input);
  await assertUserAssignedToSite(input.userId, input.siteId);

  // Phase 1.5: Validate against site plans
  await validateAgainstSitePlans(
    input.siteId,
    input.reportId,
    input.piles || [],
    (input.drillings || []).map(d => ({ typeId: d.typeId, count: d.count || 1, meters: d.meters }))
  );

  const repo = getReportRepository();

  // Phase 2: Load existing or create new aggregate.
  //
  // The Report table has @@unique([userId, siteId, date]) — one report per
  // operator per site per day. The client supplies its own reportId (used
  // as the idempotency token), so when a client retries with a different
  // reportId for the same natural key (mobile form regenerates UUID on
  // resubmit, offline outbox replays after server-side save, etc.) the
  // CREATE path would hit a P2002 unique-constraint and surface as 409.
  // Fall back to the natural key to honour the "one report per day" rule
  // and let the user edit the existing row instead of failing.
  let existing = await repo.findById(input.reportId);
  if (!existing) {
    existing = await repo.findByUserIdAndDate(input.userId, input.siteId, input.date);
    if (existing) {
      input.reportId = existing.getState().reportId;
    }
  }
  let aggregate: ReportAggregate;

  if (existing) {
    // Edit window check
    if (options.enforceEditWindow) {
      const existingState = existing.getState();
      const elapsedHours =
        (Date.now() - new Date(existingState.updatedAt).getTime()) / (1000 * 60 * 60);
      if (elapsedHours > EDIT_WINDOW_HOURS) {
        throw new ServiceError(
          `Окно редактирования истекло (${Math.floor(elapsedHours)}ч назад)`,
          403
        );
      }
    }

    // Reconstitute as draft with cleared child entries (they will be re-added)
    const existingState = existing.getState();
    aggregate = ReportAggregate.reconstitute({
      ...existingState,
      status: 'draft',
      piles: [],
      drillings: [],
      downtimes: [],
    });
  } else {
    aggregate = ReportAggregate.create({
      reportId: input.reportId,
      userId: input.userId,
      siteId: input.siteId,
      tenantId: input.tenantId,
      date: input.date,
      shiftType: input.shiftType,
      shiftStart: input.shiftStart,
      shiftEnd: input.shiftEnd,
      equipmentId: input.equipmentId,
    });
  }

  // Phase 3: Apply entries through aggregate (validates business rules)
  applyEntriesToAggregate(aggregate, input, options.actor);

  // Phase 4: Submit (draft → submitted)
  aggregate.submit(
    options.actor?.id || input.userId,
    options.actor?.name,
    options.actor?.role
  );

  // Phase 5: Persist via repository — SINGLE write path + in-tx audit hook.
  // The audit row is written inside the same transaction as the report and
  // outbox events, so auditing cannot diverge from persisted state (a crash
  // between save and audit used to leave reports with no audit trail).
  const action = existing ? 'updated' : 'created';
  const actorInfo = options.actor || { id: input.userId, name: '', role: '' };

  const auditRecord: AuditRecord = existing
    ? (() => {
        const oldState = existing.getState();
        const newState = aggregate.getState();
        return {
          reportId: input.reportId,
          action,
          userId: actorInfo.id,
          userName: actorInfo.name,
          userRole: actorInfo.role,
          oldData: oldState as Record<string, unknown>,
          newData: newState as Record<string, unknown>,
          diff: computeDiff(
            oldState as Record<string, unknown>,
            newState as Record<string, unknown>,
          ),
        };
      })()
    : {
        reportId: input.reportId,
        action,
        userId: actorInfo.id,
        userName: actorInfo.name,
        userRole: actorInfo.role,
        newData: aggregate.getState() as Record<string, unknown>,
      };

  await repo.save(aggregate, {
    onBeforeCommit: async (tx) => {
      await writeReportAuditRow(auditRecord, tx);
    },
  });

  // Phase 5.5: Post-commit audit side effects (structured logger + feedback
  // events). These don't need to be atomic with the save — if they fail,
  // the report is still persisted and the audit row is safely in place.
  await recordPostCommitAuditEvent(auditRecord);

  // Phase 6: Fetch the persisted report with relations for the response
  const report = await db.report.findUnique({
    where: { reportId: input.reportId },
    include: REPORT_DETAIL_INCLUDE,
  });

  if (!report) {
    throw new ServiceError('Report was saved but could not be retrieved', 500);
  }

  return {
    report,
    events: aggregate.getPendingEvents(),
    _action: existing ? 'updated' : 'created',
  };
}

// ============================================================
// Internal helpers
// ============================================================

function applyEntriesToAggregate(
  aggregate: ReportAggregate,
  input: UpsertReportCommand,
  actor: { id: string; name: string; role: string } | null | undefined
) {
  const userId = actor?.id || input.userId;

  aggregate.updateShiftInfo(
    {
      shiftStart: input.shiftStart,
      shiftEnd: input.shiftEnd,
      equipmentId: input.equipmentId,
      shiftType: input.shiftType,
    },
    userId
  );

  for (const pile of input.piles || []) {
    aggregate.addPileWork(pile, userId);
  }

  for (const drilling of input.drillings || []) {
    aggregate.addDrilling(
      {
        typeId: drilling.typeId,
        count: drilling.count || 1,
        metersPerUnit: drilling.metersPerUnit || 0,
        meters: drilling.meters,
        picketId: drilling.picketId,
      },
      userId
    );
  }

  for (const downtime of input.downtimes || []) {
    aggregate.addDowntime(downtime, userId);
  }
}
