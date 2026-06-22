import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import type { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const SESSION_COOKIE_NAME = 'pt-session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string | null;
  sessionVersion: number;
}

interface SessionPayload extends JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  type: 'session';
  v: 1;
  sv: number;
  jti?: string;
}

let devFallbackWarned = false;

function getSecretKey() {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (secret) {
    if (secret.length < 32 && process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }
    return new TextEncoder().encode(secret);
  }

  if (process.env.NODE_ENV !== 'production') {
    if (!devFallbackWarned) {
      devFallbackWarned = true;
      logger.warn('session-service: SESSION_SECRET not set — using dev-only fallback');
    }
    return new TextEncoder().encode('dev-only-session-secret-change-me');
  }

  throw new Error('SESSION_SECRET is not configured');
}

// ============================================================
// Revocation store (denylist of revoked jtis)
//
// Backed by the state Redis instance (REDIS_URL, noeviction policy) —
// must not be LRU-evicted, or revoked tokens silently become valid again.
//
// Fail-open on Redis outage: if Redis is unreachable, verify falls through
// and accepts the token. Alternative (fail-closed) logs out every user
// on any Redis hiccup — unacceptable on a single-Redis deployment.
// ============================================================

export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean>;
  revoke(jti: string, ttlSeconds: number): Promise<void>;
}

class RedisRevocationStore implements RevocationStore {
  private client: Redis | null = null;
  private initFailed = false;

  private getClient(): Redis | null {
    if (this.client) return this.client;
    if (this.initFailed) return null;

    const url = process.env.REDIS_URL;
    if (!url) {
      this.initFailed = true;
      return null;
    }

    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 2,
        connectTimeout: 3000,
        enableOfflineQueue: false,
        keyPrefix: 'pilingtrack:',
      });
      this.client.on('error', (err) => {
        logger.warn('session-revocation: redis error', { error: (err as Error).message });
      });
      return this.client;
    } catch (err) {
      this.initFailed = true;
      logger.warn('session-revocation: redis init failed', { error: (err as Error).message });
      return null;
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    const client = this.getClient();
    // Fail-open per the policy documented at the top of this file: on a
    // single-Redis deployment, treating every hiccup as "token revoked" would
    // log out every active operator on any momentary outage. JWT TTL stays
    // short, so the worst-case window of an actually-revoked token slipping
    // through is bounded.
    if (!client) return false;
    // ioredis is created with enableOfflineQueue:false. Until status === 'ready'
    // any .get() throws "Stream isn't writeable" — that's expected during
    // cold-start, not an operator signal. Skip the call entirely to avoid
    // log forwarding into the browser console on every admin render.
    if (client.status !== 'ready') return false;
    try {
      const v = await client.get(`revoked-jti:${jti}`);
      return v !== null;
    } catch (err) {
      logger.debug('session-revocation: GET failed (fail-open)', { error: (err as Error).message });
      return false;
    }
  }

  async revoke(jti: string, ttlSeconds: number): Promise<void> {
    const client = this.getClient();
    if (!client) {
      logger.warn('session-revocation: redis unavailable — revocation NOT persisted');
      return;
    }
    try {
      await client.set(`revoked-jti:${jti}`, '1', 'EX', Math.max(1, ttlSeconds));
    } catch (err) {
      logger.warn('session-revocation: SET failed', { error: (err as Error).message });
    }
  }
}

let revocationStore: RevocationStore = new RedisRevocationStore();

/**
 * Test-only: replace the revocation store with an in-memory or mock impl.
 * Returns a restore function.
 */
export function __setRevocationStoreForTests(store: RevocationStore): () => void {
  const prev = revocationStore;
  revocationStore = store;
  return () => {
    revocationStore = prev;
  };
}

// ============================================================
// Token operations
// ============================================================

export async function createSessionToken(user: SessionUser) {
  const secret = getSecretKey();
  const jti = randomBytes(16).toString('hex');

  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    sv: user.sessionVersion,
    type: 'session',
    v: 1,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);

  return token;
}

/**
 * Verify signature and custom claims only. Does NOT check revocation denylist.
 * Use this when you need to inspect a token you're about to revoke.
 */
export async function verifyTokenSignature(token: string): Promise<SessionPayload | null> {
  try {
    const secret = getSecretKey();
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (payload.type !== 'session' || payload.v !== 1) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Full session validation: signature + custom claims + revocation denylist.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const payload = await verifyTokenSignature(token);
  if (!payload) return null;

  if (payload.jti && (await revocationStore.isRevoked(payload.jti))) {
    return null;
  }

  return payload;
}

/**
 * Revoke a session token by adding its jti to the denylist until its natural
 * expiration. Idempotent. Returns true if a denylist entry was written.
 *
 * Tokens issued before jti was added to the schema have no jti and cannot be
 * revoked — they expire naturally within SESSION_TTL_SECONDS (12h).
 */
export async function revokeSessionToken(token: string): Promise<boolean> {
  const payload = await verifyTokenSignature(token);
  if (!payload || !payload.jti || !payload.exp) return false;

  const ttl = payload.exp - Math.floor(Date.now() / 1000);
  if (ttl <= 0) return false;

  await revocationStore.revoke(payload.jti, ttl);
  return true;
}

export function readSessionToken(request: NextRequest) {
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) {
    return cookieToken;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

export function attachSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return response;
}
