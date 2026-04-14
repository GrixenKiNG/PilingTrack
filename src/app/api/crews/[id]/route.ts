import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';
import { deleteCrew, getCrewById, updateCrew } from '@/modules/crews';
import { updateCrewSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.read');
    const { id } = await params;
    const crew = await getCrewById(id);
    await ensureTenantAccess(user!, crew.site?.tenantId ?? null, 'Crew');
    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

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
    const crew = await updateCrew({
      crewId: id,
      name: validated.data.name,
      isActive: (validated.data as any).isActive,
      userId: validated.data.operatorId,
    });
    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.manage');
    const { id } = await params;
    const result = await deleteCrew({ crewId: id });
    return NextResponse.json(result);
  },
  { domain: 'crews' }
);
