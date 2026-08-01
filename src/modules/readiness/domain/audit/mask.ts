import {canonicalize, toAuditJson} from './canonicalize';
import type {AuditJsonValue} from './types';

export const AUDIT_REDACTION = '[REDACTED]';
export const MAX_MASKED_AUDIT_BYTES = 256 * 1024;

const SENSITIVE_KEYS = new Set([
  'password', 'passphrase', 'pin', 'token', 'accesstoken', 'refreshtoken',
  'secret', 'apikey', 'cookie', 'set-cookie', 'authorization',
  'proxy-authorization', 'email', 'phone', 'mobile', 'address', 'postaladdress',
]);

function redact(value: AuditJsonValue): AuditJsonValue {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  const result: {[key: string]: AuditJsonValue} = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    result[key] = SENSITIVE_KEYS.has(normalizedKey) ? AUDIT_REDACTION : redact(child);
  }
  return result;
}

export function maskAuditPayload(value: unknown): AuditJsonValue {
  const masked = redact(toAuditJson(value));
  const byteLength = Buffer.byteLength(canonicalize(masked), 'utf8');
  if (byteLength > MAX_MASKED_AUDIT_BYTES) {
    throw new RangeError(`Masked audit payload exceeds ${MAX_MASKED_AUDIT_BYTES} bytes`);
  }
  return masked;
}

export function maskOptionalAuditPayload(value: unknown): AuditJsonValue | null {
  return value === undefined || value === null ? null : maskAuditPayload(value);
}
