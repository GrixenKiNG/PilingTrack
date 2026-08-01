import {randomUUID} from 'node:crypto';

const SAFE_CORRELATION = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveCorrelationId(value?: string | null): string {
  const candidate = value?.trim();
  return candidate && SAFE_CORRELATION.test(candidate) ? candidate : randomUUID();
}
