import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {
  WorkPermitApprovalRecord,
  WorkPermitApprovalRole,
  WorkPermitRecord,
} from './types';

/**
 * Действующее правило согласования наряда.
 *
 * Раньше оно выводилось из риска прямо здесь: обычный — диспетчер, повышенный —
 * диспетчер и админ. Владелец 16.08.2026 указал, что это не решение
 * разработчика: нормативы у каждой организации свои, и сколько подписей требуют
 * такие-то работы, знает админ, а не код. Требование переехало в справочник
 * видов работ, а наряд хранит его СНИМОК на момент оформления.
 *
 * Пустой список — не «подписи не нужны», а недонастроенный вид работ. Считаем
 * такой наряд несогласуемым: отказ безопаснее, чем наряд, который согласуется
 * сам собой, не собрав ни одной подписи.
 */
function effectiveApprovalRule(permit: WorkPermitRecord): {
  roles: readonly WorkPermitApprovalRole[]; allowAuthorApproval: boolean;
} {
  return {roles: permit.requiredApprovals, allowAuthorApproval: permit.allowAuthorApproval};
}

export function requiredApprovalRoles(permit: WorkPermitRecord): readonly WorkPermitApprovalRole[] {
  return effectiveApprovalRule(permit).roles;
}

export function assertCanApprovePermit(input: {
  permit: WorkPermitRecord;
  actorId: string;
  role: string;
  approvals: WorkPermitApprovalRecord[];
}): WorkPermitApprovalRole {
  const {roles, allowAuthorApproval} = effectiveApprovalRule(input.permit);
  if (roles.length === 0) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422,
      'Для этого вида работ не заданы согласующие. Настройте их в справочнике видов работ',
    );
  }
  const role = input.role === 'DISPATCHER' || input.role === 'ADMIN' ? input.role : null;
  if (!role || !roles.includes(role)) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'У вас нет полномочий согласовать этот наряд');
  }
  // Может ли автор подписать собственный наряд — решает админ на виде работ.
  // Раньше это было зашито: на повышенном риске нельзя, на обычном можно.
  // Обе половины этого правила остались значениями по умолчанию, но теперь их
  // видно и можно изменить, а не вычитывать из исходников.
  if (
    !allowAuthorApproval
    && (input.actorId === input.permit.authorId || input.actorId === input.permit.lastEditedById)
  ) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Этот наряд согласует не его автор');
  }
  const current = input.approvals.filter((item) =>
    item.valid && item.permitVersion === input.permit.version);
  if (current.some((item) => item.role === role)) {
    throw new ReadinessCommandError('VERSION_CONFLICT', 409, `Решение по этой роли уже принято: ${role}`);
  }
  // Несколько требуемых подписей — значит несколько РАЗНЫХ людей: иначе «два
  // согласования» вырождаются в одного человека, дважды нажавшего кнопку.
  // При одной требуемой подписи ограничение бессмысленно и не применяется.
  if (roles.length > 1 && current.some((item) => item.approvedById === input.actorId)) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422, 'Этот наряд требует согласования разными людьми',
    );
  }
  return role;
}

export function isApprovalComplete(
  permit: WorkPermitRecord,
  approvals: WorkPermitApprovalRecord[],
  version: number,
): boolean {
  const {roles} = effectiveApprovalRule(permit);
  // Ни одной требуемой роли — наряд не считается согласованным. Пустое
  // требование это ошибка настройки, а не разрешение.
  if (roles.length === 0) return false;
  const current = approvals.filter((item) => item.valid && item.permitVersion === version);
  const signed = new Set(current.map((item) => item.role));
  const users = new Set(current.map((item) => item.approvedById));
  return roles.every((role) => signed.has(role))
    && (roles.length === 1 || users.size >= roles.length);
}
