import { db } from '@/lib/db';
import type { EntityType, OperationType, ServerChange } from '@/core/shared/types/sync';

export async function getServerChanges(
  tenantId: string,
  lastSyncAt: string
): Promise<ServerChange[]> {
  const since = new Date(lastSyncAt);

  const reports = await db.report.findMany({
    where: {
      tenantId,
      updatedAt: { gt: since },
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      siteId: true,
      date: true,
      status: true,
      version: true,
      vectorClock: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: 500,
  });

  return reports.map((r: any) => ({
    entity: 'report' as EntityType,
    op: 'upsert' as OperationType,
    data: r,
    vectorClock: r.vectorClock || undefined,
  }));
}
