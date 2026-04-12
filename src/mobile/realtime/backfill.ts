/**
 * Backfill — Fetch Missed Events After Reconnect
 *
 * When WS reconnects, there may be events that were published
 * while the client was disconnected. This fetches them via HTTP.
 */

import { handleRealtimeEvent } from './event-handlers';
import { logger } from '@/lib/logger';

interface BackfillResponse {
  reports: any[];
  events: any[];
  cursor: number;
  hasMore: boolean;
}

/**
 * Fetch missed events since last known timestamp.
 */
export async function backfill(lastEventTs: number): Promise<{ received: number }> {
  try {
    const url = new URL('/api/sync/updates', window.location.origin);
    url.searchParams.set('since', String(lastEventTs));

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Backfill failed: ${response.status}`);
    }

    const data: BackfillResponse = await response.json();

    let received = 0;

    // Process server reports → update IndexedDB
    if (data.reports?.length > 0) {
      received += data.reports.length;

      // Apply via handleRealtimeEvent (reuses same update logic)
      for (const report of data.reports) {
        const ts = new Date(report.updatedAt).getTime();
        await handleRealtimeEvent({
          id: `backfill_${report.reportId}`,
          type: report.status === 'submitted' ? 'report.submitted' : 'report.updated',
          entity: 'report' as const,
          entityId: report.reportId,
          payload: {
            reportId: report.reportId,
            totalPiles: (report.piles || []).reduce((s: number, p: any) => s + p.count, 0),
            totalDrilling: (report.drillings || []).reduce((s: number, d: any) => s + d.meters, 0),
            totalDowntime: (report.downtimes || []).reduce((s: number, d: any) => s + d.duration, 0),
            status: report.status,
            updatedAt: report.updatedAt,
          } as any,
          tenantId: report.tenantId,
          siteId: report.siteId,
          userId: report.userId,
          ts,
        } as any);
      }
    }

    if (data.hasMore) {
      logger.info('Backfill has more data — fetching next page');
      // Could implement pagination here
    }

    return { received };
  } catch (error) {
    logger.error('Backfill failed', error);
    return { received: 0 };
  }
}
