/**
 * Site Command Service — CQRS Write Side
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { recordAuditEvent } from '@/services/audit/audit-service';
import { SiteAggregate } from '../../domain';
import { getSiteRepository } from '../../infrastructure';
import { CreateSiteCommand, UpdateSiteCommand, SiteCommandContext } from './site.command';

export async function createSite(command: CreateSiteCommand) {
  const aggregate = SiteAggregate.create({
    name: command.name,
    tenantId: command.tenantId,
    plannedPiles: command.plannedPiles,
    plannedDrilling: command.plannedDrilling,
    completionDate: command.completionDate,
  }, command.userId);

  const repo = getSiteRepository();
  await repo.save(aggregate);

  return db.site.findUnique({
    where: { id: aggregate.getState().id },
    include: {
      users: { include: { user: { select: { id: true, name: true, email: true } } } },
      pilePlans: { include: { pileGrade: true } },
      drillingPlans: true,
    },
  });
}

export async function updateSite(command: UpdateSiteCommand, ctx: SiteCommandContext) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const repo = getSiteRepository();
  const aggregate = await repo.findById(command.siteId, ctx.tenantId);
  if (!aggregate) throw new ServiceError('Site not found', 404);

  const prev = aggregate.getState();
  const before = { name: prev.name, plannedPiles: prev.plannedPiles, plannedDrilling: prev.plannedDrilling };

  aggregate.update({
    name: command.name,
    plannedPiles: command.plannedPiles,
    plannedDrilling: command.plannedDrilling,
    completionDate: command.completionDate,
  }, ctx.actorId);

  await repo.save(aggregate);

  const next = aggregate.getState();
  await recordAuditEvent({
    action: 'site.updated',
    scope: 'sites',
    actorId: ctx.actorId,
    targetId: command.siteId,
    metadata: {
      before,
      after: { name: next.name, plannedPiles: next.plannedPiles, plannedDrilling: next.plannedDrilling },
    },
  });

  return db.site.findUnique({
    where: { id: command.siteId },
    include: {
      users: { include: { user: { select: { id: true, name: true, email: true } } } },
      pilePlans: { include: { pileGrade: true } },
      drillingPlans: true,
    },
  });
}

export async function activateSite(siteId: string, ctx: SiteCommandContext) {
  const repo = getSiteRepository();
  const aggregate = await repo.findById(siteId, ctx.tenantId);
  if (!aggregate) throw new ServiceError('Site not found', 404);

  // Already active — no-op. The edit form always sends `isActive`, so without
  // this guard every save would emit a phantom `site.activated` audit entry.
  if (aggregate.getState().isActive) return;

  aggregate.activate(ctx.actorId);
  await repo.save(aggregate);
  await recordAuditEvent({ action: 'site.activated', scope: 'sites', actorId: ctx.actorId, targetId: siteId,
    metadata: { tenantId: ctx.tenantId, name: aggregate.getState().name } });
}

export async function deactivateSite(siteId: string, ctx: SiteCommandContext) {
  const repo = getSiteRepository();
  const aggregate = await repo.findById(siteId, ctx.tenantId);
  if (!aggregate) throw new ServiceError('Site not found', 404);

  // Already inactive — no-op (skip the draft guard, write, and audit entry).
  if (!aggregate.getState().isActive) return;

  // Block deactivation while non-terminal work exists on this site.
  // 'draft' = in-progress reports; deactivating would orphan operator work.
  // 'submitted' reports are historical and don't block.
  const activeReports = await db.report.count({
    where: { siteId, status: 'draft' },
  });
  if (activeReports > 0) {
    throw new ServiceError(
      `Невозможно деактивировать объект: ${activeReports} незавершённых отчётов. Завершите или удалите их перед деактивацией.`,
      409,
    );
  }

  const name = aggregate.getState().name;
  aggregate.deactivate(ctx.actorId);
  await repo.save(aggregate);

  await recordAuditEvent({
    action: 'site.deactivated',
    scope: 'sites',
    actorId: ctx.actorId,
    targetId: siteId,
    metadata: { tenantId: ctx.tenantId, name },
  });
}
