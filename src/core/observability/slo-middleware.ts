/**
 * SLO Middleware — Automatic Request Tracking
 *
 * Wraps API route handlers to automatically:
 * 1. Record request success/failure in SLO tracker
 * 2. Track latency (p95, p99)
 * 3. Extract domain from route path
 * 4. Integrate with error boundary for failure classification
 *
 * Usage:
 *   // In any API route:
 *   export async function GET(request: NextRequest) {
 *     return withSLOTracking(request, async () => {
 *       return NextResponse.json(await db.report.findMany());
 *     }, { domain: 'reports' });
 *   }
 *
 *   // Or use the higher-order wrapper:
 *   export const GET = withSLO(async (request) => {
 *     return NextResponse.json(await db.report.findMany());
 *   }, { domain: 'reports' });
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSLO, getSLO } from './slo-enforcement';
import { errorTracker } from './error-tracker';

// ============================================================
// Domain Extraction from Route Path
// ============================================================

const DOMAIN_PATTERNS = [
  { pattern: /\/api\/reports/i, domain: 'reports' },
  { pattern: /\/api\/sites/i, domain: 'sites' },
  { pattern: /\/api\/crews/i, domain: 'crews' },
  { pattern: /\/api\/equipment/i, domain: 'equipment' },
  { pattern: /\/api\/auth/i, domain: 'auth' },
  { pattern: /\/api\/users/i, domain: 'users' },
  { pattern: /\/api\/telemetry/i, domain: 'telemetry' },
  { pattern: /\/api\/sync/i, domain: 'sync' },
  { pattern: /\/api\/analytics/i, domain: 'analytics' },
  { pattern: /\/api\/feedback/i, domain: 'feedback' },
  { pattern: /\/api\/dictionary/i, domain: 'dictionary' },
  { pattern: /\/api\/telegram/i, domain: 'telegram' },
];

export function extractDomainFromPath(path: string): string {
  for (const { pattern, domain } of DOMAIN_PATTERNS) {
    if (pattern.test(path)) return domain;
  }
  return 'other';
}

// ============================================================
// SLO Configs per Domain
// ============================================================

const DEFAULT_SLO_CONFIGS: Record<string, { target: number; latencyThresholdMs: number }> = {
  reports: { target: 0.999, latencyThresholdMs: 5000 },
  auth: { target: 0.999, latencyThresholdMs: 3000 },
  sites: { target: 0.995, latencyThresholdMs: 5000 },
  crews: { target: 0.995, latencyThresholdMs: 5000 },
  equipment: { target: 0.995, latencyThresholdMs: 5000 },
  sync: { target: 0.999, latencyThresholdMs: 10000 },
  telemetry: { target: 0.99, latencyThresholdMs: 2000 },
  analytics: { target: 0.99, latencyThresholdMs: 15000 },
  feedback: { target: 0.995, latencyThresholdMs: 5000 },
  dictionary: { target: 0.995, latencyThresholdMs: 3000 },
  telegram: { target: 0.99, latencyThresholdMs: 5000 },
  users: { target: 0.999, latencyThresholdMs: 3000 },
};

// ============================================================
// SLO Tracking Wrapper
// ============================================================

export interface SLOTrackingOptions {
  /** Domain name (auto-extracted from path if not provided) */
  domain?: string;
  /** SLO target override (default: 0.999) */
  target?: number;
  /** Latency threshold override */
  latencyThresholdMs?: number;
}

/**
 * Wrap an API route handler with SLO tracking.
 */
export async function withSLOTracking<T>(
  request: NextRequest,
  handler: () => Promise<NextResponse<T>>,
  options?: SLOTrackingOptions
): Promise<NextResponse<T>> {
  const domain = options?.domain || extractDomainFromPath(request.nextUrl.pathname);
  const config = DEFAULT_SLO_CONFIGS[domain] || { target: 0.999, latencyThresholdMs: 5000 };

  // Ensure SLO tracker exists
  let slo = getSLO(domain);
  if (!slo) {
    slo = createSLO(domain, {
      target: options?.target ?? config.target,
      latencyThresholdMs: options?.latencyThresholdMs ?? config.latencyThresholdMs,
      windowMs: 3600_000, // 1 hour
    });
  }

  // Count every request so errorTracker.getStats() can report a real
  // errorRate (totalErrors / totalRequests) for circuit breakers and SLO
  // burn-rate alerts. Previously totalRequests was fabricated from error
  // count, which locked errorRate at a constant regardless of traffic.
  errorTracker.recordRequest(domain);

  const startTime = Date.now();

  try {
    const response = await handler();
    const latencyMs = Date.now() - startTime;

    // Success if status is 2xx or 3xx
    const success = response.status < 400;

    slo.recordRequest({
      success,
      latencyMs,
      userId: undefined, // Extract from auth context if needed
      tenantId: undefined, // Extract from tenant context if needed
    });

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    slo.recordRequest({
      success: false,
      latencyMs,
    });

    throw error;
  }
}

/**
 * Higher-order function wrapper for SLO tracking.
 */
export function withSLO<T>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>,
  options?: SLOTrackingOptions
) {
  return async (request: NextRequest): Promise<NextResponse<T>> => {
    return withSLOTracking(request, () => handler(request), options);
  };
}
