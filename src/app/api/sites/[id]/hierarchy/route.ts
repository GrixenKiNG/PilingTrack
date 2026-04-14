import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createSiteHierarchyItem, deleteSiteHierarchyItem } from '@/modules/sites';
import { siteHierarchyItemSchema, siteHierarchyDeleteSchema } from '@/lib/validation-schemas';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'sites.manage_hierarchy');
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
    });
    return NextResponse.json({ item });
  },
  { domain: 'sites' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'sites.manage_hierarchy');
    await params;
    const body = await request.json();
    const validated = siteHierarchyDeleteSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const result = await deleteSiteHierarchyItem((validated.data as any).type, (validated.data as any).itemId);
    return NextResponse.json(result);
  },
  { domain: 'sites' }
);
