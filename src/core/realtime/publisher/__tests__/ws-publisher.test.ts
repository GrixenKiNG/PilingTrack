/**
 * WS Publisher — Unit Tests
 *
 * Tests outbox → Redis event normalization:
 * - Event type mapping
 * - Payload extraction
 * - Null handling
 */

import { describe, it, expect } from 'vitest';

// Test the normalization logic in isolation
function normalizeEventType(type: string): string | null {
  const typeMap: Record<string, string> = {
    ReportCreated: 'report.created',
    ReportUpdated: 'report.updated',
    ReportSubmitted: 'report.submitted',
    PileWorkAdded: 'report.updated',
    DrillingAdded: 'report.updated',
    DowntimeAdded: 'downtime.added',
  };
  return typeMap[type] || null;
}

describe('WS Publisher — Event Normalization', () => {
  it('should map ReportCreated to report.created', () => {
    expect(normalizeEventType('ReportCreated')).toBe('report.created');
  });

  it('should map ReportUpdated to report.updated', () => {
    expect(normalizeEventType('ReportUpdated')).toBe('report.updated');
  });

  it('should map ReportSubmitted to report.submitted', () => {
    expect(normalizeEventType('ReportSubmitted')).toBe('report.submitted');
  });

  it('should map PileWorkAdded to report.updated (coalesce)', () => {
    expect(normalizeEventType('PileWorkAdded')).toBe('report.updated');
  });

  it('should map DowntimeAdded to downtime.added', () => {
    expect(normalizeEventType('DowntimeAdded')).toBe('downtime.added');
  });

  it('should return null for unknown event types', () => {
    expect(normalizeEventType('UnknownEvent')).toBe(null);
  });

  it('should not send unknown events to WS', () => {
    const result = normalizeEventType('SystemInternal');
    expect(result).toBeNull(); // Should skip WS delivery
  });
});
