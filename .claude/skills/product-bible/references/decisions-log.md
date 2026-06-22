# PilingTrack — Product Decisions Log

Durable product/architecture decisions that are NOT obvious from the code or git
history. Each entry: what was decided, why, and what it means for new work.
Newest-relevant first. Dates absolute.

## Table of contents
- [Audience & tenancy](#audience--tenancy)
- [Roadmap (current priority: ТО module)](#roadmap-current-priority-то-module)
- [Architecture decisions](#architecture-decisions)
- [Non-goals (do NOT build yet)](#non-goals-do-not-build-yet)

## Audience & tenancy
- **Near-term focus (through ~2026-11): Orion only.** Single tenant `orion`. All
  product work is judged against real Orion field use. No new tenants onboarded
  in this window.
- **Multi-tenancy is a parked decision, revisited ~2026-11-24.** The "Hybrid
  SaaS" path (Orion + 1–2 friendly tenants to shake out multi-tenant bugs) is the
  planned direction *if* taken — but it is NOT active yet.
- **Therefore: keep all tenancy/RLS code. Do not remove it.** It is both defence-
  in-depth for the single tenant and the foundation for the parked multi-tenant
  step. Ripping it out to "simplify" would be a mistake.

## Roadmap (current priority: ТО module)
**Top priority right now: finish the ТО / maintenance (CMMS) module.**
- P1a — work-orders backend: merged to main 2026-06-01, **undeployed** pending P1b UI.
- P1b — work-order UI: the immediate next step (unblocks deploying P1a).
- P2–P5 — later phases of the CMMS build (checklists, maintenance analytics, etc.).
- The checklist engine (ЕО/ТО, `Inspection` + `ChecklistTemplate`) is part of this
  arc and partly shipped.

When unsure what to work on next: it's ТО-module progress unless the user says otherwise.

## Architecture decisions
- **k8s stack deleted (2026-05-31).** No migration to Kubernetes within ≤1 year.
  Production is a single VPS Docker Compose stack. Don't reintroduce k8s manifests.
- **PDF stays in the single `workers` container.** A workers/PDF split was attempted
  and reverted — premature optimization for this scale/VPS. Don't re-attempt without
  profiling that proves a need.
- **IIoT telemetry is dormant, NOT dead.** Telemetry ingestion/tables exist and run,
  but stay empty until real hardware (a telematics box) is connected. Don't delete
  it as "unused" — it activates on hardware.
- **Equipment monitoring / analytics / maintenance deployed to prod 2026-05-27.**
  Fleet analytics + maintenance journal run on existing data; live telemetry waits
  on hardware.
- **Equipment is tenant-scoped with RLS (2026-05-28).** Latent IDOR closed.

## Non-goals (do NOT build yet)
These are deliberately out of scope for the current (Orion-only) window. Building
them now is wasted effort — flag and defer if a task drifts toward them:
- **Billing / invoicing / subscriptions.** No paid-tenant machinery yet.
- **Self-service registration / tenant onboarding.** New companies are not signing
  themselves up; tenants are provisioned manually if/when the multi-tenant step happens.
- **k8s / horizontal scaling infra.** Single VPS is the target.
- **Speculative multi-tenant features** (per-tenant theming, tenant admin portals,
  cross-tenant reporting) — wait for the parked 2026-11 decision.
