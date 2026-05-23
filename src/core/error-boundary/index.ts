export {
  withErrorBoundary,
  withTimeout,
  classifyError,
  degradeEmptyList,
  degradeEmptyObject,
  degradeWithCache,
  recordLastKnownGood,
  degradePartial,
  UserError,
  TimeoutError,
} from './api-error-boundary';

export {
  Bulkhead,
  getBulkhead,
  getBulkheadHealth,
  BulkheadRejectError,
} from './bulkhead';

export type {
  ErrorCategory,
  ErrorContext,
  ErrorBoundaryOptions,
  DegradationFn,
} from './api-error-boundary';
