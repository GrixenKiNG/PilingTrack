import { NextRequest } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { reportUpsertSchema } from '@/lib/validation-schemas';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';
import { withMutation, readJsonBody } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getReportCommandService() {
  return import('@/modules/reports/application/commands/report-command.service');
}

export const POST = withMutation(
  async (request: NextRequest) => {
    const requestId = getRequestId(request);
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const dto = await readJsonBody(request);

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
        { error: 'Некорректные данные', requestId, details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
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
    const tenantId = requireTenantId(user!);

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

    // Optional end-of-shift engine hours → the rig's MeterReading journal.
    // Non-fatal by design: the shift report must never be lost because a
    // meter reading failed.
    //
    // Отказ правила учёта (счётчик назад) при этом обязан дойти до оператора:
    // раньше любая осечка уходила в лог, и человек считал, что часы записаны.
    // Отчёт сохраняем, а причину возвращаем в ответе — `meterError`.
    let meterWarning: string | null = null;
    let meterError: string | null = null;
    if (validatedDto.engineHours != null && validatedDto.equipmentId && tenantId) {
      try {
        const { addMeterReading } = await import('@/modules/equipment');
        const meterResult = await addMeterReading(
          validatedDto.equipmentId,
          {
            engineHours: validatedDto.engineHours,
            note: `Показание из сменного отчёта за ${validatedDto.date}`,
          },
          // Отчёт заполняет оператор — снижение счётчика ему недоступно.
          // Пометки отчёта — идентификатор события: повтор отправки формы
          // (потерян ответ, перепосылка) не создаёт второе показание.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
          { tenantId, recordedById: user!.id, allowDecrease: false, dedupeByNote: true },
        );
        meterWarning = meterResult.warning;
      } catch (err) {
        const { ServiceError } = await import('@/lib/service-error');
        if (err instanceof ServiceError && err.status === 422) {
          meterError = err.message;
        } else {
          const { logger } = await import('@/lib/logger');
          logger.warn('meter reading from report failed', {
            equipmentId: validatedDto.equipmentId,
            engineHours: validatedDto.engineHours,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

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

    return createJsonResponse({ report: result, meterWarning, meterError, requestId }, { status: 200 }, requestId);
  },
  { domain: 'reports' }
);
