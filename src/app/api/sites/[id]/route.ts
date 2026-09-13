import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { getSiteWithHierarchy, updateSite, activateSite, deactivateSite, hardDeleteSite } from '@/modules/sites';
import { updateSiteWithPlans, setSiteCompleted } from '@/modules/sites/application/commands';
import { updateSiteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const commandContext = { tenantId, actorId: user!.id };
    const { id } = await params;
    const body = await readJsonBody(request);
    const validated = updateSiteSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    // Планы пришли — значит их прислали, а не «оказались непустыми».
    // Пустой массив в JavaScript истинный, поэтому прежняя проверка на
    // истинность уводила в эту ветку каждое сохранение объекта и стирала
    // план вместе со строками. Явный пустой массив по-прежнему означает
    // «очистить план» — это осознанное действие, а не побочный эффект.
    const hasPlans = validated.data.pilePlans !== undefined
      || validated.data.drillingPlans !== undefined;
    
    let site;
    if (hasPlans) {
      // Use new function that handles plans
      site = await updateSiteWithPlans(id, {
        name: validated.data.name,
        plannedPiles: validated.data.plannedPiles,
        plannedDrilling: validated.data.plannedDrilling,
        latitude: validated.data.latitude,
        longitude: validated.data.longitude,
        pilePlans: validated.data.pilePlans,
        drillingPlans: validated.data.drillingPlans,
      }, commandContext);
    } else if (validated.data.name !== undefined || validated.data.plannedPiles !== undefined
      || validated.data.plannedDrilling !== undefined
      // Координаты — самостоятельный повод сохранить объект. Без них в этом
      // условии правка одних координат уходила бы в никуда: схема их
      // принимала, а обновление не вызывалось.
      || validated.data.latitude !== undefined || validated.data.longitude !== undefined) {
      // Use existing function for simple updates
      site = await updateSite({
        siteId: id,
        name: validated.data.name,
        plannedPiles: validated.data.plannedPiles,
        plannedDrilling: validated.data.plannedDrilling,
        latitude: validated.data.latitude,
        longitude: validated.data.longitude,
      }, commandContext);
    }

    if (validated.data.isActive !== undefined) {
      if (validated.data.isActive) await activateSite(id, commandContext);
      else await deactivateSite(id, commandContext);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      site = await getSiteWithHierarchy(user!, tenantId, id);
    }

    if (validated.data.completed !== undefined) {
      await setSiteCompleted(id, validated.data.completed, commandContext);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
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
