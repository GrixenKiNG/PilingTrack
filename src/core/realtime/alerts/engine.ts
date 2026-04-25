/**
 * Alert Engine — Rules-Based Alert Evaluation
 *
 * Listens to realtime events, evaluates against defined rules,
 * and triggers notifications (WebSocket, Telegram, Email).
 *
 * Flow:
 *   Domain Event → Alert Engine → evaluate rules → notify
 *
 * Features:
 * - Cooldown per rule (prevent alert spam)
 * - Multiple notification channels
 * - Pluggable rule definitions
 */

import { RealtimeEvent, createEvent } from '../types/events';
import { getAllRules, AlertRule, AlertContext } from './rules';
import { publishToRedis, CHANNEL_ALERTS } from '../redis/pubsub';
import { logger } from '@/lib/logger';

// ============================================================
// Alert State
// ============================================================

interface AlertState {
  lastTriggered: Map<string, number>; // ruleId → timestamp
}

const state: AlertState = {
  lastTriggered: new Map(),
};

// ============================================================
// Alert Engine
// ============================================================

export async function evaluateAlert(event: RealtimeEvent): Promise<void> {
  const rules = getAllRules();
  const ctx: AlertContext = {
    tenantId: event.tenantId,
    siteId: event.siteId,
    userId: event.userId,
  };

  for (const rule of rules) {
    try {
      // Check cooldown
      const lastTriggered = state.lastTriggered.get(rule.id) || 0;
      const now = Date.now();

      if (now - lastTriggered < rule.cooldownMs) {
        continue; // Still in cooldown
      }

      // Evaluate condition
      if (!rule.condition(event, ctx)) continue;

      // Build alert event
      const alertEvent = createEvent(
        'alert.created',
        'system',
        `alert_${rule.id}_${event.entityId}`,
        {
          severity: rule.severity,
          ruleId: rule.id,
          message: rule.message(event, ctx),
          siteId: event.siteId || undefined,
          reportId: event.entity === 'report' ? event.entityId : undefined,
          sourceEvent: event.type,
        },
        {
          tenantId: event.tenantId,
          siteId: event.siteId,
          userId: event.userId,
        }
      );

      // Trigger notifications
      await notify(rule, alertEvent, ctx);

      // Update cooldown
      state.lastTriggered.set(rule.id, now);

      logger.info('Alert triggered', {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.message(event, ctx),
        siteId: event.siteId,
      });
    } catch (error) {
      logger.error('Alert evaluation failed', error, {
        ruleId: rule.id,
        eventType: event.type,
      });
    }
  }
}

// ============================================================
// Notification Dispatch
// ============================================================

async function notify(
  rule: AlertRule,
  alertEvent: RealtimeEvent,
  ctx: AlertContext
): Promise<void> {
  const tasks: Promise<void>[] = [];

  // WebSocket — always notify via Redis (WS server picks it up)
  if (rule.notify.includes('websocket')) {
    tasks.push(notifyWebSocket(alertEvent));
  }

  // Telegram — for high/critical alerts
  if (rule.notify.includes('telegram')) {
    tasks.push(notifyTelegram(rule, alertEvent, ctx));
  }

  // Email — (future implementation)
  if (rule.notify.includes('email')) {
    tasks.push(notifyEmail(rule, alertEvent, ctx));
  }

  await Promise.allSettled(tasks);
}

async function notifyWebSocket(event: RealtimeEvent): Promise<void> {
  // Publish to Redis — WS server broadcasts to subscribers
  await publishToRedis(CHANNEL_ALERTS, event as unknown as Record<string, unknown>);
}

async function notifyTelegram(
  rule: AlertRule,
  event: RealtimeEvent,
  ctx: AlertContext
): Promise<void> {
  try {
    const { telegramNotifier } = await import('@/core/notifications/telegram');

    const payload = event.payload as { severity?: string; message?: string };
    await telegramNotifier.sendAlert({
      severity: (payload.severity as any) || rule.severity,
      message: rule.message(event, ctx),
      siteId: ctx.siteId || undefined,
      reportId: ctx.reportId || undefined,
      ruleId: rule.id,
    });
  } catch (error) {
    logger.error('Failed to send Telegram notification', error, {
      rule: rule.name,
      siteId: ctx.siteId,
    });
  }
}

async function notifyEmail(
  rule: AlertRule,
  event: RealtimeEvent,
  _ctx: AlertContext
): Promise<void> {
  // Email transport not configured — log visibly so monitoring catches it.
  // When SMTP/SES is wired up, replace this stub with the real sender.
  logger.warn('Email alert skipped — transport not configured', {
    ruleId: rule.id,
    eventType: event.type,
  });
}

// ============================================================
// Event Stream Integration
// ============================================================

/**
 * Start alert engine — listen to events and evaluate rules.
 * Call once on server startup.
 */
export function startAlertEngine(): void {
  logger.info('Alert engine started', {
    rulesCount: getAllRules().length,
  });
}

/**
 * Expose for manual triggering (from outbox worker or API).
 */
export { evaluateAlert as processAlertEvent };
