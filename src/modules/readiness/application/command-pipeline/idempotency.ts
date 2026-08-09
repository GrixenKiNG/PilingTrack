import {createHash} from 'node:crypto';
import {canonicalize} from '../../domain/audit/canonicalize';
import {ReadinessCommandError} from './errors';

export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_KEY = /^[\x21-\x7E]{16,128}$/;

export function requireIdempotencyKey(value?: string | null): string {
  if (!value) {
    throw new ReadinessCommandError(
      'IDEMPOTENCY_KEY_REQUIRED', 400, 'Не передан ключ повторной отправки',
    );
  }
  if (!VALID_KEY.test(value)) {
    throw new ReadinessCommandError(
      'INVALID_IDEMPOTENCY_KEY', 400,
      'Ключ повторной отправки должен содержать от 16 до 128 печатных символов ASCII',
    );
  }
  return value;
}

export function createIdempotencyScope(input: {
  method: string;
  routeTemplate: string;
  aggregateId?: string | null;
  actorId: string;
}): string {
  return [input.method.toUpperCase(), input.routeTemplate, input.aggregateId ?? '-', input.actorId].join(':');
}

export function hashCommandRequest(input: {
  method: string;
  routeTemplate: string;
  pathIds?: Record<string, string>;
  body?: unknown;
  expectedVersion?: number | null;
  actorId: string;
}): Buffer {
  const canonical = canonicalize({
    actorId: input.actorId,
    body: input.body ?? null,
    expectedVersion: input.expectedVersion ?? null,
    method: input.method.toUpperCase(),
    pathIds: input.pathIds ?? {},
    routeTemplate: input.routeTemplate,
  });
  return createHash('sha256').update(canonical, 'utf8').digest();
}

export function hashesEqual(left: Uint8Array | null, right: Uint8Array): boolean {
  if (!left || left.byteLength !== right.byteLength) return false;
  return Buffer.from(left).equals(Buffer.from(right));
}
