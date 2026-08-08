export const READINESS_REQUEST_ID_HEADER = 'x-request-id';
export const READINESS_IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

function randomIdentifier(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createReadinessRequestId(): string {
  return `readiness-${randomIdentifier()}`;
}

export function createReadinessIdempotencyKey(command: string): string {
  return `readiness:${command}:${randomIdentifier()}`;
}

