import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Bake a version into the bundle at build time. Next's `env` config
  // replaces every `process.env.APP_VERSION` reference in compiled code
  // with this literal — including in the standalone runtime (`node
  // server.js`, not `npm`), where a plain `process.env.APP_VERSION` read
  // would otherwise be shadowed by whatever this block resolves to, no
  // matter what the container's real env var says. That shadowing is
  // exactly how health kept reporting the stale npm package version
  // (2.6.0) after the Docker image's APP_VERSION ARG/ENV was fixed to
  // carry the real deploy SHA (audit M2): this file preferred
  // npm_package_version unconditionally. Prefer the Dockerfile-supplied
  // SHA (present in process.env during `next build`, see Dockerfile's
  // builder stage) and fall back to the package version for local
  // `npm run build` without Docker.
  env: {
    APP_VERSION: process.env.APP_VERSION ?? process.env.npm_package_version ?? "unknown",
  },
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  outputFileTracingExcludes: {
    "**/*": [
      "next.config.ts",
      "coverage/**",
      "test-results/**",
      "test-screenshots/**",
      "test-screenshots-new/**",
      "tests/**",
      "chaos/**",
      "agents/**",
      "andrej-karpathy-skills-main/**",
      "zai-provider-extension/**",
      "infra/**",
      "*.md",
      "*.log",
      "*.out",
      "*.err",
      "tmp-*",
      "Dockerfile*",
      "Caddyfile",
      "components.json",
      "vitest.config.ts",
      "playwright.config.ts",
      "tsconfig*.json",
    ],
  },
  typescript: {
    // C4: strict typecheck on build. Type-check run: 0 errors across src/.
    // scripts/ and tests/ are excluded via tsconfig (separate runners).
    ignoreBuildErrors: false,
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    ...(process.env.ALLOWED_DEV_ORIGIN ? [process.env.ALLOWED_DEV_ORIGIN] : []),
  ],
  // Security + cache headers
  async headers() {
    return [
      // PDF endpoint — allow framing for inline preview
      {
        source: "/api/reports/single-pdf/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'",
          },
        ],
      },
      // Global CSP is now owned by src/proxy.ts (per-request nonce, C-4).
      // The PDF route above keeps its own CSP because it needs framing rules
      // distinct from the nonce policy.
      // All OTHER security headers (HSTS, X-Frame-Options, X-Content-Type-Options,
      // Referrer-Policy, Permissions-Policy) are owned by Caddy in deploy/Caddyfile.prod
      // to avoid duplicate-header drift that broke HSTS preload eligibility.
      {
        source: "/(.*)",
        headers: [
          { key: "X-XSS-Protection", value: "0" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
      // HSTS removed — owned by Caddy in deploy/Caddyfile.prod.
      // PWA cache headers (/sw.js, /manifest.json, /icon-:size.svg) removed
      // 2026-05-24 — the PWA was retired (no service worker, no manifest).
      // The app is a plain server-rendered site now.
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "9589921309a2",
  project: "pilingtrack",

  // SENTRY_AUTH_TOKEN is read from env at build time (.env.sentry-build-plugin
  // locally, CI/prod secret on the server). Without it, source maps upload
  // is skipped silently — the app still builds.
  silent: !process.env.CI,
  telemetry: false,

  // Capture a wider set of source-map files for readable stack traces.
  widenClientFileUpload: true,

  // Route Sentry browser requests through our own /monitoring path to dodge
  // ad-blockers. Keep an eye on src/proxy.ts — if any middleware starts
  // matching /monitoring, client errors stop reaching Sentry.
  tunnelRoute: "/monitoring",

  sourcemaps: {
    // Skip upload entirely when no auth token is present (local builds).
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // After Sentry has the maps, remove them from the build output so
    // /_next/static/.../*.js.map cannot be downloaded by visitors. Without
    // this, original source code leaks publicly on prod.
    deleteSourcemapsAfterUpload: true,
  },

  // Tie uploaded source maps to a specific build so Sentry knows which
  // release a given error belongs to.
  release: {
    name:
      process.env.SENTRY_RELEASE ||
      (process.env.npm_package_version
        ? `pilingtrack@${process.env.npm_package_version}`
        : undefined),
    create: !!process.env.SENTRY_AUTH_TOKEN,
    finalize: !!process.env.SENTRY_AUTH_TOKEN,
  },

  webpack: {
    // Strip Sentry debug logging from the production bundle.
    treeshake: { removeDebugLogging: true },
    // automaticVercelMonitors removed — we run on a self-hosted VPS, not Vercel.
  },
});
