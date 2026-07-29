# Tech Readiness Backend Task 00 — Execution ledger and baseline

**Work-plan coverage:** TR-000, TR-001, TR-002. **Goal:** establish the only approved implementation baseline and dirty-tree ownership ledger; make no product-code change.

## Target files

- Create `docs/plans/tech-readiness-production-implementation-ledger.md`.
- Read only: `package.json`, `prisma/schema.prisma`, `public/openapi.json`, `scripts/generate-openapi.ts`, `src/app/(app)/layout.tsx`, `src/app/globals.css`, `src/components/ui/{dialog,sheet,button,input,select,textarea,checkbox}.tsx`, `src/components/piling/to/**`, `src/modules/readiness/**`, `src/app/api/readiness/**`, `src/app/api/readiness-rules/**`, `src/app/api/audit/**`, the five generated test scaffolds named in the Work Plan.

## Prerequisites and steps

1. None. Confirm HEAD and GitNexus index freshness.
2. Record `existing/user-owned`, `generated scaffold`, `slice-owned`, or `unrelated/do-not-touch` for every overlapping path, including its current diff disposition.
3. Inventory routes, current focused results, skipped suites, missing harnesses, and one-commit-per-task boundary.
4. Obtain batch approval with the exact exclusions in Work Plan §6 before Task 01.

## Tests and validation

- Add/unskip: none.
- Run: `git status --short`; `git diff --name-status`; targeted `git diff -- <path>`; `git ls-files --others --exclude-standard`; `npx.cmd vitest run src/components/piling/to/__tests__/readiness-model.test.ts src/components/piling/to/__tests__/readiness-score.test.ts src/app/api/readiness-rules/__tests__/route.test.ts`; `npx.cmd tsc --noEmit`; `npm.cmd run db:check-migrations`.

## GitNexus gate

- Read `gitnexus://repo/PilingTrack/context`; if stale, run `node .gitnexus/run.cjs analyze`.
- `query` flows for `ToModule`, readiness rules, inspections, maintenance, meter readings, audit, outbox, and tenant enforcement.
- Upstream `impact` targets: none, because this task may not edit a function, class, method, route, schema, or generated artifact; Task 01 must run the first symbol impacts.
- No `detect_changes` is required because this task changes documentation only; confirm the sole new path is the ledger.

## Acceptance, rollback, exclusions

- Acceptance: every overlap has an owner/merge strategy; results are labelled pass/fail/skipped/no-harness; approval excludes deploy, production DB/seed, secrets, destructive rollback, and unrelated changes.
- Rollback: delete only the new ledger after verifying it was not extended by another owner.
- Forbidden unrelated files: all product code, schema, migrations, generated artifacts, ORION, analytics, reporting, screenshots, and current user-owned changes.
