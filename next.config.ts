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
      // CSP — kept here (per-route, needs nonce work in Sprint-2).
      // All OTHER security headers (HSTS, X-Frame-Options, X-Content-Type-Options,
      // Referrer-Policy, Permissions-Policy) are owned by Caddy in deploy/Caddyfile.prod
      // to avoid duplicate-header drift that broke HSTS preload eligibility.
      {
        source: "/(.*)",
        headers: [
          { key: "X-XSS-Protection", value: "0" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js emits inline bootstrap/hydration scripts; without
              // 'unsafe-inline' (or a per-request nonce), the app white-screens
              // in production. 'unsafe-eval' stays disabled in prod — that's
              // the bigger risk. A nonce-based CSP is the proper long-term fix.
              process.env.NODE_ENV === "production"
                ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: ws: wss:",
              "media-src 'self'",
              "object-src 'none'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-src 'self' blob:",
            ].filter(Boolean).join("; "),
          },
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
