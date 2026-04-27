import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createTelegramConfig,
  deleteTelegramConfig,
  listTelegramConfigs,
  updateTelegramConfig,
} from '@/services/telegram/telegram-config-service';
import { telegramConfigSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';

const telegramConfigIdSchema = telegramConfigSchema.partial().extend({ id: z.string().uuid() });
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

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

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
  },
  { domain: 'telegram' }
);

export const PUT = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

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
  },
  { domain: 'telegram' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

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
  },
  { domain: 'telegram' }
);
