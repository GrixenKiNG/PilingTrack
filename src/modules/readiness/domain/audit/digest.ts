import {createHash} from 'node:crypto';

export const AUDIT_DIGEST_DOMAIN = 'PILINGTRACK-AUDIT-V1';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestAuditEvent(input: {
  tenantId: string;
  sequence: string;
  prevHash: string | null;
  canonicalEvent: string;
}): string {
  return sha256Hex(
    `${AUDIT_DIGEST_DOMAIN}\n${input.tenantId}\n${input.sequence}\n${input.prevHash ?? ''}\n${input.canonicalEvent}`,
  );
}

export function digestIdempotencyKey(key: string): string {
  return sha256Hex(key);
}
