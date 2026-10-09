import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listEquipmentChecklistHistory } from '@/modules/operator-mobile';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

/**
 * ЕО и предсменные осмотры машиниста по установке — для карточки установки.
 * Читают те же роли, что открывают карточку (`equipment.read`).
 */
export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.read');
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const records = await listEquipmentChecklistHistory({ tenantId, equipmentId: id });
    return NextResponse.json({ records });
  },
  { domain: 'equipment.operator-checklists' },
);
