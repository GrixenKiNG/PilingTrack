import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { readSessionToken, verifySessionToken } from '@/services/auth/session-service';

interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    phone: string;
    tenantId: string | null;
  } | null;
  error: NextResponse | null;
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

    const payload = await verifySessionToken(token);
    if (!payload) {
      return {
        user: null,
        error: createJsonResponse(
          { error: 'Session is invalid', requestId },
          { status: 401 },
          requestId
        ),
      };
    }

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, phone: true, isActive: true, tenantId: true },
    });

    if (!user || !user.isActive) {
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
