---
name: pilingtrack-diagnostics-and-tooling
description: Use when you need to MEASURE PilingTrack instead of guessing — is it slow, is projected data complete right now (via the completeness SQL/metrics), is the outbox or DLQ backed up, how many rows a table has, what a query plan looks like, or whether a change actually moved a number before/after. Covers /api/health, /api/metrics, EXPLAIN ANALYZE, log reading, k6 load tests, GitNexus, lint, coverage thresholds, and the auth smoke test, with an interpretation table.
---

# PilingTrack — Diagnostics and Tooling

Reference for the project's measurement tools. Every command and file path below was checked against the repo on 2026-07-08 (see "Provenance and maintenance"). If you're about to eyeball a number or guess whether something is fine, stop and run the matching tool here instead.

## When NOT to use

- **You already know the symptom** (login outage, Telegram silent, "downtime in days", fleet card zeroed, migrate says "no pending" but schema is stale, `pilingtrack-app` unhealthy) → open `pilingtrack-debugging-playbook` first. It maps symptom → check → fix; come back here only for the underlying measurement tool it points at.
- **You're doing something to prod** (deploy, restart a container, read prod logs, restore a backup, SSH in) → `pilingtrack-run-and-operate`. This skill is measurement, not operations.
- **You found something and need to decide if it's real** (a hunch, an audit finding, "is this actually a bug") → `pilingtrack-proof-and-analysis-toolkit` (its Recipe 1 is literally "verify an audit finding against code"); for the general evidence bar behind that verdict, see `pilingtrack-research-methodology`. This skill only tells you how to take the measurement.
- **You need deploy mechanics, migration authoring, or a security/testing review checklist** → `deploy`, `create-migration`, `qa-checklist`, `security-reviewer` respectively. Not duplicated here.

---

## 1. `/api/health` — overall dependency status

File: `src/app/api/health/route.ts`, logic in `src/core/observability/health-checks.ts` (`getHealth()`).

```
curl -s http://localhost:3000/api/health | jq
```

Returns:

```jsonc
{
  "status": "ok" | "degraded" | "unhealthy",
  "timestamp": "...",
  "uptime": 1234.5,           // seconds, process.uptime()
  "version": "1bb42c2",       // see APP_VERSION note below
  "database_provider": "postgres",
  "checks": {
    "database": { "name": "database", "status": "pass|fail", "latencyMs": 3 },
    "memory":   { "status": "pass|warn", "details": { "heapUsedMB", "heapTotalMB", "heapLimitMB", "heapUsagePercent", "rssMB" } },
    "environment": { "status": "pass|warn", "details": { "missing": [...] } },
    "disk":     { "status": "pass|warn", "details": { "usedPercent", "availMB" } },
    "redis":    { "status": "pass|warn", "details": { "latencyMs" } }
  }
}
```

HTTP status: `200` for both `ok` and `degraded`, `503` only for `unhealthy` (i.e. `database` check failed — the only check that can `fail`; memory/disk/env/redis only ever `warn`, by design, so a full disk or dead Redis alone never triggers a container-restart loop that can't fix itself).

**Normal values:** `database.latencyMs` single-digit ms locally, low double-digit on prod; `memory.heapUsagePercent` well under 80 (80 is the warn line, measured against the V8 heap ceiling `heap_size_limit`, not the dynamic `heapTotal`); `disk.usedPercent` under 85 (the VPS root disk is 30 GB and has hit 100% before — see `pilingtrack-run-and-operate`); `redis` should be `pass` — a `warn` here means Redis is unreachable and rate-limiting/cache/WS heartbeats are degraded even though the app is still serving requests.

**`version` / `APP_VERSION` flow (verified against commit `c555422`, 2026-07-03):** `next.config.ts`'s `env: { APP_VERSION: ... }` block gets inlined into compiled code at build time by Next.js, so whichever value it resolves to at `next build` time is baked in permanently — a later `docker run -e APP_VERSION=...` cannot override it after the fact. The fix in `c555422` made this prefer `process.env.APP_VERSION` (populated by the Dockerfile's `ARG`/`ENV` during the image's `next build`) and fall back to `npm_package_version` only for a bare `npm run build` with no Docker involved. Practical implication: **the deploy runbook's `export APP_VERSION=$(git rev-parse --short HEAD)` before `docker compose build app` is load-bearing** — skip it and `/api/health` silently reports the npm package version (`2.6.0`, stale) instead of the deployed commit, which makes "did my deploy land" unanswerable from health alone.

Two related endpoints exist but are out of this skill's charter — `src/app/api/health/deep/route.ts` (deeper check, has its own test) and `getReadiness()`/`getLiveness()` in the same `health-checks.ts` file (Kubernetes-style readiness/liveness — PilingTrack isn't on k8s, but Docker Compose health checks may use them; see `pilingtrack-run-and-operate` for container health wiring).

---

## 2. `/api/metrics` — Prometheus scrape endpoint

File: `src/app/api/metrics/route.ts`. Prometheus scrapes it every 15s per the route's own comment.

```
curl -s http://localhost:3000/api/metrics
```

**Auth (verified against commit `64228fc`, 2026-07-04):** the route originally required a full user session (`requireAuth` + `assertCan(user, 'system.read')`), which Prometheus's static `scrape_configs` cannot satisfy — as a result **no application metrics had ever reached production Prometheus** before this fix; the scrape job was commented out in `observability/prometheus/prometheus-prod.yml` with a TODO. The fix added `METRICS_SCRAPE_TOKEN`, checked via `Authorization: Bearer <token>` with `timingSafeEqual` (constant-time compare — same class of fix as `auth-service.ts`'s `constantTimeEquals`). It fails closed: an unset token or any mismatch falls through to the pre-existing session check, so a logged-in admin with `system.read` can still open the URL in a browser.

```
curl -s -H "Authorization: Bearer $METRICS_SCRAPE_TOKEN" http://localhost:3000/api/metrics
```

**Metrics exposed** (all hand-rolled Prometheus text format — no `prom-client` dependency; it isn't installed despite an earlier claim it was, per commit `01943ef`):

| Metric | Source | Normal |
|---|---|---|
| `process_resident_memory_bytes`, `process_heap_bytes`, `process_heap_used_bytes` | `process.memoryUsage()` | grows slowly, sawtooths on GC; a monotonic climb with no drops is a leak |
| `nodejs_eventloop_lag_seconds` | `src/core/observability/event-loop-lag.ts`, `node:perf_hooks` `monitorEventLoopDelay` | near 0; **verified real as of `01943ef`** (2026-07-04) — before that it was `performance.now()/1000`, i.e. just process uptime in seconds, not a lag measurement at all. It's a histogram reset after every scrape, so it reflects the interval since the last scrape, not an all-time average that flattens out over days of uptime. |
| `process_uptime_seconds` | `process.uptime()` | monotonically increasing; a drop means a restart |
| `app_version_info{version,node,platform}` | `APP_VERSION` env (same flow as `/api/health`) | check this matches the deployed commit |
| `backup_age_hours`, `backup_s3_synced` | `getCurrentStatus()` backup component | age under ~24-25h; `s3_synced=0` sustained is a stuck off-site backup |
| `outbox_lag_seconds`, `outbox_pending_count`, `outbox_publish_rate`, `projection_lag_seconds`, `outbox_leader`, `projection_leader` | `src/core/observability/lag-monitor.ts` | lag near 0, pending near 0; see §4 for what these mean structurally |
| `dlq_pending_count` | same file | **0**. `01943ef` added the `DeadLetterQueueNotEmpty` alert rule watching this (5m sustained > 0, warning) — before that fix the metric existed but nothing alerted on it |
| `http_request_duration_seconds_bucket`/`_count`/`_sum`, `http_requests_total` | `src/core/observability/http-metrics.ts`, wired into `withApi`/`withMutation` in `src/core/api-wrapper.ts` | labeled by the route's `domain` value (the same tag already used for Sentry/error logs), not the raw URL — keeps the label cardinality bounded instead of growing with every entity ID in a path. Also added in `01943ef`; the alert rules `HighAPILatencyP95/P99`/`HighAPIErrorRate` in `observability/prometheus/alerts.yml` referenced these metric names for a while before anything produced them — they only became live once this landed. |

Cross-check against `observability/prometheus/alerts.yml` (23 rules; verified names include `HighAPILatencyP95`, `CriticalAPILatencyP95`, `HighAPIErrorRate`, `APIEndpointDown`, `PostgresHighConnectionCount`, `PostgresConnectionPoolExhausted`, `PostgresSlowQueries`, `PostgresDeadlocks`, `HighMemoryUsage`, `EventLoopLagHigh`, `HighGarbageCollectionTime`, `NoReportsCreated`, `HighSyncFailureRate`, `OutboxBacklog`, `DeadLetterQueueNotEmpty`, `TargetDown`, `RedisHighMemory`, `HostDiskSpaceLow/Critical`, `WebSocketConnectionsDropping`) when deciding whether a Grafana panel or a firing alert has real data behind it.

---

## 3. DB diagnostics

### 3.1 Query plans — `npm run postgres:explain-analyze`

Runs `scripts/explain-analyze.ts` (`npx tsx scripts/explain-analyze.ts`). Requires `DATABASE_PROVIDER=postgres` and a generated Postgres Prisma client (`src/generated/postgres-client`) — it exits early with a warning otherwise.

It runs `EXPLAIN ANALYZE` on ~10 hand-picked hot queries (login by email, report by site+date, active sites, pending outbox events, report/downtime stats by site+date, telemetry by equipment+time range, operator performance, pile work by report, audit log by entity) and fails a query if:
- **Seq Scan** appears in the plan when an index scan was expected, or
- **Execution Time** exceeds the query's threshold (50-100ms, tuned per query).

**How to read the output:**
- `✅ Index Scan` with duration under threshold = healthy.
- `❌ ... Sequential scan detected` = the planner walked the whole table instead of using an index. On a small local dev table this can be a false positive (Postgres prefers seq scan below a row-count threshold where an index lookup isn't worth it) — re-run against a prod-sized dataset (`npm run db:refresh-prod-snapshot`) before treating it as a real regression.
- `Duration Xms exceeds threshold Yms` = look at the plan's `Buffers` line (shown in the full JSON the script truncates to 500 chars — rerun the raw SQL manually with `EXPLAIN (ANALYZE, BUFFERS)` for the full picture) for `shared read` (disk) vs `shared hit` (cache) — a high `read` count means the working set doesn't fit in `shared_buffers`.

Exit code is non-zero if any query fails — safe to wire into CI, but it currently is **not** one of the `verify` script's steps (see §7).

### 3.2 Schema rules — `npm run postgres:check-rules`

Runs `scripts/check-postgres-rules.js` (already a `.js`, despite the file's own header comment saying `.ts` — that comment is stale). Statically parses `prisma/schema.prisma` (regex-based, no DB connection needed) against the project's 25 Postgres design rules and prints ✅/⚠️/❌ per rule with a `[criticality]` tag (`maximum`/`high`/lower). Use this after any schema edit, before generating a migration — it does not require a running database.

### 3.3 Migration safety guard — `npm run db:check-migrations`

Runs `scripts/check-migrations.js`. Walks every `prisma/migrations/*/migration.sql` and fails if it contains `DROP COLUMN`, `DROP TABLE`, or `TRUNCATE` (case-insensitive) unless that migration's directory name is listed in `scripts/.migration-guard-baseline.txt`. `DROP CONSTRAINT` is deliberately **not** flagged — Prisma drops and recreates FKs on almost every migration; that isn't data loss. This guard exists because of a real incident: 2026-05-30 an autogenerated migration silently dropped `Report.journalPhotoMediaId` on prod, which broke the reports list (a failing `findMany` renders as an empty list, not an error) and was only found in app logs hours later. This is one of the `verify` script's steps (§7) — it runs on every `npm run verify`, not just when you remember to.

### 3.4 psql recipes (read-only, safe on prod)

Row counts and RLS state aren't wrapped in an npm script — run directly:

```sql
-- Row count for any table (fill in the model name; no @@map in this
-- schema, so Prisma model names ARE the physical table names, quoted)
SELECT count(*) FROM "Report";

-- RLS state per table — pattern used by scripts/apply-postgres-hardening.ts
-- ("Step 4: Row-Level Security"). A table with RLS enabled but ZERO
-- policies locks out every non-owner role; RLS enabled but NOT forced
-- means the table owner (often the app's own DB role) bypasses every
-- policy silently.
SELECT c.relname,
       c.relrowsecurity AS rls,
       c.relforcerowsecurity AS forced,
       (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
ORDER BY c.relname;
```

Run locally against the dev container: `docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test`. On prod: `docker compose exec postgres psql -U piling -d pilingtrack` (see `pilingtrack-run-and-operate` for prod DB access specifics — this skill only covers the queries, not the ops context).

---

## 4. Projection / analytics completeness

**Vocabulary first (defined once):** the app writes state through Postgres, then an **outbox** table (`OutboxEvent`) records "this happened" rows that a background publisher marks `published`. A separate **projection** worker consumes published events and rebuilds denormalized **read models** (`ReportAnalytics`, `ReportStats`, `SiteDailySummary`, `SiteWeeklyTrend`) that dashboards actually query — this is the CQRS write/read split. An event that a projector keeps failing on gets moved to the **Dead Letter Queue** (`DeadLetterQueue`) after repeated attempts, instead of blocking the whole queue forever.

### 4.1 The script: `check-projection-completeness.sql`

Already exists at `.claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql` — **read it directly for the exact queries and their "healthy" comments**; this section summarizes what it checks, not a copy of the SQL.

Eight read-only `SELECT` sections:

1. **Row counts**: `Report` vs `ReportAnalytics` vs `ReportStats` vs `SiteDailySummary`/`SiteWeeklyTrend` (against the count of distinct site+date / site+week pairs actually present in `Report`).
2. **Reports missing their `ReportAnalytics` row** — a left join with `IS NULL`. Non-zero = the projection worker missed events for those reports.
3. **Orphaned `ReportAnalytics`** — projection row exists, source `Report` doesn't. Non-zero = a report was deleted and never reprojected (a known bug class from the 2026-07-07 data-flow audit) — analytics **overcounts**.
4. Same missing/orphaned pair for `ReportStats`.
5. **`SiteWeeklyTrend` coverage per site** — expected weeks (from `Report`) vs actual rows. All-missing for every site is the signature of the nightly rebuild wiping the table then crashing (known prod failure mode: `tenantId` NOT NULL schema drift) rather than a partial gap.
6. **Outbox backlog** — counts where `published=false` / `projected=false`, ages of the oldest of each, and a `poison_candidates` count (`attempts >= 5` and still unresolved — these will end up in the DLQ or already have).
7. **DLQ by status** (`pending`/`resolved`/`discarded`) with newest timestamp.
8. **Newest pending DLQ errors** — `eventType`, `attempts`, first 100 chars of `errorMessage`.

Two facts baked into the script's own header comments, worth restating because they're easy to get wrong when hand-writing similar queries: there is **no `@@map`** anywhere in `schema.prisma` (verified 2026-07-08 — zero matches), so physical table names equal the Prisma model names and must be double-quoted; and `ReportAnalytics.reportId`/`ReportStats.reportId` store the **business** `Report.reportId` (a UUID), not the primary key `Report.id` (a cuid) — joining on the wrong one makes every row look 100% missing.

### 4.2 Running it

```bash
# Local dev DB
docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test \
  < .claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql

# Prod (paste contents or scp the file first — see pilingtrack-run-and-operate for SSH access)
docker compose exec -T postgres psql -U piling -d pilingtrack < check-projection-completeness.sql
```

**Status as of this writing: dry.** The script was authored and read for this skill but **not executed** against any database in this session — no live row-count numbers are reported here. Run it yourself before trusting a completeness claim.

### 4.3 If it finds gaps: the rebuild endpoint

`POST /api/admin/projections/rebuild?name=operator-performance|site-daily|site-weekly|all` (route: `src/app/api/admin/projections/rebuild/route.ts`, logic in `src/modules/reports/application/projections/rebuild.ts`). Requires auth + the `projections.rebuild` permission (`withMutation` — CSRF/rate-limit handled by the wrapper, not this skill's concern). Historically this is the backfill path the team has leaned on to paper over projection lag rather than fixing the underlying worker gap — treat a completeness gap that needs a manual rebuild as a symptom worth root-causing (`pilingtrack-debugging-playbook`, `pilingtrack-research-methodology`), not just a button to press each time.

**Related, already fixed:** commit `1008ae1` (2026-07-07) fixed the fleet-monitoring dashboard's specific symptom of this gap (full incident: `pilingtrack-failure-archaeology` D2). That fix makes the **dashboard** honest under lag; it does not make the **projection** itself complete — still confirm with the SQL script above if you suspect a systemic gap rather than a single card.

---

## 5. Log diagnostics

**Two logger modules exist — know which one you're looking at:**

- **`src/lib/logger.ts`** — the one actually used across the codebase (59 files import it as of this writing). It is a **hand-rolled JSON console logger**, not pino: `logger.info/warn/error/debug(message, data)` calls `console.log`/`console.warn`/`console.error` with `JSON.stringify({ timestamp, level, message, ...data })`. Level filtering via `LOG_LEVEL` env (defaults to `info` in production, `debug` otherwise). This is what you grep for in `docker compose logs`.
- **`src/core/observability/logger.ts`** — a real **pino**-based logger (`AsyncLocalStorage`-backed correlation context, child loggers, pretty-print in dev / JSON in prod) — but it is imported by only 1 file in the codebase as of this check. Don't assume pino's structured features (child loggers, correlation IDs) are active in most of the app; verify per-file which import is in play before relying on them.

Both emit line-delimited JSON in production, which is what makes them greppable/parseable for aggregation.

**Reading logs:**

```bash
# Local dev — plain npm run dev output, or:
docker compose logs -f app --tail 200

# Filter to a level or message substring (structured JSON, so this is a
# raw string grep on the JSON line — good enough for one-off searches)
docker compose logs app --tail 1000 | grep '"level":"error"'
docker compose logs app --tail 1000 | grep 'reportId'

# Prod containers of interest
docker compose logs -f app worker s     # substitute pilingtrack-app / pilingtrack-workers / pilingtrack-ws
```

For structured queries beyond grep (e.g. "every error in the last hour with this `requestId`"), pipe through `jq`: `docker compose logs app --since 1h | jq 'select(.level=="error")'` — works because every line is one JSON object, though Docker prefixes each with a container-name tag that `jq -R 'fromjson? // empty'` handles better than plain `jq` if that prefix is present in your Compose log driver config.

---

## 6. Load / performance

| Command | Script | Shape |
|---|---|---|
| `npm run test:load` | `npx k6 run scripts/load-test.js` | k6-based; exercises health, login+rate-limit, reads (sites/dictionary/reports), writes (report upsert), sync batch push/pull. Logs in once in `setup()`, reuses the session cookie. |
| `npm run test:load:spike` | same script, `--vus 100 --duration 30s` | spike variant — 100 virtual users, 30s |
| `npm run test:load:smoke` | `node scripts/quick-load-test.js` | plain Node (no k6 dependency), 30 simulated users × 15 requests each against the actual cached read endpoints (`/api/sites/all`, `/api/crews/all`, `/api/dictionary/all`, `/api/equipment/all`) |
| `npm run test:load:stress` | `node scripts/stress-test-100.js` | same cached endpoints, 100 concurrent users × 10 requests, reports latency percentiles |

k6 needs `npx k6` (pulled via npx, not a repo dependency) and a running app at `BASE_URL` (defaults `http://localhost:3000`). The Node-only scripts (`quick-load-test.js`, `stress-test-100.js`) need nothing but a running app and valid seeded credentials — cheaper to reach for when you just want a real-endpoint latency sanity check without installing k6.

**Interpreting results:** compare p95/p99 latency against the alert thresholds already encoded in `observability/prometheus/alerts.yml` (`HighAPILatencyP95`/`CriticalAPILatencyP95`) rather than inventing your own bar — if a load test's p95 sits above the alert threshold, production would already be paging on this traffic level.

---

## 7. Code intelligence, lint, coverage

**GitNexus MCP** — for "how does X work", "what breaks if I change X", and tracing a bug through the call graph, use the GitNexus tools (`impact`, `detect_changes`, `query`, `context`, `explain`) rather than grepping blind. This is a separate, larger topic — see the `gitnexus-exploring`, `gitnexus-impact-analysis`, `gitnexus-debugging`, `gitnexus-refactoring`, `gitnexus-cli`, and `gitnexus-guide` skills for the full workflow. One habit worth repeating here: **run `impact()` before editing any symbol and `detect_changes()` before committing** — both are already mandated at the top level of this project's `CLAUDE.md`, not just a nice-to-have.

**`npm run lint`** — runs `eslint .` **and then** `node scripts/check-text-integrity.js`. The text-integrity check is not a linter in the ESLint sense: it walks `src/`, `scripts/`, `docs/`, and `next.config.ts` for `.ts/.tsx/.js/.jsx/.md/.json/.yml/.yaml` files and flags mis-decoded Cyrillic byte sequences (mojibake patterns like a lone `Р`/`С` followed by stray high-byte characters, or `вЂ`/`в†`/`Г—` sequences) — the kind of corruption that happens when Russian-language UI strings or docs get saved/read with the wrong encoding somewhere in the pipeline. A failure here means a file has garbled Cyrillic text in it, not a code-style violation.

**Coverage** — `npm run test:coverage` (`vitest run --coverage`, provider `v8`) or `npm run coverage:check` (same, dot reporter). Thresholds are defined in `vitest.config.ts` and are explicitly a **ratchet floor, not a target** — set just below the actual coverage at the time they were written so any PR that adds code without tests trips the gate:

| Metric | Threshold |
|---|---|
| Lines | 24% |
| Statements | 23% |
| Functions | 19% |
| Branches | 19% |

(Comment in the config: "Bump these up whenever coverage grows — never down without a deliberate reason.") `src/components/ui/**` (shadcn primitives) and `src/services/telemetry/mqtt-ingestion-service.ts` (dormant MQTT ingestion — trips a coverage-remapper parse error, and is 0% either way) are excluded from the coverage report on purpose, not by oversight.

`npm run typecheck` = `npm run build && tsc --noEmit` — note it runs a full build first, not just `tsc`, so a typecheck failure can also mean a build-time failure (env validation, codegen) rather than a type error per se.

---

## 8. Smoke test

**`npm run test:smoke:auth-access`** = `npm run build && node scripts/smoke-auth-access.js`. Builds the app, boots it, and drives a real HTTP sequence against it (base URL `http://127.0.0.1:3101`, seeded fixture credentials) asserting, in order: readiness returns 200/`ready:true`; unauthenticated `/api/auth/me` returns 401; admin login succeeds and resolves the right user; admin can reach `/api/users` and `/api/system` (and `/api/system`'s diagnostics report `databaseProvider: postgres`); an `operator`-role login succeeds but gets 403 on `/api/users` (RBAC boundary check); logout succeeds and the session is actually cleared (401 again on `/api/auth/me`). This is the fastest single command that proves auth + RBAC + session lifecycle all still work end to end — it is also the last step of `npm run verify`.

---

## 9. Interpretation table

| Measurement | Healthy / expected | Suspicious | Next skill / doc |
|---|---|---|---|
| `/api/health` status | `ok`, all checks `pass` | `degraded` (any `warn`) sustained, or `unhealthy` (`database` fails) | `pilingtrack-debugging-playbook` (login outage / app 500s), `pilingtrack-run-and-operate` (container health) |
| `/api/health` `version` | matches `git rev-parse --short HEAD` of the deployed commit | shows `2.6.0` or an old SHA after a deploy | you skipped `export APP_VERSION=...` before `docker compose build app` — see §1 and the deploy runbook |
| `/api/metrics` reachable by Prometheus | scrape succeeds with `METRICS_SCRAPE_TOKEN` | `APIEndpointDown`/`TargetDown` firing, or Grafana panels empty | confirm `METRICS_SCRAPE_TOKEN` is set in both the app and Prometheus config; `pilingtrack-run-and-operate` for Grafana/Prometheus quirks |
| `nodejs_eventloop_lag_seconds` | near 0, small spikes under load | sustained high value | `EventLoopLagHigh` alert context; profile the request path with GitNexus `impact`/`trace` before guessing |
| `dlq_pending_count` | 0 | `> 0` for 5+ min (`DeadLetterQueueNotEmpty` fires) | run projection-completeness §4 sections 7-8 to see the actual failing `eventType`/`errorMessage`, then `pilingtrack-debugging-playbook` |
| Outbox `unpublished`/`unprojected` counts (§4 §6) | ~0, ages < 60s | growing backlog or large ages | `docs/runbooks/004-outbox-backlog.md`; confirm the outbox/projection workers are actually running (`pilingtrack-run-and-operate`) |
| Projection completeness (§4 §§2-5) | 0 missing/orphaned rows, 0 missing weeks | any non-zero, especially "all weeks missing for every site" | `pilingtrack-debugging-playbook` ("weekly analytics near-empty"); rebuild via `/api/admin/projections/rebuild` only after finding root cause, not as a reflex |
| `postgres:explain-analyze` | ✅ index scan, under threshold | ❌ seq scan or over threshold on a prod-sized table | `src/lib/db-optimization.ts` patterns; add an index, re-run |
| `postgres:check-rules` | all ✅, or only low-criticality 🔵 | any ❌ (`maximum` criticality) | fix before writing a migration; re-run `postgres:check-rules` |
| `db:check-migrations` | passes | fails on a real `DROP COLUMN`/`DROP TABLE`/`TRUNCATE` | read the migration, confirm intent, add to `scripts/.migration-guard-baseline.txt` only if genuinely intended — `create-migration` skill for the authoring workflow |
| `check-text-integrity.js` (part of `npm run lint`) | passes | flags a file | find the mis-encoded Cyrillic string, fix the source encoding, don't just delete the flagged character |
| `test:coverage` thresholds | at/above the ratchet floor (24/23/19/19) | drops below | you removed tests or added untested code; the gate is supposed to catch this — don't lower the threshold to pass |
| `test:smoke:auth-access` | passes | any assertion fails | `pilingtrack-debugging-playbook` if the failure looks like a specific known symptom; otherwise treat as a real regression in auth/RBAC/session code (security-critical path per this project's `CLAUDE.md`) |
| Load test p95/p99 | below `HighAPILatencyP95`/`CriticalAPILatencyP95` thresholds in `alerts.yml` | above | profile with GitNexus `impact`/`context` on the hot route before optimizing blind |
| GitNexus `impact()` on a symbol you're about to edit | LOW/MEDIUM risk, callers enumerated | HIGH/CRITICAL risk | stop and read the callers before editing; `gitnexus-impact-analysis` |

---

## Provenance and maintenance

Written 2026-07-08. Every command referenced exists in `package.json` as checked on that date; every table/column referenced was checked against `prisma/schema.prisma` on that date (confirmed zero `@@map` directives in the schema — table names equal Prisma model names). The projection-completeness SQL script was **read but not executed** in the session that produced this skill — treat its interpretation notes as accurate to the SQL text, not as a live result.

Unverifiable / not independently confirmed in this pass (labeled per instruction, not asserted as fact):
- Exact current values of any metric or row count on **prod** — this skill documents how to measure, not a snapshot of current prod numbers.
- Whether `docker compose logs`' Compose log driver prepends a plain-text prefix before the JSON line in this project's specific Compose config (affects the `jq -R` vs `jq` recipe in §5) — unverified, reported 2026-07-08.
- Whether `EventLoopLagHigh`/other alert thresholds in `alerts.yml` have been tuned against real traffic yet, given `01943ef` (2026-07-04) is what first made the underlying metrics real — unverified, reported 2026-07-08.

Re-verify with:

```bash
# Scripts still exist and match package.json
grep -E "postgres:explain-analyze|postgres:check-rules|db:check-migrations|test:load|test:smoke:auth-access|^\s*\"lint\"" package.json

# No @@map crept into the schema
grep -c "@@map" prisma/schema.prisma   # expect 0

# Coverage thresholds still match what's quoted above
grep -A4 "thresholds:" vitest.config.ts

# Logger split still holds (which file is actually imported where)
grep -rl "from '@/lib/logger'" src --include=*.ts | wc -l
grep -rl "from '@/core/observability/logger'" src --include=*.ts | wc -l

# Metrics route auth + metric names unchanged
grep -n "METRICS_SCRAPE_TOKEN\|eventloop_lag\|dlq_pending_count" src/app/api/metrics/route.ts
```

If any of these diverge from what's stated above, update this file rather than trusting memory — this project's own audit-lifecycle policy treats stale diagnostic docs as a real risk (audits/skills go stale; confirm against current code before relying on them for anything you'll act on).
