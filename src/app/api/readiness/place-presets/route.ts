import type {NextRequest} from 'next/server';
import {z} from 'zod';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {withReadinessRequestTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../_shared/response';
import {withReadinessCommand} from '../_shared/route-adapter';

export const runtime = 'nodejs';

const savePlacePresetSchema = z.object({
  location: z.string().trim().min(2).max(200),
  objectName: z.string().trim().max(200).optional(),
}).strict();

/** Ключ против дублей: «Площадка 3» и «площадка 3» — одно место. */
const normalizeKey = (location: string, objectName: string) =>
  `${location}|${objectName}`.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');

/**
 * Сохранить место работ в личные подсказки.
 *
 * Список личный: и пишется, и читается только своим владельцем. Общий
 * справочник площадок здесь был бы хуже — админу пришлось бы заводить их
 * наперёд, а чужие площадки засоряли бы подсказки (решение владельца
 * 16.08.2026).
 *
 * Повторное сохранение того же места не создаёт второй строки, а обновляет
 * отметку последнего использования: подсказки сортируются по свежести.
 */
export const POST = withReadinessCommand(async (request, context) => {
  const parsed = savePlacePresetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректное место работ', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  const location = parsed.data.location;
  const objectName = parsed.data.objectName ?? '';
  const row = await withReadinessRequestTransaction(context.tenantId, (tx) =>
    tx.userPlacePreset.upsert({
      where: {
        tenantId_userId_normalizedKey: {
          tenantId: context.tenantId,
          userId: context.actorId,
          normalizedKey: normalizeKey(location, objectName),
        },
      },
      update: {usedAt: new Date(), location, objectName},
      create: {
        tenantId: context.tenantId,
        userId: context.actorId,
        location,
        objectName,
        normalizedKey: normalizeKey(location, objectName),
      },
      select: {id: true, location: true, objectName: true},
    }));
  return readinessResponse({
    body: {data: row}, status: 200,
    correlationId: context.correlationId, requestId: context.requestId,
  });
}, {domain: 'readiness-place-presets'});

/** Удалить своё сохранённое место: список личный, чужое не тронуть. */
export async function DELETE(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Не указан шаблон места');
    const removed = await withReadinessRequestTransaction(context.tenantId, (tx) =>
      // deleteMany с фильтром по userId, а не delete по id: удалить чужую
      // строку не должно получаться даже при подобранном идентификаторе.
      tx.userPlacePreset.deleteMany({where: {tenantId: context.tenantId, userId: context.actorId, id}}));
    if (removed.count === 0) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Шаблон места не найден');
    return readinessResponse({
      body: {data: {id}}, status: 200,
      correlationId: context.correlationId, requestId: context.requestId,
    });
  } catch (error) {
    if (error instanceof ReadinessCommandError) {
      return readinessErrorResponse(error, context.correlationId, context.requestId);
    }
    throw error;
  }
}
