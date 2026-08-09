import {ReadinessCommandError} from '../../application/command-pipeline/errors';

export function validateHandoverSummary(value: string): string {
  const summary = value.trim();
  if (summary.length < 3 || summary.length > 4000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Состояние техники: от 3 до 4000 символов');
  }
  return summary;
}

export function requireReworkReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Причина возврата: от 3 до 1000 символов');
  }
  return reason;
}
