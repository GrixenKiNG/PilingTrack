import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getEntityHistory } from '@/services/audit/audit-history-service';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

// Generic per-entity change history. Reads the FeedbackEvent audit log filtered
// by scope + targetId. Powers the history pane of any ops-shell module.
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'system.read');

    const scope = request.nextUrl.searchParams.get('scope');
    const targetId = request.nextUrl.searchParams.get('targetId');
    if (!scope || !targetId) {
      return NextResponse.json({ error: 'scope and targetId are required' }, { status: 400 });
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

    const entries = await getEntityHistory(scope, targetId, limit);
    return NextResponse.json({ entries });
  },
  { domain: 'audit', cache: false },
);
