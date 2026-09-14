import { NextRequest, NextResponse } from 'next/server';
import { withApi } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { requireTenantId } from '@/lib/tenant';
import { assertCan } from '@/services/auth/authorization-service';
import { exportPileJournalXlsx } from '@/modules/reports/application/queries/pile-passport.service';
import type { PileAcceptanceValue } from '@/modules/operator-mobile/domain/pile-passport';

export const runtime = 'nodejs';

const ACCEPTANCE_VALUES: PileAcceptanceValue[] = ['PENDING', 'ACCEPTED', 'NEEDS_REDRIVE'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Выгрузка журнала забивки в .xlsx — то, что распечатывают и подшивают.
 *
 * ПРАВО ТО ЖЕ, ЧТО У ЭКРАНА (`piles.manage`), а не `reports.export`: журнал
 * забивки — документ по сваям, и открыт он тем же, кто по сваям решает.
 *
 * ПОЧЕМУ БЕЗ ОГРАНИЧЕНИЯ ПЕРИОДА В 92 ДНЯ, как у отчётов. Журнал ведётся на
 * объект целиком и подшивается по завершении свайного поля — квартальная
 * граница разрезала бы документ пополам. Размер держит лимит строк (500) в
 * самой выборке.
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

    const xlsx = await exportPileJournalXlsx({
      tenantId,
      siteId: params.get('siteId') || undefined,
      acceptance: (acceptanceParam as PileAcceptanceValue | null) ?? undefined,
      dateFrom,
      dateTo,
      pileNumber: params.get('pileNumber')?.trim() || undefined,
    });

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="pile-driving-journal-${today}.xlsx"`,
      },
    });
  },
  { domain: 'piles' },
);
