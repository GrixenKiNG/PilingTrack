import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {withReadinessRequestTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../_shared/response';

export const runtime = 'nodejs';

/**
 * Всё, что нужно форме наряда-допуска, одним запросом: виды работ, люди для
 * выбора ответственных и подсказки мест.
 *
 * Почему отдельный маршрут, а не готовые `/api/users`. Тот список требует права
 * `users.manage` — администраторского. Наряд же оформляет механик или инженер
 * ОТ, и им нужно всего лишь выбрать фамилию из списка. Отдавать ради этого
 * администраторский доступ нельзя, поэтому здесь узкая выборка: идентификатор,
 * имя и роль активных сотрудников организации, ничего больше — ни почты, ни
 * телефона, ни отметок входа.
 *
 * Три источника собраны вместе намеренно: форма открывается один раз и просит
 * всё сразу, три отдельных запроса дали бы три состояния загрузки на одном
 * экране и три способа показать полупустую форму.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;
  try {
    if (!context.capabilities.has('readiness.permit.edit')) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Нет права оформлять наряд-допуск');
    }
    const data = await withReadinessRequestTransaction(context.tenantId, async (tx) => {
      const [workTypes, people, presets, sites] = await Promise.all([
        tx.permitWorkType.findMany({
          where: {tenantId: context.tenantId, isActive: true},
          orderBy: [{sortOrder: 'asc'}, {name: 'asc'}],
          select: {
            id: true, name: true, hint: true, icon: true, defaultRisk: true,
            hazardPresets: true, requiredApprovals: true, allowAuthorApproval: true,
          },
        }),
        tx.user.findMany({
          where: {tenantId: context.tenantId, isActive: true},
          orderBy: {name: 'asc'},
          select: {id: true, name: true, role: true},
        }),
        // Личные шаблоны мест: только свои. Чужие площадки в подсказках мешали
        // бы, а не помогали, и раскрывали бы, кто где работает.
        tx.userPlacePreset.findMany({
          where: {tenantId: context.tenantId, userId: context.actorId},
          orderBy: {usedAt: 'desc'},
          take: 50,
          select: {id: true, location: true, objectName: true},
        }),
        tx.site.findMany({
          where: {tenantId: context.tenantId, isActive: true},
          orderBy: {name: 'asc'},
          select: {name: true},
        }),
      ]);
      return {
        workTypes,
        people,
        placePresets: presets,
        // Объекты организации — подсказки для поля «Объект». В наряд попадает
        // текст, а не ссылка, поэтому отдаём только названия.
        objectNames: sites.map((site) => site.name),
      };
    });
    return readinessResponse({
      body: {...data, meta: {correlationId: context.correlationId}},
      status: 200, correlationId: context.correlationId, requestId: context.requestId,
    });
  } catch (error) {
    if (error instanceof ReadinessCommandError) {
      return readinessErrorResponse(error, context.correlationId, context.requestId);
    }
    throw error;
  }
}
