/**
 * POST /api/notifications/telegram/test
 *
 * Test Telegram bot connectivity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { z } from 'zod';
import { requireTenantId } from '@/lib/tenant';
import { db } from '@/lib/db';

const testConfigSchema = z.object({ configId: z.string().min(1).max(200) });

export const runtime = 'nodejs';

async function getTelegramNotifier() {
  const { telegramNotifier } = await import('@/core/notifications/telegram');
  return telegramNotifier;
}

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'reports.read_all');

  const tenantId = requireTenantId(user);
  const validated = testConfigSchema.safeParse(await readJsonBody(request));
  if (!validated.success) return NextResponse.json({ error: 'Укажите канал Telegram' }, { status: 400 });
  const configId = validated.data.configId;
  const config = await db.telegramConfig.findFirst({ where: { id: configId, tenantId }, select: { id: true } });
  if (!config) return NextResponse.json({ error: 'Канал Telegram не найден' }, { status: 404 });
  const telegramNotifier = await getTelegramNotifier();
  const result = await telegramNotifier.testConnection(configId, tenantId);

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}, { domain: 'notifications' });
