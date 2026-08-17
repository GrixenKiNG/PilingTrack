import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const schema = z.object({ reportId: z.string().min(1) });

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.manage_all');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Tenant ownership (IDOR guard, fail-closed): reportId is globally
    // unique, so a delete-by-reportId with no tenant check would let this
    // caller's tenant delete any tenant's report. Verify scope before the
    // (irreversible) delete, mirroring dictionary-service.ts's pattern.
    const report = await db.report.findFirst({
      where: { reportId: parsed.data.reportId, tenantId },
      select: { id: true, siteId: true, userId: true, date: true },
    });
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    try {
      await db.report.delete({ where: { id: report.id } });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Record to delete') || message.includes('not found')) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      throw err;
    }

    // Recompute derived projections so deleting a report doesn't leave
    // orphaned analytics rows (ReportAnalytics is keyed per-report;
    // SiteDailySummary rebuilds from the remaining reports for this
    // site+date, dropping the row if it was the last).
    //
    // Пересчёт OperatorPerformance отсюда убран 17.08.2026 вместе с самой
    // проекцией: её не читала ни одна витрина.
    //
    // Best-effort: the report is already gone, and the nightly rebuild is a
    // backstop — a recompute failure must not turn a successful delete into
    // a 500.
    try {
      const { recomputeSiteDailySummary } = await import('@/services/reports/event-handlers');
      await db.reportAnalytics.deleteMany({ where: { reportId: parsed.data.reportId } });
      await recomputeSiteDailySummary(report.siteId, report.date);
    } catch (err) {
      const { logger } = await import('@/lib/logger');
      logger.error('Report delete: projection recompute failed', err, {
        reportId: parsed.data.reportId,
      });
    }

    return NextResponse.json({ ok: true });
  },
  { domain: 'reports' }
);
