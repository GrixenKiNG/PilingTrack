/**
 * Request Context — Distributed Tracing
 *
 * Provides:
 * - AsyncLocalStorage for trace context across async calls
 * - traceId propagation across service boundaries
 * - spanId for nested operations
 * - Correlation with logs, events, and audit trail
 *
 * Usage:
 *   import { traceContext, getTraceId, createSpan } from '@/lib/request-context';
 *
 *   In middleware:
 *     traceContext.run({ traceId, spanId: 'root' }, async () => {
 *       await handler();
 *     });
 *
 *   In any function:
 *     const traceId = getTraceId(); // available anywhere in the call chain
 */

import { AsyncLocalStorage } from 'async_hooks';
import { NextResponse } from 'next/server';

// ============================================================
// Trace Context Types
// ============================================================

export interface TraceContext {
  traceId: string;      // Unique per request, propagated across services
  spanId: string;       // Unique per operation within a trace
  parentSpanId?: string; // Parent span for nested operations
  requestId?: string;   // Client-provided request ID (for correlation)
  userId?: string;      // Authenticated user ID
  tenantId?: string;    // Multi-tenant context
}

// ============================================================
// AsyncLocalStorage for Trace Context
// ============================================================

export const traceContext = new AsyncLocalStorage<TraceContext>();

/**
 * Get current trace context.
 * Returns undefined if called outside of traceContext.run().
 */
export function getCurrentTrace(): TraceContext | undefined {
  return traceContext.getStore();
}

/**
 * Get the current trace ID.
 * Falls back to 'no-trace' if called outside of a trace context.
 */
export function getTraceId(): string {
  return traceContext.getStore()?.traceId || 'no-trace';
}

/**
 * Get the current span ID.
 */
export function getSpanId(): string {
  return traceContext.getStore()?.spanId || 'no-span';
}

/**
 * Get the current request ID (client-provided or generated).
 */
export function getRequestIdFromContext(): string | undefined {
  return traceContext.getStore()?.requestId;
}

// ============================================================
// Request ID (legacy compatibility)
// ============================================================

export const REQUEST_ID_HEADER = 'x-request-id';
export const TRACE_ID_HEADER = 'x-trace-id';
export const SPAN_ID_HEADER = 'x-span-id';

interface HeaderCarrier {
  headers: {
    get(name: string): string | null;
  };
}

export function generateRequestId() {
  return crypto.randomUUID();
}

export function getRequestId(request?: HeaderCarrier) {
  return request?.headers.get(REQUEST_ID_HEADER) || generateRequestId();
}

export function attachRequestIdHeader<T extends NextResponse>(response: T, requestId: string) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * Attach distributed tracing headers to response.
 */
export function attachTraceHeaders<T extends NextResponse>(
  response: T,
  context: TraceContext
) {
  response.headers.set(TRACE_ID_HEADER, context.traceId);
  response.headers.set(SPAN_ID_HEADER, context.spanId);
  if (context.requestId) {
    response.headers.set(REQUEST_ID_HEADER, context.requestId);
  }
  return response;
}

export function createJsonResponse(
  body: unknown,
  init: ResponseInit | undefined,
  requestId: string
) {
  return attachRequestIdHeader(NextResponse.json(body, init), requestId);
}

// ============================================================
// Span Creation (for nested operations)
// ============================================================

/**
 * Create a child span for nested operations.
 * Use this to track sub-operations within a request.
 *
 * Usage:
 *   const span = createSpan('db.query');
 *   try {
 *     await db.query();
 *   } finally {
 *     span.end();
 *   }
 */
export function createSpan(operationName: string): {
  spanId: string;
  operationName: string;
  startTime: number;
  end: () => TraceContext | undefined;
} {
  const parentContext = traceContext.getStore();
  const spanId = crypto.randomUUID().slice(0, 16);

  if (!parentContext) {
    // No parent trace — create standalone span
    return {
      spanId,
      operationName,
      startTime: Date.now(),
      end: () => undefined,
    };
  }

  const childContext: TraceContext = {
    ...parentContext,
    spanId,
    parentSpanId: parentContext.spanId,
  };

  return {
    spanId,
    operationName,
    startTime: Date.now(),
    end: () => {
      // Return to parent context
      return parentContext;
    },
    _childContext: childContext,
  } as any;
}

// ============================================================
// Trace Context Initialization Middleware
// ============================================================

/**
 * Initialize trace context for a request.
 * Call this at the start of every API handler.
 *
 * Usage:
 *   export async function GET(request: NextRequest) {
 *     const trace = initTraceContext(request);
 *     return traceContext.run(trace, async () => {
 *       // Your handler logic here
 *       // getTraceId() is available anywhere in this block
 *     });
 *   }
 */
export function initTraceContext(request: HeaderCarrier): TraceContext {
  const traceId = request.headers.get(TRACE_ID_HEADER) || crypto.randomUUID();
  const spanId = request.headers.get(SPAN_ID_HEADER) || crypto.randomUUID().slice(0, 16);
  const requestId = request.headers.get(REQUEST_ID_HEADER);

  return {
    traceId,
    spanId,
    requestId: requestId || undefined,
  };
}

