/**
 * GET /api/health/deep
 *
 * Public deep health check for external uptime probes (UptimeRobot etc).
 * Probes every critical dependency (DB, Redis, MinIO/S3, WebSocket) and
 * returns HTTP 200 only when overall status is 'healthy' or 'degraded';
 * 503 when 'unhealthy'.
 *
 * Why this exists vs the other endpoints:
 *   - /api/health         → checks DB + memory + env only. No Redis/S3/WS.
 *   - /api/readiness      → DB + env, used by orchestrators (cached 5 sec).
 *   - /api/liveness       → process is alive (no probes).
 *   - /api/system/status  → admin-only, full detail (errors, latencies).
 *   - /api/health/deep    → public, minimal detail, all critical deps. ←
 *
 * Security: response body is intentionally narrow — only per-component
 * "ok"/"down" plus overall status. No error messages, no latencies,
 * no internal hostnames. The admin endpoint owns the diagnostic detail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentStatus, getFreshStatus } from '@/core/observability/health-tracker';

export const runtime = 'nodejs';

/**
 * Маршрут открыт без входа, а свежая проверка — восемь обращений к базе,
 * Redis, хранилищу и прочему. Отвечая на каждый запрос свежей, он давал
 * любому способ нагрузить машину. Фоновый трекер и так пересчитывает
 * состояние каждые 15 с — его результат и отдаём, пока он не старше этого.
 */
const MAX_STATUS_AGE_MS = 30_000;

export async function GET(_request: NextRequest) {
  const cached = getCurrentStatus();
  const status = cached && Date.now() - Date.parse(cached.timestamp) < MAX_STATUS_AGE_MS
    ? cached
    : await getFreshStatus();

  const summary = {
    status: status.status,
    timestamp: status.timestamp,
    components: {
      database: status.components.database.status === 'up' ? 'ok' : 'down',
      redis: status.components.redis.status === 'up' ? 'ok' : 'down',
      storage: status.components.storage.status === 'up' ? 'ok' : 'down',
      websocket: status.components.websocket.status === 'up' ? 'ok' : 'down',
    },
  };

  const httpStatus = status.status === 'unhealthy' ? 503 : 200;

  return NextResponse.json(summary, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
