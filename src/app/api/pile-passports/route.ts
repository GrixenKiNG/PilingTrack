import { NextRequest, NextResponse } from 'next/server';
import { withApi } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { requireTenantId } from '@/lib/tenant';
import { assertCan } from '@/services/auth/authorization-service';
import {
  listPilePassports,
  pileJournalHeader,
} from '@/modules/reports/application/queries/pile-passport.service';
import type { PileAcceptanceValue } from '@/modules/operator-mobile/domain/pile-passport';

export const runtime = 'nodejs';

const ACCEPTANCE_VALUES: PileAcceptanceValue[] = ['PENDING', 'ACCEPTED', 'NEEDS_REDRIVE'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Журнал забивки: строки по сваям и титул журнала.
 *
 * ПОЧЕМУ ТИТУЛ СЧИТАЕТСЯ ЗДЕСЬ, А НЕ НА ЭКРАНЕ. Он обязан описывать ровно ту
 * выборку, которую видно в таблице, — и ту же, которая уйдёт в выгрузку.
 * Второй счёт на клиенте разошёлся бы с выгрузкой на первом же фильтре.
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

    const params = request.nextUrl.searchParams;
    const acceptanceParam = params.get('acceptance');
    if (acceptanceParam && !ACCEPTANCE_VALUES.includes(acceptanceParam as PileAcceptanceValue)) {
      return NextResponse.json({ error: 'Неизвестное решение по свае' }, { status: 400 });
    }
    const dateFrom = params.get('dateFrom') || undefined;
    const dateTo = params.get('dateTo') || undefined;
    if ((dateFrom && !YMD.test(dateFrom)) || (dateTo && !YMD.test(dateTo))) {
      return NextResponse.json({ error: 'Даты периода задаются как ГГГГ-ММ-ДД' }, { status: 400 });
    }

    const { rows, truncated } = await listPilePassports({
      tenantId,
      siteId: params.get('siteId') || undefined,
      pendingOnly: params.get('pendingOnly') === 'true',
      acceptance: (acceptanceParam as PileAcceptanceValue | null) ?? undefined,
      dateFrom,
      dateTo,
      pileNumber: params.get('pileNumber')?.trim() || undefined,
    });
    return NextResponse.json({ data: rows, header: pileJournalHeader(rows), truncated });
  },
  { domain: 'piles' },
);
