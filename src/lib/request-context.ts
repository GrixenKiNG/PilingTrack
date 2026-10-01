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

import { NextResponse } from 'next/server';
import { generateRequestId, traceContext } from './trace-context';
import type { TraceContext } from './trace-context';

// ============================================================
// Trace Context Types
// ============================================================
//
// Ядро трассировки живёт в './trace-context' — без вызовов NextResponse, чтобы
// его мог тянуть фоновый процесс unified-worker, чей образ (Dockerfile.workers)
// удаляет node_modules/next (F-R87-CHAIN-METADATA-b). Здесь оно только
// реэкспортируется: экземпляр traceContext остаётся тем же самым, поэтому
// импорты '@/lib/request-context' работают без изменений.

export {
  getCurrentTrace,
  getRequestIdFromContext,
  getSpanId,
  getTraceId,
  generateRequestId,
  traceContext,
} from './trace-context';
export type { TraceContext } from './trace-context';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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

