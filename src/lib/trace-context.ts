/**
 * Trace Context — Distributed Tracing core (без зависимости от `next/*`)
 *
 * Ядро трассировки вынесено сюда из `@/lib/request-context`, потому что его
 * тянет фоновый процесс `unified-worker`, а образ воркеров (`Dockerfile.workers`)
 * удаляет `node_modules/next`: `next/server` в статической цепочке импортов
 * ронял воркер при старте (F-R87-CHAIN-METADATA-b). Здесь только `async_hooks`;
 * заголовки, `NextResponse` и HTTP-обвязка остаются в `request-context.ts`,
 * который реэкспортирует отсюда перечисленное ниже.
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

export function generateRequestId() {
  return crypto.randomUUID();
}
