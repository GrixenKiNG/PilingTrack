/**
 * Происшествия и опасные наблюдения, заявленные с телефона.
 *
 * Отдельно от осмотра намеренно: осмотр отвечает на заранее заданные вопросы,
 * происшествие — это то, чего в списке вопросов не было.
 */
import {enqueueAlert} from '@/core/notifications/durable-alert';
import type {Prisma} from '@/generated/postgres-client/client';
import {logger} from '@/lib/logger';
import {describeAuditEvent, type AuditEvent} from '@/modules/system';
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

  const outcome = await withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId, input.operatorId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    const duplicate = await tx.safetyIncident.findUnique({
      where: {tenantId_clientCommandId: {
        tenantId: input.tenantId, clientCommandId: input.clientCommandId,
      }},
      select: {id: true, severity: true, stopRequired: true},
    });
    if (duplicate) {
      return {result: {
        incidentId: duplicate.id,
        severity: duplicate.severity,
        stopRequired: duplicate.stopRequired,
      }, audit: null};
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

    const audit: AuditEvent = {
      action: 'incident.reported', scope: 'safety', actorId: input.operatorId,
      targetId: incident.id, tenantId: input.tenantId,
      metadata: {
        tenantId: input.tenantId, shiftId: input.shiftId,
        equipmentId: shift.equipmentId, siteId: crew.siteId,
        category: input.category, observedSigns: input.signs, injured: input.injured,
        description: input.description.trim(), severity: classification.severity,
        stopRequired: classification.stopRequired, clientCommandId: input.clientCommandId,
        occurredAt: now.toISOString(),
      },
    };
    const description = describeAuditEvent(audit);
    const actor = await tx.user.findUnique({
      where: {id: input.operatorId}, select: {name: true, role: true},
    });
    // След сохраняется вместе с происшествием: отказ записи откатывает команду.
    await tx.feedbackEvent.create({data: {
      level: description.level, priority: description.level === 'warn' ? 'HIGH' : 'MEDIUM',
      scope: audit.scope, action: audit.action, title: description.title,
      message: description.message, audience: 'OPERATIONS',
      actorId: input.operatorId, actorName: actor?.name ?? null, actorRole: actor?.role ?? null,
      targetId: incident.id, requestId: null,
      metadata: audit.metadata as Prisma.InputJsonValue,
    }});

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
      // Правило алерта: без него у происшествия нет выключателя в настройках
      // (durable-доставка гасит по `ruleId`, см. durable-alert-delivery.ts).
      // Решение владельца 26.09.2026: «прекратить работы» (сюда входит и
      // «есть пострадавший» — classifyObservedHazard) приходит всегда, поэтому
      // у него своё правило без выключателя; выключается только мелкое.
      ruleId: classification.stopRequired ? 'incidentStopWork' : 'incident',
      message: (classification.stopRequired ? 'Происшествие: требуется прекратить работы. ' : 'Происшествие: ') + input.description,
    }});
    return {result: {
      incidentId: incident.id,
      severity: classification.severity,
      stopRequired: classification.stopRequired,
    }, audit};
  });
  // Транзакция уже завершена; повтор clientCommandId не создаёт новый след.
  if (outcome.audit) logger.info('audit', outcome.audit as unknown as Record<string, unknown>);
  return outcome.result;
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

