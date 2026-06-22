import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { reportAdminUpsertSchema } from '@/lib/validation-schemas';
import { withMutation } from '@/core/api-wrapper';


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
    const dto = await request.json();
    const validated = reportAdminUpsertSchema.safeParse(dto);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const { upsertReport } = await getReportCommandService();
    // Same tenantId-from-session fix as in the operator route — admin
    // edits were also writing NULL tenantId, hiding the edited report
    // from the tenant-scoped history view.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID || undefined;
    const result = await upsertReport(
      {
        reportId: dto.reportId,
        siteId: dto.siteId,
        userId: dto.userId,
        tenantId,
        expectedVersion: validated.data.version,
        date: dto.date,
        shiftType: dto.shiftType,
        shiftStart: dto.shiftStart,
        shiftEnd: dto.shiftEnd,
        equipmentId: dto.equipmentId,
        piles: dto.piles,
        drillings: dto.drillings,
        downtimes: dto.downtimes,
      },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      { enforceEditWindow: false, actor: user! }
    );

    return NextResponse.json({ report: result });
  },
  { domain: 'reports' }
);
