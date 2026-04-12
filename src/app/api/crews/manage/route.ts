import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createCrew,
  deleteCrew,
  updateCrew,
} from '@/modules/crews';
import { createCrewSchema, crewManageSchema, crewIdSchema } from '@/lib/validation-schemas';
import { withDbProtection, CircuitOpenError } from '@/core/infrastructure/circuit-breakers';

function getLegacyAssistantNames(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  const assistantsCount = Number(value);
  if (!Number.isInteger(assistantsCount) || assistantsCount < 0) {
    throw new ServiceError('assistantsCount must be >= 0', 400);
  }

  return Array.from({ length: assistantsCount }, (_, index) => `Assistant ${index + 1}`);
}


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
    assertCan(user!, 'crews.legacy_manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = createCrewSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const crew = await withDbProtection(async () =>
      createCrew({
        operatorId: validated.data.operatorId,
        equipmentId: validated.data.equipmentId,
        siteId: validated.data.siteId,
        name: validated.data.name || 'Unnamed Crew',
      })
    );

    return NextResponse.json({ crew });
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

    console.error('Crew create error:', caughtError);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
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
    assertCan(user!, 'crews.legacy_manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = crewManageSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const crew = await withDbProtection(async () =>
      updateCrew({
        crewId: validated.data.id!,
        name: validated.data.name,
        isActive: (validated.data as any).isActive,
      })
    );

    return NextResponse.json({ crew });
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

    console.error('Crew update error:', caughtError);
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
    assertCan(user!, 'crews.legacy_manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = crewIdSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const result = await withDbProtection(async () =>
      deleteCrew({ crewId: validated.data.id, force: true })
    );
    return NextResponse.json(result);
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

    console.error('Crew delete error:', caughtError);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
