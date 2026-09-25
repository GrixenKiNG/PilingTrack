import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { computePeriodSummary, type PeriodReportInput } from '@/modules/reports/domain/period-summary';


export const runtime = 'nodejs';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Строка — реальная календарная дата в формате ГГГГ-ММ-ДД.
 *
 * Одного регекса мало: `2026-02-31` ему соответствует, а Date.parse
 * разворачивает в 3 марта. Сверка с обратным toISOString отсекает и такой
 * ввод. Проверка нужна до запроса: значение уходит в raw-SQL строкой, и
 * мусор оттуда возвращался 500.
 */
function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getReportQueryService() {
  return import('@/modules/reports/application/queries/report-query.service');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.read_all');
    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const userId = request.nextUrl.searchParams.get('userId');

    // Пустые значения не трогаем: их, как и раньше, отклоняет
    // getReportsByPeriod (400). Проверяем только то, что дошло до запроса.
    if (dateFrom && dateTo && (!isDateOnly(dateFrom) || !isDateOnly(dateTo) || dateFrom > dateTo)) {
      return NextResponse.json(
        { error: 'Некорректный период: даты в формате ГГГГ-ММ-ДД, начало не позже окончания' },
        { status: 400 }
      );
    }

    const { getReportsByPeriod } = await getReportQueryService();
    const reports = await getReportsByPeriod(dateFrom, dateTo, siteId, user?.tenantId || null, userId);

    // Pile metres come from the grade length (PileGrade.lengthMm), carried on each
    // pile row — no SitePilePlan lookup, the plan is not a length source.
    const summary = computePeriodSummary(reports as PeriodReportInput[]);
    return NextResponse.json({ reports, summary });
  },
  { domain: 'reports' }
);
