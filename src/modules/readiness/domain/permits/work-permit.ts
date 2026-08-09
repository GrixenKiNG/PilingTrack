import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import {assertPermitTransition} from './transitions';
import type {WorkPermitContent, WorkPermitRecord} from './types';

export function validatePermitContent(content: WorkPermitContent): WorkPermitContent {
  const scope = content.scope.trim();
  if (scope.length < 3 || scope.length > 4000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Описание работ: от 3 до 4000 символов');
  }
  if (content.shiftId) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422,
      'Привязка наряда к смене пока недоступна',
    );
  }
  if (!Number.isFinite(content.validFrom.getTime()) || !Number.isFinite(content.validTo.getTime())) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные даты действия наряда');
  }
  if (content.validTo <= content.validFrom) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Дата окончания должна быть позже даты начала');
  }
  return {...content, scope, shiftId: null};
}

export function editPermit(
  permit: WorkPermitRecord,
  patch: Partial<WorkPermitContent>,
  actorId: string,
): {content: WorkPermitContent; version: number; state: 'DRAFT'; invalidatesApprovals: boolean} {
  assertPermitTransition(permit.state, 'edit');
  const content = validatePermitContent({
    equipmentId: patch.equipmentId ?? permit.equipmentId,
    shiftId: patch.shiftId === undefined ? permit.shiftId : patch.shiftId,
    risk: patch.risk ?? permit.risk,
    scope: patch.scope ?? permit.scope,
    validFrom: patch.validFrom ?? permit.validFrom,
    validTo: patch.validTo ?? permit.validTo,
  });
  const changed = content.equipmentId !== permit.equipmentId
    || content.shiftId !== permit.shiftId
    || content.risk !== permit.risk
    || content.scope !== permit.scope
    || content.validFrom.getTime() !== permit.validFrom.getTime()
    || content.validTo.getTime() !== permit.validTo.getTime();
  if (!changed) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'В наряде нечего сохранять — изменений нет');
  }
  return {
    content,
    version: permit.version + 1,
    state: 'DRAFT',
    invalidatesApprovals: permit.approvals.some((item) => item.valid),
  };
}
