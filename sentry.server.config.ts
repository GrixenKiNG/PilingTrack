// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://3954e54e43b52d272c06941e5180dff0@o4511443929530368.ingest.de.sentry.io/4511443960332368",

  // Off in dev/test to keep our prod Sentry project clean.
  enabled: process.env.NODE_ENV === "production",

  // 10% trace sampling in prod keeps us well under the free quota.
  tracesSampleRate: 0.1,

  // Do not send IP, cookies, request bodies, etc. — 152-ФЗ scope.
  sendDefaultPii: false,

  // We already ship application logs to Loki — don't double-pay Sentry for them.
  enableLogs: false,
});
