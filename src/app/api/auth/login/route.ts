import { NextRequest } from 'next/server';
import {
  authenticateUserByEmailPassword,
  createAuthenticatedResponse,
} from '@/services/auth/auth-service';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { loginSchema } from '@/lib/validation-schemas';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';
import { withApi, readJsonBody } from '@/core/api-wrapper';
import { getRateLimitIdentifier } from '@/lib/rate-limiter';
import { withCsrf } from '@/lib/csrf-protection';


export const runtime = 'nodejs';

export const POST = withApi(
  async (request: NextRequest) => {
    const requestId = getRequestId(request);

    // Вход идёт через withApi (сессии ещё нет, свой лимитер попыток), поэтому
    // CSRF-проверку withMutation он не получает. Межсайтовый вход отклоняем
    // здесь, до разбора тела: иначе чужая страница могла войти в браузере
    // сотрудника под учётной записью атакующего (login CSRF, аудит Codex
    // out55, F09). Запросы без браузерных заголовков withCsrf для входа
    // пропускает (см. CSRF_HEADERLESS_ALLOWED_PATHS).
    const csrfRejection = withCsrf(request);
    if (csrfRejection) return csrfRejection;

    const body = await readJsonBody(request);
    const tenantContext = resolveTenantContext(request);

    // Zod validation
    const validation = loginSchema.safeParse(body);
    if (!validation.success) {
      return createJsonResponse(
        {
          error: 'Проверьте email и пароль',
          requestId,
          details: validation.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
        },
        { status: 400 },
        requestId
      );
    }

    const { email, password } = validation.data;

    const result = await authenticateUserByEmailPassword(
      email.trim().toLowerCase(),
      password,
      getRateLimitIdentifier(request),
    );

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
        { error: 'Слишком много попыток входа. Попробуйте позже.', requestId, retryAfter: result.retryAfter },
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

      return createJsonResponse({ error: 'Неверный email или пароль', requestId }, { status: 401 }, requestId);
    }

    await recordAuditEvent({
      action: 'auth.login.succeeded',
      scope: 'auth',
      actorId: result.user.id,
      tenantId: result.user.tenantId,
      requestId,
      metadata: { email: result.user.email, role: result.user.role },
    });

    return await createAuthenticatedResponse(result.user, requestId);
  },
  { domain: 'auth' }
);
