/**
 * Workspace settings service: one row per tenant in TenantSettings.
 * Fail-closed on missing tenantId.
 */

import { db } from '@/lib/db';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  sanitizeSettings,
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
