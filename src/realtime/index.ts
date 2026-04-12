/**
 * Realtime Module — Server-Side
 *
 * Re-exports for the real-time layer.
 */

// Types
export * from './types/events';

// Server
export { startWSServer } from './server/ws-server';
export type { ServerHandle } from './server/ws-server';
export { ClientManager } from './server/client-manager';
export type { WSClient as ServerWSClient } from './server/client-manager';
export { canSubscribe, getDefaultChannels, getEventChannels } from './server/channel-router';
export { authenticateWS } from './server/auth';

// Publisher
export { publishPendingEvents, startRealtimePublisher } from './publisher/ws-publisher';

// Redis
export { getPublisher, getSubscriber, onChannel, publishToRedis, closeRedis, CHANNEL_EVENTS, CHANNEL_ALERTS } from './redis/pubsub';

// Alerts
export { evaluateAlert, processAlertEvent, startAlertEngine } from './alerts/engine';
export { builtInRules, addCustomRule, removeCustomRule, getAllRules } from './alerts/rules';
export type { AlertRule, AlertContext } from './alerts/rules';
