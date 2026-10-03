import type { TelegramDeliveryProgress } from './telegram-delivery-progress';
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
import {
  getRequestTenantId,
  runWithTenantContext,
  setRequestTenantId,
} from '@/core/security/tenant-context';
import { runOutsideGucScope } from '@/core/security/tenant-rls';

// ============================================================
// Configuration
// ============================================================

interface TelegramBotConfig {
  id: string;
  tenantId: string;
  label: string;
  updatedAt: Date;
  botToken: string;
  chatId: string;
  enabled: boolean;
}

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

async function getConfigs(configId?: string, expectedTenantId?: string): Promise<TelegramBotConfig[]> {
  try {
    // Callers (webhook, DLQ, alert engine, report event handlers) run without
    // a user session, so there's no per-request tenant — fall back to the
    // deployment's default tenant, same as every other background path.
    const tenantId = expectedTenantId ?? getRequestTenantId() ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return [];

    // Контекст открывается здесь, а не у вызывающего: половина вызовов идёт
    // из мест без обёртки маршрута (webhook Alertmanager, публичная форма
    // заявки, очередь недоставленных). Без него под строгими политиками RLS
    // настройка бота не читается и уведомления молча пропадают.
    //
    // И вне пометки «тенант уже в базе»: отправку зовут и изнутри транзакций
    // (PDF отчёта — из блокировки строки outbox), а запрос ниже идёт
    // глобальным клиентом другим соединением. С унаследованной пометкой
    // расширение не прикладывало тенанта, и RLS отдавал ноль настроек.
    return await runWithTenantContext(() => runOutsideGucScope(async () => {
      setRequestTenantId(tenantId);
      return loadConfigsForTenant(tenantId, configId);
    }));
  } catch (err) {
    logger.error('Failed to load Telegram config', err);
    return [];
  }
}

async function loadConfigsForTenant(tenantId: string, configId?: string): Promise<TelegramBotConfig[]> {
  try {
    const db = await getDbClient();
    const { decrypt, isEncrypted } = await import('@/core/security/encryption');
    const configs = await db.telegramConfig.findMany({
      where: { tenantId, ...(configId ? { id: configId } : { enabled: true }) },
      orderBy: { createdAt: 'asc' },
    });

    // Дедупликация по chatId: админ может завести один и тот же чат дважды
    // (разные боты/подписи) — писать в него два раза нельзя.
    const seenChatIds = new Set<string>();
    const unique: TelegramBotConfig[] = [];
    for (const raw of configs) {
      if (seenChatIds.has(raw.chatId)) continue;
      seenChatIds.add(raw.chatId);
      const botToken = raw.botToken && isEncrypted(raw.botToken)
        ? decrypt(raw.botToken)
        : raw.botToken;
      unique.push({ id: raw.id, tenantId, label: raw.label, updatedAt: raw.updatedAt, botToken, chatId: raw.chatId, enabled: raw.enabled });
    }
    return unique;
  } catch (err) {
    logger.error('Failed to load Telegram config', err);
    return [];
  }
}

/** Retry transient failures; permanently disabled chats do not block working chats. */
type DeliveryResult = boolean | 'permanent';
async function deliverToAll(
  configs: TelegramBotConfig[],
  send: (config: TelegramBotConfig) => Promise<DeliveryResult>,
  progress?: TelegramDeliveryProgress,
): Promise<boolean> {
  if (configs.length === 0) return false;
  let allSucceeded = true;
  let anyDelivered = (progress?.deliveredChatIds.size ?? 0) > 0;
  for (const config of configs) {
    if (progress?.deliveredChatIds.has(config.chatId)) continue;
    const ok = await send(config);
    if (ok === true) {
      anyDelivered = true;
      await progress?.confirm(config.chatId);
    }
    else if (ok !== 'permanent') allSucceeded = false;
  }
  return allSucceeded && anyDelivered;
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
  /**
   * Человекочитаемые подстановки: название объекта и номер отчёта. Если они
   * есть — показываем их, а внутренние id (cuid) оставляем только как фолбэк
   * для вызывающих, которые эти данные не загрузили. См. F-R33-1.
   */
  siteName?: string;
  reportNumber?: string;
  /** IANA-зона организации для строки времени; по умолчанию — Москва. */
  timeZone?: string;
}

function buildAlertMessage(alert: AlertPayload): { text: string; parse_mode: string } {
  const severityEmoji: Record<string, string> = {
    low: 'ℹ️',
    medium: '⚠️',
    high: '🔴',
    critical: '🚨',
  };

  const severityLabel: Record<string, string> = {
    low: 'Информация',
    medium: 'Предупреждение',
    high: 'Важно',
    critical: 'КРИТИЧНО',
  };

  const emoji = severityEmoji[alert.severity] || '📋';
  const label = severityLabel[alert.severity] || alert.severity;

  let text = `${emoji} <b>${label}</b>\n\n`;
  text += `<code>${escapeHtml(alert.message)}</code>\n\n`;

  // Название объекта и номер отчёта вместо внутренних cuid, если вызывающий
  // их загрузил. Строки с id — фолбэк для остальных вызывающих (webhook
  // Alertmanager, планировщик ТО и т.п.), у которых человекочитаемых данных нет.
  if (alert.siteName) {
    text += `📍 Объект: <b>${escapeHtml(alert.siteName)}</b>\n`;
  } else if (alert.siteId) {
    text += `📍 Объект: <code>${escapeHtml(alert.siteId)}</code>\n`;
  }
  if (alert.reportNumber) {
    text += `📄 Отчёт: <b>${escapeHtml(alert.reportNumber)}</b>\n`;
  } else if (alert.reportId) {
    text += `📄 Отчёт: <code>${escapeHtml(alert.reportId)}</code>\n`;
  }
  if (alert.ruleId) text += `📏 Правило: <code>${escapeHtml(alert.ruleId)}</code>\n`;

  // Время — в зоне организации, а не серверной: в контейнере TZ не задан, и
  // алерт приходил на 3 часа раньше московского (F-R33-1).
  const timeZone = alert.timeZone || 'Europe/Moscow';
  const now = new Date().toLocaleString('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  text += `\n⏰ ${now}`;

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

async function recordTelegramFailure(config: TelegramBotConfig, status: number, raw: string): Promise<DeliveryResult> {
  const permanent = status === 401 || status === 403 || (status === 400 && /chat not found|bot was blocked|user is deactivated|not a member|chat_write_forbidden/i.test(raw));
  if (!permanent) return false;
  const reason = describeTelegramError(raw);
  const db = await getDbClient();
  const marked = await runWithTenantContext(() => runOutsideGucScope(async () => {
    setRequestTenantId(config.tenantId);
    return db.telegramConfig.updateMany({
      where: { id: config.id, tenantId: config.tenantId, enabled: true, updatedAt: config.updatedAt },
      data: { enabled: false, label: config.label + ' — ' + reason },
    });
  }));
  if (!marked.count) return false; // A concurrently edited config must be retried.
  logger.warn('Telegram channel disabled after permanent delivery error', { configId: config.id, tenantId: config.tenantId, chatId: config.chatId, reason });
  return 'permanent';
}
async function sendTelegramMessage(
  config: TelegramBotConfig,
  text: string,
  parse_mode = 'HTML'
): Promise<DeliveryResult> {
  try {
    const url = `${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${config.botToken}/sendMessage`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
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
      return await recordTelegramFailure(config, response.status, error);
    }

    const result = await response.json();
    return result.ok === true ? true : await recordTelegramFailure(config, result.error_code ?? 0, JSON.stringify(result));
  } catch (error) {
    logger.error('Failed to send Telegram message', error);
    return false;
  }
}

async function sendTelegramDocument(
  config: TelegramBotConfig,
  filename: string,
  data: Buffer,
  caption?: string,
): Promise<DeliveryResult> {
  try {
    const url = `${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${config.botToken}/sendDocument`;
    const form = new FormData();
    form.append('chat_id', config.chatId);
    if (caption) {
      form.append('caption', caption.slice(0, 1024));
      form.append('parse_mode', 'HTML');
    }
    const arr = new Uint8Array(data);
    form.append('document', new Blob([arr], { type: 'application/pdf' }), filename);

    const response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      const err = await response.text();
      logger.error('Telegram sendDocument error', new Error(err), { status: response.status });
      return await recordTelegramFailure(config, response.status, err);
    }
    const result = await response.json();
    return result.ok === true ? true : await recordTelegramFailure(config, result.error_code ?? 0, JSON.stringify(result));
  } catch (error) {
    logger.error('Failed to send Telegram document', error);
    return false;
  }
}

// ============================================================
// Error mapping
// ============================================================

/**
 * F-R120-2: тост кнопки «Тест» показывал сырой ответ Telegram API
 * (`{"ok":false,"error_code":401,…}`) либо английское «Not configured».
 * Сопоставляем частые отказы с русским текстом и подсказкой, что делать;
 * всё остальное сворачиваем в «Telegram отказал: <коротко>».
 */
const TELEGRAM_ERROR_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/aborted due to timeout|timeouterror|timed out/i, 'Telegram не ответил за 5 секунд — проверьте доступ в интернет'],
  [/unauthorized|invalid token|token.*not found/i, 'Токен бота неверный — проверьте токен в настройках'],
  [/chat not found/i, 'Чат не найден — проверьте ID чата'],
  [/blocked|user is deactivated|bot can't initiate/i, 'Бот заблокирован — разблокируйте его в чате'],
  [/not enough rights|not a member|no rights|chat_write_forbidden|forbidden/i, 'Недостаточно прав — добавьте бота в чат с правом отправки'],
  [/chat_id is empty/i, 'Не указан ID чата — заполните поле «ID чата»'],
];

function extractTelegramDescription(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { description?: unknown };
    if (parsed && typeof parsed.description === 'string' && parsed.description.trim()) {
      return parsed.description.trim();
    }
  } catch {
    // не JSON — ниже вернём исходный текст
  }
  return raw.trim() || 'неизвестная ошибка';
}

export function describeTelegramError(raw: string): string {
  const description = extractTelegramDescription(raw);
  for (const [pattern, message] of TELEGRAM_ERROR_HINTS) {
    if (pattern.test(description)) return message;
  }
  const short = description.length > 120 ? `${description.slice(0, 117)}…` : description;
  return `Telegram отказал: ${short}`;
}

// ============================================================
// Notifier Service
// ============================================================

export class TelegramNotifier {
  /**
   * Send an alert notification.
   */
  async sendAlert(alert: AlertPayload, progress?: TelegramDeliveryProgress): Promise<boolean> {
    const configs = await getConfigs();
    if (configs.length === 0) {
      logger.warn('Telegram not configured — skipping alert');
      return false;
    }

    const { text, parse_mode } = buildAlertMessage(alert);
    const success = await deliverToAll(configs, (config) =>
      sendTelegramMessage(config, text, parse_mode), progress,
    );

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
  async sendMessage(text: string, progress?: TelegramDeliveryProgress): Promise<boolean> {
    const configs = await getConfigs();
    if (configs.length === 0) return false;

    return deliverToAll(configs, (config) => sendTelegramMessage(config, text, 'HTML'), progress);
  }

  /**
   * Send a binary document (e.g. PDF) with optional HTML caption.
   */
  async sendDocument(
    filename: string,
    data: Buffer,
    caption?: string,
    progress?: TelegramDeliveryProgress,
  ): Promise<boolean> {
    const configs = await getConfigs();
    if (configs.length === 0) {
      logger.warn('Telegram not configured — skipping document');
      return false;
    }

    return deliverToAll(configs, (config) => sendTelegramDocument(config, filename, data, caption), progress);
  }

  /**
   * Test connectivity with Telegram API.
   */
  async testConnection(configId?: string, tenantId?: string): Promise<{ ok: boolean; chatTitle?: string; error?: string }> {
    const config = (await getConfigs(configId, tenantId))[0];
    if (!config) return { ok: false, error: 'Telegram не настроен — добавьте канал в настройках' };

    try {
      const url = `${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${config.botToken}/getChat`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.chatId }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { ok: false, error: describeTelegramError(error) };
      }

      const data = await response.json();
      return { ok: true, chatTitle: data.result?.title || data.result?.first_name };
    } catch (error) {
      return { ok: false, error: describeTelegramError(error instanceof Error ? error.message : String(error)) };
    }
  }
}

// Singleton
export const telegramNotifier = new TelegramNotifier();
