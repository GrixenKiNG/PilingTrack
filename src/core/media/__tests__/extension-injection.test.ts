/**
 * getExtensionForContentType — path/key injection regression.
 *
 * Pre-existing IDOR-adjacent bug: the extension used to be derived from the
 * client-supplied fileName (raw, no sanitization), while buildMediaKey()
 * concatenates it unsanitized after the safe()-cleaned segments. A fileName
 * with exactly one "." followed by a "/"-bearing suffix and no further dots
 * (e.g. "x.tar/../other-tenant/forged") made the old getExtension() return
 * a string containing "/" and "..", letting an uploader smuggle the S3 key
 * outside its intended media/<tenant>/<entityType>/<entityId>/ prefix —
 * into another tenant's folder. Deriving the extension strictly from the
 * server-validated contentType (this test) closes that off: there's no
 * client-controlled string in the key construction path anymore.
 */
import { describe, it, expect } from 'vitest';
import { getExtensionForContentType, buildMediaKey } from '../media-service';

describe('getExtensionForContentType', () => {
  it('maps every allowlisted content type to a clean extension', () => {
    expect(getExtensionForContentType('image/jpeg')).toBe('.jpg');
    expect(getExtensionForContentType('image/png')).toBe('.png');
    expect(getExtensionForContentType('application/pdf')).toBe('.pdf');
    expect(getExtensionForContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('.docx');
  });

  it('returns empty string for an unmapped content type — never echoes attacker input', () => {
    // A previously-injected payload disguised as a "content type" still can't
    // produce a path-bearing extension, because the function only ever
    // returns a value from its own fixed map or ''.
    expect(getExtensionForContentType('image/jpeg/../../other-tenant/forged')).toBe('');
    expect(getExtensionForContentType('not-a-real-type')).toBe('');
  });

  it('the resulting key never escapes the sanitized media/<tenant>/... prefix', () => {
    const extension = getExtensionForContentType('image/jpeg');
    const key = buildMediaKey('tenant-a', 'equipment', 'eq-1', 'media-id', extension);
    expect(key).toBe('media/tenant-a/equipment/eq-1/media-id.jpg');
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(5); // media/tenant/equipment/eq-1/media-id.jpg
  });
});
