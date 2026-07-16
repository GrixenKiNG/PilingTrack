/**
 * Per-tenant workspace settings — domain types, defaults and notification
 * catalog. Pure module (no React / no db): safe on client and server.
 */

export interface WorkspaceSettings {
  companyName: string;
  inn: string;
  timezone: string;
  dateFormat: string;
  units: string;
  currency: string;
  notifications: Record<string, boolean>;
}

/** The notification preferences a tenant can toggle. */
export const NOTIFICATION_KEYS = [
  { key: 'downtime30', label: 'Простой установки более 30 минут' },
  { key: 'planDeviation', label: 'Отклонения по плану (±10%)' },
  { key: 'maintenanceOverdue', label: 'Просроченные ТО' },
  { key: 'newReports', label: 'Новые отчёты и сводки' },
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number]['key'];

export const DEFAULT_NOTIFICATIONS: Record<string, boolean> = {
  downtime30: true,
  planDeviation: true,
  maintenanceOverdue: true,
  newReports: false,
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  companyName: '',
  inn: '',
  timezone: 'UTC+3',
  dateFormat: 'DD.MM.YYYY',
  units: 'metric',
  currency: 'RUB',
  notifications: { ...DEFAULT_NOTIFICATIONS },
};

const UNITS = new Set(['metric', 'imperial']);

function str(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' && value.length <= max ? value : fallback;
}

/** Sanitize an untrusted patch into a full, safe WorkspaceSettings value. */
export function sanitizeSettings(input: unknown, base: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS): WorkspaceSettings {
  const v = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const notifIn = (typeof v.notifications === 'object' && v.notifications !== null ? v.notifications : {}) as Record<string, unknown>;
  const notifications: Record<string, boolean> = {};
  for (const { key } of NOTIFICATION_KEYS) {
    notifications[key] = typeof notifIn[key] === 'boolean' ? (notifIn[key] as boolean) : (base.notifications[key] ?? DEFAULT_NOTIFICATIONS[key] ?? false);
  }
  return {
    companyName: str(v.companyName, 200, base.companyName),
    inn: str(v.inn, 20, base.inn),
    timezone: str(v.timezone, 40, base.timezone),
    dateFormat: str(v.dateFormat, 40, base.dateFormat),
    units: UNITS.has(v.units as string) ? (v.units as string) : base.units,
    currency: str(v.currency, 8, base.currency),
    notifications,
  };
}
