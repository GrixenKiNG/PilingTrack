---
name: product-bible
description: >-
  PilingTrack product source of truth — what the product is, who it's for, the
  current priority, and what is deliberately NOT being built yet. Use when scoping
  or proposing a feature, deciding whether work is in or out of scope, prioritizing
  what to do next, judging whether to remove/keep code, or whenever a request's
  product intent is unclear. Captures decisions that are not visible in the code or
  git history (audience, roadmap, non-goals, parked architecture choices).
---

# Product Bible (PilingTrack)

The product-level "why" and "what now" that code can't tell you. Read this before
scoping a feature or deciding if work is in scope. Detailed, dated decisions are in
[references/decisions-log.md](references/decisions-log.md) — read it when you need
the reasoning or history behind a guardrail below.

## What PilingTrack is
**Операционка для стройки** — an operations system for a piling/foundation
contractor. It runs the day-to-day: shift reports of pile-driving and drilling
work with photo evidence and provenance, crews, sites, the equipment park, and
maintenance (ТО). One place for operators to log work and for dispatchers/admins
to control and analyze it.

## Who it's for (now)
- **Tenant focus through ~2026-11: Orion only.** Judge every feature against real
  Orion field use. No new tenants in this window.
- **Users / roles:** `OPERATOR` (машинист — logs reports from the field, often
  mobile), `DISPATCHER` (диспетчер — oversight, control), `ADMIN` (full control,
  dictionaries, users), `ASSISTANT` (помощник, minimal rights). See `domain-glossary`.
- **The owner is a non-programmer** working in Russian — UI and copy are Russian;
  decisions should come with concrete next steps, not open-ended options.

## Current priority
**Finish the ТО (maintenance/CMMS) module.** Immediate next step is P1b (work-order
UI), which unblocks deploying the already-merged P1a backend. Roadmap P1b→P5 in the
decisions log. When unsure what to build next, it's ТО-module progress.

## Guardrails (check before scoping work)
- ✅ **Keep tenancy/RLS code** — defence-in-depth now, foundation for the parked
  multi-tenant step. Do NOT remove it to "simplify".
- ✅ **Keep dormant-but-live systems** — IIoT telemetry activates on hardware; don't
  delete as "unused".
- ⛔ **Don't build (yet):** billing/invoicing, self-service registration / tenant
  onboarding, k8s/scaling infra, speculative multi-tenant features. These are
  out of scope for the Orion-only window — flag and defer if a task drifts there.
- 🏗️ **Single-VPS reality** — production is one Docker Compose VPS (30 GB disk,
  ~3.8 GB RAM). Weigh features against that; no k8s.

## How to use this when scoping
1. Does the request serve Orion's real operation? If not, surface that.
2. Is it on the current priority (ТО) or does it pull away from it? Name the tradeoff.
3. Does it touch a guardrail (tenancy removal, a non-goal)? Stop and flag before building.
4. Unclear product intent? Ask — don't guess the product direction.

If a decision here turns out to be stale or the user changes direction, update
[references/decisions-log.md](references/decisions-log.md) (and the user's memory).

## Related skills
`domain-glossary` (terms/roles) · `report-evidence-model` (core data model) ·
`qa-checklist` · `deploy`
