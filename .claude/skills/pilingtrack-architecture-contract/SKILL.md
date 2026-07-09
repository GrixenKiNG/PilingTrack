---
name: pilingtrack-architecture-contract
description: Use when working in the PilingTrack codebase and deciding where code belongs (modules vs services vs core vs app/api), touching the outbox/projection pipeline or read models, changing tenancy/RLS/CSRF/JWT/encryption/CSP invariants, wondering whether a subsystem (telemetry, multi-tenancy, ReportPhoto) is dead or dormant, citing an ADR, or assessing architecture-level risk. States the load-bearing design decisions, their WHY, the hard invariants, and the known-weak points.
---

# PilingTrack Architecture Contract

The load-bearing design decisions of PilingTrack, why they were made, the invariants
that must stay true, and the honestly-stated weak points. Everything here was verified
against the repository on **2026-07-07**. Date-stamped facts can drift — re-verify with
the commands in the final checklist before relying on them.

PilingTrack is a Next.js 16 (App Router) + TypeScript + Prisma 7 + PostgreSQL app for
pile-driving construction reporting, with Redis and background workers, deployed via
Docker Compose on a single VPS (orionpiling.ru). One tenant (`orion`) today; a
hybrid-SaaS go/no-go decision is due 2026-11-24, so multi-tenancy machinery is dormant,
not dead.

## Vocabulary (defined once, used throughout)

| Term | Meaning here |
|---|---|
| **DDD** | Domain-Driven Design — code organized around business domains (bounded contexts) with explicit invariants, not around technical layers. |
| **Bounded context** | A self-contained domain module (`src/modules/<x>`) owning its entities, commands, queries, and events. |
| **CQRS** | Command Query Responsibility Segregation — writes go through commands/aggregates; reads come from separately maintained **read models** (denormalized tables). |
| **Outbox** | Transactional outbox pattern: domain events are written to an `OutboxEvent` DB table in the same transaction as the business write, then a worker publishes them. Guarantees no event is lost if the process dies mid-request. |
| **Projection** | A worker that consumes events and (re)builds read-model tables. |
| **RLS** | PostgreSQL Row-Level Security — per-row access policies enforced by the database itself. |
| **IDOR** | Insecure Direct Object Reference — fetching another tenant's/user's row by guessing or reusing its id. |
| **Facade** | An `index.ts` that only re-exports from another layer, providing a stable import path while the implementation lives elsewhere. |

## Layer map

| Layer | Path | What belongs there | Rule |
|---|---|---|---|
| Domain modules | `src/modules/<x>/` | Bounded contexts: entities with invariants, lifecycle, domain events, commands/queries | First choice for new domain code |
| Legacy/shared services | `src/services/<x>/` | Cross-cutting or not-yet-migrated domain logic (auth, audit, tenancy, telegram, dictionaries) | Fallback when code is genuinely cross-cutting |
| Infrastructure | `src/core/` | `api-wrapper`, security (encryption, refresh tokens), outbox plumbing, event-bus schema registry, observability, realtime server, media/storage | Only true infrastructure; never domain logic |
| API routes | `src/app/api/**/route.ts` | Thin HTTP handlers wrapped in `withApi`/`withMutation`; validation + delegation only | No business logic, no inline CSRF/rate-limit |
| Workers | `src/workers/` | Entrypoints: `outbox-worker.ts`, `projection-worker.ts`, `pdf-worker.ts`, `unified-worker.ts` | Run in the `pilingtrack-workers` container; use Redis leader election so only one instance processes |
| Request middleware | `src/proxy.ts` | Next.js request middleware: nonce-based CSP, security headers | Exports `proxy(request)` + `config` matcher |
| Pure helpers | `src/lib/` | `logger`, `csrf-protection`, `rate-limiter`, `format`, `db` | No side-effectful domain logic |

WHY this split (ADR-0007): without an explicit rule, domain logic leaks into routes,
services start acting like aggregates without invariants, and Prisma queries smear
across layers. The contract: routes stay thin, `modules/*` own invariants, `services/*`
orchestrate, `core/*` knows nothing about the domain.

The quick "where does my new code go" answer lives in **CLAUDE.md** (authoritative);
entity classification (module vs dictionary vs enum) is the **module-vs-dictionary**
skill. This skill explains the *why* and the migration state behind those rules.

### The half-done services→modules migration (state as of 2026-07-07)

The migration was deliberately parked mid-way. **Never start a standalone refactor to
"finish" it.** Finish a domain opportunistically — the next time you substantially
rework it anyway.

| Module | State |
|---|---|
| `modules/reports/` | **Fully migrated — the reference shape.** `domain/` (aggregate, events), `application/` (with `commands/`, `queries/`, `projections/`), `infrastructure/` (repository, prisma mapper). Copy this shape when migrating a domain. |
| `modules/crews/`, `modules/equipment/`, `modules/sites/` | Real DDD layout (`domain/application/infrastructure`), migrated during later feature work. |
| `modules/inspections/`, `modules/monitoring/` | Partial (`application/` + some `domain/`). |
| `modules/users/`, `modules/analytics/`, `modules/telemetry/`, `modules/system/` | **Re-export facades only** — a single `index.ts` re-exporting from `src/services/<x>/`. Add new logic to `services/<x>/` and export it through the facade. |

**Import rule:** callers always import from `@/modules/<x>` (the public boundary),
regardless of where the implementation currently lives. WHY: when a domain finishes
migrating, only the facade changes — zero caller churn.

**Dead-path warning:** `src/modules/reports/api/**` was a stale duplicate of the report
routes and was **removed** (commit `e6ce96b`). The live report routes are
`src/app/api/reports/**`. Do not recreate an `api/` directory inside a module — HTTP
lives in `src/app/api/` only.

## Event pipeline (outbox → projections → read models)

```
domain write (command)                         # e.g. report upsert
  └─ same DB transaction: insert OutboxEvent   # transactional outbox
outbox worker (src/workers/outbox-worker.ts)
  └─ polls OutboxEvent, validates payload against the schema registry
     (src/core/event-bus/schema-registry), emits via the legacy domain-event bus
     (src/services/reports/domain-events.ts)
projection worker (src/workers/projection-worker.ts)
  └─ registerAllEventHandlers() from src/services/reports/event-handlers
  └─ startProjectionWorker() from src/modules/reports/application/projections/
read models (prisma/schema.prisma):
  ReportAnalytics, SiteDailySummary, SiteWeeklyTrend, OperatorPerformance
  (plus DowntimeSummary and ReportStats)
```

- Both workers use **Redis leader election** (`src/core/infrastructure/leader-election`)
  so a restarted or duplicated container never double-processes.
- **Backfill endpoint:** `POST /api/admin/projections/rebuild`
  (`src/app/api/admin/projections/rebuild/route.ts`) calls
  `rebuildOperatorPerformance` / `rebuildSiteDailySummary` / `rebuildSiteWeeklyTrend` /
  `rebuildAll` from `@/modules/reports/application/projections/rebuild`. This is the
  recovery path when read models drift from source-of-truth rows.

**The single event bus (ADR-0006, reversed 2026-05-21):** a "modern" bus in
`core/event-bus/event-bus.ts` (Kafka/NATS adapters, ~947 lines) had **zero production
callers** and was deleted. The legacy bus in `src/services/reports/domain-events.ts` IS
the production bus. `core/event-bus/` keeps only the schema registry. Do not resurrect
the deleted bus from git history; a future Kafka/NATS need means building a new
`event-bus-v3` with a demonstrated caller first.

### Honest weak points of the pipeline (as of 2026-07-07)

- **Completeness historically leaned on backfill.** The projection path had gaps
  (unreachable DLQ and uuid drift fixed in `899cecf`; outbox claim atomicity fixed in
  `7afdb17`), and operators learned to run the rebuild endpoint after anomalies.
  Treat the rebuild endpoint as a legitimate repair tool, not an embarrassment.
- **Tenant context in events.** Outbox events historically carried minimal context;
  projections fall back to `DEFAULT_TENANT_ID`. Commit `c3a1774` fixed the deploy-level
  hole (the app container wasn't receiving `DEFAULT_TENANT_ID`, so fallback writes
  misbehaved). Root-cause hardening — events carrying explicit tenant/actor context —
  is still **OPEN** per the 2026-07-07 data-flow audit, alongside a daily-summary
  wrong-key finding.
- **Deletes reproject since `e79c5da`.** Before that, deleting a report left stale
  aggregate rows in read models.
- **UI vs lag:** a fleet card no longer renders zeros when the analytics projection
  lags behind (`1008ae1`).
- **OPEN:** the nightly `SiteWeeklyTrend` rebuild is wipe-then-rewrite and not
  transactional; combined with prod schema drift (NOT NULL `tenantId`) it has destroyed
  rows on prod before. Incident detail belongs to **pilingtrack-failure-archaeology**;
  the standing risk is recorded here.

## ADRs — the recorded decisions and their WHY

All in `docs/adr/`. Summaries only; read the ADR before overturning anything.

| ADR | Decision | WHY |
|---|---|---|
| **0001** PostgreSQL primary (2026-04-08, Accepted) | Delete SQLite runtime support; PostgreSQL 16+ is the only database. | The dual-runtime union type (`SqlitePrismaClient \| PostgresPrismaClient`) defeated type-checking, required two generated clients and a patch script that broke on Prisma upgrades — ~30% accidental complexity. |
| **0002** Outbox vs Kafka (2026-04-08, Accepted) | Keep polling outbox now; Redis Streams/NATS at >500 events/sec; Kafka only at >5000 events/sec. | Polling is enough for 50–1000 users; the ADR fixes numeric migration triggers (backlog >10k, lag P95 >30s/5min) so nobody "upgrades to Kafka" on vibes. |
| **0003** Sync conflict strategy (2026-04-08, Accepted) | Offline-first hybrid LWW: critical fields (status, date, siteId, userId) server-wins; non-critical client-wins; collections (piles, drillings, downtimes) merge-by-id; otherwise surface a conflict. | Field operators work with unstable connectivity; full CRDT is overkill, pure LWW loses field data — merge-by-id keeps collection entries from both devices. |
| **0004** App Router migration (2026-04-08, marked Superseded in the index) | Replace Zustand-based SPA routing with file-based App Router routes. | The SPA-in-Next.js pattern disabled Server Components, SSR, and per-route code splitting. The migration **shipped** — routes live under `src/app/(app)/` and `src/app/(auth)/`; treat file-based routing as current reality despite the Superseded marker. |
| **0005** Failure Design Documents (2026-04-08, Accepted) | Every new feature writes an FDD section: symptom / risk / required behavior / implementation / guaranteed invariant, each scenario test-covered. | An offline-first field system must be designed around what breaks, not the happy path. |
| **0006** Event system consolidation (2026-04-08, **Superseded — reversed 2026-05-21**) | Original plan: migrate to the modern `core/event-bus`. Reality: the modern bus had zero callers and was deleted; the legacy bus is the single source of truth. | The 2026-05-20 monitoring incident proved the legacy bus ran production fine (the bug was a registration race, not the bus). Don't migrate to unproven code; delete it. |
| **0007** Bounded contexts vs service layer (2026-04-24, Accepted) | The layer contract described in "Layer map" above. | Stop domain logic leaking into routes and services pretending to be aggregates. |
| **0008** DB conventions stay (2026-07-02, Accepted) | Keep cuid string PKs, PascalCase/camelCase SQL identifiers (no `@map`), and no full-text search. | cuid works offline and in workers without a DB round-trip and isn't enumerable (no `id+1` IDOR); renaming 53 models' identifiers would touch every RLS policy and raw query for zero user value; FTS has no consumer (`contains` unused in `src/`). Auditors: cite this ADR instead of reopening these three. Cost accepted: manual SQL needs quotes (`SELECT "tenantId" FROM "Report"`). |

## Security invariants

These must hold. Changing any of them is security-critical work: test-first
(see CLAUDE.md "Security-Critical Code" and the **qa-checklist** skill).

1. **Tenant checks fail closed.** Never write `tenantId IS NULL OR tenantId = ...` in a
   tenant-scoped query — a null tenant then returns EVERY tenant's rows (an IDOR that
   happened live on 2026-05-31). Missing `tenantId` on the caller must throw, not
   pass. Policy implementation: `src/services/auth/resource-access-service.ts`
   (`ensureTenantAccess`); in multi-tenant mode it fails closed on a missing user
   tenantId. See OPEN item 1 below for its known role bypass.
2. **FORCE RLS is on** (migration `20260701020000_force_row_level_security`, deployed
   2026-07-03): 25 tables `FORCE ROW LEVEL SECURITY`, so the table-owner role (which
   the app uses) no longer bypasses tenant policies. Nuance stated in the migration
   itself: the policies are written fail-open when the session var
   `app.current_tenant` is unset — so **the app layer is the primary guard and RLS is
   defense-in-depth**, not the other way round. Tenant context is set per-request via
   `withTenantContext` (`src/services/tenancy/tenant-enforcement-middleware.ts`).
3. **CSRF + rate limiting live in the wrapper, never inline.** `withApi` (GET/query:
   error boundary + HTTP metrics) and `withMutation` (adds `withCsrf` from
   `src/lib/csrf-protection.ts` + a rate limit keyed `route:sessionScope:ip`, default
   100/min) in `src/core/api-wrapper.ts`. Known deviation: the two dormant telemetry
   POST routes (`src/app/api/telemetry/route.ts`, `.../telemetry/batch/route.ts`) call
   `withApi` + inline `withCsrf` with telemetry-specific rate limits. That is the only
   sanctioned exception; do not add more.
4. **JWT + refresh-token families with rotation and reuse detection**
   (`src/core/security/refresh-tokens.ts`): each refresh rotates the token; reuse of a
   revoked token revokes the whole family (compromise detection); total family
   lifetime is capped by `familyCreatedAt` + `REFRESH_TOKEN_FAMILY_TTL_DAYS` (carried
   forward across rotations, so rotation cannot extend a session forever). The
   check-then-revoke race (TOCTOU) was closed with an atomic revoke in `b8a0593`.
5. **WebSocket auth honors `sessionVersion`** (`src/core/realtime/server/auth.ts`):
   the WS token check mirrors `src/lib/auth.ts` — a password/PIN change bumps
   `User.sessionVersion` and instantly invalidates existing WS tokens. Without this,
   force-logout wouldn't reach live sockets.
6. **Encryption keys are versioned** (`src/core/security/encryption.ts`, AES-256-GCM):
   ciphertexts are `enc:<b64>` (legacy) or `enc:v1:<b64>`, `enc:v2:...`; all known key
   versions decrypt (dual-decrypt), only `ENCRYPTION_KEY_VERSION` encrypts. WHY: key
   rotation with zero downtime — old rows keep decrypting while new writes use the new
   key. Used for Telegram bot tokens and similar secrets at rest.
7. **Nonce-based CSP** is built per-request in `buildNonceCsp` inside `src/proxy.ts`
   (the Next.js request middleware). Do not add `unsafe-inline` scripts. The open CSP
   violation on `/monitoring` is owned by the **pilingtrack-csp-monitoring-campaign**
   skill — don't "fix" it ad hoc here.

**Client/server bundle split for report evidence:** report media/evidence code is
deliberately split so server-only logic (hashing, storage access) never enters the
client bundle — the exact contract, and the dormant `ReportPhoto` trap, live in the
**report-evidence-model** skill.

## Dormant-but-alive subsystems — MUST NOT be deleted

These look unused. They are deliberate investments waiting on an external trigger.
Deleting them destroys paid-for work; the **product-bible** skill records the intent.

| Subsystem | Where | Wakes up when |
|---|---|---|
| Telemetry ingest | `src/app/api/telemetry/{ingest,batch}`, `src/services/telemetry/` (incl. MQTT ingestion service), `TelemetryRecord` table (empty) | A telematics box (Teltonika/Galileosky) is physically connected to a rig. Documented in `docs/DATA-SOURCES.md`. |
| Multi-tenancy machinery | `MULTI_TENANT_MODE`, `src/services/tenancy/`, RLS policies, `tenantId` columns everywhere | The hybrid-SaaS decision (due **2026-11-24**). Readiness gaps are cataloged in `docs/strategy/hybrid-tenant-readiness.md` — e.g. `DEFAULT_TENANT_ID=orion` hardcode removal and two-tenant RLS testing are known pre-onboarding blockers, deliberately not built yet. |
| `ReportPhoto` legacy path | `prisma/schema.prisma` model + related code | Never (superseded by `Media`), but removal is a coordinated migration owned by the report evidence domain — see **report-evidence-model**. Don't build new features on it. |

## Known-weak points and OPEN questions (as of 2026-07-07)

State these plainly when they affect your change. OPEN means undecided — do not
"resolve" one silently inside an unrelated PR.

1. **OPEN: `ensureTenantAccess` bypasses the tenant check for ADMIN and DISPATCHER**
   (`src/services/auth/resource-access-service.ts`, the early
   `if (user.role === 'ADMIN' || user.role === 'DISPATCHER') return;`). Undecided
   since 2026-06-28 whether this is intentional platform-admin design or a gap. As of
   2026-07-08: **3 caller files / 4 call sites** — `src/app/api/crews/my/route.ts`,
   `src/app/api/crews/[id]/route.ts`, `src/app/api/reports/single-pdf/route.ts` (2 call
   sites). Verify before quoting: `grep -rn "ensureTenantAccess(" src/`. This is the
   canonical count — other skills should point here rather than restate their own
   number. It **blocks two known IDOR fixes** (media and report history). Any
   multi-tenant onboarding must resolve this first. Get an explicit product decision
   before changing it.
2. **RLS policies are fail-open on an unset session var** (`app.current_tenant` unset
   ⇒ policy allows all rows). Documented as a deliberate scope cut in the FORCE-RLS
   migration header — closing it requires auditing every raw-SQL/admin path. Until
   then: never treat RLS as the primary tenant guard.
3. **Restore drill never run.** Nightly off-site backups to Cloudflare R2 have been
   live since 2026-07-01, but a full restore from R2 has never been rehearsed. The
   backup is unproven until restored once.
4. **PgBouncer sits in the runtime path** (since `6b6a3d7`): app, workers, and ws
   containers connect via `pgbouncer:5432` with `?pgbouncer=true` in `DATABASE_URL`
   (disables Prisma prepared-statement caching — required in transaction-pooling
   mode). Direct `psql` and migrations hit `postgres` directly. When debugging
   connection exhaustion or "prepared statement does not exist" errors, look at
   PgBouncer first.
5. **Data-flow audit 2026-07-07 backlog:** confirmed cross-module bugs (outbox context
   drop, daily-summary wrong key, and others) are queued for an ordered fix-then-deploy.
   Check recent commits before assuming they're still open — symptom triage lives in
   **pilingtrack-debugging-playbook**, incident history in
   **pilingtrack-failure-archaeology**.

## When NOT to use this skill

- **"Where does my new file go?"** — the short answer is in **CLAUDE.md**
  (Project-Specific Guidelines); this skill is the background reasoning.
- **Classifying an entity** (module vs dictionary vs enum) → **module-vs-dictionary**.
- **Domain vocabulary / Russian↔code term mapping** → **domain-glossary**.
- **Deploying** → **deploy** skill; pre-merge checks → **qa-checklist**.
- **Report evidence/photos/history internals** → **report-evidence-model**.
- **Debugging a live symptom** → **pilingtrack-debugging-playbook**; past incidents →
  **pilingtrack-failure-archaeology**.
- **Product scope questions** ("should we build X?") → **product-bible**.

## Invariant checklist

Each statement must remain true. Run the command from the repo root (Git Bash);
expected result in parentheses. If one fails, stop and investigate before building on
this skill's claims.

| # | Invariant | Verify |
|---|---|---|
| 1 | No fail-open tenant queries in source | `grep -rn "IS NULL OR" src --include=*.ts \| grep -vi test` (empty) |
| 2 | CSRF only via wrapper (+ the 2 telemetry exceptions) | `grep -rln "withCsrf" src/app/api` (exactly `telemetry/route.ts` and `telemetry/batch/route.ts`) |
| 3 | `withApi`/`withMutation` still exist as the route contract | `grep -n "export function withApi\|export function withMutation" src/core/api-wrapper.ts` (2 hits) |
| 4 | FORCE RLS migration present; 25 tables forced on prod | `ls prisma/migrations \| grep force_row`; on prod psql: `SELECT count(*) FROM pg_class WHERE relforcerowsecurity;` (25) |
| 5 | Facade modules still re-export from services | `grep -n "@/services/" src/modules/users/index.ts` (non-empty; same for analytics/telemetry/system) |
| 6 | Deleted modern event bus stays deleted | `grep -rln "core/event-bus/event-bus" src` (empty) |
| 7 | Report routes live in app/api, not inside the module | `ls src/app/api/reports` (exists) and `ls src/modules/reports/api` (fails) |
| 8 | Versioned encryption formats supported | `grep -n "enc:v" src/core/security/encryption.ts` (non-empty) |
| 9 | WS auth checks sessionVersion | `grep -n "sessionVersion" src/core/realtime/server/auth.ts` (non-empty) |
| 10 | Refresh-token family TTL anchored at family birth | `grep -n "familyCreatedAt" prisma/schema.prisma` (non-empty) |
| 11 | Dormant telemetry ingest still present | `ls src/app/api/telemetry/ingest` (exists) |
| 12 | Projection backfill endpoint present | `ls src/app/api/admin/projections/rebuild/route.ts` (exists) |
| 13 | OPEN item 1 unchanged (role bypass not silently altered) | `grep -n "user.role === 'DISPATCHER'" src/services/auth/resource-access-service.ts` (1 hit; if gone, the OPEN decision was made — update this skill) |
| 14 | Read models exist in schema | `grep -cE "model (ReportAnalytics\|SiteDailySummary\|SiteWeeklyTrend\|OperatorPerformance)" prisma/schema.prisma` (4) |

## Provenance and maintenance

Written 2026-07-07 from direct inspection of: `docs/adr/0001`–`0008`, `CLAUDE.md`,
`prisma/schema.prisma`, `prisma/migrations/20260701020000_force_row_level_security/`,
`src/core/api-wrapper.ts`, `src/proxy.ts`, `src/core/security/{encryption,refresh-tokens}.ts`,
`src/core/realtime/server/auth.ts`, `src/services/auth/resource-access-service.ts`,
`src/workers/*.ts`, `src/modules/*` layout, `docker-compose.yml`,
`docs/DATA-SOURCES.md`, `docs/strategy/hybrid-tenant-readiness.md`, and git history
(`e6ce96b`, `c3a1774`, `e79c5da`, `1008ae1`, `899cecf`, `7afdb17`, `b8a0593`, `6b6a3d7`).

To re-verify: run the invariant checklist above (2 minutes). Update triggers:
- A domain finishes the services→modules migration → update the migration-state table.
- The hybrid-SaaS decision lands (due 2026-11-24) → rewrite the multi-tenancy dormancy
  and OPEN items 1–2.
- Any OPEN item closes → move its story to **pilingtrack-failure-archaeology** and
  delete it here.
- A new ADR appears in `docs/adr/` (`ls docs/adr`) → add a summary row.
