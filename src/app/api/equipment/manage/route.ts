import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createEquipment,
  deleteEquipment,
  updateEquipment,
} from '@/services/equipment/equipment-service';
import { equipmentManageSchema, equipmentIdSchema } from '@/lib/validation-schemas';
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
    assertCan(user!, 'equipment.manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = equipmentManageSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await withDbProtection(async () =>
      createEquipment({
        name: validation.data.name,
        model: validation.data.model,
        qty: validation.data.qty,
        description: validation.data.description,
      })
    );

    return NextResponse.json({ equipment });
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
    assertCan(user!, 'equipment.manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = equipmentManageSchema.safeParse(body);
    if (!validation.success || !validation.data.id) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.success ? [{ field: 'id', message: 'ID is required for updates' }] : validation.error.issues },
        { status: 400 }
      );
    }

    const equipmentId = validation.data.id!;
    const equipment = await withDbProtection(async () =>
      updateEquipment(equipmentId, {
        name: validation.data.name,
        model: validation.data.model || undefined,
        qty: validation.data.qty,
        isActive: validation.data.isActive,
        description: validation.data.description || undefined,
      })
    );

    return NextResponse.json({ equipment });
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
    assertCan(user!, 'equipment.manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = equipmentIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const result = await withDbProtection(async () =>
      deleteEquipment(validation.data.id)
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
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
