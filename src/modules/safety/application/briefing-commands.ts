/**
 * Проведение инструктажа и подписи под записью журнала.
 *
 * ЗАЧЕМ. До 13.09.2026 записи в журнале появлялись ровно одним способом — сам
 * работник нажимал «Ознакомлен» в телефоне перед сменой. Вводный при приёме,
 * целевой перед работами вблизи ЛЭП, внеплановый после происшествия проводит
 * ЧЕЛОВЕК и заносит их в журнал сам; такого хода в системе не было вовсе, и
 * бумажный журнал жил отдельно от электронного.
 *
 * ПОДПИСЬ ЗДЕСЬ — ОТМЕТКА В ПРИЛОЖЕНИИ, А НЕ КВАЛИФИЦИРОВАННАЯ ЭП (решение
 * владельца 13.09.2026). Мы фиксируем, кто и когда подтвердил; это внутренний
 * журнал. Называть это «электронной подписью» в интерфейсе нельзя — человек
 * решит, что документ имеет силу, которой у него нет.
 *
 * ПОЧЕМУ ПОДПИСЫВАЮТ ДВОЕ И ПО ОТДЕЛЬНОСТИ. Инструктаж — это встреча двоих, и
 * запись доказывает её только когда подтвердили оба. Инструктор ставит свою
 * отметку сразу, работник — когда прочитал; проставить обе одним нажатием
 * означало бы расписаться за другого.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type { BriefingType } from '@/generated/postgres-client/client';

export interface ConductBriefingInput {
  userId: string;
  type: BriefingType;
  documentCode: string;
  documentTitle: string;
  documentVersion: string;
  reason: string;
  /** Когда провели. По умолчанию — сейчас. */
  recordedAt?: Date;
}

export interface BriefingActor {
  id: string;
  name: string;
}

/**
 * Записать проведённый инструктаж.
 *
 * Подпись инструктора ставится сразу: он и есть тот, кто сейчас нажимает
 * кнопку, и отдельное второе действие «подписать своё» было бы обрядом.
 * Работник подписывает отдельно — `signBriefingRecord`.
 */
export async function conductBriefing(input: {
  tenantId: string;
  actor: BriefingActor;
  /** `users.documents.read_all` — то же право, что у журнала. Считает маршрут. */
  mayManageBriefings: boolean;
  payload: ConductBriefingInput;
}) {
  if (!input.mayManageBriefings) {
    throw new ServiceError('Недостаточно прав для проведения инструктажа', 403);
  }
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const { payload } = input;
  if (!payload.documentCode || !payload.documentTitle || !payload.documentVersion) {
    throw new ServiceError('Не указана инструкция', 400);
  }

  // Работник обязан быть из своей организации. Без этой проверки запись
  // легла бы на чужого человека — с его именем в снимке и нашим tenantId.
  const employee = await db.user.findFirst({
    where: { id: payload.userId, tenantId: input.tenantId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!employee) throw new ServiceError('Работник не найден', 404);
  if (!employee.isActive) {
    throw new ServiceError('Работник не числится действующим', 400);
  }

  const recordedAt = payload.recordedAt ?? new Date();
  // Инструктаж «проведут завтра» — это план, а не запись журнала. Задним
  // числом заносить разрешаем: бумажный журнал переносят именно так.
  if (recordedAt.getTime() > Date.now() + 60_000) {
    throw new ServiceError('Инструктаж нельзя записать будущей датой', 400);
  }

  return db.briefingRecord.create({
    data: {
      tenantId: input.tenantId,
      userId: employee.id,
      kind: 'INSTRUCTION',
      type: payload.type,
      userName: employee.name,
      userRole: employee.role,
      documentCode: payload.documentCode,
      documentTitle: payload.documentTitle,
      documentVersion: payload.documentVersion,
      reason: payload.reason,
      instructorId: input.actor.id,
      instructorName: input.actor.name,
      instructorSignedAt: new Date(),
      recordedAt,
    },
    select: { id: true },
  });
}

/**
 * Поставить свою отметку под записью.
 *
 * Кто подписывает, решает не запрос, а сама запись: работник ставит отметку
 * работника, инструктор — инструктора. Параметр «за кого подписать» открыл бы
 * ровно ту дверь, ради закрытия которой подписи и заводились.
 *
 * Повторное нажатие ничего не меняет: время первой отметки — это и есть факт,
 * и переписывать его вторым нажатием значит терять момент подтверждения.
 */
export async function signBriefingRecord(input: {
  tenantId: string;
  actorId: string;
  recordId: string;
}) {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const record = await db.briefingRecord.findFirst({
    where: { id: input.recordId, tenantId: input.tenantId },
    select: {
      id: true, userId: true, instructorId: true,
      employeeSignedAt: true, instructorSignedAt: true,
    },
  });
  if (!record) throw new ServiceError('Запись журнала не найдена', 404);

  const isEmployee = record.userId === input.actorId;
  const isInstructor = record.instructorId === input.actorId;
  if (!isEmployee && !isInstructor) {
    throw new ServiceError('Подписать эту запись может только её работник или инструктор', 403);
  }

  if (isEmployee && record.employeeSignedAt) return { alreadySigned: true };
  if (isInstructor && record.instructorSignedAt) return { alreadySigned: true };

  await db.briefingRecord.update({
    where: { id: record.id },
    data: isEmployee
      ? { employeeSignedAt: new Date() }
      : { instructorSignedAt: new Date() },
  });
  return { alreadySigned: false };
}
