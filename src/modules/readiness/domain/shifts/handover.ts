import {ReadinessCommandError} from '../../application/command-pipeline/errors';

export function validateHandoverSummary(value: string): string {
  const summary = value.trim();
  if (summary.length < 3 || summary.length > 4000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Handover summary must be 3 to 4000 characters');
  }
  return summary;
}

export function requireReworkReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Rework reason must be 3 to 1000 characters');
  }
  return reason;
}
