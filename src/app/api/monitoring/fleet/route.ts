/**
 * GET /api/monitoring/fleet
 *
 * Single-shot snapshot for the live fleet dashboard. Role scope:
 *   - OPERATOR / ASSISTANT: only equipment they're crew-assigned to.
 *   - DISPATCHER / ADMIN:   the whole tenant fleet.
 *
 * Cached for 30 s — the dashboard subscribes to `report.*` WebSocket
 * events for live patching, so the HTTP path only needs to be fresh
 * enough for the initial paint and the occasional reconnect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi } from '@/core/api-wrapper';
import { getFleetSnapshot } from '@/modules/monitoring';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const operatorUserId =
      user!.role === 'OPERATOR' || user!.role === 'ASSISTANT' ? user!.id : null;

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const snapshot = await getFleetSnapshot({ tenantId, operatorUserId });
    return NextResponse.json(snapshot);
  },
  { domain: 'monitoring', cache: true, cacheTTL: 30_000 }
);
