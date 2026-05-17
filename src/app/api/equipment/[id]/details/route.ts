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
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { getEquipmentDetails } from '@/modules/equipment';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // The detail page is admin/dispatcher tooling — gate behind the
    // same permission as equipment.manage so operators can't browse
    // tech specs of rigs they're not on.
    assertCan(user!, 'equipment.manage');

    const { id } = await params;
    const details = await getEquipmentDetails(id);
    return NextResponse.json(details);
  },
  { domain: 'equipment' }
);
