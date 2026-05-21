/**
 * Integration tests for the outbox → domain-event-bus → handlers flow.
 *
 * These tests do not boot Postgres or BullMQ — they exercise the in-process
 * event bus that connects services/reports/domain-events to the registered
 * handlers (analytics, alerts, audit). The contract under test is:
 *
 *   emitDomainEvent(event) → awaits every handler subscribed to event.type
 *   one failing handler does not skip its siblings (Promise.allSettled)
 *   but ANY rejection propagates so the outbox publisher can retry / DLQ
 *   unknown event types are a no-op (logged at warn, no throw)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  on,
  emitDomainEvent,
  getHandlerCount,
  getRegisteredEventTypes,
} from '@/services/reports/domain-events';
import type { ReportDomainEvent } from '@/modules/reports/domain';

function makeEvent(type: ReportDomainEvent['type']): ReportDomainEvent {
  return {
    type,
    aggregateId: 'report-1',
    aggregateType: 'Report',
    payload: { reportId: 'report-1', siteId: 'site-1' },
    occurredAt: new Date().toISOString(),
    eventVersion: 1,
  } as ReportDomainEvent;
}

describe('outbox → domain events bus', () => {
  beforeEach(() => {
    // Each test registers fresh handlers; the registry persists between tests
    // by design (matching production), so we count from the current baseline.
  });

  it('routes an event to every handler subscribed to its type', async () => {
    const a = vi.fn();
    const b = vi.fn();
    on('ReportSubmitted', a);
    on('ReportSubmitted', b);

    const event = makeEvent('ReportSubmitted');
    await emitDomainEvent(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('runs all sibling handlers even when one throws, then re-throws the failure', async () => {
    const ok = vi.fn();
    const broken = vi.fn(() => {
      throw new Error('handler exploded');
    });
    on('ReportDeleted', broken);
    on('ReportDeleted', ok);

    // Both handlers run (Promise.allSettled), AND the failure surfaces so
    // outbox publisher can decide to retry / DLQ. Swallowing here used to
    // mask projection failures completely (see DLQ post-mortem 2026-05-20).
    await expect(emitDomainEvent(makeEvent('ReportDeleted'))).rejects.toThrow(
      'handler exploded',
    );
    expect(ok).toHaveBeenCalledOnce();
    expect(broken).toHaveBeenCalledOnce();
  });

  it('aggregates multiple handler failures into AggregateError', async () => {
    const fail1 = vi.fn().mockRejectedValue(new Error('boom-1'));
    const fail2 = vi.fn().mockRejectedValue(new Error('boom-2'));
    on('ReportVersionCreated', fail1);
    on('ReportVersionCreated', fail2);

    await expect(
      emitDomainEvent(makeEvent('ReportVersionCreated')),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(fail1).toHaveBeenCalled();
    expect(fail2).toHaveBeenCalled();
  });

  it('drops unknown event types without throwing', async () => {
    await expect(
      emitDomainEvent({
        type: 'report.no_such_event' as ReportDomainEvent['type'],
        aggregateId: 'x',
        aggregateType: 'Report',
        payload: {},
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
      } as ReportDomainEvent),
    ).resolves.toBeUndefined();
  });

  it('exposes registered event types and handler counts for observability', () => {
    on('ReportExported', vi.fn());
    expect(getRegisteredEventTypes()).toContain('ReportExported');
    expect(getHandlerCount('ReportExported')).toBeGreaterThanOrEqual(1);
  });

  it('propagates async handler rejections so the outbox publisher can retry', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('async failure'));
    on('ReportUpdated', failing);

    await expect(emitDomainEvent(makeEvent('ReportUpdated'))).rejects.toThrow(
      'async failure',
    );
    expect(failing).toHaveBeenCalled();
  });
});
