import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { canDecreaseMeter, createEquipment, getEquipmentByIdOrThrow, listAllEquipment, updateEquipmentMetadata } from '@/modules/equipment';
import { createEquipmentSchema } from '@/lib/validation-schemas';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const siteId = request.nextUrl.searchParams.get('siteId');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const operatorUserId = user!.role === 'OPERATOR' ? user!.id : null;
    const equipment = await listAllEquipment(tenantId, pagination, siteId, operatorUserId);
    const nextCursor = pagination.getNextCursor(equipment);
    return NextResponse.json({ data: equipment, nextCursor });
  },
  { domain: 'equipment', cache: true, cacheTTL: 60_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await readJsonBody(request);
    const validation = createEquipmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await createEquipment({
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      userId: user!.id,
      tenantId,
    });

    if (equipment) {
      await updateEquipmentMetadata(equipment.id, validation.data, {
        tenantId,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        actorId: user!.id,
        // Заведение техники: журнал пуст, сравнивать не с чем — снижение
        // не возникает. Флаг оставлен по роли для единообразия.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        allowDecrease: canDecreaseMeter(user!.role),
      });
    }

    // Перечитываем: `createEquipment` возвращает строку ДО записи
    // характеристик, и ответ показывал `kind: OTHER` с пустыми полями, хотя
    // в базе уже лежал верный тип. Экран, рисующий новую установку прямо из
    // ответа, показывал не то, что сохранил.
    const saved = equipment
      ? await getEquipmentByIdOrThrow(equipment.id, tenantId)
      : equipment;

    // Аудит (F-R34-14): заведение техники не оставляло следа вовсе. Снимок
    // берётся по сохранённой строке (`saved`), а не по ответу команды: тип и
    // характеристики пишутся вторым шагом, и снимок «до записи метаданных»
    // описывал бы не то, что легло в базу. Внутренних id в metadata нет —
    // только название и то, что видно на экране.
    await recordAuditEvent({
      action: 'equipment.created',
      scope: 'equipment',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: saved?.id ?? null,
      tenantId,
      metadata: saved
        ? {
            name: saved.name,
            after: { name: saved.name, model: saved.model, qty: saved.qty, isActive: saved.isActive },
          }
        : undefined,
    });

    return NextResponse.json({ equipment: saved }, { status: 201 });
  },
  { domain: 'equipment' }
);
