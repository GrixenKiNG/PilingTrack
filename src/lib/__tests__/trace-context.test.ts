/**
 * F-R87-CHAIN-METADATA-b: ядро трассировки вынесено из `@/lib/request-context`
 * в `@/lib/trace-context` (без импортов next). Реэкспорт обязан отдавать ТОТ ЖЕ
 * экземпляр AsyncLocalStorage, иначе контекст, установленный middleware через
 * `@/lib/request-context`, не будет виден коду, читающему `@/lib/trace-context`
 * (и наоборот).
 */

import { describe, expect, it } from 'vitest';
import {
  generateRequestId,
  getRequestIdFromContext,
  getTraceId,
  traceContext as requestContextTrace,
  type TraceContext,
} from '@/lib/request-context';
import { traceContext as traceContextTrace } from '@/lib/trace-context';

describe('trace context re-export (F-R87-CHAIN-METADATA-b)', () => {
  it('request-context.traceContext === trace-context.traceContext (один экземпляр)', () => {
    expect(requestContextTrace).toBe(traceContextTrace);
  });

  it('контекст, установленный через trace-context, виден реэкспорту request-context', () => {
    const context: TraceContext = { traceId: 'trace-1', spanId: 'span-1', requestId: 'req-1' };
    const seen = traceContextTrace.run(context, () => ({
      traceId: getTraceId(),
      requestId: getRequestIdFromContext(),
    }));
    expect(seen).toEqual({ traceId: 'trace-1', requestId: 'req-1' });
  });

  it('generateRequestId реэкспортирован из ядра', () => {
    expect(generateRequestId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
