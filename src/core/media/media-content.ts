/**
 * Контентный слой медиа: типы запросов, конфиг, расширения, magic-bytes и
 * построение S3-ключа. Чистые функции без S3/DB — юнит-тестируются напрямую.
 * Выделено из media-service.ts (аудит A-8: файл был 591 строку); внешние
 * импортёры продолжают брать всё из media-service (re-export там).
 */

// ============================================================
// Types
// ============================================================

export interface MediaUploadRequest {
  fileName: string;
  contentType: string;
  fileSize?: number;
  tenantId: string;
  userId: string;
  entityType?: string; // 'report', 'site', 'equipment', etc.
  entityId?: string;
}

export interface MediaUploadResponse {
  mediaId: string;
  uploadUrl: string;
  expiresAt: Date;
  key: string;
}

export interface MediaRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Configuration
// ============================================================

export interface MediaServiceConfig {
  bucket: string;
  region: string;
  endpoint?: string;       // For MinIO / R2
  accessKeyId: string;
  secretAccessKey: string;
  cdnBaseUrl?: string;     // https://cdn.example.com
  maxFileSize: number;     // bytes (default: 10MB)
  allowedContentTypes: string[];
  thumbnailWidth: number;  // default: 400
  urlExpiresIn: number;    // seconds (default: 3600)
}

export const DEFAULT_MEDIA_CONFIG: Partial<MediaServiceConfig> = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedContentTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    // iPhone defaults to HEIC; Safari sends image/heic[-sequence]/heif.
    // Sharp's bundled libvips reads HEIC on every platform we ship, so
    // thumbnailing still works; if it ever can't, the confirm step falls
    // back gracefully and the original still serves.
    'image/heic',
    'image/heif',
    'image/heic-sequence',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  thumbnailWidth: 400,
  urlExpiresIn: 3600, // 1 hour
};

/**
 * Map a (server-validated, allowlisted) content type to a file extension.
 *
 * Deliberately does NOT derive the extension from the client-supplied
 * fileName: buildMediaKey() sanitizes tenantId/entityType/entityId but
 * concatenates the extension raw, so an unsanitized fileName like
 * "x.tar/../other-tenant/forged" (last "." before a path-traversal-style
 * suffix, no further dots) would make a fileName-derived extension contain
 * "/" and "..", letting the uploader smuggle the S3 key outside its
 * intended media/<tenant>/<entityType>/<entityId>/ prefix. Deriving
 * strictly from the already-validated contentType closes this off
 * entirely instead of trying to sanitize an attacker-controlled string.
 */
export function getExtensionForContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/heic-sequence': '.heic',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return map[contentType] ?? '';
}

/** ISOBMFF (MP4-family) container: bytes 4-8 are "ftyp", brand follows. */
function isHeicOrHeifContainer(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  const brand = bytes.subarray(8, 12).toString('ascii');
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand);
}

/**
 * Verify the actual downloaded bytes match the declared (allowlisted)
 * content type — a "magic bytes" / file-signature check.
 *
 * Content-Type is entirely client-supplied at upload time (getPresignedUrl)
 * and, before this check, was never verified against anything but the
 * allowlist string comparison. A caller could declare "image/jpeg" and
 * upload arbitrary bytes; confirmUpload() would try Sharp, but on failure
 * only logged a warning and still marked the upload "completed" (see
 * confirm-upload-validation.test.ts). This function is the actual gate:
 * confirmUpload rejects when it returns false instead of completing.
 *
 * Deliberately fails CLOSED: an unmapped/unknown content type (which
 * shouldn't reach here anyway, since getPresignedUrl already checks the
 * allowlist) returns false rather than true.
 */
export function contentMatchesMagicBytes(contentType: string, bytes: Buffer): boolean {
  const checks: Record<string, (b: Buffer) => boolean> = {
    'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/gif': (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')),
    'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
    'image/heic': isHeicOrHeifContainer,
    'image/heif': isHeicOrHeifContainer,
    'image/heic-sequence': isHeicOrHeifContainer,
    'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
    // OLE2 Compound File Binary — legacy .doc.
    'application/msword': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    // .docx is a ZIP container — PK\x03\x04 (regular), \x05\x06 (empty), \x07\x08 (spanned).
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
      b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  };

  const check = checks[contentType];
  return check ? check(bytes) : false;
}

/**
 * Build the S3/MinIO object key, organized into real per-entity folders:
 *   media/{tenant}/{entityType}/{entityId}/{mediaId}{ext}
 * e.g. equipment docs → media/orion/equipment/<id>/...  (folder per установка).
 * Without an entity → media/{tenant}/misc/...  Segments are sanitized so the
 * inspection composite id ("insId__itemId") and others stay path-safe.
 */
export function buildMediaKey(
  tenantId: string,
  entityType: string | null | undefined,
  entityId: string | null | undefined,
  mediaId: string,
  extension: string,
): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const folder = entityType && entityId ? `${safe(entityType)}/${safe(entityId)}` : 'misc';
  return `media/${safe(tenantId)}/${folder}/${mediaId}${extension}`;
}
