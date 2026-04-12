import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { createEquipment, listAllEquipment } from '@/modules/equipment';
import { createEquipmentSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { error } = await requireAuth(request);
    if (error) return error;

    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const siteId = request.nextUrl.searchParams.get('siteId');
    const equipment = await listAllEquipment(pagination, siteId);
    const nextCursor = pagination.getNextCursor(equipment);
    return NextResponse.json({ data: equipment, nextCursor });
  },
  { domain: 'equipment', cache: true, cacheTTL: 60_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
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
    const body = await request.json();

    const validation = createEquipmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await createEquipment({
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      userId: user!.id,
    });
    return NextResponse.json({ equipment }, { status: 201 });
  },
  { domain: 'equipment' }
);
