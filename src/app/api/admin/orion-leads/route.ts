import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { db } from '@/lib/db';
import { requireTenantId } from '@/lib/tenant';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/**
 * Заявки с сайта ORION, о которых компания могла не узнать: Telegram не принял
 * сообщение или бот не настроен, поэтому `deliveredAt` пуст. Заявки, помеченные
 * ловушкой для ботов, не считаем: по замыслу они в Telegram не уходят.
 *
 * Права те же, что у очереди недоставленных событий (`dlq.manage`): это тот же
 * класс проблемы. Организация — строгим равенством.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'dlq.manage');

    const tenantId = requireTenantId(user);

    // Нечисло давало NaN и 500 от Prisma, отрицательное — выборку с конца.
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const where = { tenantId, deliveredAt: null, isSpam: false };
    const [leads, total] = await Promise.all([
      db.orionLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, name: true, contact: true, message: true, deliveryError: true, createdAt: true },
      }),
      db.orionLead.count({ where }),
    ]);

    return NextResponse.json({ leads, total });
  },
  { domain: 'admin-orion-leads' }
);
