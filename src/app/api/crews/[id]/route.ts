import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';
import { updateCrewSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { invalidateCrewsCache } from '../cache';


export const runtime = 'nodejs';

async function getCrewsModule() {
  return import('@/modules/crews');
}

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'crews.read');
    const { id } = await params;
    const { getCrewById } = await getCrewsModule();
    const crew = await getCrewById(id);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    await ensureTenantAccess(user!, crew.site?.tenantId ?? null, 'Crew');
    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'crews.manage');
    const { id } = await params;
    const body = await request.json();
    const validated = updateCrewSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const { updateCrew } = await getCrewsModule();
    const crew = await updateCrew({
      crewId: id,
      name: validated.data.name,
      operatorId: validated.data.operatorId,
      equipmentId: validated.data.equipmentId,
      siteId: validated.data.siteId,
      assistantNames: validated.data.assistantNames,
      isActive: validated.data.isActive,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      userId: user!.id,
    });

    invalidateCrewsCache();

    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'crews.manage');
    const { id } = await params;
    const { deleteCrew } = await getCrewsModule();
    const result = await deleteCrew({ crewId: id });

    invalidateCrewsCache();

    return NextResponse.json(result);
  },
  { domain: 'crews' }
);
