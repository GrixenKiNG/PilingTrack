/**
 * Encryption — AES-256-GCM with versioned keys
 *
 * Used for encrypting sensitive data before storing in DB:
 * - Telegram bot tokens
 * - API keys
 * - OAuth secrets
 *
 * Algorithm: AES-256-GCM (authenticated, tamper-proof)
 *
 * Ciphertext formats (both supported on read):
 *   enc:<base64>           — legacy (single ENCRYPTION_KEY)
 *   enc:v1:<base64>        — versioned (ENCRYPTION_KEY_V1)
 *   enc:v2:<base64>        — versioned (ENCRYPTION_KEY_V2), etc.
 *
 * Migration path (no downtime):
 *   1. Set ENCRYPTION_KEY_V1 = current ENCRYPTION_KEY value.
 *   2. Set ENCRYPTION_KEY_V2 = new key (32 bytes hex).
 *   3. Set ENCRYPTION_KEY_VERSION = v2.
 *   4. Restart: new writes go out as enc:v2:..., old enc:... and
 *      enc:v1:... still decrypt because their keys are still in env.
 *   5. (Optional) Run a re-encrypt sweep to upgrade old ciphertexts.
 *   6. Once nothing uses v1 anymore, drop ENCRYPTION_KEY_V1 from env.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { logger } from '@/lib/logger';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const ENCRYPTED_PREFIX = 'enc:';
const VERSION_RE = /^v\d+$/;

type KeyRegistry = {
  /** Map of version label → key buffer. 'legacy' = ENCRYPTION_KEY without version. */
  byVersion: Map<string, Buffer>;
  /** Version label used for NEW encryptions. */
  active: string;
};

let cachedRegistry: KeyRegistry | null = null;
/**
 * Test seam: drop the cache so a test that sets process.env mid-run can pick
 * up the new keys. Intentionally NOT exported in any prod path.
 */
export function __resetEncryptionKeyCacheForTests() { cachedRegistry = null; }

function parseHexKey(hex: string, label: string): Buffer {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `${label} must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${buf.length} bytes`,
    );
  }
  return buf;
}

function loadKeyRegistry(): KeyRegistry {
  if (cachedRegistry) return cachedRegistry;

  const byVersion = new Map<string, Buffer>();

  // Pick up versioned keys: ENCRYPTION_KEY_V1, ENCRYPTION_KEY_V2, ...
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(/^ENCRYPTION_KEY_V(\d+)$/);
    if (match && value) {
      byVersion.set(`v${match[1]}`, parseHexKey(value, name));
    }
  }

  // Pick up legacy single key.
  if (process.env.ENCRYPTION_KEY) {
    byVersion.set('legacy', parseHexKey(process.env.ENCRYPTION_KEY, 'ENCRYPTION_KEY'));
  }

  // Determine active version for new encryptions.
  let active = process.env.ENCRYPTION_KEY_VERSION || '';
  if (active && !byVersion.has(active)) {
    throw new Error(
      `ENCRYPTION_KEY_VERSION=${active} but ENCRYPTION_KEY_${active.toUpperCase()} is not set`,
    );
  }
  if (!active) {
    // Default: pick the highest versioned key if any, otherwise 'legacy'.
    const versioned = Array.from(byVersion.keys())
      .filter((v) => VERSION_RE.test(v))
      .sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
    active = versioned[0] || (byVersion.has('legacy') ? 'legacy' : '');
  }

  if (!active) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No encryption key configured. Set ENCRYPTION_KEY or ENCRYPTION_KEY_V1 in production',
      );
    }
    logger.warn(
      'No ENCRYPTION_KEY* set. Generating random key — encrypted data will not survive restart',
    );
    const dev = randomBytes(KEY_LENGTH);
    byVersion.set('legacy', dev);
    active = 'legacy';
  }

  cachedRegistry = { byVersion, active };
  return cachedRegistry;
}

function keyForVersion(version: string): Buffer {
  const reg = loadKeyRegistry();
  const key = reg.byVersion.get(version);
  if (!key) {
    throw new Error(
      `Cannot decrypt: encryption key for version "${version}" is not configured. ` +
      `Set ENCRYPTION_KEY_${version.toUpperCase()} or restore ENCRYPTION_KEY for legacy data.`,
    );
  }
  return key;
}

/** Currently-active key version (for telemetry / debugging). */
export function activeKeyVersion(): string {
  return loadKeyRegistry().active;
}

/**
 * Encrypt plaintext. Output is tagged with the active key version so it can
 * later be decrypted even after key rotation.
 */
export function encrypt(plaintext: string): string {
  const reg = loadKeyRegistry();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const key = reg.byVersion.get(reg.active)!;
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  const blob = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'base64')]).toString('base64');

  // 'legacy' produces the historic 'enc:<base64>' shape so we don't churn
  // existing rows when nothing has rotated yet.
  if (reg.active === 'legacy') return ENCRYPTED_PREFIX + blob;
  return `${ENCRYPTED_PREFIX}${reg.active}:${blob}`;
}

/**
 * Decrypt ciphertext. Auto-detects version from the prefix, falls back to
 * the legacy ENCRYPTION_KEY when no version is present.
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    // Not encrypted — return as-is (backward compatibility).
    return ciphertext;
  }

  const after = ciphertext.slice(ENCRYPTED_PREFIX.length);
  let version = 'legacy';
  let blob = after;

  const colon = after.indexOf(':');
  if (colon > 0) {
    const maybeVersion = after.slice(0, colon);
    if (VERSION_RE.test(maybeVersion)) {
      version = maybeVersion;
      blob = after.slice(colon + 1);
    }
    // Otherwise the colon is part of the base64 (shouldn't happen but be lenient).
  }

  const key = keyForVersion(version);
  const decoded = Buffer.from(blob, 'base64');
  const iv = decoded.subarray(0, IV_LENGTH);
  const authTag = decoded.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = decoded.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Check if a value is encrypted (has 'enc:' prefix). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Re-encrypt a ciphertext with the currently-active key version. Used by the
 * key-rotation sweep: read row → reEncrypt → write back. No-op if the
 * ciphertext is already at the active version.
 */
export function reEncrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) return ciphertext;
  const reg = loadKeyRegistry();

  // Quick check to avoid decrypt+encrypt churn when nothing changed.
  const after = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const colon = after.indexOf(':');
  const currentVersion =
    colon > 0 && VERSION_RE.test(after.slice(0, colon)) ? after.slice(0, colon) : 'legacy';
  if (currentVersion === reg.active) return ciphertext;

  return encrypt(decrypt(ciphertext));
}

/** Generate a random encryption key (for setup scripts). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}
