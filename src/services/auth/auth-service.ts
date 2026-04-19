import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { attachRequestIdHeader } from '@/lib/request-context';
import {
  attachSessionCookie,
  clearSessionCookie,
  createSessionToken,
  type SessionUser,
} from '@/services/auth/session-service';
import { rateLimiter, AUTH_RATE_LIMIT, PIN_RATE_LIMIT } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

const BCRYPT_ROUNDS = 12;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const PIN_HASH_PREFIX = '$2';

/**
 * Compute a deterministic lookup key for a PIN.
 *
 * We cannot index the bcrypt(PIN) column because bcrypt uses a random salt —
 * two users with the same PIN get different hashes, and there's no way to
 * query "find the user whose bcrypt hash matches this input" without
 * scanning every row.
 *
 * Instead we store a second field, `pinLookup`, containing an HMAC of the
 * PIN with a server-side secret. HMAC is deterministic, so we can index it
 * and look up the single candidate user in O(1). The HMAC secret ensures
 * an attacker with read access to the DB cannot brute-force PINs offline
 * without also compromising the secret.
 */
let pinLookupSecretFallbackWarned = false;

export function computePinLookup(pin: string): string {
  const explicitSecret = process.env.PIN_LOOKUP_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  const secret = explicitSecret || sessionSecret || '';

  if (!secret) {
    // Hard-fail in production: a plain SHA256 over a 4-6 digit PIN is trivial
    // to rainbow-table for anyone with DB read access.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PIN_LOOKUP_SECRET is required in production (or SESSION_SECRET as a fallback)'
      );
    }
    // Dev/test only — keeps PIN login functional locally.
    return createHash('sha256').update(`pinlookup:${pin}`).digest('hex');
  }

  if (!explicitSecret && sessionSecret && !pinLookupSecretFallbackWarned) {
    pinLookupSecretFallbackWarned = true;
    // Coupling warning: rotating SESSION_SECRET will invalidate every stored
    // pinLookup, locking out all PIN users until they reset.
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] PIN_LOOKUP_SECRET not set — falling back to SESSION_SECRET. ' +
      'Rotating SESSION_SECRET will invalidate all stored PIN lookups.'
    );
  }

  return createHmac('sha256', secret).update(pin).digest('hex');
}

export async function hashPin(pin: string): Promise<string> {
  return bcryptHash(pin, BCRYPT_ROUNDS);
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks
 * on legacy plaintext PIN values.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function hashPassword(value: string): Promise<string> {
  return bcryptHash(value, BCRYPT_ROUNDS);
}

export async function verifyPassword(value: string, hash: string): Promise<boolean> {
  return bcryptCompare(value, hash);
}

function hashLegacyPassword(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isBcryptHash(hash: string) {
  return hash.startsWith('$2');
}

function isLegacySha256Hash(hash: string) {
  return SHA256_HEX_PATTERN.test(hash);
}

function safeHexEqual(aHex: string, bHex: string) {
  if (aHex.length !== bHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch {
    return false;
  }
}

async function verifyPasswordWithLegacySupport(value: string, storedHash: string) {
  if (isBcryptHash(storedHash)) {
    return { isValid: await verifyPassword(value, storedHash), needsUpgrade: false };
  }

  if (isLegacySha256Hash(storedHash)) {
    return {
      isValid: safeHexEqual(hashLegacyPassword(value), storedHash),
      needsUpgrade: true,
    };
  }

  // Unknown hash format — refuse authentication rather than falling through
  // to plaintext comparison (historical footgun — stored plaintext passwords
  // would otherwise authenticate successfully).
  return { isValid: false, needsUpgrade: false };
}

async function upgradeLegacyPasswordIfNeeded(userId: string, plainTextPassword: string, needsUpgrade: boolean) {
  if (!needsUpgrade) {
    return;
  }

  await db.user.update({
    where: { id: userId },
    data: {
      password: await hashPassword(plainTextPassword),
    },
  });
}

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  };
}

export async function authenticateUserByEmailPassword(email: string, password: string) {
  const rateLimit = await rateLimiter.check(email.toLowerCase(), AUTH_RATE_LIMIT);

  if (!rateLimit.allowed) {
    return { user: null, rateLimited: true, retryAfter: rateLimit.retryAfter };
  }

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      password: true,
      name: true,
      role: true,
      isActive: true,
      tenantId: true,
    },
  });

  if (!user || !user.isActive) {
    return { user: null, rateLimited: false };
  }

  try {
    const verification = await verifyPasswordWithLegacySupport(password, user.password);
    const isValid = verification.isValid;
    if (!isValid) {
      return { user: null, rateLimited: false };
    }

    await upgradeLegacyPasswordIfNeeded(user.id, password, verification.needsUpgrade);
    await rateLimiter.reset(email.toLowerCase());
    return { user: toSessionUser(user), rateLimited: false };
  } catch (err) {
    logger.error('authenticateUserByEmailPassword failed', err);
    throw err;
  }
}

export async function authenticateUserByPin(pin: string, clientIdentifier: string) {
  // Rate limit by client identifier (IP/tenant). Rate limiting by PIN value
  // itself was wrong: attackers can try N different PINs from the same IP
  // without ever tripping the counter, and a legitimate user sharing a PIN
  // with a blocked attacker would also be blocked.
  const rateLimit = await rateLimiter.check(`pin-ip-${clientIdentifier}`, PIN_RATE_LIMIT);

  if (!rateLimit.allowed) {
    return {
      user: null,
      rateLimited: true,
      retryAfter: rateLimit.retryAfter,
      error: `Too many PIN attempts. Try again in ${Math.ceil((rateLimit.retryAfter || 60) / 60)} minutes.`,
    };
  }

  const pinLookup = computePinLookup(pin);

  // Fast path: O(1) index lookup by deterministic HMAC of the PIN.
  // Falls back to a full scan only for legacy users whose pinLookup column
  // has not been backfilled yet.
  let matchedUser: {
    id: string;
    email: string;
    password: string;
    pin: string | null;
    pinLookup: string | null;
    name: string;
    role: string;
    isActive: boolean;
    tenantId: string | null;
  } | null = null;

  const indexedCandidate = await db.user.findUnique({
    where: { pinLookup },
    select: {
      id: true,
      email: true,
      password: true,
      pin: true,
      pinLookup: true,
      name: true,
      role: true,
      isActive: true,
      tenantId: true,
    },
  }).catch(() => null);

  if (indexedCandidate && indexedCandidate.isActive && indexedCandidate.pin) {
    const isBcrypt = indexedCandidate.pin.startsWith(PIN_HASH_PREFIX);
    const matches = isBcrypt
      ? await bcryptCompare(pin, indexedCandidate.pin)
      : constantTimeEquals(pin, indexedCandidate.pin);
    if (matches) matchedUser = indexedCandidate;
  }

  // Legacy fallback: pinLookup column not yet backfilled for this user.
  // Scans only users whose pinLookup is null (backfilled users are excluded
  // from the scan path so repeated PIN logins never re-hit it).
  if (!matchedUser) {
    const unindexedUsers = await db.user.findMany({
      where: {
        isActive: true,
        pinLookup: null,
        NOT: { pin: null },
      },
      select: {
        id: true,
        email: true,
        password: true,
        pin: true,
        pinLookup: true,
        name: true,
        role: true,
        isActive: true,
        tenantId: true,
      },
    });

    for (const u of unindexedUsers) {
      if (!u.pin) continue;
      const isBcrypt = u.pin.startsWith(PIN_HASH_PREFIX);
      const matches = isBcrypt
        ? await bcryptCompare(pin, u.pin)
        : constantTimeEquals(pin, u.pin);
      if (matches) {
        matchedUser = u;
        break;
      }
    }
  }

  if (!matchedUser) {
    return { user: null, rateLimited: false };
  }

  // Opportunistic upgrade: ensure stored values use bcrypt + have pinLookup
  // backfilled so the next login takes the O(1) fast path.
  const needsBcryptUpgrade = !matchedUser.pin!.startsWith(PIN_HASH_PREFIX);
  const needsLookupBackfill = !matchedUser.pinLookup;
  if (needsBcryptUpgrade || needsLookupBackfill) {
    const updateData: Record<string, unknown> = {};
    if (needsBcryptUpgrade) updateData.pin = await hashPin(pin);
    if (needsLookupBackfill) updateData.pinLookup = pinLookup;
    await db.user.update({
      where: { id: matchedUser.id },
      data: updateData,
    }).catch(() => {
      // Best-effort upgrade — retry on next login if it fails.
    });
  }

  await rateLimiter.reset(`pin-ip-${clientIdentifier}`);
  return { user: toSessionUser(matchedUser), rateLimited: false };
}

export async function createAuthenticatedResponse(user: SessionUser, requestId?: string) {
  const response = NextResponse.json({ user });
  attachSessionCookie(response, await createSessionToken(user));
  return requestId ? attachRequestIdHeader(response, requestId) : response;
}

export function createLogoutResponse(requestId?: string) {
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return requestId ? attachRequestIdHeader(response, requestId) : response;
}
