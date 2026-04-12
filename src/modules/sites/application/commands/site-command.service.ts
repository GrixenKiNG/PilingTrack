/**
 * Site Command Service — CQRS Write Side
 */

import { db } from '@/lib/db';
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

  aggregate.update({
    name: command.name,
    plannedPiles: command.plannedPiles,
    plannedDrilling: command.plannedDrilling,
    completionDate: command.completionDate,
  }, command.userId);

  await repo.save(aggregate);

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
  if (!aggregate) throw new Error('Site not found');

  aggregate.deactivate(userId);
  await repo.save(aggregate);
}
