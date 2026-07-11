/**
 * Settings module facade — per-tenant workspace settings + notification prefs.
 */

export { getSettings, saveSettings } from './application/settings-service';
export {
  DEFAULT_WORKSPACE_SETTINGS,
  NOTIFICATION_KEYS,
  sanitizeSettings,
  type WorkspaceSettings,
  type NotificationKey,
} from './domain/settings';
