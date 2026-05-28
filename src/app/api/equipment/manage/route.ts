import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createEquipment, updateEquipment, deleteEquipment } from '@/modules/equipment';
import { equipmentManageSchema, equipmentIdSchema } from '@/lib/validation-schemas';
import { withMutation } from '@/core/api-wrapper';
import { withDbProtection } from '@/core/infrastructure/circuit-breakers';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = equipmentManageSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await withDbProtection(async () =>
      createEquipment({
        name: validation.data.name,
        model: validation.data.model,
        qty: validation.data.qty,
        description: validation.data.description,
        userId: user!.id,
        tenantId,
      })
    );

    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const PUT = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = equipmentManageSchema.safeParse(body);
    if (!validation.success || !validation.data.id) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.success ? [{ field: 'id', message: 'ID is required for updates' }] : validation.error.issues },
        { status: 400 }
      );
    }

    const equipmentId = validation.data.id!;
    await withDbProtection(async () =>
      updateEquipment({
        equipmentId,
        name: validation.data.name,
        model: validation.data.model || undefined,
        qty: validation.data.qty,
        description: validation.data.description || undefined,
        userId: user!.id,
        tenantId,
      })
    );

    return NextResponse.json({ success: true });
  },
  { domain: 'equipment' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = equipmentIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const result = await withDbProtection(async () =>
      deleteEquipment(validation.data.id, tenantId)
    );
    return NextResponse.json(result);
  },
  { domain: 'equipment' }
);
