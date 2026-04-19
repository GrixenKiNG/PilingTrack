import { NextRequest } from 'next/server';
import {
  authenticateUserByPin,
  createAuthenticatedResponse,
} from '@/services/auth/auth-service';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { pinAuthSchema } from '@/lib/validation-schemas';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';
import { getRateLimitIdentifier } from '@/lib/rate-limiter';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const POST = withApi(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const body = await request.json();
  const tenantContext = resolveTenantContext(request);

  const validation = pinAuthSchema.safeParse(body);
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

  const { pin } = validation.data;

  // Rate-limit by client identifier (IP, or tenant+IP if tenant header present).
  // Prevents a brute-force of "try all PINs from one IP" that rate-limiting
  // by PIN value would miss.
  const clientIdentifier = getRateLimitIdentifier(request, 'unknown', {
    includeTenant: true,
  });
  const result = await authenticateUserByPin(pin, clientIdentifier);

  if (result.rateLimited) {
    await recordAuditEvent({
      action: 'auth.pin.rate_limited',
      scope: 'auth',
      tenantId: tenantContext.tenantId,
      requestId,
      metadata: { retryAfter: result.retryAfter },
    });

    return createJsonResponse(
      { error: result.error || 'Too many PIN attempts', requestId, retryAfter: result.retryAfter },
      { status: 429 },
      requestId
    );
  }

  if (!result.user) {
    await recordAuditEvent({
      action: 'auth.pin.failed',
      scope: 'auth',
      tenantId: tenantContext.tenantId,
      requestId,
    });

    return createJsonResponse({ error: 'Invalid PIN', requestId }, { status: 401 }, requestId);
  }

  // TODO(security): same caveat as login — tenantContext.tenantId comes from
  // header, not session. Proper fix requires SessionUser.tenantId plumbing.
  await recordAuditEvent({
    action: 'auth.pin.succeeded',
    scope: 'auth',
    actorId: result.user.id,
    tenantId: tenantContext.tenantId,
    requestId,
    metadata: { email: result.user.email, role: result.user.role },
  });

  return await createAuthenticatedResponse(result.user, requestId);
}, { domain: 'auth.pin' });
