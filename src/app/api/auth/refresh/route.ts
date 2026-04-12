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
 *   { accessToken, refreshToken, expiresAt }
 */

import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/core/security/refresh-tokens';
import { attachSessionCookie } from '@/services/auth/session-service';
import { ServiceError } from '@/services/service-error';
import { withCsrf } from '@/lib/csrf-protection';
import { z } from 'zod';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  try {
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

    const response = NextResponse.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

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
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/refresh
 *
 * Logout from current device (revoke current refresh token).
 */
export async function DELETE(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  try {
    const refreshToken = request.cookies.get('pt-refresh')?.value;

    if (refreshToken) {
      const { revokeRefreshToken } = await import('@/core/security/refresh-tokens');
      await revokeRefreshToken(refreshToken);
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set('pt-refresh', '', { maxAge: 0, path: '/api/auth/refresh' });

    return response;
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
