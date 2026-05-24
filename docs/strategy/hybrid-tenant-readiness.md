# Hybrid-tenant readiness checklist

| Metadata | Value |
|---|---|
| **Strategy** | Hybrid — Orion + 1–2 friendly tenants for shakeout |
| **Decision date** | 2026-11-24 (continue to SaaS or sunset multi-tenancy) |
| **Today's tenant count** | 1 (orion) |

This document lists what's currently OK because we have one tenant
(`orion`) and what will need to be done **before** onboarding a second.
Nothing here is built today — that's deliberate (don't pay for what
you don't need). The list exists so the work is visible when the moment
arrives.

Severity legend:
- 🔴 **blocker** — without this the second tenant cannot be onboarded
  at all
- 🟡 **first-week debt** — onboardable, but pain by week 2 if not
  addressed
- 🟢 **nice-to-have** — quality-of-life; not strictly required

---

## Tenant identity & data isolation

### 🔴 Remove `DEFAULT_TENANT_ID=orion` hardcode

**Current state:** `.env` and `.env.production` pin
`DEFAULT_TENANT_ID=orion`. Every write path that doesn't explicitly carry
`tenantId` falls back to this constant. The single-tenant prod was
silently leaving rows with `tenantId=NULL` until we plugged the upsert
hole in `2026-04-XX`.

**What to do:** make `tenantId` mandatory at the boundary (Zod schemas
reject the request if missing) and remove the default. Sweep every write
in `src/modules/` and `src/services/` that touches `tenantId`.

### 🔴 Verify RLS policies are tenant-aware on every table

**Current state:** RLS foundation lives in
`prisma/migrations/20260425000000_enable_rls_foundation`. It's enabled
on the core tables but has never been tested with two tenants in the
same DB.

**What to do:**
1. Pick the top-20 tables by read/write volume and audit their RLS
   policies for `USING (tenantId = current_setting('app.tenant_id'))`.
2. Write a test that creates two tenants, logs in as each in turn,
   and asserts a query for tenant A returns 0 rows from tenant B.
   Put it in CI under integration tests.

### 🟡 Audit log includes `tenantId` consistently

**Current state:** `src/services/audit/` writes events with `tenantId`
on the actor, but not always on the target. With one tenant we can't
tell whether two-tenant audit reads will work.

**What to do:** add `tenantId` to every audit event payload + an index
on `(tenantId, createdAt)` once we see real cross-tenant query patterns.

---

## Tenant lifecycle

### 🔴 Tenant creation flow

**Current state:** No tenant onboarding endpoint, no UI. The only
"tenant" was created manually via SQL when prod went live.

**What to do:** an admin-only endpoint `POST /api/admin/tenants` that:
1. Inserts a `Tenant` row with name + slug
2. Creates an initial admin user for that tenant
3. Optionally provisions per-tenant resources (S3 bucket prefix,
   Telegram bot config slot)

UI can come later — for the first two tenants we can use the API
directly.

### 🟡 Tenant slug routing

**Current state:** Single hostname `orionpiling.ru`. No path-based
tenant routing.

**What to do:** decide between:
- **Sub-domain per tenant** (`orion.pilingtrack.ru`,
  `acme.pilingtrack.ru`) — clean, but needs wildcard cert from Caddy
  and DNS automation
- **Path prefix** (`/t/orion`, `/t/acme`) — works without DNS changes
  but uglier URLs

For the first 1–2 friendly tenants, path prefix is fine. Revisit if
SaaS happens.

### 🟢 Tenant suspension

**Current state:** No way to disable a tenant without deleting their
data.

**What to do:** add `Tenant.status` enum (`active` / `suspended`).
Suspended tenants get 403 on every API call until reactivated.

---

## Operational concerns

### 🟡 Per-tenant resource limits

**Current state:** Rate limits are per-IP. Database connection pool
is global.

**What to do:** rate-limit per `(tenantId, route)` so a busy tenant
can't starve others. Bullmq queues already partition by job ID, so
PDF generation is fine.

### 🟡 Per-tenant disk usage visibility

**Current state:** No dashboard for "how much disk is tenant X using
on S3 / Postgres".

**What to do:** add per-tenant counters to the existing Grafana board.
Important once a tenant approaches the VPS's 30 GB ceiling.

### 🟢 Per-tenant backup

**Current state:** `pg_dump` is whole-DB. PITR base backups are
whole-DB. Both restore the entire database.

**What to do:** `pg_dump --table` filters by tenant or per-tenant
snapshot script. Not urgent — restore-whole-DB is acceptable for the
first phase.

---

## Billing & legal

### 🔴 Decide what's billable (only if going SaaS)

**Current state:** Orion is internal — no billing infrastructure.

**What to do:** before the second tenant pays, decide:
- Pricing model (per-user / per-site / flat)
- Billing backend (Stripe / YooKassa / manual invoice)
- Tax handling (РФ НДС for Russian customers)

If second tenant is free (shakeout), defer this entirely.

### 🟡 Terms of service / privacy policy

**Current state:** Internal product, no public TOS.

**What to do:** even a friendly second tenant needs a one-page
agreement that defines: data ownership, SLA (or lack thereof), exit
procedure. Get a lawyer to look once before you have more than one
tenant.

### 🟢 152-ФЗ persistence

**Current state:** Single tenant, owner is the data controller.

**What to do:** with multiple tenants, you become the data **processor**
for each. Reading 152-ФЗ on processor obligations becomes mandatory.

---

## Engineering hygiene

### 🟡 Code paths that assume single tenant

**Search-and-destroy targets** when adding tenant 2:
- `grep -rn "tenantId.*orion" src/` — any hardcoded constants
- `grep -rn "DEFAULT_TENANT_ID" src/` — fallback paths
- `grep -rn "where:.*tenantId" src/modules/` — verify every write
  passes the actor's tenant, not a default

### 🟡 Tests that assume single tenant

Integration test suites currently set up a single tenant. Add a
multi-tenant fixture and at least one cross-tenant isolation test
per feature module.

---

## What we are NOT doing today

Listed here so they don't accidentally land via scope creep:

- ❌ Tenant signup UI
- ❌ Billing integration
- ❌ Self-service tenant provisioning
- ❌ Multi-region deployment
- ❌ Tenant-scoped feature flags
- ❌ Pricing page / public marketing site

These all wait until **after** we know whether SaaS is the direction
(decision: 2026-11-24).

---

## When to revisit this document

- A second tenant is requested / committed to → walk the 🔴 blockers
  first, then the 🟡 list, then onboard.
- Six months pass with no second tenant → re-evaluate the Hybrid
  strategy itself. If still no demand, consider sunsetting tenancy
  code and saving the ~15% complexity.
