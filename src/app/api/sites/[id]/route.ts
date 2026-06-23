import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { getSiteWithHierarchy, updateSite, activateSite, deactivateSite, hardDeleteSite } from '@/modules/sites';
import { updateSiteWithPlans, setSiteCompleted } from '@/modules/sites/application/commands';
import { updateSiteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withApi, withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const site = await getSiteWithHierarchy(user!, tenantId, id);
    if (!site) throw new ServiceError('Site not found', 404);
    return NextResponse.json({ site });
  },
  { domain: 'sites', cache: true, cacheTTL: 30_000 }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const commandContext = { tenantId, actorId: user!.id };
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
        pilePlans: validated.data.pilePlans,
        drillingPlans: validated.data.drillingPlans,
      }, commandContext);
    } else if (validated.data.name !== undefined || validated.data.plannedPiles !== undefined || validated.data.plannedDrilling !== undefined) {
      // Use existing function for simple updates
      site = await updateSite({
        siteId: id,
        name: validated.data.name,
        plannedPiles: validated.data.plannedPiles,
        plannedDrilling: validated.data.plannedDrilling,
      }, commandContext);
    }

    if (validated.data.isActive !== undefined) {
      if (validated.data.isActive) await activateSite(id, commandContext);
      else await deactivateSite(id, commandContext);
      site = await getSiteWithHierarchy(user!, tenantId, id);
    }

    if (validated.data.completed !== undefined) {
      await setSiteCompleted(id, validated.data.completed, commandContext);
      site = await getSiteWithHierarchy(user!, tenantId, id);
    }

    await invalidateSites(tenantId);
    return NextResponse.json({ site });
  },
  { domain: 'sites' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const { id } = await params;
    // Permanent delete — only succeeds for erroneously created sites (0 crews,
    // 0 reports). Worked sites must be deactivated via PUT { isActive: false }.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    await hardDeleteSite(id, { tenantId, actorId: user!.id });
    await invalidateSites(tenantId);
    return NextResponse.json({ ok: true, siteId: id });
  },
  { domain: 'sites' }
);
