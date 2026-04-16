import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { getSiteWithHierarchy, updateSite, deactivateSite } from '@/modules/sites';
import { updateSiteWithPlans } from '@/modules/sites/application/commands';
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

    // Check if plans are included
    const hasPlans = validated.data.pilePlans || validated.data.drillingPlans;
    
    let site;
    if (hasPlans) {
      // Use new function that handles plans
      site = await updateSiteWithPlans(id, {
        name: validated.data.name,
        plannedPiles: validated.data.plannedPiles,
        plannedDrilling: validated.data.plannedDrilling,
        completionDate: validated.data.completionDate,
        pilePlans: validated.data.pilePlans,
        drillingPlans: validated.data.drillingPlans,
      });
    } else {
      // Use existing function for simple updates
      site = await updateSite({
        siteId: id,
        name: validated.data.name,
        plannedPiles: validated.data.plannedPiles,
        plannedDrilling: validated.data.plannedDrilling,
        completionDate: validated.data.completionDate,
        userId: user!.id,
      });
    }
    
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
