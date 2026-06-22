import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { reportUpsertSchema } from '@/lib/validation-schemas';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getReportCommandService() {
  return import('@/modules/reports/application/commands/report-command.service');
}

export const POST = withMutation(
  async (request: NextRequest) => {
    const requestId = getRequestId(request);
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const dto = await request.json();

    // Zod validation
    const validation = reportUpsertSchema.safeParse(dto);
    if (!validation.success) {
      await recordFeedbackEvent({
        level: 'warn',
        scope: 'reports',
        action: 'report.validation_failed',
        title: 'Отчёт не сохранён',
        message: 'Проверка данных отчёта завершилась ошибкой валидации.',
        audience: 'OPERATIONS',
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
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
        { error: 'Validation failed', requestId, details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 },
        requestId
      );
    }

    const validatedDto = validation.data;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const requestedUserId = validatedDto.userId ?? user!.id;

    const { assertCanActForUser, resolveReportUserId, upsertReport } = await getReportCommandService();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCanActForUser(user!, requestedUserId);

    // Single-tenant prod was leaving every new Report.tenantId as NULL
    // because nothing on the write path supplied it. The history /
    // analytics queries then filter by tenantId=orion and silently
    // hide those reports (operator sees "no history", admin period
    // filter shows zeros). Resolve it once here.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID || null;

    const result = await upsertReport(
      {
        reportId: validatedDto.reportId || validatedDto.id || crypto.randomUUID(),
        siteId: validatedDto.siteId,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        userId: resolveReportUserId(user!, requestedUserId),
        tenantId: tenantId || undefined,
        expectedVersion: validatedDto.version,
        date: validatedDto.date,
        shiftType: validatedDto.shiftType,
        shiftStart: validatedDto.shiftStart,
        shiftEnd: validatedDto.shiftEnd,
        equipmentId: validatedDto.equipmentId,
        piles: validatedDto.piles,
        drillings: validatedDto.drillings,
        downtimes: validatedDto.downtimes,
      },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actor: { id: user!.id, name: user!.name, role: user!.role },
      targetId: result.report.reportId,
      requestId,
      metadata: {
        siteId: result.report.siteId,
        reportDate: result.report.date,
      },
    });

    return createJsonResponse({ report: result, requestId }, { status: 200 }, requestId);
  },
  { domain: 'reports' }
);
