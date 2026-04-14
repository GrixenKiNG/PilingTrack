import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { getSiteWithHierarchy, updateSite, deactivateSite } from '@/modules/sites';
import { updateSiteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withApi, withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    const site = await getSiteWithHierarchy(user!, id);
    if (!site) throw new ServiceError('Site not found', 404);
    return NextResponse.json({ site });
  },
  { domain: 'sites', cache: true, cacheTTL: 30_000 }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'sites.manage');
    const { id } = await params;
    const body = await request.json();
    const validated = updateSiteSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const site = await updateSite({
      siteId: id,
      name: validated.data.name,
      plannedPiles: validated.data.plannedPiles,
      plannedDrilling: validated.data.plannedDrilling,
      completionDate: (validated.data as any).completionDate,
      userId: user!.id,
    });
    await invalidateSites();
    return NextResponse.json({ site });
  },
  { domain: 'sites' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'sites.manage');
    const { id } = await params;
    await deactivateSite(id, user!.id);
    await invalidateSites();
    return NextResponse.json({ ok: true, siteId: id });
  },
  { domain: 'sites' }
);
