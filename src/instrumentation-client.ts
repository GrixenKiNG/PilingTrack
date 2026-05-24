// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://3954e54e43b52d272c06941e5180dff0@o4511443929530368.ingest.de.sentry.io/4511443960332368",
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enableLogs: false,

  // Filter out noise that swamps the dashboard without indicating real bugs.
  ignoreErrors: [
    /chrome-extension:/i,
    /Network Error/i,
    /Loading chunk \d+ failed/i,
    /ResizeObserver loop limit exceeded/i,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
