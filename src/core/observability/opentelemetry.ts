/**
 * OpenTelemetry — Full OTLP Integration
 *
 * Replaces the in-memory tracer with a production-grade OTLP exporter.
 * Compatible with: Jaeger, Grafana Tempo, Honeycomb, Datadog, New Relic.
 *
 * Usage:
 *   import '@/core/observability/opentelemetry'; // Import ONCE at startup
 *
 * Environment:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
 *   OTEL_SERVICE_NAME=pilingtrack
 *   OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
 *   OTEL_TRACES_SAMPLER=parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG=0.1
 */

import { trace, context, propagation, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, SEMRESATTRS_HOST_NAME } from '@opentelemetry/semantic-conventions';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SimpleSpanProcessor, ConsoleSpanExporter, AlwaysOnSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

// ============================================================
// Configuration
// ============================================================

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'pilingtrack';
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const SAMPLE_RATE = parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || '1.0');

// ============================================================
// Resource Attributes
// ============================================================

const resource = resourceFromAttributes({
  [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
  [SEMRESATTRS_SERVICE_VERSION]: process.env.APP_VERSION || process.env.npm_package_version || 'unknown',
  [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: ENVIRONMENT,
  [SEMRESATTRS_HOST_NAME]: process.env.HOSTNAME || 'localhost',
  'app.tenant_id': process.env.DEFAULT_TENANT_ID || '',
});

// ============================================================
// Trace Exporter
// ============================================================

// Production: OTLP → Jaeger/Tempo
const otlpExporter = new OTLPTraceExporter({
  url: `${OTEL_ENDPOINT}/v1/traces`,
});

// Development: Console output
const consoleExporter = new ConsoleSpanExporter();

// ============================================================
// SDK Setup
// ============================================================

const sampler = ENVIRONMENT === 'production'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- telemetry enum/Prisma cast at the ingestion boundary
  ? new ParentBasedSampler({ root: { shouldSample: () => ({ decision: Math.random() < SAMPLE_RATE ? 1 : 0 }) } as any })
  : new AlwaysOnSampler();

const sdk = new NodeSDK({
  resource,
  sampler,
  spanProcessors: [
    // In production, use batch processor (default in NodeSDK)
    ...(ENVIRONMENT === 'production'
      ? [] // NodeSDK uses BatchSpanProcessor by default with otlpExporter
      : [new SimpleSpanProcessor(consoleExporter)]),
  ],
  traceExporter: ENVIRONMENT === 'production' ? otlpExporter : undefined,
  instrumentations: [
    new HttpInstrumentation(),
  ],
});

// ============================================================
// Start
// ============================================================

let sdkStarted = false;

export function startOpenTelemetry(): void {
  if (sdkStarted) return;
  sdkStarted = true;

  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await sdk.shutdown();
  });

  process.on('SIGINT', async () => {
    await sdk.shutdown();
  });
}

// Auto-start if environment configured
if (OTEL_ENDPOINT) {
  startOpenTelemetry();
}

// ============================================================
// Tracing Utilities (compatible with existing API)
// ============================================================

const tracer = trace.getTracer(SERVICE_NAME);

/**
 * Wrap an async function with a span.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: ReturnType<typeof tracer.startSpan>) => Promise<T>,
  options?: { attributes?: Record<string, string | number | boolean> }
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (options?.attributes) {
        Object.entries(options.attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }

      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Get current span from context (for adding attributes).
 */
export function getCurrentSpan() {
  return trace.getSpan(context.active());
}

/**
 * Set an attribute on the current span.
 */
export function setSpanAttribute(key: string, value: string | number | boolean): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttribute(key, value);
  }
}

/**
 * Export W3C trace context for propagation to downstream services.
 */
export function getTraceContextHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}

export { tracer };
