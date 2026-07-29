# Tech Readiness Backend Task 13 — OpenAPI, upgrade rehearsal and final gate

**Work-plan coverage:** TR-1103, TR-1104. **Goal:** deterministically materialize real contracts and prove ordered upgrade, rollback controls and release quality.

## Target files

- Edit `scripts/generate-openapi.ts`, generated `public/openapi.json`, `/api/openapi` handler and generated-client/type check artifacts already owned by the repository.
- Edit `prisma/seed.ts` only for approved dev/test service calls and production missing-timezone/default-draft behavior.
- Create `docs/runbooks/tech-readiness-rollout-rollback.md`.
- Tests: `tests/contract/tech-readiness-api.spec.ts` and migration/upgrade scripts already identified in the ledger.

## Prerequisites and steps

1. Backend Task 12 and Frontend Task 11.
2. Preserve/review pre-existing generator/spec/seed diffs; describe all operations/enums/actions/errors/cookie auth/ETag/idempotency/CSV headers.
3. Generate twice and require no second diff; activate entire contract suite only when all cases bind/pass.
4. Rehearse ordered migrations twice: tenant context; mechanic role; workflows; snapshots/outbox/idempotency; audit chain; typed rules; RLS enforce; start-snapshot FK. Resume backfill, prove old-code compatibility and independent flag/consumer rollback without deletion.

## Tests and validation

- `npm.cmd run openapi:generate` twice; OpenAPI 3.0.3 validation; `npm.cmd run test:contract`; `npm.cmd run db:check-migrations`; `npm.cmd run db:generate`; focused domain/contract/integration/E2E; `npm.cmd run lint`; `npx.cmd tsc --noEmit`; `npm.cmd run build`; security reviewer approval.

## GitNexus gate

- Upstream `impact`: generator exports, `/api/openapi` handler and generated-client consumers. Stop on HIGH/CRITICAL.
- Before any commit run `detect_changes({scope:"compare",base_ref:"chore/april-accumulated-work",repo:"PilingTrack"})`, plus task-branch/unstaged review; investigate every unexpected process/path.

## Acceptance, rollback, exclusions

- Acceptance: deterministic spec matches handlers; upgrade twice/backfill resume/security/role E2E/build green; no unapproved acceptance skip; rollback stops audit read/shadow, snapshot read/consumer, permits, shifts and commands independently without data loss or unrelated consumer stop.
- Rollback: revert only this task’s generator/spec hunk; use documented flags/consumer pause; forward-fix migrations.
- Forbidden: deploy/production migration/seed/allowlist, destructive rollback/rechain/delete, overwriting prior dirty generated changes, unrelated product files.
