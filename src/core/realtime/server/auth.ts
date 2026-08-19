/**
 * WebSocket Authentication
 *
 * Verifies session cookie or JWT during WS handshake.
 * Reuses existing session-service from the app.
 */

import * as http from 'http';
import { IncomingMessage } from 'http';
import { parse as parseCookie } from 'cookie';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { SESSION_COOKIE_NAME, tokenTenantId, verifySessionToken } from '@/services/auth/session-service';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface WSAuthResult {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string | null;
  siteIds: string[];
}

/**
 * Validate the Origin header on a WebSocket upgrade request.
 * Mirrors the HTTP CSRF check in lib/csrf-protection.ts: same-origin (Origin
 * host === Host header) passes; an Origin present but pointing elsewhere is
 * rejected. Missing Origin is allowed, same as the HTTP CSRF fallback, since
 * non-browser clients (health checks, internal tooling) don't send one.
 */
export function validateWSOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Authenticate a WebSocket upgrade request.
 * Extracts session cookie, verifies token, returns user context.
 */
export async function authenticateWS(req: IncomingMessage): Promise<WSAuthResult | null> {
  // Контекст организации открывается здесь, а не у вызывающего: у сервера
  // сокетов нет обёртки withApi, а без открытого контекста setRequestTenantId
  // ниже молча ничего не делает — и под строгими политиками RLS строка
  // пользователя не читается вовсе, то есть рукопожатие не проходит ни у кого.
  return runWithTenantContext(() => authenticateWSScoped(req));
}

async function authenticateWSScoped(req: IncomingMessage): Promise<WSAuthResult | null> {
  try {
    // Parse cookies from upgrade request
    const cookieHeader = req.headers.cookie || '';
    const cookies = parseCookie(cookieHeader);

    // Session token comes from the cookie only. The old `?token=` query
    // fallback put long-lived session JWTs into proxy/access logs and had no
    // production consumer — the browser client authenticates via the
    // same-origin cookie (audit M4).
    const sessionToken = cookies[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return null;
    }

    // Verify session token
    const payload = await verifySessionToken(sessionToken);
    if (!payload) {
      return null;
    }

    // Тот же порядок, что и в HTTP-пути: организация из токена попадает в
    // контекст до чтения строки пользователя.
    const claimedTenantId = tokenTenantId(payload);
    if (claimedTenantId !== undefined) {
      setRequestTenantId(claimedTenantId);
    }

    // Fetch full user context
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        isActive: true,
        sessionVersion: true,
      },
    });

    // sessionVersion mirrors the check in lib/auth.ts — a password/PIN change
    // or deactivation bumps it, which must kill live WS sessions too, not
    // just future HTTP requests.
    if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
      return null;
    }

    // Токен со старой организацией — сессия недействительна (см. lib/auth.ts).
    if (claimedTenantId !== undefined && user.tenantId !== claimedTenantId) {
      return null;
    }

    // Get user's site assignments
    const assignments = await db.userSiteAssignment.findMany({
      where: { userId: user.id },
      select: { siteId: true },
    });

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      siteIds: assignments.map(a => a.siteId),
    };
  } catch (error) {
    logger.error('WS authentication failed', error);
    return null;
  }
}

/**
 * Send auth error and close connection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
export function sendAuthError(ws: http.ServerResponse | any, code: number, message: string): void {
  try {
    ws.send(JSON.stringify({
      type: 'error',
      code: code === 401 ? 'AUTH_FAILED' : 'AUTH_ERROR',
      message,
    }));

    ws.close(1008, message);
  } catch {
    // Connection may already be closed
  }
}
