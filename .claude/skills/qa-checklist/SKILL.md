---
name: qa-checklist
description: >-
  PilingTrack pre-merge / pre-deploy quality gate — the exact verification steps
  to run before committing, opening a PR, or deploying, plus what extra scrutiny
  security-critical and DB changes need. Use when finishing a feature or bugfix,
  before committing or pushing, before opening a PR, before a prod deploy, or when
  the user asks "is this ready / did I miss anything / run the checks". Mirrors the
  `npm run verify` gate and the project's test-first rules for auth/security code.
---

# QA Checklist (PilingTrack)

The project has one canonical gate: **`npm run verify`**. This skill is when and
how to use it, plus the change-specific checks `verify` can't catch on its own.

## The one command

```bash
npm run verify
```
runs, in order: `db:check-migrations` → `lint` → `typecheck` → `test:unit` →
`build` → `test:smoke:auth-access`. If it passes, the mechanical gate is green.

⚠️ `typecheck` and `build` both run a full Next build — minutes, RAM-heavy. On
this machine the user prefers `npm run dev` + Docker DB for routine work and
avoids full rebuilds. So:
- **Fast inner loop while coding:** `npm run lint` + `npm run test:unit` (seconds).
- **Full `npm run verify`:** before a commit that will be pushed / PR'd / deployed.
Don't run the heavy build repeatedly mid-task; run the fast checks, then verify once at the end.

## Workflow by checkpoint

**Before committing code that will be pushed**
1. `npm run lint` — ESLint + text-integrity check.
2. `npm run test:unit` — Vitest unit suite.
3. `npm run verify` once it looks done (covers the above + typecheck + build + smoke).
4. Confirm the diff is surgical (CLAUDE.md §3): every changed line traces to the request.

**Before opening a PR / merging** → full `npm run verify` must be green.

**Before a prod deploy** → use the `deploy` skill (it auto-detects new migrations).
If a migration is involved, also see the `create-migration` skill.

## Change-specific checks (what `verify` won't judge for you)

**Touched a security-critical file?** (`src/services/auth/**`,
`authorization-service.ts`, `src/core/security/**`, `src/lib/rate-limiter.ts`,
media/tenant access) → **test-first** (CLAUDE.md): write a test reproducing the
behavior, then change it. Specifically confirm:
- PIN/password compares use `crypto.timingSafeEqual` (no early-return string compare).
- Token rotation/revocation covered by a test if you touched sessions.
- Rate-limit boundaries tested if you touched limits.
- `test:smoke:auth-access` (in `verify`) still passes — it exercises real auth+access.

**Tenant-scoped query?** Never `IS NULL OR tenantId` — fail closed on a missing
`tenantId`, use strict equality. (IDOR policy, CLAUDE.md / `resource-access-service.ts`.)

**Prisma schema / migration?** Hand off to the `create-migration` skill:
one logical change, read the generated SQL, `db:check-migrations` must pass, and
remember the prod `migrate`-service rebuild. New table that's tenant-scoped → add RLS.

**API route?** Wrapped in `withApi` (GET) or `withMutation` (POST/PUT/DELETE) — no
inline CSRF/rate-limit. Input validated with a schema `safeParse`; use only `validated.data`.

**Report / evidence / photo / audit change?** Cross-check against the
`report-evidence-model` skill (live photo path is `Media`, not `ReportPhoto`; don't
break the client/server bundle split).

**Operator-facing string?** Russian, and the label belongs in the central label map,
not inline (see `domain-glossary`).

**New logging?** `logger.*` from `src/lib/logger`, never `console.log` in services.

## Definition of done
- [ ] `npm run verify` green (or fast checks green + verify green before push)
- [ ] Diff is surgical — no unrelated "improvements"
- [ ] Security-critical change has a test written first
- [ ] No `IS NULL OR tenantId`; tenant queries fail closed
- [ ] New/changed tests actually assert behavior, not just run
- [ ] Migration (if any) reviewed + guard passing + deploy note understood

## Related skills
`create-migration` · `deploy` · `report-evidence-model` · `domain-glossary`
