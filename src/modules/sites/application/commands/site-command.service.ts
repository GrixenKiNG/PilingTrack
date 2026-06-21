/**
 * Site Command Service — CQRS Write Side
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { SiteAggregate } from '../../domain';
import { getSiteRepository } from '../../infrastructure';
import { CreateSiteCommand, UpdateSiteCommand } from './site.command';

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

export async function updateSite(command: UpdateSiteCommand) {
  const repo = getSiteRepository();
  const aggregate = await repo.findById(command.siteId);
  if (!aggregate) throw new Error('Site not found');

  const prev = aggregate.getState();
  const before = { name: prev.name, plannedPiles: prev.plannedPiles, plannedDrilling: prev.plannedDrilling };

  aggregate.update({
    name: command.name,
    plannedPiles: command.plannedPiles,
    plannedDrilling: command.plannedDrilling,
    completionDate: command.completionDate,
  }, command.userId);

  await repo.save(aggregate);

  const next = aggregate.getState();
  await recordAuditEvent({
    action: 'site.updated',
    scope: 'sites',
    actorId: command.userId || null,
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

export async function activateSite(siteId: string, userId?: string) {
  const repo = getSiteRepository();
  const aggregate = await repo.findById(siteId);
  if (!aggregate) throw new Error('Site not found');

  aggregate.activate(userId);
  await repo.save(aggregate);
}

export async function deactivateSite(siteId: string, userId?: string) {
  const repo = getSiteRepository();
  const aggregate = await repo.findById(siteId);
  if (!aggregate) throw new ServiceError('Site not found', 404);

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
  aggregate.deactivate(userId);
  await repo.save(aggregate);

  await recordAuditEvent({
    action: 'site.deactivated',
    scope: 'sites',
    actorId: userId || null,
    targetId: siteId,
    metadata: { name },
  });
}
