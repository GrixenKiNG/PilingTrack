---
name: pilingtrack-research-frontier
description: PilingTrack's three candidate frontier directions — provable data trust, hybrid multi-tenant SaaS, and telemetry-driven predictive maintenance. Use when deciding what to build next beyond routine work, evaluating whether a research idea or optimization is worth pursuing, picking a strategic direction, or asked "what's the state of the art here" / "what should this project push on next".
---

# PilingTrack — Research Frontier

Written 2026-07-08. Every asset claim below was verified by reading the cited
file, commit, or doc on that date — see "Provenance and maintenance" for the
re-verification commands. Anything phrased in future tense (a metric that
doesn't exist yet, a test suite not yet written) is a **candidate**, not a
fact — do not act as if it's already true.

This skill answers one question: **where can this project push past what a
typical small-contractor ops tool does, using an asset that already exists
here?** It is deliberately narrow — three directions, owner-selected, not an
open brainstorm. If you were sent here to find *any* good idea, that's the
wrong tool; see "When NOT to use" below.

## Vocabulary (defined once)

- **Projection** — a denormalized read-model table rebuilt asynchronously
  from the `Report` source of truth via the **outbox**. Full definition:
  `pilingtrack-architecture-contract` Vocabulary.
- **RLS** (Row-Level Security) — a Postgres feature enforcing a
  `tenantId`-matching policy at the database layer. Full definition:
  `pilingtrack-architecture-contract` Vocabulary.
- **Dormant** (not dead) — code that is wired and reachable but produces no
  data yet because an external precondition is missing. Telemetry ingestion
  is dormant because no physical box is connected; deleting dormant code is
  a product decision, never a cleanup one (see `product-bible`).
- **CMMS** — Computerized Maintenance Management System: the ТО (maintenance)
  module here — plans, meter readings, work orders, inspections.

## When NOT to use

- **Scoping ordinary feature work, or judging what's in/out of scope right
  now** → `product-bible` is the actual source of truth for current priority
  (finishing ТО P1b→P5) and hard non-goals. This skill's directions are
  candidates for *later*; they do not override the current priority.
- **You have a hunch and want to know if it's real** → `pilingtrack-research-methodology`
  owns the evidence bar (one mechanism explains all observations, survives
  adversarial refutation) and the hunch→spec→plan→deploy-or-retire lifecycle.
  This skill only proposes *what* to investigate, not how to validate it.
- **You need the actual measurement tool** (a script, an endpoint, a query) →
  `pilingtrack-diagnostics-and-tooling` (the runnable inventory: `/api/health`,
  `/api/metrics`, the projection-completeness SQL, load tests, GitNexus).
- **You need a proof recipe** (how to demonstrate an IDOR, a race, a slow
  query, a restore) → `pilingtrack-proof-and-analysis-toolkit`.
- **Routine bugfixing with a known symptom** → `pilingtrack-debugging-playbook`
  maps symptom → check → fix directly.
- **Pre-merge/pre-deploy mechanics, migrations, config, security review** →
  `qa-checklist`, `deploy`, `create-migration`, `pilingtrack-config-and-flags`,
  `security-reviewer`, `pilingtrack-change-control` respectively.
- **Writing tests for something a direction below produces** →
  `pilingtrack-testing-and-evidence` (test taxonomy + the keep-tests-lean
  constraint apply to frontier work exactly as they do to everyday work).

---

## Direction 1 — Provable data trust ("stability as a product")

### SOTA gap

Most small-to-mid ops/BI dashboards run on an eventually-consistent
write→projection pipeline (CQRS, ETL, or a nightly batch job) and expose no
signal for *how eventually*. When the projection lags or silently drops a
row, the dashboard doesn't show "data incomplete" — it shows a number, and
the number is wrong low. Nobody outside a large-scale data-eng org routinely
publishes a completeness metric for this; it's treated as an implementation
detail rather than a product property. (This framing of the wider industry
is an informed claim, not something verified from this repo — treat it as
context, not as a cited fact.)

### Our asset (verified)

- **The pipeline is real and already instrumented.** `OutboxEvent`
  (`prisma/schema.prisma` ~L926-950) has `published`/`projected` booleans,
  `attempts`, and `nextRetryAt`; a projection worker consumes it and rebuilds
  `ReportAnalytics`/`ReportStats`/`SiteDailySummary`/`SiteWeeklyTrend`. A
  manual backfill exists: `POST /api/admin/projections/rebuild?name=all`
  (`src/app/api/admin/projections/rebuild/route.ts`, logic in
  `src/modules/reports/application/projections/rebuild.ts`).
- **`/api/metrics` is a live, extensible Prometheus endpoint** (verified by
  reading `src/app/api/metrics/route.ts`), already exposing
  `outbox_lag_seconds`, `outbox_pending_count`, `projection_lag_seconds`,
  and `dlq_pending_count` via `src/core/observability/lag-monitor.ts`. Each
  metric section is a self-contained `try/catch` block appended to `output`
  — a new gauge is additive, not a rewrite.
- **A nightly safety net already exists but doesn't measure drift.**
  `src/workers/unified-worker/projection-rebuild-scheduler.ts` runs
  `rebuildAll()` once at startup and once every 24h unconditionally — it
  logs `rows` written (from `rebuildAll()`'s return value) but never
  compares that number to what was there *before* the rebuild, so a
  systemic gap and a no-op rebuild look identical in the log today.
- **A projection-completeness SQL script already exists, drafted but never
  run or committed.** `.claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql`
  — 8 read-only `SELECT` sections (row-count parity, missing/orphaned
  `ReportAnalytics`/`ReportStats`, `SiteWeeklyTrend` week coverage, outbox
  backlog, DLQ status). It sits under `.claude/`, which `.gitignore` line 76
  excludes wholesale — unlike the rest of the skill library, this one file
  was never `git add -f`'d, so `git ls-files` doesn't show it even though it's
  on disk. Its own header notes: **status "dry" — authored and read, never
  executed against a database.**
  Run it: `docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test < .claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql`
- **A real caught case, not a hypothetical.** Commit `1008ae1` (2026-07-07)
  fixed a fleet card rendering "active" with all-zero metrics when its
  projection row was missing (full incident: `pilingtrack-failure-archaeology`
  D2). This is the *symptom*; Direction 1 is about measuring the
  *underlying* projection gap so this class of bug surfaces before a user
  sees a wrong number, not after.
- **Backups are real; restores are unproven.** `scripts/backup-postgres.sh`
  pushes nightly dumps to Cloudflare R2 via `rclone` (confirmed working
  2026-06-27, per `docs/runbooks/006-postgres-backup-restore.md`). But
  **PITR is currently disabled** — `docs/runbooks/009-pitr-restore.md`
  states plainly: `archive_mode=off` since 2026-06-24 (after a broken
  `archive_command` filled the disk with 9.6 GB of un-recycled WAL), so
  second-level recovery is **not available today**; real RPO is ~24h via the
  nightly logical dump. The runbook's own words: *"A backup you never
  restore is not a backup — it's a hope."* No restore into a throwaway DB
  has been recorded anywhere in this repo's docs.
- **The honesty doctrine is documented and current.** `docs/DATA-SOURCES.md`
  (updated 2026-06-20): verdict "no data fabrication anywhere"; every
  placeholder (`EquipmentPlaceholder`, the `notifyEmail` stub) is
  intentional and labeled. Direction 1 extends this doctrine from "no fake
  numbers" to "a measured bound on how current the real numbers are."

### First three steps

1. **Run the SQL script that already exists — it has never produced a real
   number.** `docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test < .claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql`
   against the local prod-snapshot DB. Read the output against the script's
   own "Healthy:" comments. Then fix its git status: either `git add -f`
   it like the rest of the skill library, or move it to `scripts/` where
   `.gitignore` won't swallow it — right now it is invisible to `git log`
   and to anyone who doesn't already know it's there.
2. **Turn sections 1-5 of that script into a gauge in `/api/metrics`.**
   Add a new `try/catch` block to `src/app/api/metrics/route.ts` (mirror the
   existing `backup_age_hours`/`dlq_pending_count` blocks) exposing
   something like `projection_missing_rows{table="ReportAnalytics"}` and
   `projection_orphaned_rows{table="ReportAnalytics"}`. Put the query logic
   in a new function in `src/core/observability/` (mirror the shape of
   `lag-monitor.ts`) rather than inline SQL in the route — keeps the route
   thin and the query testable.
3. **Make the existing nightly job measure drift, not just rebuild blind.**
   `src/workers/unified-worker/projection-rebuild-scheduler.ts`'s `runOnce()`
   already calls `rebuildAll()` and gets back `rowsWritten` per projection —
   add a `SELECT count(*)` snapshot *before* the rebuild and log/emit the
   delta as the drift number, instead of only logging the post-rebuild total.
   This is additive to a file that already runs on a schedule; it does not
   require new infrastructure. Then, separately and only once step 1-2 give
   you a clean baseline: perform the **first restore drill** — restore the
   latest nightly dump (runbook 006) into a throwaway local DB and diff row
   counts against the source; this is the realistic first drill today since
   PITR itself is off (runbook 009).

Steps 2-3 are code changes — route them through `qa-checklist` +
`pilingtrack-change-control` before shipping, and remember deploy is
operator-driven. These are candidates only; do not start ahead of the
current ТО priority (`product-bible`).

### You have a result when…

Reconciliation (the drift number from step 3) reports **zero unexplained
drift for 30 consecutive nightly runs** — "unexplained" meaning any
non-zero the script's own sections classify as a known, already-tracked
failure mode (e.g. a DLQ item already flagged) doesn't count against the
streak — **and** a timed restore-into-throwaway-DB completes with exact
row-count parity against the source dump for every table the SQL script
checks. Until both hold, "the data is trustworthy" is an assertion, not a
result, per this project's own evidence bar (`pilingtrack-research-methodology`).

### Wrong paths

- Building a bespoke consistency-checking framework before running the one
  SQL script that already exists and has never been executed.
- Treating `POST /api/admin/projections/rebuild` as *the* fix for a
  systemic gap — the diagnostics skill already warns this has historically
  been leaned on to paper over a worker bug rather than root-causing it.
- Attempting to re-enable WAL archiving/PITR before a single logical-dump
  restore drill has succeeded — fix the layer that's supposed to already
  work before adding the fancier one back.
- Fabricating a synthetic outbox failure to "test" the reconciliation job.
  This project's own retirement ledger exists because of exactly this
  mistake with telemetry (`f320e53` — simulated evidence is not evidence);
  use real historical gaps (the DLQ, real projection lag under real load).
- Building any billing/usage-metering feature under the "data trust" banner
  — out of scope regardless (see Direction 2's non-goals).

---

## Direction 2 — SaaS for the piling industry

### SOTA gap

The claim that this niche (Russian-market piling/foundation contractors)
lacks a dedicated multi-tenant ops platform is an **informed assumption**,
not something this repo can verify — no competitor audit exists in this
codebase. Treat "no real multi-tenant ops platform in this niche" as the
working hypothesis for why this direction might matter, not a proven fact.
What *is* verifiable is the readiness gap on our own side, below.

**Absolute constraint:** `product-bible` owns product scope and its
guardrails are not optional here. Tenant focus is **Orion-only through
~2026-11**; the hybrid-vs-sunset decision is dated **2026-11-24**; billing,
self-service registration, and tenant onboarding UI are explicit non-goals
until that decision. Nothing in this direction authorizes building any of
those now.

### Our asset (verified)

- **Tenancy and RLS are live in prod, not speculative.** Migrations
  `20260425000000_enable_rls_foundation`, `20260516100000_extend_rls_tenant_scoped`,
  `20260603120100_checklist_engine_rls`, `20260701020000_force_row_level_security`
  (FORCE RLS — even the table-owner DB role can't bypass it), and
  `20260702000000_drop_stray_rls_tenant_outbox` all exist in
  `prisma/migrations/`. `DEFAULT_TENANT_ID=orion` is live in
  `.env`/`.env.production`; single-tenant shakeout is the current mode.
- **The readiness checklist is already written and current.**
  `docs/strategy/hybrid-tenant-readiness.md` lists every 🔴 blocker (remove
  the `DEFAULT_TENANT_ID` hardcode; verify RLS on the top-20 tables with a
  real two-tenant test; build a tenant-creation endpoint) and 🟡/🟢 debt
  items, explicitly dated to the 2026-11-24 decision, with a "what we are
  NOT doing today" list (tenant signup UI, billing, self-service
  provisioning, multi-region, tenant feature flags, pricing pages).
- **A real, deliberate, unresolved architecture question sits in the
  security layer.** `src/services/auth/resource-access-service.ts`
  `ensureTenantAccess()` (L75-99): `if (user.role === 'ADMIN' || user.role
  === 'DISPATCHER') return;` — ADMIN and DISPATCHER unconditionally bypass
  every tenant check, before the multi-tenant-mode check even runs. This
  was flagged, not fixed, in the 2026-06-28 security pass: is it
  intentional platform-admin design, or a gap that only matters once tenant
  2 exists? Current call-site count is owned by
  `pilingtrack-architecture-contract` §"Known-weak points" item 1 (3 caller
  files / 4 call sites as of 2026-07-08: `src/app/api/crews/my/route.ts`,
  `src/app/api/crews/[id]/route.ts`, `src/app/api/reports/single-pdf/route.ts`)
  — a small, enumerable blast radius today, though it will grow as more
  resource types add tenant checks. (`crew-command.service.ts` mentions the
  function only in a comment, not a call — it uses `requireTenantCrew`
  instead.)
- **The existing isolation test does not prove isolation.**
  `tests/integration/tenant-isolation.spec.ts` exists, but per its own
  docstring (quoted in `pilingtrack-testing-and-evidence`): *"These tests do
  not boot a real database. They exercise the helpers in isolation against
  deterministic inputs and mock the Prisma transaction surface."* There is
  no Postgres-backed multi-tenant integration harness in this repo today —
  a real RLS test (two tenants, real DB, cross-access matrix) does not
  exist yet.

### First three steps

1. **Prepare — not decide — the ADMIN/DISPATCHER bypass design memo.**
   Enumerate every call site above plus any equivalent inline
   `role === 'ADMIN' || role === 'DISPATCHER'` bypass pattern elsewhere
   (`grep -rn "'ADMIN'.*'DISPATCHER'\|'DISPATCHER'.*'ADMIN'" src/`). Write
   up both readings — intentional platform-admin design vs. an
   under-specified gap — with the blast radius and a recommended default,
   and stop there. This is explicitly an owner decision (per project
   memory and the 2026-06-28 security pass which deliberately left it
   unfixed); a session's job is the memo, not the verdict. Natural home:
   `docs/adr/` (see `pilingtrack-docs-and-writing` for the ADR template) or
   next to `docs/strategy/hybrid-tenant-readiness.md`.
2. **Build the cross-tenant isolation test the readiness doc itself calls
   for** — a real Postgres-backed suite: two seeded tenants, log in as
   each, assert tenant A's queries return zero tenant-B rows, across the
   top-20 tables by read/write volume. Since no DB-backed integration
   harness exists yet, this is two sub-steps: stand up a minimal one
   (the closest existing template for "real DB, real HTTP" is
   `scripts/smoke-auth-access.js`, which already boots the built server
   against a real seeded DB) before writing the matrix on top of it.
   Justify the new test file under the keep-tests-lean rule the same way
   `pilingtrack-testing-and-evidence` already does for security/tenant
   guards: "always justified, new file allowed if no existing home fits."
3. **Walk the readiness doc's 🔴 blockers in the order it already lists
   them** — mandatory `tenantId` at the Zod boundary (removing the silent
   `DEFAULT_TENANT_ID` fallback), then the top-20-table RLS audit, then the
   `POST /api/admin/tenants` onboarding endpoint — before drafting an
   onboarding runbook for a real second tenant. The readiness doc's own
   "When to revisit" section says this order; don't reorder it to build
   the exciting parts (onboarding UI) before the boring blockers.

Steps 2-3 are code/schema changes — route them through `qa-checklist` +
`pilingtrack-change-control` (a new tenant-scoped migration also needs
`create-migration`) before shipping, and remember deploy is operator-driven.
These are candidates only; do not start ahead of the current ТО priority
(`product-bible`).

### You have a result when…

A second tenant runs live in production with: the ADMIN/DISPATCHER
question resolved by an explicit owner decision (not defaulted by
inaction), a passing real-DB cross-tenant isolation matrix across the
top-20 tables, and a standing audit query —
`SELECT count(*) FROM "<table>" WHERE "tenantId" != current_setting('app.tenant_id')`
run under each tenant's session — returning **zero** rows for every
audited table, for 30 consecutive days post-onboarding.

### Wrong paths

- Building billing, invoicing, self-service registration, or a tenant
  signup UI now — explicit non-goals until the 2026-11-24 decision,
  regardless of how "SaaS-shaped" this direction sounds.
- Deciding the ADMIN/DISPATCHER bypass unilaterally inside an
  implementation session — it needs an explicit owner call; ship the memo,
  not a silent fix or a silent leave-as-is.
- Removing or "simplifying away" tenancy/RLS code — an explicit
  `product-bible` guardrail regardless of how the 2026-11-24 decision goes.
- Building sub-domain routing, wildcard certs, or DNS automation before a
  second tenant is even confirmed — the readiness doc explicitly defers
  this ("path prefix is fine for the first 1-2 tenants").
- Treating the existing mocked `tenant-isolation.spec.ts` as if it already
  proves DB-level isolation — it doesn't touch a real database.

---

## Direction 3 — Telemetry + predictive maintenance (ТО)

### SOTA gap

The claim that calendar-based maintenance dominates this niche, meter-based
scheduling is rarer, and predictive maintenance is essentially absent among
small piling contractors is an **industry-general claim**, not something
verified from this repo — there is no competitor data here. What's
verifiable is that this project already has more of the *plumbing* for
meter-based and eventually predictive maintenance than a typical
small-contractor tool would, below.

### Our asset (verified)

- **A dormant but fully wired telemetry ingest path — three real routes.**
  `src/app/api/telemetry/route.ts`, `batch/route.ts`, and `ingest/route.ts`
  (device-key auth via `X-Device-Key` header,
  `src/services/telemetry/device-key-service.ts`). Device provisioning
  already has an admin route: `src/app/api/equipment/[id]/device-keys/route.ts`.
  A dormant MQTT path also exists (`src/services/telemetry/mqtt-ingestion-service.ts`
  — deliberately excluded from the coverage report, per
  `pilingtrack-testing-and-evidence`, because it trips a coverage-remapper
  parse error, not because it's untested by policy).
- **The data model already anticipates real hardware, not a toy schema.**
  `prisma/schema.prisma`: `TelematicsDevice` (L547-598, with a
  `PROVISIONED → ACTIVE → DEGRADED → OFFLINE → ARCHIVED` lifecycle enum,
  provider enum for `TELTONIKA_FMC640`/`GALILEOSKY_7X`/etc., and reserved
  PULL-mode fields for future OEM cloud polling), `DeviceKey` (L507-531,
  supports key rotation via an optional `telematicsDeviceId` link), and
  `TelematicsDeviceAssignment` (L624+, an append-only history of which box
  was on which rig and when — built for the "whose data was this" audit
  question before it's ever needed).
- **The simulator was deliberately removed, and the reason is on record.**
  Commit `f320e53` (2026-05-17, 785 deletions): *"revert(telemetry): drop
  simulator + Leaflet map MVP."* The do-not-retry condition, stated in
  `pilingtrack-research-methodology`: only real hardware producing real
  telemetry counts as evidence for this direction; a map animated by fake
  data proves nothing about the product.
- **A complete CMMS module already exists in prod, not a stub.** Verified
  by file inventory: `src/modules/equipment/application/commands/meter-reading.ts`,
  `maintenance-plan.ts`, `pm-scheduler.ts` (preventive-maintenance
  scheduler), `equipment-maintenance.ts`; `src/lib/maintenance-due.ts`;
  `src/components/piling/maintenance/work-order-logic.ts` (+ its own test
  file); the inspections module
  (`src/modules/inspections/application/commands/inspection-commands.ts`).
  Engine-hours are already captured from shift reports today (not from
  telemetry) — referenced across `report-form.tsx`,
  `use-report-form.ts`, and `equipment-analytics-service.ts`.
- **A verified, concrete whitelist gap — not a vague "telemetry needs
  work."** The HTTP ingest route's `validTypes` array
  (`src/app/api/telemetry/ingest/route.ts` L229-248) does **not** include
  `machine_state` or `fuel_total`. Yet `getTelemetryAnalysis()` in
  `src/services/telemetry/telemetry-ingestion-service.ts` (L422) already
  filters query results by `g.type !== 'machine_state'`, treating that type
  as an expected, already-flowing signal — and the equipment-monitoring UI's
  `PARAM_SPECS` (`src/components/piling/admin-equipment/detail/equipment-monitoring.tsx`
  L42+) defines thresholds for parameter types (`engine_rpm`, `fuel_rate`,
  and others) that the ingest whitelist and the ingestion service's
  `TelemetryType` union (L35-42, currently only 7 types) don't yet cover
  either. A device sending any of these types today gets rejected by the
  HTTP validator (fails closed — 400, not corrupted data — but still a real
  gap to close before a box's first real batch). **Not independently
  re-confirmed this session:** a "GPS coordinates defaulting to 0" issue
  noted in prior project memory — the current `validateTelemetry()` only
  rejects out-of-range lat/lon, it does not special-case `0`; treat that
  specific claim as reported, not verified, until checked against a real
  device's actual payload shape.

### First three steps

1. **Write down the first-device connection protocol as it exists TODAY.**
   Document, from the code (not from what's planned): how a `DeviceKey` is
   provisioned (`POST /api/equipment/[id]/device-keys`), the two real
   ingestion surfaces and their auth (`X-Device-Key` header on
   `/api/telemetry/ingest`; the dormant MQTT path), and the
   `TelematicsDevice` status lifecycle it will move through. Home: a new
   runbook or ADR (`pilingtrack-docs-and-writing` owns the template) — so
   the day a real Teltonika/Galileosky box ships, the first integration
   session isn't reverse-engineering ingestion code cold.
2. **Close the two verified whitelist gaps before a real box's first
   batch.** Add `machine_state` and `fuel_total` (and the other
   `PARAM_SPECS` types not yet covered) to `validTypes` in
   `src/app/api/telemetry/ingest/route.ts` and to the `TelemetryType` union
   in `src/services/telemetry/telemetry-ingestion-service.ts`. Add a
   focused regression test at the HTTP-route level (that file already has
   test infrastructure; the ingestion-*service* file is the one excluded
   from coverage, not the route) — one test per newly-accepted type is
   filler; one test asserting the whitelist and `PARAM_SPECS` keys stay in
   sync is the actually load-bearing guard. Independently verify (don't
   assume) whether GPS-zero is a real issue once a target device's payload
   format is known. Telemetry ingest sits behind device-key auth — apply
   the security-critical test-first gate (`pilingtrack-change-control`
   §2.3) even for a whitelist-only change.
3. **Once any device exists, cross-validate telemetry `engine_hours`
   against the shift-report `engine_hours` already captured today** — same
   equipment, same day, compute a % divergence, and log/emit it as a
   metric. This is explicitly the *first* signal to build, before any
   predictive-maintenance logic: it tells you whether the telemetry number
   can be trusted at all before anything is built on top of it.

Steps 2-3 are code changes — route them through `qa-checklist` +
`pilingtrack-change-control` before shipping, and remember deploy is
operator-driven. These are candidates only; do not start ahead of the
current ТО priority (`product-bible`).

### You have a result when…

At minimum, the honest prerequisite milestone: **one real `TelematicsDevice`
reaches `status = ACTIVE`** (not `PROVISIONED`) **and produces ≥7
consecutive days of `engine_hours` telemetry whose daily total diverges by
less than 10% from that same equipment's shift-report `engine_hours` for
the same day, for at least one rig.** Only once that holds does it become
meaningful to state the fuller goal: a meter-based ТО trigger from
`pm-scheduler.ts` fires from live telemetry and matches a manually-logged
due date within an agreed tolerance. Treat the first milestone as the
falsifiable checkpoint — if divergence stays high, the mechanism (which
signal, which device, which unit conversion) needs to be found before
scheduling anything off of it.

### Wrong paths

- Reviving a simulator "just to demo the dashboard to the owner" — this was
  retired for a stated reason (`f320e53`); the do-not-retry condition is
  real hardware, full stop.
- Deleting the dormant telemetry code, tables, or the MQTT path as
  "unused" — an explicit `product-bible` guardrail; dormant ≠ dead.
- Building any predictive-maintenance model before a single day of real
  `engine_hours` telemetry exists to validate against.
- Treating the whitelist fix as complete without a test that pins the
  `validTypes`/`TelemetryType`/`PARAM_SPECS` keys against each other — this
  exact class of drift (three lists that are supposed to agree, quietly
  diverging) is how the `machine_state`/`fuel_total` gap happened in the
  first place.
- Fighting the coverage tool's parse-error exclusion on
  `mqtt-ingestion-service.ts` — it's a known, accepted exclusion, not a
  bug to "fix" by restructuring the dormant MQTT code.

---

## Cross-direction notes

- All three directions are candidates for **after** the current priority
  (finishing the ТО module, per `product-bible`), not a reason to pause it.
  If asked "what next," the honest answer is still ТО P1b unless the owner
  has explicitly said otherwise.
- None of the three milestones is close to being met today (2026-07-08) —
  this skill documents *where the leverage is*, not a claim that any
  direction is nearly done.
- If a direction's asset turns out to be stale on re-verification (a file
  moved, a migration got reverted, the 2026-11-24 decision landed), fix
  this file in the same change rather than letting it drift — this project
  treats stale strategy docs as a real risk (see the audit-lifecycle
  policy in `pilingtrack-research-methodology` §7).

## Provenance and maintenance

Written 2026-07-08 from repository ground truth; every path, commit, and
line-range citation above was read directly on that date. Re-verify with
(Git Bash, from repo root):

```bash
# Has the hybrid-vs-sunset decision landed? (governs whether Direction 2 is
# still "prepare a memo" or "the decision is made, act on it")
grep -n "Decision date" docs/strategy/hybrid-tenant-readiness.md
date +%F   # if this is at/after 2026-11-24, check with the owner directly —
           # this file will not know the outcome until updated

# Direction 1 — pipeline, metrics, script, PITR status
git show -s --format='%h %ad %s' --date=short 1008ae1
grep -n "outbox_lag_seconds\|dlq_pending_count\|projection_lag_seconds" src/app/api/metrics/route.ts
ls .claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql
grep -n "СЕЙЧАС НЕДОСТУПЕН\|archive_mode" docs/runbooks/009-pitr-restore.md
grep -n "runOnce\|rebuildAll" src/workers/unified-worker/projection-rebuild-scheduler.ts

# Direction 2 — tenancy, RLS, the open bypass question
ls prisma/migrations | grep -i rls
grep -n "ADMIN.*DISPATCHER bypass" src/services/auth/resource-access-service.ts
grep -rln "ensureTenantAccess" src/app src/modules
grep -n "does not boot a real database" tests/integration/tenant-isolation.spec.ts

# Direction 3 — telemetry surfaces, whitelist gap, CMMS inventory
git show -s --format='%h %ad %s' --date=short f320e53
grep -n "machine_state\|fuel_total" src/app/api/telemetry/ingest/route.ts
grep -n "type !== 'machine_state'" src/services/telemetry/telemetry-ingestion-service.ts
ls src/modules/equipment/application/commands/ src/components/piling/maintenance/
```

If any command above disagrees with a claim in this file, the claim is
stale — update this file in the same change rather than trusting memory,
and prefer removing an unverifiable claim over leaving it uncorrected.

**Unverifiable in this pass (labeled, not asserted as fact):**
- The broader industry-SOTA framing for all three directions (no
  competitor/market data exists in this repo).
- The "GPS coordinates defaulting to 0" telemetry issue (Direction 3) —
  reported in prior project memory, not independently reproduced against
  current code in this session.
- The exact call-site count for the ADMIN/DISPATCHER tenant bypass beyond
  the four verified above — prior project memory cites a larger number;
  re-run the grep above before quoting a specific count.
