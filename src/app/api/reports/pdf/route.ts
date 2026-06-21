import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { generatePeriodPdf } from '@/lib/pdf-generator';
import { buildPeriodPdfData } from '@/lib/pdf-data';
import { enqueuePdfGeneration, getPdfJobStatus, downloadPdf } from '@/lib/pdf-queue';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';
import { getRequestId } from '@/lib/request-context';
import { logger } from '@/lib/logger';
import { withApi, withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

// ============================================================
// POST — Enqueue async PDF generation (default)
// ============================================================

export const POST = withMutation(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'reports.read_all');

    const body = await request.json();
    const { dateFrom, dateTo, siteId, filterUserId, equipmentId } = body;

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required' },
        { status: 400 }
      );
    }

    const pdfData = await buildPeriodPdfData({
      dateFrom,
      dateTo,
      siteId,
      tenantId: user?.tenantId || null,
      userId: filterUserId || null,
      equipmentId: equipmentId || null,
    });

    const jobId = await enqueuePdfGeneration({
      dateFrom,
      dateTo,
      siteId: siteId || '',
      type: 'period',
      userId: user!.id,
      reports: pdfData.reports,
      totalPiles: pdfData.totalPiles,
      totalDrilling: pdfData.totalDrilling,
      totalDowntime: pdfData.totalDowntime,
    });

    // Fallback to sync if Redis unavailable
    if (!jobId) {
      const inline = request.nextUrl.searchParams.get('inline') === '1';
      const pdfBuffer = await generatePeriodPdf(pdfData);

      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="pilingtrack-report-${dateFrom}-${dateTo}.pdf"`,
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

    logger.error('pdf: enqueue failed', caughtError, { requestId });
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
}, { domain: 'reports' });

// ============================================================
// GET — Sync fallback (?sync=1) or status/download by jobId
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
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
}, { domain: 'reports' });

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
    const filterUserId = request.nextUrl.searchParams.get('userId');
    const equipmentId = request.nextUrl.searchParams.get('equipmentId');
    const inline = request.nextUrl.searchParams.get('inline') === '1';

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required for sync mode' },
        { status: 400 }
      );
    }

    const pdfData = await buildPeriodPdfData({
      dateFrom,
      dateTo,
      siteId,
      tenantId: user?.tenantId || null,
      userId: filterUserId,
      equipmentId,
    });
    const pdfBuffer = await generatePeriodPdf(pdfData);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="pilingtrack-report-${dateFrom}-${dateTo}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    logger.error('pdf: generation failed', caughtError);
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
    const inline = request.nextUrl.searchParams.get('inline') === '1';
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="pilingtrack-report-${jobId}.pdf"`,
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
