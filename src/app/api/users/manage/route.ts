import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateUser } from '@/modules/users';
import { updateUserSchema } from '@/lib/validation-schemas';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

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
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Zod validation — do NOT call .partial() here; updateUserSchema already
    // makes optional fields optional and keeps `id` REQUIRED.
    const validation = updateUserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const validatedData = validation.data;

    const updated = await updateUser({
      id: validatedData.id,
      isActive: validatedData.isActive,
      name: validatedData.name,
      role: validatedData.role,
      phone: validatedData.phone,
      email: validatedData.email,
      password: validatedData.password,
    }, user!.id);

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        isActive: updated.isActive,
        name: updated.name,
        role: updated.role,
        phone: updated.phone,
      },
    });
  },
  { domain: 'users' }
);
