import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { getSiteWithHierarchy, updateSite, deactivateSite } from '@/modules/sites';
import { updateSiteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // Extract id from URL since params not available in wrapper
    const id = request.nextUrl.pathname.split('/').pop() || '';
    const site = await getSiteWithHierarchy(user!, id);
    if (!site) throw new ServiceError('Site not found', 404);
    return NextResponse.json({ site });
  },
  { domain: 'sites', cache: true, cacheTTL: 30_000 }
);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const body = await request.json();
    const validated = updateSiteSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const site = await updateSite({
      siteId: id,
      name: validated.data.name,
      plannedPiles: validated.data.plannedPiles,
      plannedDrilling: validated.data.plannedDrilling,
      completionDate: (validated.data as any).completionDate,
      userId: user!.id,
    });
    // Invalidate sites cache
    await invalidateSites();
    return NextResponse.json({ site });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }
    if (typeof caughtError === 'object' && caughtError !== null && 'code' in caughtError && (caughtError as any).code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    await deactivateSite(id, user!.id);
    // Invalidate sites cache
    await invalidateSites();
    return NextResponse.json({ ok: true, siteId: id });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }
    if (typeof caughtError === 'object' && caughtError !== null && 'code' in caughtError && (caughtError as any).code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
