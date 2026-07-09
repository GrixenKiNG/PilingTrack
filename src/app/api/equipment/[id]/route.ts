import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getEquipmentByIdOrThrow, updateEquipment, updateEquipmentMetadata, deleteEquipment } from '@/modules/equipment';
import { equipmentManageSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const equipment = await getEquipmentByIdOrThrow(id, tenantId);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const body = await request.json();

    const validation = equipmentManageSchema.partial().safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    await updateEquipment({
      equipmentId: id,
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      isActive: validation.data.isActive,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      userId: user!.id,
      tenantId,
    });

    await updateEquipmentMetadata(id, validation.data);

    const equipment = await getEquipmentByIdOrThrow(id, tenantId);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const result = await deleteEquipment(id, tenantId);
    return NextResponse.json(result);
  },
  { domain: 'equipment' }
);
