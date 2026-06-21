/**
 * POST /api/reports/upsert
 *
 * Create or update a shift production report.
 * Uses domain aggregate + repository + outbox pattern.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import {
  assertCanActForUser,
  resolveReportUserId,
  upsertReport,
} from '@/modules/reports';
import { ServiceError } from '@/lib/service-error';
import { reportUpsertSchema } from '@/lib/validation-schemas';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const dto = await request.json();

    const validation = reportUpsertSchema.safeParse(dto);
    if (!validation.success) {
      await recordFeedbackEvent({
        level: 'warn',
        scope: 'reports',
        action: 'report.validation_failed',
        title: 'Отчёт не сохранён',
        message: 'Проверка данных отчёта завершилась ошибкой валидации.',
        audience: 'OPERATIONS',
        actor: { id: user!.id, name: user!.name, role: user!.role },
        requestId,
        metadata: {
          issues: validation.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });

      return createJsonResponse(
        {
          error: 'Validation failed',
          requestId,
          details: validation.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
        requestId
      );
    }

    const validatedDto = validation.data;
    const requestedUserId = validatedDto.userId ?? user!.id;

    assertCanActForUser(user!, requestedUserId);

    const result = await upsertReport(
      {
        reportId: validatedDto.reportId || validatedDto.id || crypto.randomUUID(),
        siteId: validatedDto.siteId,
        userId: resolveReportUserId(user!, requestedUserId),
        date: validatedDto.date,
        shiftType: validatedDto.shiftType,
        shiftStart: validatedDto.shiftStart,
        shiftEnd: validatedDto.shiftEnd,
        equipmentId: validatedDto.equipmentId,
        piles: validatedDto.piles,
        drillings: validatedDto.drillings,
        downtimes: validatedDto.downtimes,
      },
      { enforceEditWindow: true, actor: user! }
    );

    await recordFeedbackEvent({
      level: 'success',
      scope: 'reports',
      action: result._action === 'updated' ? 'report.submit.updated' : 'report.submit.created',
      title: result._action === 'updated' ? 'Отчёт обновлён' : 'Отчёт отправлен',
      message:
        result._action === 'updated'
          ? 'Производственный отчёт был успешно обновлён.'
          : 'Новый производственный отчёт был успешно сохранён.',
      audience: 'OPERATIONS',
      actor: { id: user!.id, name: user!.name, role: user!.role },
      targetId: result.report.reportId,
      requestId,
      metadata: {
        siteId: result.report.siteId,
        reportDate: result.report.date,
      },
    });

    return createJsonResponse({ report: result, requestId }, { status: 200 }, requestId);
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      await recordFeedbackEvent({
        level: caughtError.status >= 500 ? 'error' : 'warn',
        scope: 'reports',
        action: 'report.submit.failed',
        title: 'Ошибка сохранения отчёта',
        message: caughtError.message,
        audience: 'OPERATIONS',
        actor: { id: user!.id, name: user!.name, role: user!.role },
        requestId,
      });
      return createJsonResponse(
        { error: caughtError.message, requestId },
        { status: caughtError.status },
        requestId
      );
    }

    const message = caughtError instanceof Error ? caughtError.message : 'Internal error';
    await recordFeedbackEvent({
      level: 'error',
      scope: 'reports',
      action: 'report.submit.failed',
      title: 'Внутренняя ошибка сохранения отчёта',
      message,
      audience: 'OPERATIONS',
      actor: { id: user!.id, name: user!.name, role: user!.role },
      requestId,
    });
    return createJsonResponse({ error: message, requestId }, { status: 500 }, requestId);
  }
}
