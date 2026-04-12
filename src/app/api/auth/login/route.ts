import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateUserByEmailPassword,
  createAuthenticatedResponse,
} from '@/services/auth/auth-service';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { loginSchema } from '@/lib/validation-schemas';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';


export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const body = await request.json();
    const tenantContext = resolveTenantContext(request);
    
    // Zod validation
    const validation = loginSchema.safeParse(body);
    if (!validation.success) {
      return createJsonResponse(
        {
          error: 'Validation failed',
          requestId,
          details: validation.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
        },
        { status: 400 },
        requestId
      );
    }

    const { email, password } = validation.data;

    const result = await authenticateUserByEmailPassword(email.trim().toLowerCase(), password);

    // Rate limited
    if (result.rateLimited) {
      await recordAuditEvent({
        action: 'auth.login.rate_limited',
        scope: 'auth',
        tenantId: tenantContext.tenantId,
        requestId,
        metadata: { email: validation.data.email.trim().toLowerCase(), retryAfter: result.retryAfter },
      });

      return createJsonResponse(
        { error: 'Too many login attempts', requestId, retryAfter: result.retryAfter },
        { status: 429 },
        requestId
      );
    }

    if (!result.user) {
      await recordAuditEvent({
        action: 'auth.login.failed',
        scope: 'auth',
        tenantId: tenantContext.tenantId,
        requestId,
        metadata: { email },
      });

      return createJsonResponse({ error: 'Invalid credentials', requestId }, { status: 401 }, requestId);
    }

    await recordAuditEvent({
      action: 'auth.login.succeeded',
      scope: 'auth',
      actorId: result.user.id,
      tenantId: tenantContext.tenantId,
      requestId,
      metadata: { email: result.user.email, role: result.user.role },
    });

    return await createAuthenticatedResponse(result.user, requestId);
  } catch (error) {
    console.error('Login error:', error);
    return createJsonResponse({ error: 'Internal error', requestId }, { status: 500 }, requestId);
  }
}
