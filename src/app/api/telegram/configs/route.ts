import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createTelegramConfig,
  deleteTelegramConfig,
  listTelegramConfigs,
  updateTelegramConfig,
} from '@/services/telegram/telegram-config-service';
import { telegramConfigSchema } from '@/lib/validation-schemas';
import { withApi } from '@/core/api-wrapper';

const telegramConfigIdSchema = telegramConfigSchema.extend({ id: z.string().uuid() });
const deleteIdSchema = z.object({ id: z.string().uuid('Invalid ID') });


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'telegram.manage');
    const configs = await listTelegramConfigs();
    return NextResponse.json({ configs });
  },
  { domain: 'telegram', cache: true, cacheTTL: 60_000 }
);

export async function POST(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'telegram.manage');
    const body = await request.json();
    
    const validation = telegramConfigSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const config = await createTelegramConfig(validation.data);
    return NextResponse.json({ config }, { status: 201 });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'telegram.manage');
    const body = await request.json();
    
    const validation = telegramConfigIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const { id, ...data } = validation.data;
    const config = await updateTelegramConfig(id, data);
    return NextResponse.json({ config });
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

  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'telegram.manage');
    const body = await request.json();
    
    const validation = deleteIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const result = await deleteTelegramConfig(validation.data.id);
    return NextResponse.json(result);
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
