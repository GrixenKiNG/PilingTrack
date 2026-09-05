import { NextRequest, NextResponse } from 'next/server';
import { withApi } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { requireTenantId } from '@/lib/tenant';
import { assertCan } from '@/services/auth/authorization-service';
import { listPilePassports } from '@/modules/reports/application/queries/pile-passport.service';

export const runtime = 'nodejs';

/**
 * Журнал забивки: паспорта свай для разбора мастером.
 *
 * Кеш здесь не включаем: список меняется каждым решением мастера, и десять
 * секунд устаревшего разбора — это свая, принятая дважды.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'piles.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);

    const rows = await listPilePassports({
      tenantId,
      siteId: request.nextUrl.searchParams.get('siteId') || undefined,
      pendingOnly: request.nextUrl.searchParams.get('pendingOnly') === 'true',
    });
    return NextResponse.json({ data: rows });
  },
  { domain: 'piles' },
);
