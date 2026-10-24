import {deliverQueuedAlert} from '@/modules/notifications';
import {runWithTenantContext, setRequestTenantId} from '@/core/security/tenant-context';
import {startOutboxWorker} from '@/modules/reports/application/outbox-publisher';

process.on('message', async (job: {mode: 'direct' | 'poll'; tenantId: string; id?: string; data?: unknown}) => {
  try {
    await runWithTenantContext(async () => {
      setRequestTenantId(job.tenantId);
      if (job.mode === 'poll') {
        startOutboxWorker(async event => {
          if (event.type !== 'NotificationDeliveryRequested') throw new Error('Unexpected fixture event');
          await deliverQueuedAlert(event);
        }, 100);
        process.send?.({started: true});
      } else {
        const start = performance.now();
        try {
          await deliverQueuedAlert(job);
          process.send?.({ok: true, durationMs: performance.now() - start});
        } catch (error) {
          process.send?.({ok: false, durationMs: performance.now() - start, error: error instanceof Error ? error.message : String(error)});
        }
      }
    });
  } catch (error) {
    process.send?.({fatal: error instanceof Error ? error.message : String(error)});
  }
});
process.send?.({ready: true});
