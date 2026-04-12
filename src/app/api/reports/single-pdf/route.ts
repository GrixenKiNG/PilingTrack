import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCanAccessReportOwner } from '@/services/auth/resource-access-service';
import { generateSinglePdf } from '@/lib/pdf-generator';
import { enqueuePdfGeneration, getPdfJobStatus, downloadPdf } from '@/lib/pdf-queue';
import { getRequestId } from '@/lib/request-context';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';

export const runtime = 'nodejs';

// ============================================================
// POST — Enqueue async single PDF generation (default)
// ============================================================

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { reportId } = body;

    if (!reportId) {
      return NextResponse.json({ error: 'reportId required' }, { status: 400 });
    }

    const report = await db.report.findUnique({
      where: { reportId },
      include: {
        user: { select: { name: true } },
        site: { select: { name: true } },
        equipment: { select: { name: true } },
        crew: {
          select: {
            name: true,
            assistants: { select: { name: true } },
            equipment: { select: { name: true } },
          },
        },
        piles: { include: { pileGrade: true } },
        drillings: { include: { type: true } },
        downtimes: { include: { reason: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    assertCanAccessReportOwner(user!, report.userId, 'reports.read_cross_user');

    const fallbackCrew = report.crew
      ? null
      : await db.crew.findFirst({
          where: {
            operatorId: report.userId,
            siteId: report.siteId,
            isActive: true,
          },
          select: {
            assistants: { select: { name: true } },
            equipment: { select: { name: true } },
          },
        });

    const effectiveCrew = report.crew || fallbackCrew;
    const assistantName =
      effectiveCrew?.assistants?.map((assistant) => assistant.name).filter(Boolean).join(', ') || '';

    const pdfData = {
      reportId: report.reportId,
      date: report.date,
      shiftStart: report.shiftStart,
      shiftEnd: report.shiftEnd,
      shiftType: report.shiftType,
      status: report.status,
      lastEditedByName: report.lastEditedByName,
      lastEditedByRole: report.lastEditedByRole,
      assistantName,
      equipmentName: report.equipment?.name || effectiveCrew?.equipment?.name || '',
      user: report.user,
      site: report.site,
      piles: report.piles,
      drillings: report.drillings,
      downtimes: report.downtimes,
    };

    const jobId = await enqueuePdfGeneration({
      dateFrom: report.date,
      dateTo: report.date,
      siteId: report.siteId || '',
      type: 'single',
      reportId,
      userId: user!.id,
      report: pdfData,
    });

    // Fallback to sync if Redis unavailable
    if (!jobId) {
      const pdfBuffer = await generateSinglePdf(pdfData);
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="otchet-${report.date}-${report.user?.name || ''}.pdf"`,
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
        action: 'report.single_pdf.enqueue.failed',
        title: 'Ошибка постановки PDF в очередь',
        message: caughtError.message,
        audience: 'OPERATIONS',
        actor: user ? { id: user.id, name: user.name, role: user.role } : null,
        requestId,
      });
      return NextResponse.json({ error: caughtError.message, requestId }, { status: caughtError.status });
    }

    console.error('Single PDF enqueue error:', caughtError);
    await recordFeedbackEvent({
      level: 'error',
      scope: 'pdf',
      action: 'report.single_pdf.enqueue.failed',
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
  const sync = searchParams.get('sync');

  // --- Sync fallback ---
  if (sync === '1') {
    return handleSyncGeneration(request, user!);
  }

  // --- Job status / download ---
  const jobId = searchParams.get('jobId');
  const action = searchParams.get('action') || 'status';

  if (!jobId) {
    return NextResponse.json(
      { error: 'jobId required for async mode. Use POST to enqueue.' },
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

async function handleSyncGeneration(request: NextRequest, user: { id: string; name: string; role: string }) {
  const requestId = getRequestId(request);

  try {
    const reportId = request.nextUrl.searchParams.get('reportId');

    if (!reportId) {
      return NextResponse.json({ error: 'reportId required' }, { status: 400 });
    }

    const report = await db.report.findUnique({
      where: { reportId },
      include: {
        user: { select: { name: true } },
        site: { select: { name: true } },
        equipment: { select: { name: true } },
        crew: {
          select: {
            name: true,
            assistants: { select: { name: true } },
            equipment: { select: { name: true } },
          },
        },
        piles: { include: { pileGrade: true } },
        drillings: { include: { type: true } },
        downtimes: { include: { reason: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    assertCanAccessReportOwner(user!, report.userId, 'reports.read_cross_user');

    const fallbackCrew = report.crew
      ? null
      : await db.crew.findFirst({
          where: {
            operatorId: report.userId,
            siteId: report.siteId,
            isActive: true,
          },
          select: {
            assistants: { select: { name: true } },
            equipment: { select: { name: true } },
          },
        });

    const effectiveCrew = report.crew || fallbackCrew;
    const assistantName =
      effectiveCrew?.assistants?.map((assistant) => assistant.name).filter(Boolean).join(', ') || '';

    const pdfData = {
      reportId: report.reportId,
      date: report.date,
      shiftStart: report.shiftStart,
      shiftEnd: report.shiftEnd,
      shiftType: report.shiftType,
      status: report.status,
      lastEditedByName: report.lastEditedByName,
      lastEditedByRole: report.lastEditedByRole,
      assistantName,
      equipmentName: report.equipment?.name || effectiveCrew?.equipment?.name || '',
      user: report.user,
      site: report.site,
      piles: report.piles,
      drillings: report.drillings,
      downtimes: report.downtimes,
    };

    const pdfBuffer = await generateSinglePdf(pdfData);

    const safeDate = report.date.replace(/[^0-9-]/g, '');
    const inline = request.nextUrl.searchParams.get('inline') === '1';
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="pilingtrack-report-${safeDate}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
        'x-request-id': requestId,
      },
    });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      await recordFeedbackEvent({
        level: caughtError.status >= 500 ? 'error' : 'warn',
        scope: 'pdf',
        action: 'report.single_pdf.sync.failed',
        title: 'Ошибка формирования PDF',
        message: caughtError.message,
        audience: 'OPERATIONS',
        actor: user ? { id: user.id, name: user.name, role: user.role } : null,
        requestId,
      });
      return NextResponse.json({ error: caughtError.message, requestId }, { status: caughtError.status });
    }

    console.error('Single PDF generation error:', caughtError);
    await recordFeedbackEvent({
      level: 'error',
      scope: 'pdf',
      action: 'report.single_pdf.sync.failed',
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
