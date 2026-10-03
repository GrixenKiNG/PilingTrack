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
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { ALERT_DELIVERY_EVENT } from '@/core/notifications/durable-alert';
import { deliverQueuedAlert } from '@/services/notifications/durable-alert-delivery';
import { db } from '@/lib/db';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
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

// За HTTP-запрос отправляем до MAX_FORWARDED новых сообщений; весь хвост
// сохраняется в outbox. Повтор пропускает уже доставленные алерты.
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
    return NextResponse.json({ error: 'Неверный токен вебхука' }, { status: 401 });
  }

  let payload: AlertmanagerPayload;
  try {
    const parsed = webhookSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
    }
    payload = parsed.data as AlertmanagerPayload;
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const alerts = payload.alerts ?? [];
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
    return NextResponse.json({ ok: true, forwarded: 0, reason: 'disabled' });
  }

  let forwarded = 0;
  let firing = 0;
  let attempted = 0;
  const tenantId = process.env.DEFAULT_TENANT_ID;
  for (const alert of alerts) {
    if (alert.status !== 'firing') continue;
    firing++;
    if (!tenantId) continue;
    const severity = SEVERITY_MAP[alert.labels.severity] ?? 'medium';
    const summary = alert.annotations.summary || alert.annotations.description || alert.labels.alertname || 'Alert';
    const description = alert.annotations.description;
    const message = description && description !== summary ? summary + '\n' + description : summary;
    // Labels + start identify the same firing episode independent of batch order.
    // Missing/invalid start is ambiguous: a new id favors retry over silent loss.
    const identity = typeof alert.startsAt === 'string' && Number.isFinite(Date.parse(alert.startsAt))
      ? createHash('sha256').update(JSON.stringify([Object.keys(alert.labels).sort().map(key => [key, alert.labels[key]]), alert.startsAt])).digest('hex')
      : randomUUID();
    try {
      const delivered = await runWithTenantContext(async () => {
        setRequestTenantId(tenantId);
        let row = await db.outboxEvent.upsert({
          where: { tenantId_dedupeKey: { tenantId, dedupeKey: 'alertmanager:' + identity } },
          create: { type: ALERT_DELIVERY_EVENT, aggregateType: 'Notification', aggregateId: identity,
            tenantId, dedupeKey: 'alertmanager:' + identity, projected: true,
            payload: { severity, message, ...(alert.labels.alertname ? { ruleId: alert.labels.alertname } : {}), notificationKey: 'systemAlerts' } },
          update: {}, select: { id: true, published: true, payload: true, lastError: true },
        });
        if (row.published && row.lastError?.startsWith('Moved to DLQ:')) {
          // Preserve the DLQ record; a recovered channel gets a fresh attempt.
          row = await db.outboxEvent.create({
            data: { type: ALERT_DELIVERY_EVENT, aggregateType: 'Notification', aggregateId: identity,
              tenantId, dedupeKey: 'alertmanager:' + identity + ':retry:' + randomUUID(), projected: true,
              payload: { severity, message, ...(alert.labels.alertname ? { ruleId: alert.labels.alertname } : {}), notificationKey: 'systemAlerts' } },
            select: { id: true, published: true, payload: true, lastError: true },
          });
        }
        if (row.published) return true;
        if (attempted >= MAX_FORWARDED) return false;
        attempted++;
        await deliverQueuedAlert({ id: row.id, tenantId, data: row.payload });
        return true;
      });
      if (delivered) forwarded++;
    } catch (error) {
      logger.error('Alertmanager alert retained for retry', error, { alertname: alert.labels.alertname });
    }
  }
  if (forwarded < firing) {
    logger.error('Alertmanager webhook: incomplete Telegram delivery', { total: alerts.length, firing, forwarded });
    return NextResponse.json(
      { ok: false, forwarded, error: 'Не удалось доставить алерты в Telegram' },
      { status: 503 },
    );
  }

  logger.info('Alertmanager webhook processed', { total: alerts.length, forwarded });
  return NextResponse.json({ ok: true, forwarded });
}
