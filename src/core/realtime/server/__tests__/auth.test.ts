/**
 * WebSocket Authentication — Unit Tests
 *
 * Tests:
 * - authenticateClient: success, no cookie, invalid token, expired token
 * - Mocked verifySessionToken and db
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncomingMessage } from 'http';
import { Socket } from 'net';

// ============================================================
// Mocks — use vi.hoisted to avoid top-level variable issues
// ============================================================

const mocks = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
  dbUserFindUnique: vi.fn(),
  dbUserSiteAssignmentFindMany: vi.fn(),
}));

vi.mock('@/services/auth/session-service', async () => {
  const actual = await vi.importActual<typeof import('@/services/auth/session-service')>('@/services/auth/session-service');
  return {
    ...actual,
    verifySessionToken: mocks.verifySessionToken,
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: mocks.dbUserFindUnique,
    },
    userSiteAssignment: {
      findMany: mocks.dbUserSiteAssignmentFindMany,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { authenticateWS } from '@/core/realtime/server/auth';

// ============================================================
// Helpers
// ============================================================

function createMockReq(headers: Record<string, string | undefined>): IncomingMessage {
  const req = new IncomingMessage(new Socket()) as IncomingMessage;
  req.headers = {};

  if (headers.cookie) {
    req.headers.cookie = headers.cookie;
  }

  req.url = headers.url || '/';

  return req;
}

describe('WebSocket Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Successful authentication
  // ============================================================

  describe('authenticateClient — success', () => {
    it('should authenticate with valid session cookie', async () => {
      mocks.verifySessionToken.mockResolvedValue({
        sub: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'OPERATOR',
        type: 'session',
        v: 1,
      });

      mocks.dbUserFindUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        isActive: true,
      });

      mocks.dbUserSiteAssignmentFindMany.mockResolvedValue([
        { siteId: 'site-1' },
        { siteId: 'site-2' },
      ]);

      const req = createMockReq({ cookie: 'pt-session=valid-token-123' });
      const result = await authenticateWS(req);

      expect(result).not.toBeNull();
      expect(result).toEqual({
        userId: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        siteIds: ['site-1', 'site-2'],
      });

      expect(mocks.verifySessionToken).toHaveBeenCalledWith('valid-token-123');
    });

    it('should authenticate with token from query param', async () => {
      mocks.verifySessionToken.mockResolvedValue({
        sub: 'user-2',
        email: 'api@example.com',
        name: 'API User',
        role: 'ADMIN',
        type: 'session',
        v: 1,
      });

      mocks.dbUserFindUnique.mockResolvedValue({
        id: 'user-2',
        email: 'api@example.com',
        name: 'API User',
        role: 'ADMIN',
        tenantId: 'tenant-1',
        isActive: true,
      });

      mocks.dbUserSiteAssignmentFindMany.mockResolvedValue([]);

      const req = createMockReq({ url: '/?token=my-api-token' });
      const result = await authenticateWS(req);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-2');
      expect(mocks.verifySessionToken).toHaveBeenCalledWith('my-api-token');
    });
  });

  // ============================================================
  // No cookie / no token
  // ============================================================

  describe('authenticateClient — no cookie', () => {
    it('should return null when no session cookie or token', async () => {
      const req = createMockReq({});
      const result = await authenticateWS(req);

      expect(result).toBeNull();
      expect(mocks.verifySessionToken).not.toHaveBeenCalled();
    });

    it('should return null when cookie exists but session key is missing', async () => {
      const req = createMockReq({ cookie: 'other-cookie=value' });
      const result = await authenticateWS(req);

      expect(result).toBeNull();
      expect(mocks.verifySessionToken).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Invalid token
  // ============================================================

  describe('authenticateClient — invalid token', () => {
    it('should return null when verifySessionToken returns null', async () => {
      mocks.verifySessionToken.mockResolvedValue(null);

      const req = createMockReq({ cookie: 'pt-session=garbage-token' });
      const result = await authenticateWS(req);

      expect(result).toBeNull();
      expect(mocks.verifySessionToken).toHaveBeenCalledWith('garbage-token');
    });

    it('should return null when verifySessionToken throws', async () => {
      mocks.verifySessionToken.mockRejectedValue(new Error('Invalid token'));

      const req = createMockReq({ cookie: 'pt-session=invalid' });
      const result = await authenticateWS(req);

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // Expired / inactive user
  // ============================================================

  describe('authenticateClient — expired or inactive', () => {
    it('should return null when user is not active', async () => {
      mocks.verifySessionToken.mockResolvedValue({
        sub: 'user-3',
        email: 'inactive@example.com',
        name: 'Inactive User',
        role: 'OPERATOR',
        type: 'session',
        v: 1,
      });

      mocks.dbUserFindUnique.mockResolvedValue({
        id: 'user-3',
        email: 'inactive@example.com',
        name: 'Inactive User',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        isActive: false,
      });

      const req = createMockReq({ cookie: 'pt-session=valid-but-inactive' });
      const result = await authenticateWS(req);

      expect(result).toBeNull();
    });

    it('should return null when user not found in database', async () => {
      mocks.verifySessionToken.mockResolvedValue({
        sub: 'deleted-user',
        email: 'deleted@example.com',
        name: 'Deleted User',
        role: 'OPERATOR',
        type: 'session',
        v: 1,
      });

      mocks.dbUserFindUnique.mockResolvedValue(null);

      const req = createMockReq({ cookie: 'pt-session=orphaned-token' });
      const result = await authenticateWS(req);

      expect(result).toBeNull();
    });
  });
});
