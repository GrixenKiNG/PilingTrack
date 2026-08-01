import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import {assertPermitTransition} from './transitions';
import type {WorkPermitContent, WorkPermitRecord} from './types';

export function validatePermitContent(content: WorkPermitContent): WorkPermitContent {
  const scope = content.scope.trim();
  if (scope.length < 3 || scope.length > 4000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Permit scope must be 3 to 4000 characters');
  }
  if (content.shiftId) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422,
      'Shift linkage is unavailable until the Shift aggregate migration is active',
    );
  }
  if (!Number.isFinite(content.validFrom.getTime()) || !Number.isFinite(content.validTo.getTime())) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Permit timestamps are invalid');
  }
  if (content.validTo <= content.validFrom) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'validTo must be later than validFrom');
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
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Permit edit contains no substantive change');
  }
  return {
    content,
    version: permit.version + 1,
    state: 'DRAFT',
    invalidatesApprovals: permit.approvals.some((item) => item.valid),
  };
}
