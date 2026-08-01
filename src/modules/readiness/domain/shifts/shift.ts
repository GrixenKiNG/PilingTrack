import {ReadinessCommandError} from '../../application/command-pipeline/errors';

export function validateShiftWindow(start: Date | null, end: Date | null): void {
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Shift timestamps are invalid');
  }
  if (start && end && end <= start) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'plannedEndAt must be later than plannedStartAt');
  }
}

export function requireCancellationReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Cancellation reason must be 3 to 1000 characters');
  }
  return reason;
}
