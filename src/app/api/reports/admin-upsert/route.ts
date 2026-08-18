import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { reportAdminUpsertSchema } from '@/lib/validation-schemas';
import { withMutation, readJsonBody } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getReportCommandService() {
  return import('@/modules/reports/application/commands/report-command.service');
}

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.manage_all');
    const dto = await readJsonBody(request);
    const validated = reportAdminUpsertSchema.safeParse(dto);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    // Дальше читаем validated.data, а не сырое тело. Схема проставляет
    // значения по умолчанию — shiftType 'DAY', пустые массивы piles,
    // drillings, downtimes, — и раньше они терялись: админский маршрут брал
    // поля из необработанного dto, тогда как операторский рядом (upsert)
    // всегда работал с разобранными. Отчёт, сохранённый админом без раздела
    // свай, уходил в команду с undefined вместо пустого списка.
    const data = validated.data;
    const { upsertReport } = await getReportCommandService();
    // Same tenantId-from-session fix as in the operator route — admin
    // edits were also writing NULL tenantId, hiding the edited report
    // from the tenant-scoped history view.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID || undefined;
    const result = await upsertReport(
      {
        // Тот же порядок, что и в операторском маршруте: свой идентификатор,
        // затем id, затем новый — админ тоже может создавать отчёт с нуля.
        reportId: data.reportId || data.id || crypto.randomUUID(),
        siteId: data.siteId,
        userId: data.userId,
        tenantId,
        expectedVersion: data.version,
        date: data.date,
        shiftType: data.shiftType,
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        equipmentId: data.equipmentId,
        piles: data.piles,
        drillings: data.drillings,
        downtimes: data.downtimes,
      },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      { enforceEditWindow: false, actor: user! }
    );

    return NextResponse.json({ report: result });
  },
  { domain: 'reports' }
);
