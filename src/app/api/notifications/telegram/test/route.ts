/**
 * POST /api/notifications/telegram/test
 *
 * Test Telegram bot connectivity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { telegramNotifier } from '@/core/notifications/telegram';
import { assertCan } from '@/services/auth/authorization-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
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

  assertCan(user!, 'reports.read_all'); // Use existing ability

  const result = await telegramNotifier.testConnection();

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
