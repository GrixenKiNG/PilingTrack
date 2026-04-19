import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateUserByEmailPassword,
  createAuthenticatedResponse,
} from '@/services/auth/auth-service';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { loginSchema } from '@/lib/validation-schemas';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withApi(
  async (request: NextRequest) => {
    const requestId = getRequestId(request);

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

    // TODO(security): tenantContext.tenantId comes from the X-Tenant-ID
    // header — a logged-in user from tenant A who sends X-Tenant-ID: B will
    // record this success audit under tenant B. Proper fix requires plumbing
    // tenantId through SessionUser/JWT payload (out of scope here).
    await recordAuditEvent({
      action: 'auth.login.succeeded',
      scope: 'auth',
      actorId: result.user.id,
      tenantId: tenantContext.tenantId,
      requestId,
      metadata: { email: result.user.email, role: result.user.role },
    });

    return await createAuthenticatedResponse(result.user, requestId);
  },
  { domain: 'auth' }
);
