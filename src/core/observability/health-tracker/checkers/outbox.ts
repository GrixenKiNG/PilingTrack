import { getOutboxStats } from '@/services/reports/outbox-publisher';
import { getDbClient, withTimeout } from '../helpers';
import {
  DB_CHECK_TIMEOUT_MS,
  OUTBOX_BACKLOG_THRESHOLD,
  OUTBOX_STALE_MS,
} from '../thresholds';
import type { OutboxHealth } from '../types';

export async function checkOutbox(): Promise<OutboxHealth> {
  try {
    const stats = await withTimeout(getOutboxStats(), DB_CHECK_TIMEOUT_MS, 'Outbox stats');
    const pendingCount = stats.unpublished;

    let oldestPending: string | undefined;
    if (pendingCount > 0) {
      const db = await getDbClient();
      const oldest = await withTimeout(
        db.outboxEvent.findFirst({
          where: { published: false },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        DB_CHECK_TIMEOUT_MS,
        'Oldest pending query'
      );

      if (oldest) {
        oldestPending = oldest.createdAt.toISOString();
      }
    }

    if (pendingCount > OUTBOX_BACKLOG_THRESHOLD) {
      return { status: 'backlog', pendingCount, oldestPending };
    }

    if (oldestPending) {
      const age = Date.now() - new Date(oldestPending).getTime();
      if (age > OUTBOX_STALE_MS) {
        return { status: 'stalled', pendingCount, oldestPending };
      }
    }

    return { status: 'ok', pendingCount, oldestPending };
  } catch {
    return { status: 'stalled', pendingCount: -1 };
  }
}
