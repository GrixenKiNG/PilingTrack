import http from 'http';
import { logger } from '@/lib/logger';
import { HEALTH_PORT } from './config';
import { workerStates } from './state';

export function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/api/health') {
      const allWorkers = Object.values(workerStates);
      const runningWorkers = allWorkers.filter((worker) => worker.status === 'running');
      const errorWorkers = allWorkers.filter((worker) => worker.status === 'error');

      res.writeHead(errorWorkers.length > 0 ? 503 : runningWorkers.length > 0 ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          status: errorWorkers.length > 0 ? 'degraded' : 'ok',
          uptime: process.uptime(),
          pid: process.pid,
          memory: process.memoryUsage(),
          workers: Object.fromEntries(
            allWorkers.map((worker) => [
              worker.name,
              {
                status: worker.status,
                leader: worker.isLeader,
                lastHeartbeat: worker.lastHeartbeat?.toISOString(),
                error: worker.error,
                uptime: worker.startedAt
                  ? Math.round((Date.now() - worker.startedAt.getTime()) / 1000)
                  : 0,
              },
            ])
          ),
        })
      );
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });

      const lines = Object.values(workerStates).flatMap((worker) => [
        `worker_status{name="${worker.name}"} ${worker.status === 'running' ? 1 : 0}`,
        `worker_is_leader{name="${worker.name}"} ${worker.isLeader ? 1 : 0}`,
        `worker_uptime_seconds{name="${worker.name}"} ${
          worker.startedAt ? Math.round((Date.now() - worker.startedAt.getTime()) / 1000) : 0
        }`,
      ]);

      res.end(lines.join('\n') + '\n');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(HEALTH_PORT, () => {
    logger.info('Worker health server started', { port: HEALTH_PORT });
  });

  return server;
}
