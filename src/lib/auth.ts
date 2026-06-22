import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { readSessionToken, verifySessionToken } from '@/services/auth/session-service';

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string;
  tenantId: string | null;
}

interface AuthResult {
  user: AuthenticatedUser | null;
  error: NextResponse | null;
}

interface CachedAuthUser {
  expiresAt: number;
  user: AuthenticatedUser;
}

interface SessionResolution {
  payloadValid: boolean;
  user: AuthenticatedUser | null;
}

const AUTH_USER_CACHE_TTL_MS = 5_000;
const AUTH_USER_CACHE_MAX_ENTRIES = 500;

const authUserCache = new Map<string, CachedAuthUser>();
const authUserInFlight = new Map<string, Promise<SessionResolution>>();

function pruneAuthUserCache(now = Date.now()) {
  for (const [key, entry] of authUserCache.entries()) {
    if (entry.expiresAt <= now) {
      authUserCache.delete(key);
    }
  }

  if (authUserCache.size <= AUTH_USER_CACHE_MAX_ENTRIES) {
    return;
  }

  const overflow = authUserCache.size - AUTH_USER_CACHE_MAX_ENTRIES;
  const oldestEntries = Array.from(authUserCache.entries())
    .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
    .slice(0, overflow);

  for (const [key] of oldestEntries) {
    authUserCache.delete(key);
  }
}

async function resolveSessionUser(token: string): Promise<SessionResolution> {
  const now = Date.now();
  const cached = authUserCache.get(token);
  if (cached && cached.expiresAt > now) {
    return { payloadValid: true, user: cached.user };
  }

  const inFlight = authUserInFlight.get(token);
  if (inFlight) {
    return inFlight;
  }

  const resolutionPromise = (async (): Promise<SessionResolution> => {
    const payload = await verifySessionToken(token);
    if (!payload) {
      authUserCache.delete(token);
      return { payloadValid: false, user: null };
    }

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        isActive: true,
        tenantId: true,
        sessionVersion: true,
      },
    });

    if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
      authUserCache.delete(token);
      return { payloadValid: true, user: null };
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      tenantId: user.tenantId,
    };

    authUserCache.set(token, {
      user: authenticatedUser,
      expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
    });
    pruneAuthUserCache();

    return { payloadValid: true, user: authenticatedUser };
  })().finally(() => {
    authUserInFlight.delete(token);
  });

  authUserInFlight.set(token, resolutionPromise);
  return resolutionPromise;
}

/**
 * Drop the cached auth-user entry for a given token. Called from logout so the
 * current process doesn't keep serving the revoked session from its 5s cache.
 * Other processes pick up the Redis denylist within their own cache window.
 */
export function clearAuthUserCacheEntry(token: string) {
  authUserCache.delete(token);
  authUserInFlight.delete(token);
}

export async function requireAuth(request: NextRequest): Promise<AuthResult> {
  const requestId = getRequestId(request);

  try {
    const token = readSessionToken(request);
    if (!token) {
      return {
        user: null,
        error: createJsonResponse({ error: 'Unauthorized', requestId }, { status: 401 }, requestId),
      };
    }

    const { payloadValid, user } = await resolveSessionUser(token);
    if (!payloadValid) {
      return {
        user: null,
        error: createJsonResponse(
          { error: 'Session is invalid', requestId },
          { status: 401 },
          requestId
        ),
      };
    }

    if (!user) {
      return {
        user: null,
        error: createJsonResponse({ error: 'User not found', requestId }, { status: 401 }, requestId),
      };
    }

    return { user, error: null };
  } catch {
    return {
      user: null,
      error: createJsonResponse(
        { error: 'Authentication failed', requestId },
        { status: 500 },
        requestId
      ),
    };
  }
}
