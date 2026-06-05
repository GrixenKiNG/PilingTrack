import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { ChecklistLevel } from '@/generated/postgres-client';

export async function listTemplates(
  tenantId: string,
  filter: { level?: ChecklistLevel } = {},
) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.checklistTemplate.findMany({
    where: { tenantId, isActive: true, ...(filter.level ? { level: filter.level } : {}) },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
  });
}

export async function getTemplate(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const t = await db.checklistTemplate.findUnique({
    where: { id },
    include: { sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } } },
  });
  if (!t || t.tenantId !== tenantId) throw new ServiceError('Template not found', 404);
  return t;
}
