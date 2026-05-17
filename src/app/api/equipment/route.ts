import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createEquipment, listAllEquipment, updateEquipmentMetadata } from '@/modules/equipment';
import { createEquipmentSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const siteId = request.nextUrl.searchParams.get('siteId');
    const operatorUserId = user!.role === 'OPERATOR' ? user!.id : null;
    const equipment = await listAllEquipment(pagination, siteId, operatorUserId);
    const nextCursor = pagination.getNextCursor(equipment);
    return NextResponse.json({ data: equipment, nextCursor });
  },
  { domain: 'equipment', cache: true, cacheTTL: 60_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const body = await request.json();

    const validation = createEquipmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await createEquipment({
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      userId: user!.id,
    });

    // Apply template metadata in the same request — operators usually
    // fill the whole form in one go via the multi-tab edit dialog.
    if (equipment) {
      await updateEquipmentMetadata(equipment.id, validation.data);
    }

    return NextResponse.json({ equipment }, { status: 201 });
  },
  { domain: 'equipment' }
);
