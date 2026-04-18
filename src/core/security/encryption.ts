/**
 * Encryption — AES-256-GCM authenticated encryption
 *
 * Used for encrypting sensitive data before storing in DB:
 * - Telegram bot tokens
 * - API keys
 * - OAuth secrets
 *
 * Algorithm: AES-256-GCM (authenticated, tamper-proof)
 * Key: 32 bytes (256 bits) from ENCRYPTION_KEY env var
 *
 * Ciphertext format: base64(iv + authTag + encryptedData)
 * Prefix: 'enc:' to distinguish from plaintext
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { logger } from '@/lib/logger';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const ENCRYPTED_PREFIX = 'enc:';

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.ENCRYPTION_KEY;

  if (envKey) {
    // Validate length
    const keyBuffer = Buffer.from(envKey, 'hex');
    if (keyBuffer.length !== KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${keyBuffer.length} bytes`
      );
    }
    cachedKey = keyBuffer;
    return cachedKey;
  }

  // Development fallback — generate and warn
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('ENCRYPTION_KEY not set. Generating random key — encrypted data will not survive restart');
    cachedKey = randomBytes(KEY_LENGTH);
    return cachedKey;
  }

  throw new Error('ENCRYPTION_KEY must be set in production');
}

/**
 * Encrypt plaintext string.
 * Returns base64 ciphertext with 'enc:' prefix.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv + authTag + encrypted (all base64)
  const ciphertext = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'base64'),
  ]).toString('base64');

  return ENCRYPTED_PREFIX + ciphertext;
}

/**
 * Decrypt ciphertext string.
 * Expects 'enc:' prefix + base64(iv + authTag + data).
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    // Not encrypted — return as-is (backward compatibility)
    return ciphertext;
  }

  const key = getEncryptionKey();
  const raw = ciphertext.slice(ENCRYPTED_PREFIX.length);

  const decoded = Buffer.from(raw, 'base64');

  const iv = decoded.subarray(0, IV_LENGTH);
  const authTag = decoded.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = decoded.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a value is encrypted (has 'enc:' prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Generate a random encryption key (for setup scripts).
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}
