import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCanAccessReportOwner, ensureTenantAccess } from '@/services/auth/resource-access-service';
import { assertCan } from '@/services/auth/authorization-service';
import { generateSinglePdf } from '@/lib/pdf-generator';
import { loadSingleReportPdfContext } from '@/lib/pdf-data';
import { enqueuePdfGeneration, getPdfJobStatus, getPdfJobOwnerId, downloadPdf } from '@/lib/pdf-queue';
import { getRequestId } from '@/lib/request-context';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';
import { logger } from '@/lib/logger';
import { withApi, withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FeedbackEvent messages are rendered verbatim in the feedback feed, so a
// non-ServiceError (Prisma/English internals) must never reach it — the real
// text goes to the log instead.
const PDF_FAILURE_FEEDBACK_MESSAGE = 'Не удалось сформировать PDF — попробуйте ещё раз или сообщите администратору';

// POST body — reportId reaches a Prisma findUnique; keep it a bounded string.
const singlePdfBodySchema = z.object({
  reportId: z.string().min(1).max(100),
});

// ============================================================
// POST — Enqueue async single PDF generation (default)
// ============================================================

export const POST = withMutation(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const parsed = singlePdfBodySchema.safeParse(body);

    if (!parsed.success) {
      // Preserve the original message when reportId is simply absent.
      if (!body?.reportId) {
        return NextResponse.json({ error: 'Не указан reportId' }, { status: 400 });
      }
      return NextResponse.json(
        {
          error: 'Некорректные параметры запроса',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    const { reportId } = parsed.data;

    const context = await loadSingleReportPdfContext(reportId);
    if (!context) {
      return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    await ensureTenantAccess(user!, context.report.tenantId, 'report');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCanAccessReportOwner(user!, context.report.userId, 'reports.read_cross_user');

    const jobId = await enqueuePdfGeneration({
      dateFrom: context.report.date,
      dateTo: context.report.date,
      siteId: context.report.siteId || '',
      type: 'single',
      reportId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      userId: user!.id,
      report: context.pdfData,
    });

    // Fallback to sync if Redis unavailable
    if (!jobId) {
      const pdfBuffer = await Promise.race([
        generateSinglePdf(context.pdfData),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new ServiceError('Превышено время подготовки PDF (30 с)', 504)), 30_000),
        ),
      ]);
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="otchet-${context.report.date}-${context.report.user?.name || ''}.pdf"`,
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

    logger.error('single-pdf: enqueue failed', caughtError, { requestId });
    await recordFeedbackEvent({
      level: 'error',
      scope: 'pdf',
      action: 'report.single_pdf.enqueue.failed',
      title: 'Ошибка постановки PDF в очередь',
      message: PDF_FAILURE_FEEDBACK_MESSAGE,
      audience: 'OPERATIONS',
      actor: user ? { id: user.id, name: user.name, role: user.role } : null,
      requestId,
    });
    return NextResponse.json({ error: 'Не удалось поставить задачу генерации PDF в очередь', requestId }, { status: 500 });
  }
}, { domain: 'reports' });

// ============================================================
// GET — Sync fallback (?sync=1) or status/download by jobId
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const searchParams = request.nextUrl.searchParams;
  const reportId = searchParams.get('reportId');
  const sync = searchParams.get('sync');

  // --- If reportId is provided, generate synchronously for preview/download ---
  if (reportId) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    return handleSyncGeneration(request, user!);
  }

  // --- Explicit sync fallback ---
  if (sync === '1') {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    return handleSyncGeneration(request, user!);
  }

  // --- Job status / download ---
  const jobId = searchParams.get('jobId');
  const action = searchParams.get('action') || 'status';

  if (!jobId) {
    return NextResponse.json(
      { error: 'Для асинхронного режима требуется jobId. Поставьте задачу через POST' },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: 'Некорректный jobId' }, { status: 400 });
  }

  // A single-report PDF belongs to the operator who triggered it — only
  // they (or someone with reports.read_cross_user) may poll/download it.
  // Fail closed when the job record is gone (BullMQ prunes completed jobs
  // by count, independently of the rendered PDF's own RESULTS_TTL in
  // storage) — the rendered file can outlive the job that proves ownership.
  const ownerId = await getPdfJobOwnerId(jobId);
  if (ownerId) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCanAccessReportOwner(user!, ownerId, 'reports.read_cross_user');
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.read_cross_user');
  }

  if (action === 'status') {
    return handleJobStatus(jobId);
  }

  if (action === 'download') {
    return handleJobDownload(jobId, request);
  }

  return NextResponse.json({ error: 'Некорректное действие. Используйте action=status или action=download' }, { status: 400 });
}, { domain: 'reports' });

// ============================================================
// Sync generation (fallback)
// ============================================================

async function handleSyncGeneration(request: NextRequest, user: { id: string; name: string; role: string }) {
  const requestId = getRequestId(request);

  try {
    const reportId = request.nextUrl.searchParams.get('reportId');

    if (!reportId) {
      return NextResponse.json({ error: 'Не указан reportId' }, { status: 400 });
    }

    const context = await loadSingleReportPdfContext(reportId);
    if (!context) {
      return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    await ensureTenantAccess(user!, context.report.tenantId, 'report');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCanAccessReportOwner(user!, context.report.userId, 'reports.read_cross_user');

    const pdfBuffer = await generateSinglePdf(context.pdfData);

    const safeDate = context.report.date.replace(/[^0-9-]/g, '');
    const inline = request.nextUrl.searchParams.get('inline') === '1';
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="pilingtrack-report-${safeDate}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
        'x-request-id': requestId,
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'",
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

    logger.error('single-pdf: generation failed', caughtError, { requestId });
    await recordFeedbackEvent({
      level: 'error',
      scope: 'pdf',
      action: 'report.single_pdf.sync.failed',
      title: 'Ошибка формирования PDF',
      message: PDF_FAILURE_FEEDBACK_MESSAGE,
      audience: 'OPERATIONS',
      actor: user ? { id: user.id, name: user.name, role: user.role } : null,
      requestId,
    });
    return NextResponse.json({ error: 'Не удалось сформировать PDF-файл', requestId }, { status: 500 });
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
    logger.error('single-pdf: job status failed', err);
    return NextResponse.json(
      { error: 'Не удалось получить статус задачи' },
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
      return NextResponse.json({ error: 'Отчёт ещё не готов', jobId }, { status: 202 });
    }
    logger.error('single-pdf: download failed', err);
    return NextResponse.json(
      { error: 'Не удалось загрузить PDF-файл' },
      { status: 500 }
    );
  }
}
