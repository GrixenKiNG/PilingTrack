/**
 * Workspace settings service: one row per tenant in TenantSettings.
 * Fail-closed on missing tenantId.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_WORKSPACE_SETTINGS,
  sanitizeSettings,
  type NotificationKey,
  type WorkspaceSettings,
} from '../domain/settings';

export async function getSettings(tenantId: string): Promise<WorkspaceSettings> {
  if (!tenantId) throw new Error('getSettings: tenantId is required'); // fail closed
  const row = await db.tenantSettings.findUnique({ where: { tenantId } });
  if (!row) return { ...DEFAULT_WORKSPACE_SETTINGS, notifications: { ...DEFAULT_WORKSPACE_SETTINGS.notifications } };
  return sanitizeSettings({
    companyName: row.companyName,
    inn: row.inn,
    timezone: row.timezone,
    dateFormat: row.dateFormat,
    units: row.units,
    currency: row.currency,
    notifications: row.notifications,
  });
}

/**
 * Проверка признака уведомления перед отправкой.
 *
 * Вызывается из обработчиков доменных событий, где tenantId приходит из
 * конверта события и может отсутствовать (в outbox он писался не всегда).
 * Отсутствие организации — отказ, а не подстановка: `DEFAULT_TENANT_ID`
 * подменил бы организацию получателя чужой (и отправил бы уведомление не
 * туда), поэтому такого адресата просто не обслуживаем.
 *
 * При ошибке чтения настроек отправляем: молчащее оповещение о простое хуже
 * лишнего. Явное `false` в настройках при этом соблюдается строго.
 */
export async function isNotificationEnabled(
  tenantId: string | null | undefined,
  key: NotificationKey,
): Promise<boolean> {
  if (!tenantId) {
    logger.warn('isNotificationEnabled: tenantId is required', { key });
    return false;
  }
  try {
    const settings = await getSettings(tenantId);
    return settings.notifications[key] ?? DEFAULT_NOTIFICATIONS[key] ?? false;
  } catch {
    return true;
  }
}

export async function saveSettings(
  tenantId: string,
  patch: unknown,
  updatedBy: string,
): Promise<WorkspaceSettings> {
  if (!tenantId) throw new Error('saveSettings: tenantId is required'); // fail closed
  const current = await getSettings(tenantId);
  const next = sanitizeSettings(patch, current);
  await db.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, updatedBy, ...next, notifications: next.notifications as object },
    update: { updatedBy, ...next, notifications: next.notifications as object },
  });
  return next;
}
