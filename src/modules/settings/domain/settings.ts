/**
 * Per-tenant workspace settings — domain types, defaults and notification
 * catalog. Pure module (no React / no db): safe on client and server.
 */

/**
 * Настройки организации.
 *
 * Приложение считается только с `companyName` (шапка контура техготовности) и
 * `timezone` (производственные сутки, периоды отчётов, форматирование дат).
 *
 * `inn`, `dateFormat`, `units`, `currency` хранятся исторически и не влияют ни
 * на что: даты форматируются жёстко по ru-RU, единицы всегда метрические,
 * денег в приложении одна колонка (стоимость наряда ТО) и та подписана «₽» в
 * разметке. Поля убраны с экрана настроек — администратор менял их и думал,
 * что что-то произошло. Колонки оставлены: значения не теряются, если поля
 * когда-нибудь свяжут с выводом документов.
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

/**
 * Правила уведомлений, которые тенант может включать и выключать.
 *
 * `implemented` — есть ли у правила настоящий отправитель. Отправителей ровно
 * два (`services/reports/event-handlers.ts`): предупреждение о простое и PDF
 * сменного отчёта. Оба теперь проверяют признак; раньше признак сохранялся, но
 * никем не читался, и включённое правило вело себя ровно как выключенное.
 *
 * Подпись первого правила обещала простой «более 30 минут», хотя отправитель
 * молчит до 2 часов, — приведена к фактическому порогу.
 */
export const NOTIFICATION_KEYS = [
  { key: 'downtime30', label: 'Простой в сменном отчёте дольше 2 часов', implemented: true },
  { key: 'planDeviation', label: 'Отклонения по плану (±10%)', implemented: false },
  { key: 'maintenanceOverdue', label: 'Просроченные ТО', implemented: false },
  { key: 'newReports', label: 'Новые отчёты и сводки', implemented: true },
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
  // Именно IANA-зона, а не 'UTC+3': такую строку Intl.DateTimeFormat не знает
  // и бросает RangeError. Совпадает с умолчанием колонки в схеме.
  timezone: 'Europe/Moscow',
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
