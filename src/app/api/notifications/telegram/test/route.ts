/**
 * POST /api/notifications/telegram/test
 *
 * Test Telegram bot connectivity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { telegramNotifier } from '@/core/notifications/telegram';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  assertCan(user!, 'reports.read_all');

  const result = await telegramNotifier.testConnection();

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}, { domain: 'notifications' });
