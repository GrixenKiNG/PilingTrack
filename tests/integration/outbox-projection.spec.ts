/**
 * Integration tests for the outbox → domain-event-bus → handlers flow.
 *
 * These tests do not boot Postgres or BullMQ — they exercise the in-process
 * event bus that connects services/reports/domain-events to the registered
 * handlers (analytics, alerts, audit). The contract under test is:
 *
 *   emitDomainEvent(event) → all handlers for event.type fire
 *   handler error in one handler does not stop the others
 *   unknown event types are dropped without throwing
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

  it('routes an event to every handler subscribed to its type', () => {
    const a = vi.fn();
    const b = vi.fn();
    on('ReportSubmitted', a);
    on('ReportSubmitted', b);

    const event = makeEvent('ReportSubmitted');
    emitDomainEvent(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('isolates handler failures — a throwing handler does not block siblings', async () => {
    const ok = vi.fn();
    const broken = vi.fn(() => {
      throw new Error('handler exploded');
    });
    on('ReportDeleted', broken);
    on('ReportDeleted', ok);

    expect(() => emitDomainEvent(makeEvent('ReportDeleted'))).not.toThrow();
    expect(ok).toHaveBeenCalledOnce();
    expect(broken).toHaveBeenCalledOnce();
  });

  it('drops unknown event types without throwing', () => {
    expect(() =>
      emitDomainEvent({
        type: 'report.no_such_event' as ReportDomainEvent['type'],
        aggregateId: 'x',
        aggregateType: 'Report',
        payload: {},
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
      } as ReportDomainEvent)
    ).not.toThrow();
  });

  it('exposes registered event types and handler counts for observability', () => {
    on('ReportExported', vi.fn());
    expect(getRegisteredEventTypes()).toContain('ReportExported');
    expect(getHandlerCount('ReportExported')).toBeGreaterThanOrEqual(1);
  });

  it('awaits async handler errors without rejecting the caller', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('async failure'));
    on('ReportUpdated', failing);

    // The bus must not propagate async rejections to the publisher — that
    // would cause an entire outbox batch to be retried because one handler
    // failed, which is the wrong granularity.
    expect(() => emitDomainEvent(makeEvent('ReportUpdated'))).not.toThrow();
    // Allow microtask queue to flush so the rejection is observed by Node.
    await new Promise((resolve) => setImmediate(resolve));
    expect(failing).toHaveBeenCalled();
  });
});
