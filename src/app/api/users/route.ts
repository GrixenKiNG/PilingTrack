import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { assertCan } from '@/services/auth/authorization-service';
import { createUser, deleteUser, listUsers, updateUser } from '@/modules/users';
import { createUserSchema, deleteIdSchema, updateUserSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'users.manage');
    const role = request.nextUrl.searchParams.get('role');
    const users = await listUsers(role);
    return NextResponse.json({ users });
  },
  { domain: 'users', cache: true, cacheTTL: 30_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
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

    assertCan(user!, 'users.manage');
    const body = await request.json();

    const validation = createUserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const { pin, password, isActive, ...rest } = validation.data;
    if (!password?.trim() && !pin?.trim()) {
      return NextResponse.json(
        { error: 'password or pin is required' },
        { status: 400 }
      );
    }

    const createdUser = await createUser({
      ...rest,
      password: password?.trim() || pin?.trim() || '',
      role: rest.role || 'OPERATOR',
    }, user!.id);
    return NextResponse.json({ user: createdUser }, { status: 201 });
  },
  { domain: 'users' }
);

export const PUT = withMutation(
  async (request: NextRequest) => {
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

    assertCan(user!, 'users.manage');
    const body = await request.json();

    const validation = updateUserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const updatedUser = await updateUser(validation.data, user!.id);
    return NextResponse.json({ user: updatedUser });
  },
  { domain: 'users' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
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

    assertCan(user!, 'users.manage');
    const body = await request.json();

    const validation = deleteIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const result = await deleteUser(user!.id, validation.data.id);
    return NextResponse.json(result);
  },
  { domain: 'users' }
);
