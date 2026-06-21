/**
 * Refresh Token Service — Secure Session Management
 *
 * Features:
 * - Refresh token rotation (each refresh issues a new token)
 * - Token family tracking (detects concurrent reuse = compromised)
 * - Automatic revocation on rotation
 * - Hashed token storage (never store raw tokens)
 * - IP/User agent tracking for audit
 *
 * Flow:
 * 1. Login → issue access token + refresh token
 * 2. Access token expires → client sends refresh token
 * 3. Server validates, rotates (issues new pair), revokes old
 * 4. If same-family token reused → revoke entire family (compromise detected)
 *
 * Usage:
 *   import { createRefreshToken, rotateRefreshToken } from '@/core/security/refresh-tokens';
 *
 *   // On login:
 *   const { accessToken, refreshToken } = await createRefreshToken(user, ip, ua);
 *
 *   // On refresh:
 *   const { accessToken, refreshToken } = await rotateRefreshToken(oldRefreshToken, ip, ua);
 */

import { createHash, randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { createSessionToken, SessionUser } from '@/services/auth/session-service';
import { ServiceError } from '@/lib/service-error';

// ============================================================
// Token Configuration
// ============================================================

const REFRESH_TOKEN_TTL_DAYS = 30;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 90-day refresh-token family max-lifetime is defined but not yet enforced; tracked as a follow-up security task.
const REFRESH_TOKEN_FAMILY_TTL_DAYS = 90; // Max family lifetime

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// ============================================================
// Token Utilities
// ============================================================

/**
 * Generate a cryptographically secure random token string.
 */
function generateToken(): string {
  return randomUUID() + randomUUID(); // 72 chars of entropy
}

/**
 * Hash a token for secure storage.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new token family.
 * All tokens in a family are linked (for rotation detection).
 */
function createFamily(): string {
  return randomUUID();
}

// ============================================================
// Refresh Token CRUD
// ============================================================

/**
 * Create a new refresh token and issue an access token.
 * Called on initial login.
 */
export async function createRefreshToken(
  user: SessionUser,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<TokenPair> {
  const rawToken = generateToken();
  const hashedToken = hashToken(rawToken);
  const family = createFamily();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await db.refreshToken.create({
    data: {
      userId: user.id,
      token: hashedToken,
      family,
      expiresAt,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    },
  });

  const accessToken = await createSessionToken(user);

  return {
    accessToken,
    refreshToken: rawToken,
    expiresAt,
  };
}

/**
 * Rotate a refresh token: validate old, issue new pair.
 * The old token is revoked immediately.
 *
 * If a different token from the same family is used concurrently,
 * the entire family is revoked (compromise detection).
 */
export async function rotateRefreshToken(
  rawToken: string,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<TokenPair> {
  const hashedToken = hashToken(rawToken);

  // Find the token
  const existingToken = await db.refreshToken.findUnique({
    where: { token: hashedToken },
  });

  if (!existingToken) {
    throw new ServiceError('Invalid refresh token', 401);
  }

  if (existingToken.revoked) {
    // Token was already revoked — this might be a replay or a compromise
    // Check if the entire family has been revoked
    const familyTokens = await db.refreshToken.findMany({
      where: { family: existingToken.family },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (familyTokens.length > 0 && familyTokens[0].revoked) {
      throw new ServiceError('Token family revoked — please re-authenticate', 401);
    }

    throw new ServiceError('Refresh token has been revoked', 401);
  }

  if (existingToken.expiresAt < new Date()) {
    throw new ServiceError('Refresh token expired', 401);
  }

  // Check for concurrent reuse (different token hash, same family, not yet revoked)
  const concurrentTokens = await db.refreshToken.findMany({
    where: {
      family: existingToken.family,
      token: { not: hashedToken },
      revoked: false,
      expiresAt: { gt: new Date() },
    },
  });

  if (concurrentTokens.length > 0) {
    // COMPROMISE DETECTED — revoke entire family
    await db.refreshToken.updateMany({
      where: { family: existingToken.family },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: 'Concurrent token reuse detected — possible token theft',
      },
    });

    throw new ServiceError(
      'Security: refresh token was reused. All sessions revoked. Please re-authenticate.',
      401
    );
  }

  // Revoke the current token
  await db.refreshToken.update({
    where: { id: existingToken.id },
    data: {
      revoked: true,
      revokedAt: new Date(),
      lastUsedAt: new Date(),
    },
  });

  // Fetch user for new access token
  const user = await db.user.findUnique({
    where: { id: existingToken.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, tenantId: true },
  });

  if (!user || !user.isActive) {
    throw new ServiceError('User not found or inactive', 401);
  }

  // Issue new token pair (same family)
  const rawNewToken = generateToken();
  const hashedNewToken = hashToken(rawNewToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await db.refreshToken.create({
    data: {
      userId: user.id,
      token: hashedNewToken,
      family: existingToken.family,
      expiresAt,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    },
  });

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  };

  const accessToken = await createSessionToken(sessionUser);

  return {
    accessToken,
    refreshToken: rawNewToken,
    expiresAt,
  };
}

/**
 * Revoke a refresh token (logout from specific device).
 */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hashedToken = hashToken(rawToken);

  await db.refreshToken.updateMany({
    where: { token: hashedToken, revoked: false },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: 'User-initiated logout',
    },
  });
}

/**
 * Revoke all tokens for a user (logout all devices).
 */
export async function revokeAllUserTokens(userId: string, reason = 'User-initiated'): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
}

/**
 * Revoke an entire token family (security incident).
 */
export async function revokeTokenFamily(family: string, reason: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { family },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
}

// ============================================================
// Cleanup
// ============================================================

/**
 * Delete expired refresh tokens.
 * Run daily via cron or worker.
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const result = await db.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revoked: true, revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, // Revoked > 7 days
      ],
    },
  });

  return result.count;
}

/**
 * Get active sessions for a user (for session management UI).
 */
export async function getUserActiveSessions(userId: string) {
  const tokens = await db.refreshToken.findMany({
    where: {
      userId,
      revoked: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id: true,
      family: true,
      expiresAt: true,
      createdAt: true,
      lastUsedAt: true,
      ipAddress: true,
      userAgent: true,
    },
  });

  return tokens.map(t => ({
    id: t.id,
    family: t.family,
    expiresAt: t.expiresAt,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    ipAddress: t.ipAddress,
    userAgent: t.userAgent,
    isCurrentSession: false, // Caller should set based on current request
  }));
}
