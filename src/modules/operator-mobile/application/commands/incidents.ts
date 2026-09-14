/**
 * Происшествия и опасные наблюдения, заявленные с телефона.
 *
 * Отдельно от осмотра намеренно: осмотр отвечает на заранее заданные вопросы,
 * происшествие — это то, чего в списке вопросов не было.
 */
import {enqueueAlert} from '@/core/notifications/durable-alert';
import type {Prisma} from '@/generated/postgres-client/client';
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {requestReadinessSnapshot} from '@/modules/readiness/server';
import {classifyObservedHazard, validateIncident, type IncidentCategory, type IncidentSign} from '../../domain/incidents';
import {OperatorCommandError, requireCrew, requireOpenShift} from './shared';
import type {Tx} from './shared';

/**
 * Происшествие на смене.
 *
 * ПОЧЕМУ ЗАПИСЬ, А НЕ ЗАПРЕТ. Оценку «критично» ставит правило по названным
 * признакам, и оно же говорит, что работы надо прекратить. Но прекращает их
 * человек: приложение не видит площадку и не может знать, чем обернётся
 * остановка посреди погружения сваи. Поэтому происшествие поднимает красное
 * предупреждение оператору и диспетчеру и остаётся на виду, пока его не
 * разберут, — но кнопок не запирает. Единственное, что здесь действительно
 * запрещает работу, — погода, и она измеряется прибором, а не человеком.
 *
 * ПОЧЕМУ ФОТО НЕ ОБЯЗАТЕЛЬНО. У происшествия с человеком первое действие —
 * помочь, а не снимать. Требовать снимок значит либо задержать помощь, либо
 * научить людей писать «прочее» вместо правды.
 */
export async function reportIncident(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  category: IncidentCategory;
  signs: IncidentSign[];
  injured: boolean;
  description: string;
  mediaIds?: string[];
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const problems = validateIncident({
    category: input.category,
    signs: input.signs,
    injured: input.injured,
    description: input.description,
  });
  if (problems.length > 0) {
    throw new OperatorCommandError(400, problems[0], problems);
  }

  const classification = classifyObservedHazard({
    observedSigns: input.signs, injured: input.injured,
  });

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    const duplicate = await tx.safetyIncident.findUnique({
      where: {tenantId_clientCommandId: {
        tenantId: input.tenantId, clientCommandId: input.clientCommandId,
      }},
      select: {id: true, severity: true, stopRequired: true},
    });
    if (duplicate) {
      return {
        incidentId: duplicate.id,
        severity: duplicate.severity,
        stopRequired: duplicate.stopRequired,
      };
    }

    const mediaIds = await confirmedIncidentImages(
      tx, input.tenantId, input.operatorId, input.clientCommandId, input.mediaIds ?? [],
    );

    const incident = await tx.safetyIncident.create({
      data: {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        equipmentId: shift.equipmentId,
        siteId: crew.siteId,
        category: input.category,
        // Состояние ведём тем же словарём, что достался от прежнего модуля:
        // таблица одна, и два набора состояний в ней означали бы, что
        // администратор видит строки, смысл которых зависит от того, каким
        // экраном их завели.
        state: classification.stopRequired ? 'STOP_REQUIRED' : 'REPORTED',
        severity: classification.severity,
        description: input.description.trim(),
        observedSigns: input.signs as unknown as Prisma.InputJsonValue,
        stopRequired: classification.stopRequired,
        injured: input.injured,
        evidenceMediaIds: mediaIds as unknown as Prisma.InputJsonValue,
        classificationRuleId: classification.ruleId,
        classificationRuleVersion: classification.ruleVersion,
        occurredAt: now,
        reportedById: input.operatorId,
        clientCommandId: input.clientCommandId,
      },
      select: {id: true},
    });

    // Готовность пересчитываем: происшествие — такой же факт о машине, как
    // осмотр, и центр готовности должен узнать о нём без ручного обновления.
    await requestReadinessSnapshot(tx as unknown as Parameters<typeof requestReadinessSnapshot>[0], {
      tenantId: input.tenantId,
      equipmentId: shift.equipmentId,
      aggregateId: incident.id,
      aggregateType: 'SafetyIncident',
      triggerType: 'SAFETY_INCIDENT_REPORTED',
      triggerId: incident.id,
      occurredAt: now,
      shiftId: input.shiftId,
    });

    await enqueueAlert(tx, {tenantId: input.tenantId, aggregateId: incident.id, alert: {
      severity: classification.severity === 'CRITICAL' ? 'critical' : classification.severity === 'HIGH' ? 'high' : 'medium',
      message: (classification.stopRequired ? 'Происшествие: требуется прекратить работы. ' : 'Происшествие: ') + input.description,
    }});
    return {
      incidentId: incident.id,
      severity: classification.severity,
      stopRequired: classification.stopRequired,
    };
  });
}

/**
 * Снимки происшествия: те же правила, что и у неисправностей в осмотре —
 * идентификатор без подтверждённой загрузки ничего не доказывает.
 */
async function confirmedIncidentImages(
  tx: Tx, tenantId: string, actorId: string, clientCommandId: string, mediaIds: string[],
): Promise<string[]> {
  if (mediaIds.length === 0) return [];
  const confirmed = await tx.media.findMany({
    where: {
      id: {in: mediaIds},
      tenantId,
      userId: actorId,
      entityType: 'safety_incident',
      entityId: clientCommandId,
      uploadStatus: 'completed',
      isDeleted: false,
    },
    select: {id: true, contentType: true},
  });
  const usable = confirmed
    .filter((media) => media.contentType?.startsWith('image/'))
    .map((media) => media.id);
  if (usable.length !== mediaIds.length) {
    throw new OperatorCommandError(400, 'Снимок не долетел до хранилища. Повторите отправку фото.');
  }
  return usable;
}

