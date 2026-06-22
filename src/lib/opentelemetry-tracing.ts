/**
 * OpenTelemetry Tracing Utility
 *
 * Provides distributed tracing for API requests.
 * Compatible with OpenTelemetry protocol — can export to Jaeger, Zipkin, Tempo, etc.
 *
 * Current implementation: lightweight in-memory tracer with W3C TraceContext.
 * Can be upgraded to full OpenTelemetry SDK by replacing the tracer backend.
 *
 * Usage:
 *   import { withTracing, getActiveSpan } from '@/lib/opentelemetry-tracing';
 *
 *   export async function GET(request: NextRequest) {
 *     return withTracing('GET /api/sites', request, async (span) => {
 *       span.setAttribute('site.id', siteId);
 *       const sites = await db.site.findMany();
 *       span.setAttribute('sites.count', sites.length);
 *       return NextResponse.json(sites);
 *     });
 *   }
 */

import { NextRequest } from 'next/server';

// W3C TraceContext header names
const TRACEPARENT_HEADER = 'traceparent';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  attributes: Map<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  isSampled: boolean;
}

// In-memory span store (for development/testing)
const spanStore = new Map<string, Span[]>();

/**
 * Generate a random trace ID (32 hex chars).
 */
function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random span ID (16 hex chars).
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse W3C TraceContext header.
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length < 4) return null;

  const [, traceId, spanId, flags] = parts;
  const isSampled = parseInt(flags, 16) & 1;

  return { traceId, spanId, isSampled: !!isSampled };
}

/**
 * Create W3C TraceContext header.
 */
export function createTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.isSampled ? '01' : '00'}`;
}

/**
 * Start a new span.
 */
export function startSpan(
  name: string,
  parentContext?: TraceContext
): { span: Span; context: TraceContext } {
  const traceId = parentContext?.traceId || generateTraceId();
  const spanId = generateSpanId();

  const span: Span = {
    traceId,
    spanId,
    parentSpanId: parentContext?.spanId,
    name,
    startTime: Date.now(),
    status: 'ok',
    attributes: new Map(),
    events: [],
  };

  // Store span
  if (!spanStore.has(traceId)) spanStore.set(traceId, []);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  spanStore.get(traceId)!.push(span);

  return {
    span,
    context: {
      traceId,
      spanId,
      isSampled: parentContext?.isSampled ?? true,
    },
  };
}

/**
 * End a span.
 */
export function endSpan(span: Span, status: 'ok' | 'error' = 'ok') {
  span.endTime = Date.now();
  span.status = status;
}

/**
 * Add an event to a span.
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, unknown>
) {
  span.events.push({
    name,
    timestamp: Date.now(),
    attributes,
  });
}

/**
 * Wrap an async handler with tracing.
 * Automatically extracts trace context from request and injects into response.
 */
export async function withTracing<T>(
  spanName: string,
  request: NextRequest | Request,
  handler: (span: Span) => Promise<T>
): Promise<{ result: T; responseInit?: ResponseInit }> {
  // Extract parent trace context
  const traceparent = request.headers.get(TRACEPARENT_HEADER);
  const parentContext = traceparent ? parseTraceparent(traceparent) : null;

  const { span, context } = startSpan(spanName, parentContext || undefined);

  // Add request attributes
  span.attributes.set('http.method', request.method);
  if ('nextUrl' in request) {
    span.attributes.set('http.url', request.nextUrl.pathname);
  }

  try {
    const result = await handler(span);
    endSpan(span, 'ok');

    const responseInit: ResponseInit = {
      headers: {
        [TRACEPARENT_HEADER]: createTraceparent(context),
      },
    };

    return { result, responseInit };
  } catch (error) {
    endSpan(span, 'error');
    span.attributes.set('error.message', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Get all spans for a trace (for debugging).
 */
export function getTraceSpans(traceId: string): Span[] {
  return spanStore.get(traceId) || [];
}

/**
 * Get tracing stats (for diagnostics endpoint).
 */
export function getTracingStats(): {
  totalTraces: number;
  totalSpans: number;
  oldestTrace?: string;
} {
  let totalSpans = 0;
  let oldestTrace: string | undefined;
  let oldestTime = Infinity;

  for (const [traceId, spans] of spanStore.entries()) {
    totalSpans += spans.length;
    const firstSpan = spans[0];
    if (firstSpan && firstSpan.startTime < oldestTime) {
      oldestTime = firstSpan.startTime;
      oldestTrace = traceId;
    }
  }

  return {
    totalTraces: spanStore.size,
    totalSpans,
    oldestTrace,
  };
}

/**
 * Clear span store (for memory management).
 */
export function clearSpanStore(maxAgeMs: number = 3600000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [traceId, spans] of spanStore.entries()) {
    if (spans.every((s) => (s.endTime || s.startTime) < cutoff)) {
      spanStore.delete(traceId);
    }
  }
}

// Auto-cleanup old spans every 10 minutes
if (typeof globalThis !== 'undefined' && !(globalThis as typeof globalThis & { __tracingCleanupSet?: boolean }).__tracingCleanupSet) {
  setInterval(() => clearSpanStore(3600000), 10 * 60 * 1000);
  (globalThis as typeof globalThis & { __tracingCleanupSet?: boolean }).__tracingCleanupSet = true;
}
