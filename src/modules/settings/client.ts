/**
 * Client-safe entry: pure data and functions, no database, no node:*.
 * Purity is enforced by src/modules/__tests__/client-entry-purity.test.ts.
 */
export {
  DEFAULT_WORKSPACE_SETTINGS,
  NOTIFICATION_KEYS,
} from './domain/settings';
export type {
  WorkspaceSettings,
} from './domain/settings';
