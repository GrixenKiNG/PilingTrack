/**
 * Realtime Module — Client-Side WebSocket + Events
 *
 * Re-exports for easy importing:
 *   import { useRealtime, WSClient, handleRealtimeEvent } from '@/mobile/realtime';
 */

// WebSocket Client
export { WSClient } from './ws-client';
export type { WSConnectionState, WSEventCallback, WSStateCallback } from './ws-client';

// React Hook
export { useRealtime } from './use-realtime';
export type { UseRealtimeOptions, UseRealtimeResult } from './use-realtime';

// Event Handlers
export { handleRealtimeEvent } from './event-handlers';

// Backfill
export { backfill } from './backfill';
