/**
 * GET /api/equipment/[id]/details
 *
 * Composite snapshot for /admin/equipment/[id]: equipment row with
 * full template metadata + current crew + 30-day activity rollup
 * (from ReportAnalytics) + telematics devices + documents.
 *
 * One request → one render of the detail page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { getEquipmentDetails } from '@/modules/equipment';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // Чтение карточки машины, а не диагностика системы: раньше здесь стояло
    // system.read, взятое как синоним «админ или диспетчер», и механик не
    // мог открыть установку, которую сам обслуживает. Изменения по-прежнему
    // закрыты equipment.manage в своих маршрутах.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.read');

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const details = await getEquipmentDetails(id, tenantId);
    return NextResponse.json(details);
  },
  { domain: 'equipment' }
);
