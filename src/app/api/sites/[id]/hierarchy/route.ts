import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createSiteHierarchyItem, deleteSiteHierarchyItem } from '@/modules/sites';
import { siteHierarchyItemSchema, siteHierarchyDeleteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.manage_hierarchy');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const { id } = await params;
    const body = await request.json();
    const validated = siteHierarchyItemSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
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
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const { id } = await params;
    const body = await request.json();
    const validated = siteHierarchyDeleteSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const result = await deleteSiteHierarchyItem(id, validated.data.type, validated.data.itemId, { tenantId, actorId: user!.id });
    await invalidateSites(tenantId);
    return NextResponse.json(result);
  },
  { domain: 'sites' }
);
