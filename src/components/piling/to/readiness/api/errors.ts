export type ReadinessApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'
  | 'CANCELLED';

export class ReadinessApiError extends Error {
  constructor(
    readonly code: ReadinessApiErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ReadinessApiError';
  }

  get retryable(): boolean {
    return this.code === 'RATE_LIMITED'
      || this.code === 'UNAVAILABLE'
      || this.code === 'REQUEST_FAILED';
  }
}

export class ReadinessRequestCancelledError extends ReadinessApiError {
  constructor() {
    super('CANCELLED', 'Запрос отменён.');
    this.name = 'ReadinessRequestCancelledError';
  }
}

export function isReadinessRequestCancelled(error: unknown): boolean {
  return error instanceof ReadinessRequestCancelledError
    || (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

