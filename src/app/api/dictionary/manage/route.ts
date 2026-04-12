import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { createDictionaryItem, deleteDictionaryItem } from '@/services/dictionaries/dictionary-service';
import { z } from 'zod';

const createDictionaryItemSchema = z.object({
  type: z.enum(['pileGrade', 'drillingType', 'downtimeReason']),
  name: z.string().min(1).max(100),
});

const deleteDictionaryItemSchema = z.object({
  type: z.enum(['pileGrade', 'drillingType', 'downtimeReason']),
  id: z.string().min(1),
});


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
    assertCan(user!, 'dictionary.manage');
    const body = await request.json();
    const validated = createDictionaryItemSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const item = await createDictionaryItem(validated.data.type, validated.data.name);
    return NextResponse.json({ item });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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
    assertCan(user!, 'dictionary.manage');
    const body = await request.json();
    const validated = deleteDictionaryItemSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const result = await deleteDictionaryItem(validated.data.type, validated.data.id);
    return NextResponse.json(result);
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
