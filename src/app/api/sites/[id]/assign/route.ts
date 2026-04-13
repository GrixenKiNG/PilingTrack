import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { assertCan } from '@/services/auth/authorization-service';
import { assignUserToSite, unassignUserFromSite } from '@/modules/sites';
import { siteAssignSchema } from '@/lib/validation-schemas';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

    assertCan(user!, 'sites.assign_users');
    const { id } = await params;
    const body = await request.json();
    const validated = siteAssignSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json({ error: 'Validation failed', details: validated.error.flatten() }, { status: 400 });
    }
    const assignment = await assignUserToSite(id, validated.data.userId);
    return NextResponse.json({ assignment });
  },
  { domain: 'sites' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

    assertCan(user!, 'sites.assign_users');
    const { id } = await params;
    const userId = request.nextUrl.searchParams.get('userId');
    const result = await unassignUserFromSite(id, userId || '');
    return NextResponse.json(result);
  },
  { domain: 'sites' }
);
