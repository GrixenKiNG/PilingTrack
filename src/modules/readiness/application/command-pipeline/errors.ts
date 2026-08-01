export type ReadinessErrorCode =
  | 'PRECONDITION_REQUIRED'
  | 'INVALID_PRECONDITION'
  | 'VERSION_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'COMMAND_IN_PROGRESS'
  | 'RETRYABLE_TRANSACTION_FAILURE';

export class ReadinessCommandError extends Error {
  constructor(
    public readonly code: ReadinessErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ReadinessCommandError';
  }
}

export const preconditionRequired = () => new ReadinessCommandError(
  'PRECONDITION_REQUIRED', 428, 'A strong If-Match or expected version is required',
);

export const invalidPrecondition = (message: string) => new ReadinessCommandError(
  'INVALID_PRECONDITION', 400, message,
);

export const commandInProgress = () => new ReadinessCommandError(
  'COMMAND_IN_PROGRESS', 409, 'An identical command is still in progress', undefined,
  {'Retry-After': '1'},
);
