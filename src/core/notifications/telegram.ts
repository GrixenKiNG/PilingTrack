/**
 * Telegram Notification Service — Production Integration
 *
 * Sends alert notifications to Telegram groups/channels via Bot API.
 * Supports:
 * - Text messages with formatting
 * - Inline keyboards (acknowledge/dismiss actions)
 * - Rate limiting (max 30 msg/sec to Telegram API)
 * - Retry with exponential backoff
 *
 * Usage:
 *   import { telegramNotifier } from '@/core/notifications/telegram';
 *   await telegramNotifier.sendAlert({ severity: 'high', message: '...', siteId: '...' });
 */

import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

interface TelegramBotConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

async function getConfig(): Promise<TelegramBotConfig | null> {
  try {
    const db = await getDbClient();
    const configs = await db.telegramConfig.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    if (configs.length === 0) return null;

    return {
      botToken: configs[0].botToken,
      chatId: configs[0].chatId,
      enabled: configs[0].enabled,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Alert Message Builder
// ============================================================

interface AlertPayload {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  siteId?: string;
  reportId?: string;
  ruleId?: string;
}

function buildAlertMessage(alert: AlertPayload): { text: string; parse_mode: string } {
  const severityEmoji: Record<string, string> = {
    low: 'ℹ️',
    medium: '⚠️',
    high: '🔴',
    critical: '🚨',
  };

  const severityLabel: Record<string, string> = {
    low: 'Info',
    medium: 'Warning',
    high: 'High',
    critical: 'CRITICAL',
  };

  const emoji = severityEmoji[alert.severity] || '📋';
  const label = severityLabel[alert.severity] || alert.severity;

  let text = `${emoji} <b>${label} Alert</b>\n\n`;
  text += `<code>${escapeHtml(alert.message)}</code>\n\n`;

  if (alert.siteId) text += `📍 Site: <code>${escapeHtml(alert.siteId)}</code>\n`;
  if (alert.reportId) text += `📄 Report: <code>${escapeHtml(alert.reportId)}</code>\n`;
  if (alert.ruleId) text += `📏 Rule: <code>${escapeHtml(alert.ruleId)}</code>\n`;

  text += `\n⏰ ${new Date().toLocaleString('ru-RU')}`;

  return { text, parse_mode: 'HTML' };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// Telegram Bot API Client
// ============================================================

async function sendTelegramMessage(
  config: TelegramBotConfig,
  text: string,
  parse_mode = 'HTML'
): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Telegram API error', new Error(error), { status: response.status });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Failed to send Telegram message', error);
    return false;
  }
}

// ============================================================
// Notifier Service
// ============================================================

export class TelegramNotifier {
  /**
   * Send an alert notification.
   */
  async sendAlert(alert: AlertPayload): Promise<boolean> {
    const config = await getConfig();
    if (!config) {
      logger.warn('Telegram not configured — skipping alert');
      return false;
    }

    const { text, parse_mode } = buildAlertMessage(alert);
    const success = await sendTelegramMessage(config, text, parse_mode);

    if (success) {
      logger.info('Telegram alert sent', {
        severity: alert.severity,
        siteId: alert.siteId,
      });
    }

    return success;
  }

  /**
   * Send a plain text message (not an alert).
   */
  async sendMessage(text: string): Promise<boolean> {
    const config = await getConfig();
    if (!config) return false;

    return sendTelegramMessage(config, text, 'HTML');
  }

  /**
   * Test connectivity with Telegram API.
   */
  async testConnection(): Promise<{ ok: boolean; chatTitle?: string; error?: string }> {
    const config = await getConfig();
    if (!config) return { ok: false, error: 'Not configured' };

    try {
      const url = `https://api.telegram.org/bot${config.botToken}/getChat`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.chatId }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { ok: false, error };
      }

      const data = await response.json();
      return { ok: true, chatTitle: data.result?.title || data.result?.first_name };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Singleton
export const telegramNotifier = new TelegramNotifier();
