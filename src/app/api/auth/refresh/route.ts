/**
 * POST /api/auth/refresh
 *
 * Exchange an expiring access token for a new pair.
 * Uses refresh token rotation with family tracking.
 *
 * Request body:
 *   { refreshToken: "raw-token-string" }
 *
 * Response:
 *   { expiresAt }
 * (accessToken/refreshToken are delivered via httpOnly cookies only — never
 * in the body, see the comment at the response below)
 */

import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/core/security/refresh-tokens';
import { attachSessionCookie } from '@/services/auth/session-service';
import { z } from 'zod';
import { withMutation } from '@/core/api-wrapper';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest) => {
    const body = await request.json();
    const validated = refreshSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
    const ua = request.headers.get('user-agent');

    const tokens = await rotateRefreshToken(validated.data.refreshToken, ip, ua);

    // Tokens are delivered exclusively via httpOnly cookies below — never in
    // the response body, where any XSS, client logger, or error-tracking
    // integration that captures fetch responses could read them, defeating
    // the httpOnly mitigation entirely.
    const response = NextResponse.json({ expiresAt: tokens.expiresAt });

    // Update session cookie with new access token
    attachSessionCookie(response, tokens.accessToken);

    // Set refresh token in httpOnly cookie for automatic rotation
    response.cookies.set({
      name: 'pt-refresh',
      value: tokens.refreshToken,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/refresh',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  },
  { domain: 'auth' }
);

/**
 * DELETE /api/auth/refresh
 *
 * Logout from current device (revoke current refresh token).
 */
export const DELETE = withMutation(
  async (request: NextRequest) => {
    const refreshToken = request.cookies.get('pt-refresh')?.value;

    if (refreshToken) {
      const { revokeRefreshToken } = await import('@/core/security/refresh-tokens');
      await revokeRefreshToken(refreshToken);
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set('pt-refresh', '', { maxAge: 0, path: '/api/auth/refresh' });

    return response;
  },
  { domain: 'auth' }
);
