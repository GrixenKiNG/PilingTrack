/**
 * Realtime Server — Entry Point
 *
 * Starts WebSocket server for real-time event delivery.
 * Run as a separate process:
 *   npx tsx src/realtime/server/index.ts
 *
 * Or as a Docker container / systemd service in production.
 *
 * Environment:
 *   WS_PORT=3001         # WebSocket server port
 *   REDIS_URL=redis://... # Redis for Pub/Sub (optional)
 */

import { startWSServer } from './ws-server';
import { logger } from '@/lib/logger';

async function main() {
  logger.info('PilingTrack Realtime Server starting...');

  const handle = await startWSServer();

  // Log stats periodically
  setInterval(() => {
    const stats = handle.getStats();
    logger.info('Realtime server stats', stats);
  }, 60000);

  logger.info('PilingTrack Realtime Server running');
}

main().catch((error) => {
  logger.error('Realtime server failed to start', error);
  process.exit(1);
});
