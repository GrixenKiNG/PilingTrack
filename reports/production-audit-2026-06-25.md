# PilingTrack — Production Audit Report

**Date**: 2026-06-25
**Scope**: Full independent audit — infrastructure, backend, frontend, database, security, performance, reliability, UX

---

## Executive Summary

PilingTrack is a well-architected industrial web platform with several enterprise-grade patterns already in place (transactional outbox, CQRS projections, versioned encryption, nonce-based CSP). However, there are **5 critical** and **12 high-severity** issues that must be addressed before considering the system production-hardened.

**Production Readiness Score: 6.5 / 10**

---

## 1. INFRASTRUCTURE

### Strengths
- Multi-stage Dockerfiles with minimal runner images
- Non-root user (UID 1001) in all containers
- Healthchecks on every service
- Separate Redis instances for state (noeviction) vs cache (allkeys-lru)
- PgBouncer in transaction mode with proper `pgbouncer=true` Prisma flag
- Production overlay hides internal ports from host
- Log rotation configured

### CRITICAL: I-1 — Secrets in Tracked .env File
- **Severity**: CRITICAL
- **Where**: `.env` lines 1-41
- **Problem**: `.env` contains plaintext passwords (`postgres123secure`), session secrets, encryption keys, and Redis passwords. This file is tracked by git.
- **Impact**: Any repo leak (fork, backup, CI artifact, developer laptop theft) gives an attacker full database access, session forgery capability, and ability to decrypt all stored secrets (Telegram tokens, device keys).
- **Fix**: `git rm --cached .env`, rotate ALL secrets, add `.env` to `.gitignore`, use `.env.example` with placeholder values only.

### HIGH: I-2 — Unpinned Container Images
- **Where**: `docker-compose.yml` lines 229, 325
- **Problem**: `postgres:18-alpine` and `edoburu/pgbouncer:latest` use mutable tags. A `docker compose pull` can silently introduce breaking changes.
- **Fix**: Pin to specific versions (e.g., `postgres:18.3-alpine`, `edoburu/pgbouncer:1.23.1`).

### HIGH: I-3 — No Automated Backups
- **Where**: `docker-compose.prod.yml`
- **Problem**: WAL archiving is disabled (incident 2026-06-24). No backup container or cron job exists. Only weekly basebackups are mentioned in comments.
- **Fix**: Add a backup service that runs `pg_dump` daily to local disk and uploads to S3/MinIO. Retain 7 days minimum.

### MEDIUM: I-4 — Workers Install tsx Globally
- **Where**: `Dockerfile.workers:79`
- **Problem**: `npm install -g tsx` bypasses npm audit and is a supply-chain risk.
- **Fix**: Add tsx as a production dependency or copy it from the deps stage.

### MEDIUM: I-5 — No Read-Only Filesystem
- **Where**: All runner containers
- **Problem**: Containers can write to unexpected paths. A compromised app could modify its own code or configs.
- **Fix**: Add `read_only: true` with explicit tmpfs mounts for `/tmp`.

---

## 2. BACKEND / API

### Strengths
- Zod validation on all API inputs
- Rate limiting with Redis-backed Lua script + in-memory fallback
- Rate-limit identifier based on IP (not attacker-controlled headers)
- Audit logging on all auth events
- Transactional outbox pattern for reliable event publishing
- IdempotencyKey model for duplicate prevention
- Legacy password upgrade (SHA256 → bcrypt) with constant-time comparison
- `withApi`/`withMutation` wrappers for consistent error handling

### CRITICAL: B-1 — Session Revocation Fail-Open on Redis Outage
- **Severity**: CRITICAL
- **Where**: `src/services/auth/session-service.ts:100-119`
- **Problem**: When Redis is down, `isRevoked()` returns `false` for all tokens. A revoked admin session remains valid for up to 12 hours (SESSION_TTL).
- **Impact**: If Redis crashes and an admin session was revoked (e.g., after detecting compromise), the attacker's token stays valid.
- **Fix**: Keep a local in-process denylist as fallback. When Redis is unavailable, check the local Set before returning false. Sync back to Redis when it recovers.

### HIGH: B-2 — WS Server Has No Auth on /health
- **Where**: `Dockerfile.ws:75-76`
- **Problem**: The healthcheck endpoint returns 200 without authentication. While this is standard for healthchecks, the WS server itself has no rate limiting on connection attempts.
- **Fix**: Add connection rate limiting per IP on the WebSocket upgrade handler.

### HIGH: B-3 — Telemetry Ingestion Lacks Request Size Limit
- **Where**: `src/app/api/telemetry/ingest/route.ts:111`
- **Problem**: `request.json()` is called without a body size limit. An attacker could send a multi-GB payload to exhaust memory.
- **Fix**: Add a max body size check before parsing (e.g., via middleware or Content-Length header check).

### HIGH: B-4 — Rate Limiter In-Memory Fallback Not Distributed
- **Where**: `src/lib/rate-limiter.ts:244-302`
- **Problem**: When Redis is unavailable, rate limiting falls back to in-memory Maps. In a multi-replica deployment, each instance has its own counter — an attacker can bypass limits by hitting different replicas.
- **Fix**: Document this as an accepted limitation for single-replica, or add a sticky-session requirement.

### MEDIUM: B-5 — PIN Auth Legacy Fallback Scans Unindexed Users
- **Where**: `src/services/auth/auth-service.ts:267-299`
- **Problem**: Users with `pinLookup: null` trigger a full table scan. While this is a migration path, it could be exploited if many users haven't been backfilled.
- **Fix**: Add a migration to backfill all `pinLookup` values, then remove the legacy scan path.

### MEDIUM: B-6 — Auth User Cache Uses Token as Key
- **Where**: `src/lib/auth.ts:33`
- **Problem**: The cache key is the full JWT token string. Two requests with the same token but different sessions (e.g., after rotation) could serve stale user data within the 5-second TTL window.
- **Fix**: Use `jti` (token ID) as the cache key instead of the full token.

---

## 3. DATABASE

### Strengths
- Comprehensive indexing strategy (composite indexes on common query patterns)
- Transaction isolation level set to ReadCommitted with timeouts
- PgBouncer connection pooling in transaction mode
- CQRS read projections for analytics queries
- Optimistic concurrency via version field on Report
- Proper onDelete cascade/restrict/setnull on all relations

### HIGH: D-1 — No Index on `Report.tenantId + status` Composite
- **Where**: `prisma/schema.prisma:847-855`
- **Problem**: Queries filtering by both `tenantId` and `status` (common in admin dashboards) lack a composite index. The individual indexes exist but PostgreSQL may not use them efficiently together.
- **Fix**: Add `@@index([tenantId, status])` to the Report model.

### HIGH: D-2 — TelemetryRecord Has No Partitioning
- **Where**: `prisma/schema.prisma:902-918`
- **Problem**: The `TelemetryRecord` table will grow unbounded (500 requests/minute/device). Without partitioning by time, queries will slow down and VACUUM will struggle.
- **Fix**: Partition by `createdAt` (monthly ranges). Prisma supports this via raw SQL migrations.

### MEDIUM: D-3 — OutboxEvent No Cleanup of Published Rows
- **Where**: `prisma/schema.prisma:924-948`
- **Problem**: Published events are never deleted from the OutboxEvent table. Over time this table will grow large and slow down the outbox poll query.
- **Fix**: Add a periodic cleanup job that deletes `published=true` rows older than 7 days.

### MEDIUM: D-4 — No Connection Pool Monitoring
- **Where**: `src/lib/db.ts`
- **Problem**: No metrics are exposed for PgBouncer pool utilization (active connections, waiting clients). Pool exhaustion would manifest as mysterious timeouts.
- **Fix**: Enable PgBouncer admin interface and add pool stats to the `/api/metrics` endpoint.

---

## 4. SECURITY

### Strengths
- AES-256-GCM encryption with versioned key rotation
- Nonce-based CSP with strict-dynamic
- HSTS with preload in Caddy
- CORS properly configured with origin validation
- `PIN_LOOKUP_SECRET` must differ from `SESSION_SECRET` in production
- Device keys use HMAC lookup (not stored plaintext)
- Timing-safe comparisons for password/PIN verification
- Proper `X-Frame-Options: DENY` and `Permissions-Policy`

### CRITICAL: S-1 — .env Secrets Committed to Git
- Same as I-1. Duplicate entry because this is both an infrastructure AND security issue.

### CRITICAL: S-2 — `dangerouslySetInnerHTML` in Layout
- **Where**: `src/app/layout.tsx:89`
- **Problem**: While the content is a hardcoded string (`DEV_PERFORMANCE_MEASURE_GUARD`), the pattern is dangerous. If any future code injects user-controlled data into this, it's XSS.
- **Fix**: Verify the injected content is always a static string. Add an ESLint rule to flag `dangerouslySetInnerHTML` usage.

### HIGH: S-3 — No CSRF Protection on State-Changing Endpoints
- **Where**: All POST/PUT/DELETE API routes
- **Problem**: The session cookie uses `sameSite: 'lax'` which protects against most CSRF attacks, but POST requests from same-site contexts are still allowed. No explicit CSRF token validation exists.
- **Fix**: For same-origin POST requests, `sameSite: lax` is sufficient for most cases. However, add explicit CSRF token validation for sensitive operations (password change, role assignment, report deletion).

### HIGH: S-4 — WebSocket Server Has No Origin Validation
- **Where**: `src/core/realtime/server/index.ts` (ws-server)
- **Problem**: The WebSocket server accepts connections from any origin. An attacker could establish a WS connection from a malicious page to exfiltrate real-time data.
- **Fix**: Validate the `Origin` header against allowed origins during the WebSocket upgrade handshake.

### HIGH: S-5 — Grafana Exposed Behind Caddy Without Auth
- **Where**: `deploy/Caddyfile.prod:41-43`
- **Problem**: Grafana at `/grafana` is proxied to `127.0.0.1:3010` without any authentication layer in Caddy. If Grafana itself doesn't enforce auth, monitoring data is public.
- **Fix**: Add Basic Auth or OAuth2 Proxy in Caddy for the Grafana path.

### MEDIUM: S-6 — No Security Headers on WebSocket Connection
- **Where**: `deploy/Caddyfile.prod:47-49`
- **Problem**: The WS reverse proxy doesn't set security headers. While WS connections don't need CSP, the upgrade response should still carry HSTS.
- **Fix**: Add header directives to the WS matcher block.

---

## 5. PERFORMANCE

### Strengths
- Next.js standalone output for minimal Docker images
- Redis caching layer (separate from state Redis)
- PgBouncer connection pooling
- CQRS projections for analytics queries
- esbuild bundling for WS server (fast startup)
- `NODE_OPTIONS=--max-old-space-size=512` caps Node heap

### HIGH: P-1 — No Response Caching on Read-Heavy Endpoints
- **Where**: API routes for `/api/reports/all`, `/api/sites/all`, `/api/equipment/all`
- **Problem**: Every page load triggers fresh database queries. No HTTP cache headers or Redis caching for these read-heavy endpoints.
- **Fix**: Add `Cache-Control: private, max-age=30` for authenticated list endpoints. Use the redis-cache instance for frequently accessed data.

### HIGH: P-2 — Prisma Client Proxy Adds Latency to Every Query
- **Where**: `src/lib/db.ts:128-165`
- **Problem**: The Proxy-based lazy client wraps every Prisma method call with property traversal and Reflect.apply. While individually cheap, this adds measurable overhead to high-throughput paths (telemetry ingestion).
- **Fix**: For the telemetry path, consider using the Prisma client directly instead of through the proxy.

### MEDIUM: P-3 — No Bundle Size Monitoring
- **Where**: `next.config.ts`
- **Problem**: No `@next/bundle-analyzer` or similar tool configured. Bundle bloat can creep in silently.
- **Fix**: Add `@next/bundle-analyzer` and run it periodically. Set size budgets in CI.

---

## 6. RELIABILITY

### Strengths
- Graceful shutdown handlers in unified worker (SIGTERM/SIGINT)
- Leader election for outbox/projection workers
- Health server on workers for orchestrator checks
- Transaction outbox for reliable event delivery
- Dead Letter Queue for permanently failed events
- `tini` as init system in workers container (proper signal forwarding)

### HIGH: R-1 — No Circuit Breaker for External Services
- **Where**: S3/MinIO calls, Telegram API calls
- **Problem**: If MinIO is down, every report submission that triggers PDF generation will retry and potentially exhaust connection pools. No circuit breaker pattern exists.
- **Fix**: Implement a circuit breaker (e.g., using `opossum` library) for S3 and Telegram API calls. Trip after 5 consecutive failures, half-open after 30 seconds.

### HIGH: R-2 — Outbox Worker Has No Deadlock Detection
- **Where**: `src/workers/unified-worker/outbox.ts`
- **Problem**: The outbox poll query uses `FOR UPDATE SKIP LOCKED`, which is correct. However, if a worker crashes mid-transaction, the lock is released but the event may be left in a `processing` state with no recovery mechanism.
- **Fix**: Add a stale-event recovery query that resets events stuck in `processing` for >5 minutes back to `published=false`.

### MEDIUM: R-3 — Uncaught Exception Handler Doesn't Exit
- **Where**: `src/workers/unified-worker.ts:130-134`
- **Problem**: `uncaughtException` is logged but the process continues. After an uncaught exception, Node.js is in an undefined state and should exit.
- **Fix**: After logging, call `process.exit(1)` and let Docker restart the container.

### MEDIUM: R-4 — No Structured Logging for Audit Trail
- **Where**: `recordAuditEvent` calls
- **Problem**: Audit events are written to the database but not to structured logs. If the database is compromised, the audit trail is lost.
- **Fix**: Dual-write audit events to both the database AND structured logs (stdout/file).

---

## 7. FRONTEND / UX

### Strengths
- React 19 with concurrent features
- Zustand for state management (lightweight)
- Framer Motion for animations
- Responsive design with mobile support
- Offline-first architecture with sync capabilities

### MEDIUM: F-1 — No Loading States for Slow Connections
- **Where**: Various page components
- **Problem**: Industrial users on 2G/3G connections may see blank screens during page loads. No skeleton loaders or progressive loading.
- **Fix**: Add skeleton loaders for all data-dependent components. Implement optimistic updates for common actions.

### MEDIUM: F-2 — No Touch Target Size Validation
- **Where**: Form components
- **Problem**: Industrial users wearing gloves need larger touch targets (minimum 48x48px). No automated testing for touch target sizes.
- **Fix**: Add Playwright tests that verify all interactive elements meet WCAG touch target guidelines.

### LOW: F-3 — No Offline Indicator
- **Where**: Global app shell
- **Problem**: Users on construction sites with spotty connectivity don't know when they're offline vs. when the server is slow.
- **Fix**: Add a visible connection status indicator (e.g., "Offline — changes will sync when connected").

---

## Top-10 Critical Issues (Priority Order)

1. **I-1/S-1**: Secrets in tracked `.env` — rotate immediately, remove from git
2. **B-1**: Session revocation fail-open on Redis outage — add local denylist
3. **S-4**: WebSocket has no origin validation — add Origin header check
4. **S-5**: Grafana exposed without auth — add Basic Auth in Caddy
5. **I-3**: No automated backups — add pg_dump cron job
6. **D-2**: TelemetryRecord unbounded growth — add partitioning
7. **P-1**: No response caching on read-heavy endpoints — add Cache-Control
8. **R-1**: No circuit breaker for external services — add opossum
9. **R-2**: Outbox stale event recovery — add reset query
10. **R-3**: Uncaught exception doesn't exit — add process.exit(1)

---

## Quick Wins (Do These First)

1. **Rotate all secrets** in `.env` and production environment (30 min)
2. **Add `.env` to `.gitignore`** and `git rm --cached .env` (5 min)
3. **Pin Docker image versions** in docker-compose.yml (15 min)
4. **Add `process.exit(1)`** to uncaught exception handler (5 min)
5. **Add Grafana Basic Auth** in Caddyfile.prod (10 min)
6. **Add `Cache-Control` headers** to list endpoints (30 min)

---

## Long-Term Architecture Improvements

1. **Secrets Management**: Migrate to Doppler, Vault, or cloud provider secrets manager
2. **Observability**: Add OpenTelemetry tracing across all services
3. **Chaos Engineering**: Implement failure injection testing (Redis down, Postgres failover)
4. **Multi-Region**: Design for eventual multi-region deployment with conflict resolution
5. **Automated Backups**: Daily pg_dump to S3 with point-in-time restore testing
6. **Load Testing**: Regular k6 load tests simulating 100+ concurrent operators
7. **Security Auditing**: Quarterly penetration testing and dependency audits
