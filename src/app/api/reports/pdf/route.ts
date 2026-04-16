import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { getReportsByPeriod } from '@/modules/reports/application/queries/report-query.service';
import { generatePeriodPdf } from '@/lib/pdf-generator';
import { enqueuePdfGeneration, getPdfJobStatus, downloadPdf } from '@/lib/pdf-queue';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';
import { getRequestId } from '@/lib/request-context';
import { normalizeCrewData } from '@/lib/normalize-crew';

export const runtime = 'nodejs';

// ============================================================
// POST — Enqueue async PDF generation (default)
// ============================================================

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'reports.read_all');

    const body = await request.json();
    const { dateFrom, dateTo, siteId } = body;

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required' },
        { status: 400 }
      );
    }

    const reports = await getReportsByPeriod(dateFrom, dateTo, siteId, user?.tenantId || null);
    const fallbackCrews = await db.crew.findMany({
      where: {
        isActive: true,
        operatorId: { in: reports.map((report: { userId: string }) => report.userId) },
        siteId: { in: reports.map((report: { siteId: string }) => report.siteId) },
      },
      select: {
        operatorId: true,
        siteId: true,
        assistants: { select: { name: true } },
        equipment: { select: { name: true } },
      },
    });
    const fallbackCrewByKey = new Map(
      fallbackCrews.map((crew: { operatorId: string; siteId: string }) => [`${crew.operatorId}:${crew.siteId}`, crew])
    );

    const normalizedReports = reports.map((report) => {
      const fallbackCrew = report.crew
        ? null
        : fallbackCrewByKey.get(`${report.userId}:${report.siteId}`) || null;
      const effectiveCrew = report.crew || fallbackCrew;
      const crewData = normalizeCrewData(effectiveCrew);

      return {
        ...report,
        assistantName: crewData.assistantName,
        equipmentName: report.equipment?.name || crewData.equipmentName,
      };
    });

    // Compute summary from reports
    const summary = {
      totalPiles: reports.reduce((sum: number, r: any) => sum + (r.piles?.reduce((s: number, p: any) => s + (p.count || 0), 0) || 0), 0),
      totalDrilling: reports.reduce((sum: number, r: any) => sum + (r.drillings?.reduce((s: number, d: any) => s + (d.meters || 0), 0) || 0), 0),
      totalDowntime: reports.reduce((sum: number, r: any) => sum + (r.downtimes?.reduce((s: number, dt: any) => s + (dt.duration || 0), 0) || 0), 0),
    };

    const jobId = await enqueuePdfGeneration({
      dateFrom,
      dateTo,
      siteId: siteId || '',
      type: 'period',
      userId: user!.id,
      reports: normalizedReports,
      totalPiles: summary.totalPiles,
      totalDrilling: summary.totalDrilling,
      totalDowntime: summary.totalDowntime,
    });

    // Fallback to sync if Redis unavailable
    if (!jobId) {
      const pdfBuffer = await generatePeriodPdf({
        reports: normalizedReports,
        dateFrom,
        dateTo,
        siteId: siteId || '',
        totalPiles: summary.totalPiles,
        totalDrilling: summary.totalDrilling,
        totalDowntime: summary.totalDowntime,
      });

      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="pilingtrack-report-${dateFrom}-${dateTo}.pdf"`,
        },
      });
    }

    return NextResponse.json(
      { jobId, status: 'queued' },
      { status: 202 }
    );
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      await recordFeedbackEvent({
        level: caughtError.status >= 500 ? 'error' : 'warn',
        scope: 'pdf',
        action: 'report.pdf.enqueue.failed',
        title: 'Ошибка постановки PDF в очередь',
        message: caughtError.message,
        audience: 'OPERATIONS',
        actor: user ? { id: user.id, name: user.name, role: user.role } : null,
        requestId,
      });
      return NextResponse.json({ error: caughtError.message, requestId }, { status: caughtError.status });
    }

    console.error('PDF enqueue error:', caughtError);
    await recordFeedbackEvent({
      level: 'error',
      scope: 'pdf',
      action: 'report.pdf.enqueue.failed',
      title: 'Ошибка постановки PDF в очередь',
      message: caughtError instanceof Error ? caughtError.message : 'PDF enqueue failed',
      audience: 'OPERATIONS',
      actor: user ? { id: user.id, name: user.name, role: user.role } : null,
      requestId,
    });
    return NextResponse.json({ error: 'PDF enqueue failed', requestId }, { status: 500 });
  }
}

// ============================================================
// GET — Sync fallback (?sync=1) or status/download by jobId
// ============================================================

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const searchParams = request.nextUrl.searchParams;
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const sync = searchParams.get('sync');

  // --- Auto-sync if dateFrom/dateTo are provided ---
  if (dateFrom && dateTo) {
    return handleSyncGeneration(request, user!);
  }

  // --- Explicit sync mode ---
  if (sync === '1') {
    return handleSyncGeneration(request, user!);
  }

  // --- Job status / download ---
  const jobId = searchParams.get('jobId');
  const action = searchParams.get('action') || 'status';

  if (!jobId) {
    return NextResponse.json(
      { error: 'Provide dateFrom+dateTo for PDF generation or jobId for async status' },
      { status: 400 }
    );
  }

  if (action === 'status') {
    return handleJobStatus(jobId);
  }

  if (action === 'download') {
    return handleJobDownload(jobId, request);
  }

  return NextResponse.json({ error: 'Invalid action. Use action=status or action=download' }, { status: 400 });
}

// ============================================================
// Sync generation (fallback)
// ============================================================

async function handleSyncGeneration(request: NextRequest, user: { id: string; name: string; role: string; email: string; phone: string; tenantId: string | null }) {
  const requestId = getRequestId(request);

  try {
    assertCan(user, 'reports.read_all');
    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    const siteId = request.nextUrl.searchParams.get('siteId');

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required for sync mode' },
        { status: 400 }
      );
    }

    const reports = await getReportsByPeriod(dateFrom, dateTo, siteId, user?.tenantId || null);
    const fallbackCrews = await db.crew.findMany({
      where: {
        isActive: true,
        operatorId: { in: reports.map((report: { userId: string }) => report.userId) },
        siteId: { in: reports.map((report: { siteId: string }) => report.siteId) },
      },
      select: {
        operatorId: true,
        siteId: true,
        assistants: { select: { name: true } },
        equipment: { select: { name: true } },
      },
    });
    const fallbackCrewByKey = new Map(
      fallbackCrews.map((crew: { operatorId: string; siteId: string }) => [`${crew.operatorId}:${crew.siteId}`, crew])
    );

    const normalizedReports = reports.map((report) => {
      const fallbackCrew = report.crew
        ? null
        : fallbackCrewByKey.get(`${report.userId}:${report.siteId}`) || null;
      const effectiveCrew = report.crew || fallbackCrew;
      const crewData = normalizeCrewData(effectiveCrew);

      return {
        ...report,
        assistantName: crewData.assistantName,
        equipmentName: report.equipment?.name || crewData.equipmentName,
      };
    });

    // Compute summary
    const syncSummary = {
      totalPiles: reports.reduce((sum: number, r: any) => sum + (r.piles?.reduce((s: number, p: any) => s + (p.count || 0), 0) || 0), 0),
      totalDrilling: reports.reduce((sum: number, r: any) => sum + (r.drillings?.reduce((s: number, d: any) => s + (d.meters || 0), 0) || 0), 0),
      totalDowntime: reports.reduce((sum: number, r: any) => sum + (r.downtimes?.reduce((s: number, dt: any) => s + (dt.duration || 0), 0) || 0), 0),
    };

    const pdfBuffer = await generatePeriodPdf({
      dateFrom,
      dateTo,
      siteId: siteId || '',
      reports: normalizedReports,
      totalPiles: syncSummary.totalPiles,
      totalDrilling: syncSummary.totalDrilling,
      totalDowntime: syncSummary.totalDowntime,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="pilingtrack-report-${dateFrom}-${dateTo}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    console.error('PDF generation error:', caughtError);
    await recordFeedbackEvent({
      level: 'error',
      scope: 'pdf',
      action: 'report.pdf.sync.failed',
      title: 'Ошибка формирования PDF',
      message: caughtError instanceof Error ? caughtError.message : 'PDF generation failed',
      audience: 'OPERATIONS',
      actor: user ? { id: user.id, name: user.name, role: user.role } : null,
      requestId,
    });
    return NextResponse.json({ error: 'PDF generation failed', requestId }, { status: 500 });
  }
}

// ============================================================
// Job status
// ============================================================

async function handleJobStatus(jobId: string) {
  try {
    const status = await getPdfJobStatus(jobId);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to get job status', message: (err as Error).message },
      { status: 500 }
    );
  }
}

// ============================================================
// Job download
// ============================================================

async function handleJobDownload(jobId: string, request: NextRequest) {
  try {
    const pdfBuffer = await downloadPdf(jobId);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="pilingtrack-report-${jobId}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not ready') || message.includes('not-found')) {
      return NextResponse.json({ error: 'PDF not ready yet', jobId }, { status: 202 });
    }
    return NextResponse.json(
      { error: 'Failed to download PDF', message },
      { status: 500 }
    );
  }
}
