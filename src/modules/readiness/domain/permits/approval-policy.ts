import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {
  WorkPermitApprovalRecord,
  WorkPermitApprovalRole,
  WorkPermitRecord,
  WorkPermitRisk,
} from './types';

export function requiredApprovalRoles(risk: WorkPermitRisk): readonly WorkPermitApprovalRole[] {
  return risk === 'NORMAL' ? ['DISPATCHER'] : ['DISPATCHER', 'ADMIN'];
}

export function assertCanApprovePermit(input: {
  permit: WorkPermitRecord;
  actorId: string;
  role: string;
  approvals: WorkPermitApprovalRecord[];
}): WorkPermitApprovalRole {
  const role = input.role === 'DISPATCHER' || input.role === 'ADMIN' ? input.role : null;
  if (!role || !requiredApprovalRoles(input.permit.risk).includes(role)) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'У вас нет полномочий согласовать этот наряд');
  }
  // «Второй глаз» требуется на работах повышенного риска — там наряд обязаны
  // подписать двое разных людей (см. isApprovalComplete).
  //
  // На обычных работах запрет снят намеренно. В ОРИОНе наряды заводит
  // администратор, замещая механика или инженера ОТ, и согласовать их, кроме
  // него, было некому: у диспетчера нет права редактировать наряд, а у автора
  // не было права подписать. Контур вставал целиком. Кто подписал и от чьего
  // имени — видно в цепочке аудита, поэтому след не теряется.
  if (
    input.permit.risk !== 'NORMAL'
    && (input.actorId === input.permit.authorId || input.actorId === input.permit.lastEditedById)
  ) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Наряд повышенного риска согласует не его автор');
  }
  const current = input.approvals.filter((item) =>
    item.valid && item.permitVersion === input.permit.version);
  if (current.some((item) => item.role === role)) {
    throw new ReadinessCommandError('VERSION_CONFLICT', 409, `Решение по этой роли уже принято: ${role}`);
  }
  if (current.some((item) => item.approvedById === input.actorId)) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422, 'Повышенный риск требует согласования двумя разными людьми',
    );
  }
  return role;
}

export function isApprovalComplete(
  risk: WorkPermitRisk,
  approvals: WorkPermitApprovalRecord[],
  version: number,
): boolean {
  const current = approvals.filter((item) => item.valid && item.permitVersion === version);
  const roles = new Set(current.map((item) => item.role));
  const users = new Set(current.map((item) => item.approvedById));
  const required = requiredApprovalRoles(risk);
  return required.every((role) => roles.has(role))
    && (risk === 'NORMAL' || users.size === required.length);
}
