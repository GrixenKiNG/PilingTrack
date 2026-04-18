import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const SESSION_COOKIE_NAME = 'pt-session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface SessionPayload extends JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  type: 'session';
  v: 1;
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

export async function createSessionToken(user: SessionUser) {
  const secret = getSecretKey();

  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    type: 'session',
    v: 1,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);

  return token;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secret = getSecretKey();

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    // Custom claims validation
    if (payload.type !== 'session' || payload.v !== 1) {
      return null;
    }

    return payload as SessionPayload;
  } catch {
    return null;
  }
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
