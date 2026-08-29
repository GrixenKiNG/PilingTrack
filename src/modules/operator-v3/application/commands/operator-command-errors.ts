export type OperatorCommandErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EQUIPMENT_NOT_ASSIGNED'
  | 'ACTIVE_SHIFT_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'COMMAND_IN_PROGRESS'
  | 'REQUIRED_ACTION_INCOMPLETE'
  | 'INVALID_TRANSITION'
  | 'READINESS_DENIED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export class OperatorCommandError extends Error {
  constructor(
    readonly code: OperatorCommandErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'OperatorCommandError';
  }
}

export function unknownOperatorCommand(commandName: string): OperatorCommandError {
  return new OperatorCommandError(
    'NOT_FOUND',
    404,
    'Запрошенное действие не существует или больше недоступно',
    {commandName},
  );
}
