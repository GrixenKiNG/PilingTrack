import {ReadinessCommandError} from '../../application/command-pipeline/errors';

export function validateShiftWindow(start: Date | null, end: Date | null): void {
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные даты смены');
  }
  if (start && end && end <= start) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Окончание смены должно быть позже начала');
  }
}

export function requireCancellationReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Причина: от 3 до 1000 символов');
  }
  return reason;
}
