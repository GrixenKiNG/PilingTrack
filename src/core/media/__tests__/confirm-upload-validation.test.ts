/**
 * confirmUpload() — magic-byte validation gate (2026-07-04 media review).
 *
 * Before this fix: Content-Type is entirely client-declared at
 * getPresignedUrl() time and checked only against an allowlist string.
 * confirmUpload() would try to thumbnail anything claiming "image/*" via
 * Sharp, but on failure the catch block only logged a warning and still
 * set uploadStatus: 'completed' — so a caller could declare "image/jpeg",
 * upload arbitrary bytes (e.g. a script, an executable, garbage), and the
 * upload would be confirmed as if it were a real photo. Non-image types
 * (PDF/DOC/DOCX) had zero content verification at all.
 *
 * These tests reproduce that exact bypass end-to-end and pin the fix:
 * confirmUpload must reject (mark 'failed', throw) when the downloaded
 * bytes don't match the declared content type's file signature.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock, sharpMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  sharpMock: vi.fn(),
}));

// The real SDK exports classes — `new GetObjectCommand(...)` etc. in the
// code under test. Arrow functions can't be constructors, so these mocks
// must be real classes/functions, not `vi.fn((x) => ({...}))` shorthand.
class FakeCommand {
  __type: string;
  input: unknown;
  constructor(type: string, input: unknown) {
    this.__type = type;
    this.input = input;
  }
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function S3ClientMock() {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return new FakeCommand('PutObjectCommand', input);
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return new FakeCommand('GetObjectCommand', input);
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return new FakeCommand('DeleteObjectCommand', input);
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://example.com/signed-url'),
}));

vi.mock('sharp', () => ({
  default: sharpMock,
}));

interface FakeMediaRow {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  key: string;
  thumbnailKey: string | null;
  tenantId: string;
  userId: string;
  entityType: string | null;
  entityId: string | null;
  cdnUrl: string | null;
  isDeleted: boolean;
  uploadStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

const mediaTable = new Map<string, FakeMediaRow>();

vi.mock('@/lib/db', () => ({
  db: {
    media: {
      findUnique: vi.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(mediaTable.get(id) ?? null)),
      update: vi.fn(({ where: { id }, data }: { where: { id: string }; data: Partial<FakeMediaRow> }) => {
        const existing = mediaTable.get(id);
        if (!existing) throw new Error(`no row ${id}`);
        const updated = { ...existing, ...data };
        mediaTable.set(id, updated);
        return Promise.resolve(updated);
      }),
    },
  },
}));

import { MediaService } from '../media-service';

function seedMedia(over: Partial<FakeMediaRow>): FakeMediaRow {
  const row: FakeMediaRow = {
    id: 'media-1', fileName: 'photo.jpg', contentType: 'image/jpeg', fileSize: 1000,
    key: 'media/tenant-a/report/report-1/media-1.jpg', thumbnailKey: null,
    tenantId: 'tenant-a', userId: 'user-1', entityType: 'report', entityId: 'report-1',
    cdnUrl: null, isDeleted: false, uploadStatus: 'pending',
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
  mediaTable.set(row.id, row);
  return row;
}

function mockDownload(bytes: Buffer) {
  sendMock.mockImplementation((command: { __type: string }) => {
    if (command.__type === 'GetObjectCommand') {
      return Promise.resolve({ Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(bytes)) } });
    }
    return Promise.resolve({}); // PutObjectCommand for thumbnail upload
  });
}

function makeService() {
  return new MediaService({
    bucket: 'test-bucket', region: 'us-east-1',
    accessKeyId: 'test', secretAccessKey: 'test',
    maxFileSize: 10 * 1024 * 1024,
    allowedContentTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    thumbnailWidth: 400, urlExpiresIn: 3600,
  });
}

describe('MediaService.confirmUpload — content validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaTable.clear();
  });

  it('THE REPORTED BYPASS: rejects bytes that are not actually a JPEG, despite declaring image/jpeg', async () => {
    seedMedia({ contentType: 'image/jpeg' });
    mockDownload(Buffer.from('<script>alert(1)</script> definitely not a photo', 'utf8'));
    const service = makeService();

    await expect(service.confirmUpload('media-1')).rejects.toThrow(/does not match/i);

    expect(mediaTable.get('media-1')?.uploadStatus).toBe('failed');
    // Sharp must never even be invoked on bytes that already fail the
    // signature check — the gate runs before any decode attempt.
    expect(sharpMock).not.toHaveBeenCalled();
  });

  it('rejects a PDF relabeled as image/jpeg (cross-type confusion)', async () => {
    seedMedia({ contentType: 'image/jpeg' });
    mockDownload(Buffer.from('%PDF-1.7\n%…rest of a real pdf…', 'ascii'));
    const service = makeService();

    await expect(service.confirmUpload('media-1')).rejects.toThrow(/does not match/i);
    expect(mediaTable.get('media-1')?.uploadStatus).toBe('failed');
  });

  it('accepts and completes a real JPEG, generating a thumbnail as before', async () => {
    seedMedia({ contentType: 'image/jpeg' });
    const realJpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    mockDownload(realJpegHeader);
    sharpMock.mockReturnValue({
      rotate: () => ({
        resize: () => ({
          jpeg: () => ({ toBuffer: () => Promise.resolve(Buffer.from('thumb')) }),
        }),
      }),
    });
    const service = makeService();

    const result = await service.confirmUpload('media-1');

    expect(result.thumbnailKey).toBe('media/tenant-a/report/report-1/media-1.jpg.thumb.jpg');
    expect(mediaTable.get('media-1')?.uploadStatus).toBe('completed');
  });

  it('still completes (no thumbnail) when magic bytes match but Sharp itself fails to decode — unchanged legacy behavior for genuinely valid-but-quirky images', async () => {
    seedMedia({ contentType: 'image/jpeg' });
    const realJpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    mockDownload(realJpegHeader);
    sharpMock.mockImplementation(() => {
      throw new Error('unsupported image subtype');
    });
    const service = makeService();

    const result = await service.confirmUpload('media-1');

    expect(result.thumbnailKey).toBeNull();
    expect(mediaTable.get('media-1')?.uploadStatus).toBe('completed');
  });

  it('rejects a non-image type (PDF) with mismatched bytes too', async () => {
    seedMedia({ contentType: 'application/pdf', fileName: 'doc.pdf', key: 'media/tenant-a/report/report-1/media-1.pdf' });
    mockDownload(Buffer.from([0x7f, 0x45, 0x4c, 0x46])); // ELF executable magic
    const service = makeService();

    await expect(service.confirmUpload('media-1')).rejects.toThrow(/does not match/i);
    expect(mediaTable.get('media-1')?.uploadStatus).toBe('failed');
  });

  it('accepts a real PDF and completes without attempting Sharp', async () => {
    seedMedia({ contentType: 'application/pdf', fileName: 'doc.pdf', key: 'media/tenant-a/report/report-1/media-1.pdf' });
    mockDownload(Buffer.from('%PDF-1.4\n', 'ascii'));
    const service = makeService();

    const result = await service.confirmUpload('media-1');

    expect(result.thumbnailKey).toBeNull();
    expect(mediaTable.get('media-1')?.uploadStatus).toBe('completed');
    expect(sharpMock).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-completed upload short-circuits before any re-validation', async () => {
    seedMedia({ contentType: 'image/jpeg', uploadStatus: 'completed', thumbnailKey: 'existing.thumb.jpg' });
    const service = makeService();

    const result = await service.confirmUpload('media-1');

    expect(result.thumbnailKey).toBe('existing.thumb.jpg');
    expect(sendMock).not.toHaveBeenCalled();
  });
});
