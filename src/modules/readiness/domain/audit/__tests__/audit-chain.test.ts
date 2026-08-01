import {describe, expect, it} from 'vitest';
import {canonicalize} from '../canonicalize';
import {digestAuditEvent} from '../digest';
import {maskAuditPayload, MAX_MASKED_AUDIT_BYTES} from '../mask';

describe('audit canonicalization and masking', () => {
  it('matches RFC 8785 ordering and number vectors', () => {
    expect(canonicalize({b: 1, a: [3, -0, 1e-7]})).toBe('{"a":[3,0,1e-7],"b":1}');
    expect(canonicalize({'€': 'Euro Sign', '\r': 'Carriage Return', '1': 'One'}))
      .toBe('{"\\r":"Carriage Return","1":"One","€":"Euro Sign"}');
  });

  it('rejects values outside the JSON data model', () => {
    expect(() => canonicalize({bad: undefined})).toThrow(/unsupported/);
    expect(() => canonicalize({bad: Number.NaN})).toThrow(/finite/);
    expect(() => canonicalize({bad: BigInt(1)})).toThrow(/unsupported/);
  });

  it('masks case-insensitive secrets and contacts recursively', () => {
    expect(maskAuditPayload({
      AccessToken: 'token', access_token: 'token-2', api_key: 'key',
      nested: {EMAIL: 'a@example.test'}, rows: [{phone: '+7000'}], safe: 3,
    })).toEqual({
      AccessToken: '[REDACTED]', access_token: '[REDACTED]', api_key: '[REDACTED]',
      nested: {EMAIL: '[REDACTED]'}, rows: [{phone: '[REDACTED]'}], safe: 3,
    });
  });

  it('enforces depth and masked byte limits', () => {
    let deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 34; index += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }
    expect(() => maskAuditPayload(deep)).toThrow(/depth/);
    expect(() => maskAuditPayload({safe: 'x'.repeat(MAX_MASKED_AUDIT_BYTES)})).toThrow(/exceeds/);
  });

  it('uses the ADR-0043 golden digest formula', () => {
    expect(digestAuditEvent({
      tenantId: 'tenant-1', sequence: '1', prevHash: null, canonicalEvent: '{"a":1}',
    })).toBe('e459dbbbb173d03bfe7c85deba690e85ff7b37e3414c8149f730b2f26adfc5f3');
  });
});
