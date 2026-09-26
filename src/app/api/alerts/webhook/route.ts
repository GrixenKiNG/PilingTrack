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
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { telegramNotifier } from '@/core/notifications/telegram';
import { isNotificationEnabled } from '@/modules/settings';
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

/**
 * Runtime schema for the Alertmanager webhook payload. The compile-time
 * interface above is erased at runtime, so without this a malformed body
 * (`null`, alert missing labels/annotations) throws rather than returning 400.
 * Unknown keys are passed through — Alertmanager bundles extras we ignore.
 */
const alertSchema = z.object({
  status: z.string(),
  labels: z.object({
    severity: z.string().optional(),
    alertname: z.string().optional(),
  }).passthrough(),
  annotations: z.object({
    summary: z.string().optional(),
    description: z.string().optional(),
  }).passthrough(),
}).passthrough();

const webhookSchema = z.object({
  alerts: z.array(alertSchema),
}).passthrough();

// Большую пачку не отклоняем: на 400 Alertmanager повторяет ту же пачку
// бесконечно и тревоги теряются именно в крупную аварию. Пересылаем первые
// MAX_FORWARDED, чтобы не завалить Telegram.
const MAX_FORWARDED = 100;

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
    const parsed = webhookSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    payload = parsed.data as AlertmanagerPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const alerts = (payload.alerts ?? []).slice(0, MAX_FORWARDED);
  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, forwarded: 0 });
  }

  // Выключатель «Сбои сервера (мониторинг)». У вебхука нет сессии: тенант —
  // только тенант развёртывания, тот же, в чьи чаты уходит отправка
  // (core/notifications/telegram.ts:getConfigs).
  const notifyEnabled = await isNotificationEnabled(
    process.env.DEFAULT_TENANT_ID ?? null,
    'systemAlerts',
  );
  if (!notifyEnabled) {
    logger.info('Alertmanager webhook suppressed by notification settings', { total: alerts.length });
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
