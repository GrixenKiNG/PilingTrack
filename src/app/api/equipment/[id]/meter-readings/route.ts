import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { addMeterReading, canDecreaseMeter, listMeterReadings } from '@/modules/equipment';
import { getCrewForOperator } from '@/modules/crews';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

/**
 * Оператор снимает моточасы только со своей машины.
 *
 * Право `meter.record` открыто оператору намеренно — показания фиксирует тот,
 * кто стоит у установки. Но само право не сужает выбор машины, поэтому без
 * этой проверки оператор мог бы писать наработку любой единице тенанта.
 */
async function assertOperatorOwnsEquipment(
  user: { id: string; role: string },
  equipmentId: string,
): Promise<void> {
  if (user.role !== 'OPERATOR') return;
  const crew = await getCrewForOperator(user, null);
  if (!crew || crew.equipmentId !== equipmentId) {
    throw new ServiceError('Установка не закреплена за вашим экипажем', 403);
  }
}

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z.object({
  engineHours: z.coerce.number().int().min(0),
  recordedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  source: z.enum(['MANUAL', 'TELEMETRY']).optional(),
  note: z.string().max(500).optional().nullable(),
});

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'meter.record');

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      await assertOperatorOwnsEquipment(user!, id);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
    const readings = await listMeterReadings(id, tenantId);
    return NextResponse.json({ readings });
  },
  { domain: 'equipment.maintenance' }
);

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'meter.record');

    const { id } = await params;
    const body = await readJsonBody(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);

    // Название установки нужно только ленте (F-R72-FEED-METER-MAINT): сама
    // команда его не возвращает, а в тексте события оно читается вместо id.
    // Читается ДО команды, строго по тенанту — как в удалении показания.
    const equipment = await db.equipment.findFirst({
      where: { id, tenantId },
      select: { name: true },
    });

    let result;
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      await assertOperatorOwnsEquipment(user!, id);
      result = await addMeterReading(id, parsed.data, {
        tenantId,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        recordedById: user!.id,
        // Оператору счётчик назад не отмотать: цифра меньше предыдущей — опечатка.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        allowDecrease: canDecreaseMeter(user!.role),
      });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Запись показания двигает наработку и сроки ТО, а строки в журнале по ней
    // не было вовсе — при том что удаление того же показания писалось
    // (F-R72-FEED-METER-MAINT). Пишется только после успешной команды.
    await recordAuditEvent({
      action: 'meter.reading.added',
      scope: 'equipment',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: result.reading.id,
      tenantId,
      metadata: equipment
        ? { name: equipment.name, after: { engineHours: result.reading.engineHours } }
        : { after: { engineHours: result.reading.engineHours } },
    });

    return NextResponse.json(result, { status: 201 });
  },
  { domain: 'equipment.maintenance' }
);
