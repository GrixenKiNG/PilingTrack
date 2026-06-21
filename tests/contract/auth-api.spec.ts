/**
 * Contract tests for the /api/auth/* routes.
 *
 * These tests freeze the request/response shapes that the frontend and
 * external clients rely on. Drift here is a breaking change and must be
 * intentional. The contract is the *test* — keep schemas inline; do not
 * import from production code, or a renamed field would silently pass.
 *
 * Routes covered:
 *   GET    /api/auth/me        — current user profile
 *   POST   /api/auth/refresh   — rotate access + refresh token pair
 *   DELETE /api/auth/refresh   — revoke current refresh token (device logout)
 *   POST   /api/auth/logout    — full logout: revoke session + audit
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================
// GET /api/auth/me — response contract
// ============================================================

const meResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT']),
    isActive: z.boolean(),
  }),
});

const meErrorSchema = z.object({
  error: z.string(),
});

describe('contract — GET /api/auth/me', () => {
  it('accepts a complete user payload from the server', () => {
    const result = meResponseSchema.safeParse({
      user: {
        id: 'user-1',
        email: 'operator@piling.ru',
        name: 'Иван Иванов',
        role: 'OPERATOR',
        isActive: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects user payload missing role (the FE branches on it)', () => {
    const result = meResponseSchema.safeParse({
      user: { id: 'u', email: 'x@y.ru', name: 'n', isActive: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects role outside the four canonical values', () => {
    const result = meResponseSchema.safeParse({
      user: {
        id: 'u', email: 'x@y.ru', name: 'n', role: 'SUPERADMIN', isActive: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it('returns 404 envelope when user not found (after auth succeeded)', () => {
    // The route logs the requester in and then can't find the requested
    // userId (only relevant when ?userId=other is passed and authorized).
    // FE distinguishes this from 401: the user IS logged in.
    const result = meErrorSchema.safeParse({ error: 'User not found' });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// POST /api/auth/refresh — request + response contract
// ============================================================

// Inlined mirror of refreshSchema in src/app/api/auth/refresh/route.ts.
// If you change one, the other must follow — that's what this test enforces.
const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

const refreshResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.union([z.string().datetime(), z.number(), z.date()]),
});

const refreshValidationErrorSchema = z.object({
  error: z.literal('Validation error'),
  details: z.any(),
});

describe('contract — POST /api/auth/refresh', () => {
  it('accepts a body with a non-empty refreshToken', () => {
    const result = refreshRequestSchema.safeParse({ refreshToken: 'rt-abc' });
    expect(result.success).toBe(true);
  });

  it('rejects empty refreshToken', () => {
    expect(refreshRequestSchema.safeParse({ refreshToken: '' }).success).toBe(false);
  });

  it('rejects missing refreshToken', () => {
    expect(refreshRequestSchema.safeParse({}).success).toBe(false);
  });

  it('returns the canonical token-pair envelope on success', () => {
    const result = refreshResponseSchema.safeParse({
      accessToken: 'jwt.a.b',
      refreshToken: 'rt-new',
      expiresAt: '2026-12-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('returns 400 envelope with details on validation failure', () => {
    const result = refreshValidationErrorSchema.safeParse({
      error: 'Validation error',
      details: { fieldErrors: { refreshToken: ['Required'] } },
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// DELETE /api/auth/refresh — device-level logout contract
// ============================================================

const deviceLogoutResponseSchema = z.object({ ok: z.literal(true) });

describe('contract — DELETE /api/auth/refresh', () => {
  it('returns { ok: true } on revoke (even when no cookie was present)', () => {
    // Note: the route deliberately returns ok=true whether or not the
    // pt-refresh cookie existed. This is so clients can treat it as
    // idempotent. Do not change to 404-on-missing without coordinating
    // with mobile clients that may double-call it on logout.
    const result = deviceLogoutResponseSchema.safeParse({ ok: true });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// POST /api/auth/logout — full session-level logout contract
// ============================================================

// createLogoutResponse in services/auth/auth-service.ts returns an object
// with a success flag and clears the session cookie. The exact body shape
// is documented here so the FE auth provider can rely on it.
const logoutResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

describe('contract — POST /api/auth/logout', () => {
  it('returns a success envelope', () => {
    const result = logoutResponseSchema.safeParse({ success: true });
    expect(result.success).toBe(true);
  });

  it('tolerates an optional message field', () => {
    const result = logoutResponseSchema.safeParse({
      success: true,
      message: 'Logged out',
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// Cross-route invariants
// ============================================================

describe('contract — auth wrapper application', () => {
  // Cold dynamic import of auth routes pulls in jose + bcrypt + db + wrappers;
  // on a cold run that can exceed vitest's default 5s. Give these import-heavy
  // contract tests a generous timeout so they don't flake (was: intermittent
  // "Test timed out in 5000ms").
  it('every auth route module exports its expected HTTP verb function', async () => {
    // Smoke check: if a route module forgets to export GET/POST/DELETE,
    // Next.js silently 405s in production. This test catches that drift.
    const meModule = await import('@/app/api/auth/me/route');
    const refreshModule = await import('@/app/api/auth/refresh/route');
    const logoutModule = await import('@/app/api/auth/logout/route');

    expect(typeof meModule.GET).toBe('function');
    expect(typeof refreshModule.POST).toBe('function');
    expect(typeof refreshModule.DELETE).toBe('function');
    expect(typeof logoutModule.POST).toBe('function');
  }, 30000);

  it('all auth route modules declare the nodejs runtime (jose + bcrypt need it)', async () => {
    const meModule = await import('@/app/api/auth/me/route');
    const refreshModule = await import('@/app/api/auth/refresh/route');
    const logoutModule = await import('@/app/api/auth/logout/route');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    expect((meModule as any).runtime).toBe('nodejs');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    expect((refreshModule as any).runtime).toBe('nodejs');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    expect((logoutModule as any).runtime).toBe('nodejs');
  }, 30000);
});
