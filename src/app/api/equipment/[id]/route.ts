import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { assertCan } from '@/services/auth/authorization-service';
import { getEquipmentByIdOrThrow, updateEquipment, deleteEquipment } from '@/modules/equipment';
import { equipmentManageSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    const equipment = await getEquipmentByIdOrThrow(id);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

    await updateEquipment({
      equipmentId: id,
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      userId: user!.id,
    });

    const equipment = await getEquipmentByIdOrThrow(id);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    const result = await deleteEquipment(id);
    return NextResponse.json(result);
  },
  { domain: 'equipment' }
);
