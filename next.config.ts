import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
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
      // Service Worker: always revalidate
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      // PWA manifest
      {
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
      // PWA icons
      {
        source: "/icon-:size.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, immutable",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || "",
  project: process.env.SENTRY_PROJECT || "pilingtrack",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
});
