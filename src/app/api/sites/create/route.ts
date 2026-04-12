import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { createSiteWithPlans } from '@/services/sites/site-admin-service';
import { createSiteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withDbProtection, CircuitOpenError } from '@/core/infrastructure/circuit-breakers';


export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  const MUTATION_RATE_LIMIT = {
    maxAttempts: 100,
    windowMs: 60_000,
    blockDurationMs: 60_000,
  };

  const identifier = getRateLimitIdentifier(request);
  const rl = await rateLimiter.check(identifier, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
    );
  }

  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'sites.manage');

    const body = await request.json();
    const validation = createSiteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    return await withDbProtection(async () => {
      const site = await createSiteWithPlans({
        name: validation.data.name,
        pilePlans: body.pilePlans,
        drillingPlans: body.drillingPlans,
      });

      // Invalidate sites cache
      await invalidateSites();

      return NextResponse.json({ site }, { status: 201 });
    });
  } catch (caughtError) {
    if (caughtError instanceof CircuitOpenError) {
      const retryAfterSec = Math.ceil(caughtError.retryAfterMs / 1000);
      return NextResponse.json(
        { error: 'Database temporarily unavailable', retryAfter: retryAfterSec },
        { status: 503, headers: { 'Retry-After': String(retryAfterSec) } }
      );
    }

    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    console.error('Create site error:', caughtError);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
