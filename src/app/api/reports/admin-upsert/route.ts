import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { upsertReport } from '@/modules/reports/application/commands/report-command.service';
import { reportAdminUpsertSchema } from '@/lib/validation-schemas';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'reports.manage_all');
    const dto = await request.json();
    const validated = reportAdminUpsertSchema.safeParse(dto);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const result = await upsertReport(
      {
        reportId: dto.reportId,
        siteId: dto.siteId,
        userId: dto.userId,
        date: dto.date,
        shiftType: dto.shiftType,
        shiftStart: dto.shiftStart,
        shiftEnd: dto.shiftEnd,
        equipmentId: dto.equipmentId,
        piles: dto.piles,
        drillings: dto.drillings,
        downtimes: dto.downtimes,
      },
      { enforceEditWindow: false, actor: user! }
    );

    return NextResponse.json({ report: result });
  },
  { domain: 'reports' }
);
