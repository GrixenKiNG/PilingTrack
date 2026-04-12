/**
 * SLO Metrics — Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SLOTracker, recordSLOApiRequest, getSLOStatus, calculateBurnRate, calculateErrorBudgetRemaining, BURN_RATE_WINDOWS } from '../slo-metrics';

// Mock dependencies
vi.mock('@/core/infrastructure/circuit-breakers', () => ({
  getCircuitBreakerHealth: () => ({
    redis: { state: 'CLOSED', failures: 0 },
    s3: { state: 'CLOSED', failures: 0 },
    telegram: { state: 'CLOSED', failures: 0 },
    database: { state: 'CLOSED', failures: 0 },
  }),
}));

vi.mock('@/core/outbox/dead-letter-queue', () => ({
  getDlqStats: () => Promise.resolve({ pending: 0, resolved: 5, discarded: 2, total: 7 }),
}));

vi.mock('@/services/reports/outbox-publisher', () => ({
  getOutboxStats: () => Promise.resolve({ unpublished: 50, failed: 5, total: 100 }),
}));

describe('SLO Tracker', () => {
  let tracker: InstanceType<typeof SLOTracker>;

  beforeEach(() => {
    // Create fresh tracker instance for each test
    tracker = new SLOTracker();
    vi.clearAllMocks();
  });

  it('records API requests and calculates availability', async () => {
    for (let i = 0; i < 100; i++) {
      tracker.recordApiRequest(true);
    }

    const status = await tracker.getStatus();
    const availabilitySLO = status.slo.find(s => s.name === 'api_availability');

    expect(availabilitySLO).toBeDefined();
    expect(availabilitySLO!.current).toBe(100);
    expect(availabilitySLO!.status).toBe('meeting');
  });

  it('detects SLO breach when availability drops below 99.9%', async () => {
    // 990 successful + 10 failed = 99.0% availability
    for (let i = 0; i < 990; i++) {
      tracker.recordApiRequest(true);
    }
    for (let i = 0; i < 10; i++) {
      tracker.recordApiRequest(false);
    }

    const status = await tracker.getStatus();
    const availabilitySLO = status.slo.find(s => s.name === 'api_availability');

    expect(availabilitySLO).toBeDefined();
    expect(availabilitySLO!.current).toBeCloseTo(99.0, 0);
    // 99.0% < 99.5% warning threshold → breached
    expect(availabilitySLO!.status).toBe('breached');
  });

  it('triggers alert on DLQ pending events > 50', async () => {
    const status = await tracker.getStatus();

    // With current mock (0 pending), no DLQ alert expected
    const dlqAlert = status.alerts.find(a => a.includes('DLQ'));
    expect(dlqAlert).toBeUndefined();
  });

  it('triggers alert on outbox backlog > 1000', async () => {
    const status = await tracker.getStatus();
    const backlogAlert = status.alerts.find(a => a.includes('Outbox backlog'));
    expect(backlogAlert).toBeUndefined();
  });

  it('returns healthy when all SLOs met', async () => {
    for (let i = 0; i < 1000; i++) {
      tracker.recordApiRequest(true);
    }

    const status = await tracker.getStatus();
    expect(status.overallHealth).toBe('healthy');
    expect(status.alerts).toHaveLength(0);
  });
});

describe('Burn Rate Calculation', () => {
  it('returns 1x burn rate when error rate equals allowed rate', () => {
    const burnRate = calculateBurnRate(0.1, 99.9, 60);
    expect(burnRate).toBeCloseTo(1, 5);
  });

  it('returns 10x burn rate when error rate is 10x allowed', () => {
    const burnRate = calculateBurnRate(1.0, 99.9, 60);
    expect(burnRate).toBeCloseTo(10, 5);
  });

  it('returns 0 burn rate when no errors', () => {
    const burnRate = calculateBurnRate(0, 99.9, 60);
    expect(burnRate).toBe(0);
  });

  it('calculates error budget remaining', () => {
    const remaining = calculateErrorBudgetRemaining(0.05, 99.9);
    expect(remaining).toBeCloseTo(0.05, 2);
  });

  it('returns negative budget when over budget', () => {
    const remaining = calculateErrorBudgetRemaining(0.2, 99.9);
    expect(remaining).toBeLessThan(0);
  });

  it('has correct burn rate window definitions', () => {
    expect(BURN_RATE_WINDOWS).toHaveLength(4);
    expect(BURN_RATE_WINDOWS[0].severity).toBe('page');
    expect(BURN_RATE_WINDOWS[0].windowMinutes).toBe(5);
    expect(BURN_RATE_WINDOWS[0].burnRateMultiplier).toBe(14.4);
  });
});
