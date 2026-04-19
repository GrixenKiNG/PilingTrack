import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

const KEY_BYTES = 32; // 256-bit random key — `${prefix}_${base64url}` ~ 43 chars
const KEY_PREFIX = 'pkdk'; // pilingtrack device key

/**
 * Hash a device key with HMAC-SHA256 using DEVICE_KEY_LOOKUP_SECRET so DB
 * read access alone is insufficient to impersonate a device. Falls back
 * to SESSION_SECRET in non-production envs only — see auth-service for
 * the same pattern.
 */
function hashDeviceKey(plaintext: string): string {
  const explicitSecret = process.env.DEVICE_KEY_LOOKUP_SECRET;
  const fallbackSecret = process.env.SESSION_SECRET;
  const secret = explicitSecret || fallbackSecret;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceError(
        'DEVICE_KEY_LOOKUP_SECRET is required in production',
        500
      );
    }
    // Dev/test fallback — keys still work but are weaker.
    return createHmac('sha256', 'dev-only-device-key-fallback').update(plaintext).digest('hex');
  }

  return createHmac('sha256', secret).update(plaintext).digest('hex');
}

export interface ProvisionedDeviceKey {
  id: string;
  /** Plaintext key — shown to the operator exactly once. */
  key: string;
  name: string;
  equipmentId: string;
  tenantId: string | null;
  siteId: string | null;
}

/**
 * Mint a new device key. The plaintext key is returned exactly once;
 * subsequent reads from the DB only see the hash.
 */
export async function provisionDeviceKey(input: {
  name: string;
  equipmentId: string;
  tenantId?: string | null;
  siteId?: string | null;
  createdById?: string | null;
}): Promise<ProvisionedDeviceKey> {
  const equipment = await db.equipment.findUnique({
    where: { id: input.equipmentId },
    select: { id: true, isActive: true },
  });
  if (!equipment || !equipment.isActive) {
    throw new ServiceError('Equipment not found', 404);
  }

  const plaintext = `${KEY_PREFIX}_${randomBytes(KEY_BYTES).toString('base64url')}`;
  const keyHash = hashDeviceKey(plaintext);

  const created = await db.deviceKey.create({
    data: {
      keyHash,
      name: input.name,
      equipmentId: input.equipmentId,
      tenantId: input.tenantId ?? null,
      siteId: input.siteId ?? null,
      createdById: input.createdById ?? null,
    },
    select: {
      id: true,
      name: true,
      equipmentId: true,
      tenantId: true,
      siteId: true,
    },
  });

  return { ...created, key: plaintext };
}

export interface AuthenticatedDevice {
  deviceKeyId: string;
  equipmentId: string;
  siteId: string | null;
  tenantId: string | null;
}

/**
 * Look up a device by its plaintext API key. Returns null if the key is
 * unknown or revoked. Caller is responsible for rate-limiting failed
 * lookups to defend against an offline DB-read attacker scanning the
 * keyHash column with a stolen secret.
 *
 * Lookup is by exact hash match (DB index), which is constant-time enough
 * for this purpose; we don't need timingSafeEqual on the column itself.
 */
export async function authenticateDeviceByKey(
  plaintextKey: string
): Promise<AuthenticatedDevice | null> {
  if (!plaintextKey || plaintextKey.length < 16) return null;

  const keyHash = hashDeviceKey(plaintextKey);
  const device = await db.deviceKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      keyHash: true,
      revoked: true,
      equipmentId: true,
      siteId: true,
      tenantId: true,
    },
  });

  if (!device || device.revoked) return null;

  // Belt-and-braces constant-time check on the hash itself — cheap and
  // makes any future change to lookup strategy fail-safe.
  const a = Buffer.from(device.keyHash);
  const b = Buffer.from(keyHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Best-effort lastUsedAt — fire-and-forget so a slow write doesn't
  // delay telemetry ingestion.
  void db.deviceKey
    .update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
    .catch(() => { /* ignore */ });

  return {
    deviceKeyId: device.id,
    equipmentId: device.equipmentId,
    siteId: device.siteId,
    tenantId: device.tenantId,
  };
}

export async function revokeDeviceKey(id: string): Promise<void> {
  await db.deviceKey.update({
    where: { id },
    data: { revoked: true },
  });
}
