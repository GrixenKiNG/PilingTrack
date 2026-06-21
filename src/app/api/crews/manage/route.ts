import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createCrewSchema, crewManageSchema, crewIdSchema } from '@/lib/validation-schemas';
import { withDbProtection } from '@/core/infrastructure/circuit-breakers';
import { withMutation } from '@/core/api-wrapper';
import { invalidateCrewsCache } from '../cache';


export const runtime = 'nodejs';

async function getCrewsModule() {
  return import('@/modules/crews');
}

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.legacy_manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = createCrewSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { createCrew } = await getCrewsModule();
    const crew = await withDbProtection(async () =>
      createCrew({
        operatorId: validated.data.operatorId,
        equipmentId: validated.data.equipmentId,
        siteId: validated.data.siteId,
        name: validated.data.name || 'Unnamed Crew',
      })
    );

    invalidateCrewsCache();

    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);

export const PUT = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.legacy_manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = crewManageSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { updateCrew } = await getCrewsModule();
    const crew = await withDbProtection(async () =>
      updateCrew({
        crewId: validated.data.id!,
        name: validated.data.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
        isActive: (validated.data as any).isActive,
      })
    );

    invalidateCrewsCache();

    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.legacy_manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = crewIdSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { deleteCrew } = await getCrewsModule();
    const result = await withDbProtection(async () =>
      deleteCrew({ crewId: validated.data.id, force: true })
    );

    invalidateCrewsCache();

    return NextResponse.json(result);
  },
  { domain: 'crews' }
);
