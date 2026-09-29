import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createSiteHierarchyItem, deleteSiteHierarchyItem } from '@/modules/sites';
import { siteHierarchyItemSchema, siteHierarchyDeleteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';


export const runtime = 'nodejs';

/**
 * Имя удаляемого узла читается ДО удаления (F-R34-15): после `delete` строки уже
 * нет, а «удалён пикет» без названия не сообщает, какую привязку выработки
 * потеряли. Строго по объекту и тенанту — как и сама команда; в metadata уходит
 * только имя, внутренний id элемента остаётся в itemId.
 */
async function readHierarchyItemName(
  siteId: string,
  tenantId: string,
  type: 'field' | 'cluster' | 'picket',
  itemId: string,
) {
  if (type === 'picket') {
    const item = await db.picket.findFirst({
      where: { id: itemId, cluster: { field: { siteId, site: { tenantId } } } },
      select: { name: true },
    });
    return item?.name ?? null;
  }
  if (type === 'cluster') {
    const item = await db.cluster.findFirst({
      where: { id: itemId, field: { siteId, site: { tenantId } } },
      select: { name: true },
    });
    return item?.name ?? null;
  }
  const item = await db.pileField.findFirst({
    where: { id: itemId, siteId, site: { tenantId } },
    select: { name: true },
  });
  return item?.name ?? null;
}

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.manage_hierarchy');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const { id } = await params;
    const body = await readJsonBody(request);
    const validated = siteHierarchyItemSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const item = await createSiteHierarchyItem({
      siteId: id,
      type: validated.data.type,
      name: validated.data.name,
      parentId: validated.data.parentId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    }, { tenantId, actorId: user!.id });
    await invalidateSites(tenantId);

    // След создания узла схемы объекта (F-R34-15): пикет — ключ привязки
    // выработки (PileWork.picketId), поэтому появление узла должно быть видно в
    // ленте. Узел уже создан — сбой записи следа не должен превращать успешное
    // создание в 500.
    try {
      await recordAuditEvent({
        action: 'site.hierarchy.created',
        scope: 'sites',
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        actorId: user!.id,
        targetId: id,
        tenantId,
        metadata: { type: validated.data.type, name: item.name, itemId: item.id },
      });
    } catch (err) {
      logger.error('Site hierarchy create: audit write failed', err, { siteId: id, itemId: item.id });
    }

    return NextResponse.json({ item });
  },
  { domain: 'sites' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.manage_hierarchy');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const { id } = await params;
    const body = await readJsonBody(request);
    const validated = siteHierarchyDeleteSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    // Имя узла читается до удаления: строка после `delete` исчезает, а след без
    // названия не отвечает, какой пикет/куст/поле убрали (F-R34-15).
    const itemName = await readHierarchyItemName(id, tenantId, validated.data.type, validated.data.itemId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const result = await deleteSiteHierarchyItem(id, validated.data.type, validated.data.itemId, { tenantId, actorId: user!.id });
    await invalidateSites(tenantId);

    // Узел уже удалён — сбой записи следа не должен превращать успешное удаление
    // в 500, иначе админ повторит запрос и получит 404 по уже удалённому узлу.
    try {
      await recordAuditEvent({
        action: 'site.hierarchy.deleted',
        scope: 'sites',
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        actorId: user!.id,
        targetId: id,
        tenantId,
        metadata: { type: validated.data.type, name: itemName, itemId: validated.data.itemId },
      });
    } catch (err) {
      logger.error('Site hierarchy delete: audit write failed', err, { siteId: id, itemId: validated.data.itemId });
    }

    return NextResponse.json(result);
  },
  { domain: 'sites' }
);
