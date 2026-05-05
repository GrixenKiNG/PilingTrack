/**
 * Health Tracker — Continuous System Health Monitoring
 *
 * Periodically probes all subsystems and caches the result so the
 * /api/system/status endpoint responds quickly even under degradation.
 *
 * Public API:
 *   startHealthTracker()    — call once at startup, kicks off background polling
 *   getCurrentStatus()      — last cached status (cheap, < 1ms)
 *   getFreshStatus()        — force fresh probe (slow; bypasses cache)
 *   checkSystemStatus()     — pure check, no caching (used internally + tests)
 *   recordWorkerHeartbeat() — workers ping this every 30s
 *   setWsConnectionCount()  — WS server reports connection count
 *
 * Internal split (this directory):
 *   types.ts           — SystemStatus, ComponentHealth, etc.
 *   thresholds.ts      — timing/size constants
 *   helpers.ts         — withTimeout, getDbClient
 *   checkers/*.ts      — per-component health probes
 *   aggregate.ts       — checkSystemStatus + computeOverallStatus + collectMetrics
 *   tracker.ts         — background loop + cache + public lifecycle
 */

export { checkSystemStatus } from './aggregate';
export { recordWorkerHeartbeat } from './checkers/workers';
export { setWsConnectionCount } from './checkers/websocket';
export {
  getCurrentStatus,
  getFreshStatus,
  startHealthTracker,
} from './tracker';
export type {
  BackupHealth,
  ComponentHealth,
  ComponentStatus,
  OutboxHealth,
  OutboxStatus,
  OverallStatus,
  RedisHealth,
  StorageHealth,
  StorageProvider,
  SystemComponents,
  SystemMetrics,
  SystemStatus,
  WebSocketHealth,
  WorkerHealth,
  WorkerStatus,
} from './types';
