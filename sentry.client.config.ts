import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  // Adjust this value in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Add request data to error reports
  sendDefaultPii: false,
  // Filter out noise
  ignoreErrors: [
    // Browser extensions
    /chrome-extension:/i,
    // Common non-errors
    /Network Error/i,
    /Loading chunk \d+ failed/i,
    // Known non-critical
    /ResizeObserver loop limit exceeded/i,
  ],
  // Don't send errors in development unless DSN is set
  enabled: !!process.env.SENTRY_DSN,
});
