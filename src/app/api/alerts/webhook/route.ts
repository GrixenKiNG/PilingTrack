/**
 * POST /api/alerts/webhook — Alertmanager → Telegram bridge.
 *
 * Alertmanager sends grouped alerts as JSON; we forward each one to the
 * configured Telegram chat via the existing notifier.
 *
 * Auth: shared-secret token via `Authorization: Bearer <token>` or
 * `?token=<token>` query, matched against ALERTMANAGER_WEBHOOK_TOKEN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { telegramNotifier } from '@/core/notifications/telegram';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

interface AlertmanagerAlert {
  status: 'firing' | 'resolved';
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
}

interface AlertmanagerPayload {
  alerts?: AlertmanagerAlert[];
  groupLabels?: Record<string, string>;
}

const SEVERITY_MAP: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  info: 'low',
  warning: 'medium',
  high: 'high',
  critical: 'critical',
};

// Constant-time string comparison to prevent a timing side-channel on the
// shared-secret token (mirrors auth-service.ts's constantTimeEquals).
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ALERTMANAGER_WEBHOOK_TOKEN;
  if (!expected) return false; // misconfigured — reject rather than open

  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const query = request.nextUrl.searchParams.get('token');
  return (!!bearer && constantTimeEquals(bearer, expected)) ||
    (!!query && constantTimeEquals(query, expected));
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: AlertmanagerPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const alerts = payload.alerts ?? [];
  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, forwarded: 0 });
  }

  let forwarded = 0;
  for (const alert of alerts) {
    if (alert.status !== 'firing') continue;
    const severity = SEVERITY_MAP[alert.labels.severity] ?? 'medium';
    const summary = alert.annotations.summary || alert.annotations.description || alert.labels.alertname || 'Alert';
    const description = alert.annotations.description;
    const message = description && description !== summary ? `${summary}\n${description}` : summary;

    const sent = await telegramNotifier.sendAlert({
      severity,
      message,
      ruleId: alert.labels.alertname,
    });
    if (sent) forwarded++;
  }

  logger.info('Alertmanager webhook processed', { total: alerts.length, forwarded });
  return NextResponse.json({ ok: true, forwarded });
}
