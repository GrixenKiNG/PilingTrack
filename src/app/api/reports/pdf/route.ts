import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST body — dateFrom/dateTo flow into the Content-Disposition filename,
// so they must be strictly YYYY-MM-DD (no CRLF/quotes → no header injection)
// before anything else runs.
const periodPdfBodySchema = z
  .object({
    dateFrom: z.string().regex(DATE_RE),
    dateTo: z.string().regex(DATE_RE),
    siteId: z.string().min(1).max(100).optional(),
    filterUserId: z.string().min(1).max(100).optional(),
    equipmentId: z.string().min(1).max(100).optional(),
  })
  .refine((data) => data.dateFrom <= data.dateTo, {
    message: 'Дата начала позже даты окончания',
    path: ['dateTo'],
  });

// ============================================================
// POST — Enqueue async PDF generation (default)
// ============================================================

export const POST = withMutation(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.read_all');

    const body = await request.json();
    const parsed = periodPdfBodySchema.safeParse(body);

    if (!parsed.success) {
      // Preserve the original message when the dates are simply absent.
      if (!body?.dateFrom || !body?.dateTo) {
        return NextResponse.json(
          { error: 'Укажите период: даты начала и окончания' },
          { status: 400 }
        );
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

    const { dateFrom, dateTo, siteId, filterUserId, equipmentId } = parsed.data;

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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
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
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const sync = searchParams.get('sync');

  // --- Auto-sync if dateFrom/dateTo are provided ---
  if (dateFrom && dateTo) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    return handleSyncGeneration(request, user!);
  }

  // --- Explicit sync mode ---
  if (sync === '1') {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    return handleSyncGeneration(request, user!);
  }

  // --- Job status / download ---
  const jobId = searchParams.get('jobId');
  const action = searchParams.get('action') || 'status';

  if (!jobId) {
    return NextResponse.json(
      { error: 'Укажите dateFrom и dateTo для генерации PDF или jobId для асинхронного статуса' },
      { status: 400 }
    );
  }

  // jobId is a UUID we generate ourselves at enqueue time — reject anything
  // else outright. Closes both enumeration (BullMQ's old default jobId was
  // a small sequential int) and path traversal (jobId flows into a file
  // path / S3 key in pdf-generator/storage.ts).
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: 'Некорректный jobId' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'reports.read_all');

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
        { error: 'Укажите период: даты начала и окончания' },
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
    logger.error('pdf: job status failed', err);
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
    logger.error('pdf: download failed', err);
    return NextResponse.json(
      { error: 'Не удалось загрузить PDF-файл' },
      { status: 500 }
    );
  }
}
