import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { deleteEquipment, getEquipmentById, updateEquipment } from '@/services/equipment/equipment-service';
import { equipmentManageSchema } from '@/lib/validation-schemas';


export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(request);
  if (error) return error;

  try {
    const { id } = await params;
    const equipment = await getEquipmentById(id);
    return NextResponse.json({ equipment });
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfCheck = withCsrf(request);
  if (csrfCheck) return csrfCheck;

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
    const { id } = await params;
    const body = await request.json();

    const validation = equipmentManageSchema.partial().safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await updateEquipment(id, validation.data);

    return NextResponse.json({ equipment });
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
  const csrfCheck = withCsrf(request);
  if (csrfCheck) return csrfCheck;

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
    const { id } = await params;
    const result = await deleteEquipment(id);
    return NextResponse.json(result);
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
