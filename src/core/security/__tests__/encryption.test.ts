/**
 * Encryption — versioned key rotation tests.
 *
 * Pins the H-2 contract:
 *  - Legacy ENCRYPTION_KEY produces enc:<base64> (no version) and round-trips.
 *  - ENCRYPTION_KEY_V1/V2 produce enc:vN:<base64> and round-trip.
 *  - Decrypt picks the right key by version prefix even after rotation.
 *  - reEncrypt() upgrades a ciphertext to the active version.
 *  - Missing key for a version → clear error, not silent garbage.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const KEY_A = '11'.repeat(32); // 64 hex chars = 32 bytes
const KEY_B = '22'.repeat(32);
const KEY_C = '33'.repeat(32);

async function freshModule(env: Record<string, string | undefined>) {
  // Clear any prior keys.
  for (const k of Object.keys(process.env)) {
    if (k === 'ENCRYPTION_KEY' || k === 'ENCRYPTION_KEY_VERSION' || k.startsWith('ENCRYPTION_KEY_V')) {
      delete process.env[k];
    }
  }
  // Apply this test's env.
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Reset module-level cache so the new env takes effect.
  const mod = await import('../encryption');
  mod.__resetEncryptionKeyCacheForTests();
  // Force key registry load now so config errors surface here, not on first
  // encrypt/decrypt call inside the test body.
  mod.activeKeyVersion();
  return mod;
}

describe('encryption — versioned keys', () => {
  beforeEach(() => {
    // Each test starts from a known clean state.
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_VERSION;
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('ENCRYPTION_KEY_V')) delete process.env[k];
    }
  });

  it('legacy ENCRYPTION_KEY round-trips and uses the no-version prefix', async () => {
    const m = await freshModule({ ENCRYPTION_KEY: KEY_A });
    const ct = m.encrypt('telegram-bot-token-secret');
    expect(ct.startsWith('enc:')).toBe(true);
    expect(ct.startsWith('enc:v')).toBe(false); // legacy keeps the historic shape
    expect(m.decrypt(ct)).toBe('telegram-bot-token-secret');
    expect(m.activeKeyVersion()).toBe('legacy');
  });

  it('versioned key produces enc:vN: prefix and round-trips', async () => {
    const m = await freshModule({ ENCRYPTION_KEY_V1: KEY_A });
    const ct = m.encrypt('hello');
    expect(ct.startsWith('enc:v1:')).toBe(true);
    expect(m.decrypt(ct)).toBe('hello');
    expect(m.activeKeyVersion()).toBe('v1');
  });

  it('decrypts old legacy ciphertext after rotation to v2', async () => {
    // Phase 1: encrypt under legacy key.
    let m = await freshModule({ ENCRYPTION_KEY: KEY_A });
    const oldCt = m.encrypt('legacy-payload');
    expect(oldCt.startsWith('enc:v')).toBe(false);

    // Phase 2: rotate. Legacy key kept (so old data still readable),
    // V2 introduced and made active.
    m = await freshModule({
      ENCRYPTION_KEY: KEY_A,
      ENCRYPTION_KEY_V2: KEY_B,
      ENCRYPTION_KEY_VERSION: 'v2',
    });
    expect(m.activeKeyVersion()).toBe('v2');
    expect(m.decrypt(oldCt)).toBe('legacy-payload'); // old data still works
    const newCt = m.encrypt('new-payload');
    expect(newCt.startsWith('enc:v2:')).toBe(true);
    expect(m.decrypt(newCt)).toBe('new-payload');
  });

  it('picks the highest version when ENCRYPTION_KEY_VERSION is not set', async () => {
    const m = await freshModule({
      ENCRYPTION_KEY_V1: KEY_A,
      ENCRYPTION_KEY_V2: KEY_B,
    });
    expect(m.activeKeyVersion()).toBe('v2');
  });

  it('throws when ENCRYPTION_KEY_VERSION refers to an unset key', async () => {
    await expect(
      freshModule({
        ENCRYPTION_KEY_V1: KEY_A,
        ENCRYPTION_KEY_VERSION: 'v3',
      }),
    ).rejects.toThrow(/ENCRYPTION_KEY_V3/);
  });

  it('throws on decrypt when the ciphertext version key is missing', async () => {
    // Encrypt under v2.
    let m = await freshModule({ ENCRYPTION_KEY_V2: KEY_B });
    const ct = m.encrypt('top-secret');

    // Reload without V2 — should fail loudly, not return garbage.
    m = await freshModule({ ENCRYPTION_KEY_V1: KEY_A });
    expect(() => m.decrypt(ct)).toThrow(/version "v2"/);
  });

  it('reEncrypt() upgrades a legacy ciphertext to the active v2', async () => {
    let m = await freshModule({ ENCRYPTION_KEY: KEY_A });
    const legacyCt = m.encrypt('payload');

    m = await freshModule({
      ENCRYPTION_KEY: KEY_A,
      ENCRYPTION_KEY_V2: KEY_B,
      ENCRYPTION_KEY_VERSION: 'v2',
    });
    const upgraded = m.reEncrypt(legacyCt);
    expect(upgraded.startsWith('enc:v2:')).toBe(true);
    expect(m.decrypt(upgraded)).toBe('payload');
  });

  it('reEncrypt() is a no-op when ciphertext is already at the active version', async () => {
    const m = await freshModule({ ENCRYPTION_KEY_V1: KEY_A });
    const ct = m.encrypt('payload');
    expect(m.reEncrypt(ct)).toBe(ct); // identical bytes, no churn
  });

  it('isEncrypted() recognises both legacy and versioned shapes', async () => {
    const m = await freshModule({ ENCRYPTION_KEY: KEY_A });
    expect(m.isEncrypted('plain')).toBe(false);
    expect(m.isEncrypted('enc:abc')).toBe(true);
    expect(m.isEncrypted('enc:v1:abc')).toBe(true);
  });

  it('rejects ENCRYPTION_KEY of wrong byte length', async () => {
    await expect(freshModule({ ENCRYPTION_KEY: 'aa'.repeat(16) })) // 16 bytes, not 32
      .rejects.toThrow(/32 bytes/);
  });

  it('does not regress: tampering with ciphertext throws', async () => {
    const m = await freshModule({ ENCRYPTION_KEY: KEY_A });
    const ct = m.encrypt('confidential');
    // Flip one base64 char so the auth tag check fails.
    const tampered = ct.slice(0, -2) + (ct.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(() => m.decrypt(tampered)).toThrow();
  });
});
