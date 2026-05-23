import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  verifyTokenSignature,
  revokeSessionToken,
  readSessionToken,
  attachSessionCookie,
  clearSessionCookie,
  __setRevocationStoreForTests,
  type RevocationStore,
  SESSION_COOKIE_NAME,
} from '../session-service';
import { NextRequest, NextResponse } from 'next/server';

const mockUser = {
  id: 'user-1',
  email: 'test@piling.ru',
  name: 'Test User',
  role: 'OPERATOR',
  tenantId: null,
};

describe('session-service', () => {
  const originalEnv = { ...process.env };
  let restoreRevocation: (() => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SESSION_SECRET = 'test-secret-key-for-unit-tests';
    // Tests run without Redis. The default RedisRevocationStore fails open
    // when Redis is unreachable (returns isRevoked=false), so verification
    // would succeed regardless. We install an in-memory denylist anyway so
    // tests can exercise both the revoked and non-revoked branches explicitly.
    const revoked = new Set<string>();
    restoreRevocation = __setRevocationStoreForTests({
      isRevoked: async (jti) => revoked.has(jti),
      revoke: async (jti) => {
        revoked.add(jti);
      },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (restoreRevocation) {
      restoreRevocation();
      restoreRevocation = null;
    }
  });

  describe('createSessionToken', () => {
    it('creates a valid JWT-like token', async () => {
      const token = await createSessionToken(mockUser);
      const parts = token.split('.');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBeDefined();
      expect(parts[1]).toBeDefined();
      expect(parts[2]).toBeDefined();
    });

    it('encodes user data in the payload', async () => {
      const token = await createSessionToken(mockUser);
      const parts = token.split('.');
      // Decode payload (base64url)
      const payload = JSON.parse(Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

      expect(payload.sub).toBe('user-1');
      expect(payload.email).toBe('test@piling.ru');
      expect(payload.name).toBe('Test User');
      expect(payload.role).toBe('OPERATOR');
      expect(payload.type).toBe('session');
      expect(payload.v).toBe(1);
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });
  });

  describe('verifySessionToken', () => {
    it('returns payload for a valid token', async () => {
      const token = await createSessionToken(mockUser);
      const result = await verifySessionToken(token);

      expect(result).not.toBeNull();
      expect(result!.sub).toBe('user-1');
      expect(result!.email).toBe('test@piling.ru');
    });

    it('returns null for tampered token', async () => {
      const token = await createSessionToken(mockUser);
      const parts = token.split('.');
      // Tamper with payload
      const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), role: 'ADMIN' }))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(await verifySessionToken(tamperedToken)).toBeNull();
    });

    it('returns null for malformed token', async () => {
      expect(await verifySessionToken('invalid')).toBeNull();
      expect(await verifySessionToken('a.b')).toBeNull();
      expect(await verifySessionToken('')).toBeNull();
      expect(await verifySessionToken('a.b.c.d')).toBeNull();
    });

    it('returns null for token with wrong signature', async () => {
      const token = await createSessionToken(mockUser);
      const parts = token.split('.');
      const badToken = `${parts[0]}.${parts[1]}.wr0ngS1gnature`;

      expect(await verifySessionToken(badToken)).toBeNull();
    });
  });

  describe('readSessionToken', () => {
    it('reads token from cookie', () => {
      const request = new NextRequest('http://localhost');
      request.cookies.set(SESSION_COOKIE_NAME, 'cookie-token');

      expect(readSessionToken(request)).toBe('cookie-token');
    });

    it('reads token from Authorization header', () => {
      const request = new NextRequest('http://localhost', {
        headers: { Authorization: 'Bearer header-token' },
      });

      expect(readSessionToken(request)).toBe('header-token');
    });

    it('prefers cookie over header', () => {
      const request = new NextRequest('http://localhost', {
        headers: { Authorization: 'Bearer header-token' },
      });
      request.cookies.set(SESSION_COOKIE_NAME, 'cookie-token');

      expect(readSessionToken(request)).toBe('cookie-token');
    });

    it('returns null when no token present', () => {
      const request = new NextRequest('http://localhost');

      expect(readSessionToken(request)).toBeNull();
    });
  });

  describe('attachSessionCookie', () => {
    it('sets session cookie on response', () => {
      const response = new NextResponse();
      attachSessionCookie(response, 'some-token');

      const cookie = response.cookies.get(SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      expect(cookie!.value).toBe('some-token');
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe('lax');
    });
  });

  describe('revocation', () => {
    function makeMemoryStore(): RevocationStore & { entries: Map<string, number> } {
      const entries = new Map<string, number>();
      return {
        entries,
        async isRevoked(jti) {
          const exp = entries.get(jti);
          if (!exp) return false;
          if (exp <= Math.floor(Date.now() / 1000)) {
            entries.delete(jti);
            return false;
          }
          return true;
        },
        async revoke(jti, ttl) {
          entries.set(jti, Math.floor(Date.now() / 1000) + ttl);
        },
      };
    }

    it('createSessionToken sets a jti claim', async () => {
      const token = await createSessionToken(mockUser);
      const payload = await verifyTokenSignature(token);
      expect(payload?.jti).toMatch(/^[a-f0-9]{32}$/);
    });

    it('verifySessionToken returns null for a revoked token', async () => {
      const store = makeMemoryStore();
      const restore = __setRevocationStoreForTests(store);
      try {
        const token = await createSessionToken(mockUser);
        expect(await verifySessionToken(token)).not.toBeNull();

        const revoked = await revokeSessionToken(token);
        expect(revoked).toBe(true);
        expect(store.entries.size).toBe(1);

        expect(await verifySessionToken(token)).toBeNull();
      } finally {
        restore();
      }
    });

    it('verifyTokenSignature still accepts a revoked token (signature-only path)', async () => {
      const store = makeMemoryStore();
      const restore = __setRevocationStoreForTests(store);
      try {
        const token = await createSessionToken(mockUser);
        await revokeSessionToken(token);

        const payload = await verifyTokenSignature(token);
        expect(payload).not.toBeNull();
        expect(payload?.sub).toBe('user-1');
      } finally {
        restore();
      }
    });

    it('revokeSessionToken stores TTL bounded by exp claim', async () => {
      const store = makeMemoryStore();
      const restore = __setRevocationStoreForTests(store);
      try {
        const token = await createSessionToken(mockUser);
        const payload = await verifyTokenSignature(token);
        await revokeSessionToken(token);

        const storedExp = store.entries.get(payload!.jti!);
        expect(storedExp).toBe(payload!.exp);
      } finally {
        restore();
      }
    });

    it('revokeSessionToken returns false for invalid token', async () => {
      expect(await revokeSessionToken('not.a.jwt')).toBe(false);
    });
  });

  describe('clearSessionCookie', () => {
    it('clears session cookie by setting empty value and maxAge=0', () => {
      const response = new NextResponse();
      attachSessionCookie(response, 'some-token');
      clearSessionCookie(response);

      const cookie = response.cookies.get(SESSION_COOKIE_NAME);
      expect(cookie!.value).toBe('');
      expect(cookie!.maxAge).toBe(0);
    });
  });
});
