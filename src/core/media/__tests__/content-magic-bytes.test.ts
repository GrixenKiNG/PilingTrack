/**
 * contentMatchesMagicBytes — closes the upload validation gap found in the
 * 2026-07-04 media review: getPresignedUrl/confirmUpload only ever checked
 * the client-declared Content-Type string against an allowlist. Nothing
 * verified the actual bytes, so a caller could declare "image/jpeg" and
 * upload arbitrary bytes straight through confirmUpload() (Sharp would
 * throw, but the catch block only logged a warning and still marked the
 * upload "completed" — see confirm-upload-validation.test.ts for the
 * end-to-end reproduction of that exact bypass).
 *
 * This function checks the real file-format signature ("magic bytes") of
 * the downloaded object against what the declared content type requires —
 * the one thing an attacker can't forge without producing an actual file of
 * that structure.
 */
import { describe, it, expect } from 'vitest';
import { contentMatchesMagicBytes } from '../media-service';

describe('contentMatchesMagicBytes', () => {
  it('accepts a real JPEG signature (FF D8 FF)', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(contentMatchesMagicBytes('image/jpeg', jpeg)).toBe(true);
  });

  it('accepts a real PNG signature', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(contentMatchesMagicBytes('image/png', png)).toBe(true);
  });

  it('accepts GIF87a and GIF89a signatures', () => {
    expect(contentMatchesMagicBytes('image/gif', Buffer.from('GIF87a...', 'ascii'))).toBe(true);
    expect(contentMatchesMagicBytes('image/gif', Buffer.from('GIF89a...', 'ascii'))).toBe(true);
  });

  it('accepts a real WebP (RIFF....WEBP) signature', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(contentMatchesMagicBytes('image/webp', webp)).toBe(true);
  });

  it('accepts HEIC/HEIF ISOBMFF ftyp boxes with a recognized brand', () => {
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]), // box size
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('heic', 'ascii'), // major brand
    ]);
    expect(contentMatchesMagicBytes('image/heic', heic)).toBe(true);
    expect(contentMatchesMagicBytes('image/heif', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from('mif1')]))).toBe(true);
  });

  it('accepts a real PDF signature (%PDF-)', () => {
    expect(contentMatchesMagicBytes('application/pdf', Buffer.from('%PDF-1.7\n', 'ascii'))).toBe(true);
  });

  it('accepts a real legacy .doc (OLE2 compound file) signature', () => {
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(contentMatchesMagicBytes('application/msword', ole2)).toBe(true);
  });

  it('accepts a real .docx (ZIP-based) signature', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(contentMatchesMagicBytes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zip,
    )).toBe(true);
  });

  it('THE REPORTED BYPASS: rejects arbitrary bytes declared as image/jpeg', () => {
    const notAnImage = Buffer.from('<script>alert(1)</script>this is not an image at all', 'utf8');
    expect(contentMatchesMagicBytes('image/jpeg', notAnImage)).toBe(false);
  });

  it('rejects a PNG file relabeled as image/jpeg (cross-type confusion)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(contentMatchesMagicBytes('image/jpeg', png)).toBe(false);
  });

  it('rejects an executable disguised as application/pdf', () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // ELF magic
    expect(contentMatchesMagicBytes('application/pdf', elf)).toBe(false);
  });

  it('rejects empty or too-short buffers', () => {
    expect(contentMatchesMagicBytes('image/jpeg', Buffer.alloc(0))).toBe(false);
    expect(contentMatchesMagicBytes('image/png', Buffer.from([0x89, 0x50]))).toBe(false);
  });

  it('rejects an unrecognized/unmapped content type — fail closed, not open', () => {
    expect(contentMatchesMagicBytes('application/x-msdownload', Buffer.from([0x4d, 0x5a]))).toBe(false);
  });
});
