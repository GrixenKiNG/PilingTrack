# Tech Readiness production implementation ledger

- Baseline captured: 2026-07-29 (Europe/Moscow)
- Repository: `C:\PillingR\my-project`
- Branch: `main`
- HEAD: `e94846733eaab9cff8aa3dcea0eaf1b53792ed2e`
- Coverage: TR-000, TR-001, TR-002
- Task 00 mutation allowlist: this ledger only
- Batch approval: approved in the implementation-batch conversation on
  2026-07-29; Task 01 may proceed only within the boundaries recorded below

## GitNexus baseline

`gitnexus://repo/PilingTrack/context` reports 997 files, 9,969 symbols, and
300 processes. The repository registry was indexed at
`2026-07-29T05:38:15.452Z` from commit
`e94846733eaab9cff8aa3dcea0eaf1b53792ed2e`, which exactly matches the
captured HEAD. Re-analysis was therefore not required.

The required concept query covered `ToModule`, readiness rules, inspections,
maintenance, meter readings, audit, outbox, and tenant enforcement. The index
returned:

- `ToModule` and `parseView` definitions in
  `src/components/piling/to/to-module.tsx`;
- readiness rule and scoring definitions in `src/modules/readiness/domain/**`;
- the maintenance-plan GET flow and `ensureTenantAccess`;
- the report upsert/outbox-adjacent flow;
- tenant enforcement through `src/proxy.ts`;
- no complete production Tech Readiness workflow spanning authoritative source
  writes, audit/outbox, projection, read model, and UI.

This is an inventory result, not proof that any production workflow passes.
Task 00 changes no function, class, method, route, schema, or generated
artifact, so it has no symbol impact target and does not require
`detect_changes()`.

## Dirty-tree ownership and merge ledger

Disposition meanings:

- `existing/user-owned`: present before Task 00; preserve its exact content and
  merge later only through a targeted, reviewed patch.
- `generated scaffold`: generated acceptance fixture/spec; keep suite-level
  skips and placeholder adapters until its owning slice supplies a real
  harness.
- `slice-owned`: created by the named task and eligible for that task's narrow
  commit only.
- `unrelated/do-not-touch`: outside the Tech Readiness task allowlist.

### Modified tracked overlaps

The targeted diff contains 14 tracked files with 838 insertions and 407
deletions. All are pre-existing user-owned changes.

| Path | Owner | Baseline disposition | Merge strategy |
|---|---|---|---|
| `prisma/schema.prisma` | `existing/user-owned` | `M`, +16/-0 | Preserve current hunk; later schema slices add only reviewed additive hunks after impact and migration checks. |
| `public/openapi.json` | `existing/user-owned` | `M`, +212/-0 | Preserve dirty generated diff; regenerate only in the owning contract slice after deterministic-generator review. |
| `scripts/generate-openapi.ts` | `existing/user-owned` | `M`, +122/-0 | Preserve current generator additions; later contract changes use targeted patches. |
| `src/app/(app)/layout.tsx` | `existing/user-owned` | `M`, +24/-17 | Preserve shell work; frontend integration must patch only its approved seam. |
| `src/app/globals.css` | `existing/user-owned` | `M`, +49/-2 | Preserve global style work; prefer feature-local styles and patch only if acceptance cannot be met locally. |
| `src/components/piling/to/maintenance-plans-panel.tsx` | `existing/user-owned` | `M`, +31/-6 | Preserve current panel changes; later source integration requires targeted merge review. |
| `src/components/piling/to/to-module.tsx` | `existing/user-owned` | `M`, +372/-371 | High-overlap integration file; preserve and patch only after the required symbol impact gate. |
| `src/components/ui/button.tsx` | `existing/user-owned` | `M`, +1/-1 | Shared control; do not reformat or replace. Patch only for an unavoidable approved accessibility fix. |
| `src/components/ui/checkbox.tsx` | `existing/user-owned` | `M`, +1/-1 | Same shared-control rule. |
| `src/components/ui/dialog.tsx` | `existing/user-owned` | `M`, +3/-2 | Same shared-control rule. |
| `src/components/ui/input.tsx` | `existing/user-owned` | `M`, +1/-1 | Same shared-control rule. |
| `src/components/ui/select.tsx` | `existing/user-owned` | `M`, +1/-1 | Same shared-control rule. |
| `src/components/ui/sheet.tsx` | `existing/user-owned` | `M`, +4/-4 | Same shared-control rule. |
| `src/components/ui/textarea.tsx` | `existing/user-owned` | `M`, +1/-1 | Same shared-control rule. |

### Untracked implementation overlaps

These paths existed before Task 00 and are not available for wholesale
replacement. Their baseline disposition is `??`.

| Path | Owner | Merge strategy |
|---|---|---|
| `prisma/migrations/20260728120000_readiness_rules/migration.sql` | `existing/user-owned` | Preserve as an existing migration candidate; owning schema slice must review ordering and additive safety. |
| `src/app/api/readiness-rules/route.ts` | `existing/user-owned` | Preserve current GET/PUT implementation; owning slice must remove fallback tenant behavior through a targeted patch. |
| `src/app/api/readiness-rules/publish/route.ts` | `existing/user-owned` | Preserve current POST implementation; later patch only after impact/RBAC/tenant gates. |
| `src/app/api/readiness-rules/__tests__/route.test.ts` | `existing/user-owned` | Active focused test; extend only in the owning rules slice. |
| `src/components/piling/to/__tests__/readiness-model.test.ts` | `existing/user-owned` | Active focused test; preserve and extend narrowly. |
| `src/components/piling/to/__tests__/readiness-score.test.ts` | `existing/user-owned` | Active focused test; preserve and extend narrowly. |
| `src/components/piling/to/readiness-center.tsx` | `existing/user-owned` | Preserve prototype/integration work; do not treat static controls as a passed workflow. |
| `src/components/piling/to/readiness-design-views.tsx` | `existing/user-owned` | Preserve current view work; later frontend slice owns only approved deltas. |
| `src/components/piling/to/readiness-model.ts` | `existing/user-owned` | Preserve current client model; production UI must ultimately consume server facts rather than infer authority here. |
| `src/components/piling/to/readiness-reference-ui.tsx` | `existing/user-owned` | Preserve reference work; it is not production acceptance evidence. |
| `src/modules/readiness/application/readiness-facts.ts` | `existing/user-owned` | Preserve current facts implementation; later application slice uses symbol impact before wiring. |
| `src/modules/readiness/application/readiness-rules-service.ts` | `existing/user-owned` | Preserve current service; later rules slice owns targeted changes only. |
| `src/modules/readiness/domain/readiness-rules.ts` | `existing/user-owned` | Preserve current rule definitions; later domain slice owns targeted changes only. |
| `src/modules/readiness/domain/readiness-score.ts` | `existing/user-owned` | Preserve current score implementation; no production authorization claim. |
| `src/modules/readiness/index.ts` | `existing/user-owned` | Preserve current public exports; later changes require integration-point impact. |

### Generated production scaffolds

All five files are untracked (`??`) at baseline.

| Path | Owner | Current result | Harness disposition |
|---|---|---|---|
| `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts` | `generated scaffold` | `skipped` | `no-harness`: adapters throw `pendingImplementation`. |
| `tests/fixtures/tech-readiness.fixture.ts` | `generated scaffold` | fixture only | `no-harness`: constants and isolation assertions exist, but no seed/reset/session binding. |
| `tests/contract/tech-readiness-api.spec.ts` | `generated scaffold` | `skipped` | `no-harness`: request/seed/reset adapters throw. |
| `tests/integration/tech-readiness-write-pipeline.spec.ts` | `generated scaffold` | `skipped` | `no-harness`: proxy adapter throws for every operation. |
| `e2e/tech-readiness-production.spec.ts` | `generated scaffold` | `skipped` | `no-harness`: test headers/session adapter are not implemented and must be impossible outside test mode. |

The first owning slice may activate only its suite and must leave not-yet-owned
cases individually skipped with a slice/issue reference. No suite may be
unskipped while its adapter is a placeholder.

### Clean inspected paths

These paths have no tracked or untracked diff at the captured baseline and are
read-only in Task 00:

| Path | Owner | Disposition |
|---|---|---|
| `package.json` | `existing/user-owned` | clean; provides the current test/type/migration scripts |
| `src/app/api/readiness/route.ts` | `existing/user-owned` | clean; current application readiness probe |
| `src/app/api/audit/route.ts` | `existing/user-owned` | clean; current generic FeedbackEvent-backed history route |
| `src/components/piling/to/meter-readings-panel.tsx` | `existing/user-owned` | clean |
| `src/components/piling/to/to-module-bits.tsx` | `existing/user-owned` | clean |
| `src/components/piling/to/to-stats.ts` | `existing/user-owned` | clean |
| `src/components/piling/to/__tests__/to-stats.test.ts` | `existing/user-owned` | clean |

### Task 00 and unrelated paths

| Path/scope | Owner | Disposition |
|---|---|---|
| `docs/plans/tech-readiness-production-implementation-ledger.md` | `slice-owned` (Task 00) | sole Task 00 addition; eligible for a Task 00 narrow commit only after review |
| ORION files/assets/tests, analytics, reporting, monitoring, admin modules, screenshots, design outputs, and every dirty path not listed above | `unrelated/do-not-touch` | never reset, clean, reformat, regenerate, stage, commit, or otherwise mutate in this batch |

Before every later task, refresh status and targeted diffs. If another owner
extends any path above, their newer ownership wins and the task must stop for a
merge decision rather than overwrite it.

## Current route inventory

| Method and route | Baseline behavior | Readiness status |
|---|---|---|
| `GET /api/readiness` | Calls the application health readiness probe and returns 200/503. | Existing infrastructure probe; **not** the Tech Readiness read model. |
| `GET /api/readiness-rules` | Loads rules for an authenticated tenant. | User-owned prototype; currently permits `DEFAULT_TENANT_ID` fallback, contrary to the production invariant. |
| `PUT /api/readiness-rules` | ADMIN draft save. | User-owned prototype; same tenant-fallback gap. |
| `POST /api/readiness-rules/publish` | ADMIN publish. | User-owned prototype; same tenant-fallback gap. |
| `GET /api/audit` | Reads `FeedbackEvent`-backed entity history by scope/target. | Existing legacy audit route; not the ADR-0043 tenant hash-chain source. |

There are no production Tech Readiness permit, shift/handover, inspection,
maintenance, meter-reading, snapshot, trend, equipment read-model, audit CSV,
or bootstrap routes under the inspected readiness roots. Related legacy source
routes elsewhere in the repository do not by themselves satisfy the planned
transactional workflow.

## Baseline validation

| Check | Result | Evidence |
|---|---|---|
| `git status --short` | `pass` | Captured before mutation; the tree was materially dirty. |
| `git diff --name-status` | `pass` | Captured; 14 tracked overlap files were modified. |
| targeted `git diff -- <paths>` | `pass` | Captured for schema, OpenAPI, generator, layout, globals, shared controls, TO, readiness, audit, scaffolds, and the existing readiness migration. |
| `git ls-files --others --exclude-standard` | `pass` | Captured; overlapping untracked files are recorded above. A global-ignore permission warning was non-fatal. |
| focused Vitest command | `pass` | 3 files passed; 19 tests passed; duration 5.53 s. |
| `npx.cmd tsc --noEmit` | `pass` | Exit code 0 with no diagnostics. |
| `npm.cmd run db:check-migrations` | `pass` | `Migration guard: no un-reviewed destructive migrations`. |
| generated production suites | `skipped` | Suite-level skips preserved; no suite was executed or unskipped. |
| contract/integration/E2E production harnesses | `no-harness` | Placeholder adapters remain intentionally unbound. |

No build or broad contract/integration/E2E suite was requested by Task 00, so
none is claimed as passed.

## Slice and commit boundary

Task 00 authorizes no product implementation. After batch approval, each task
must:

1. refresh the ownership ledger and targeted diff;
2. run the required upstream GitNexus impacts before editing integration
   symbols and stop on HIGH/CRITICAL;
3. change only its explicit allowlist;
4. run focused validation and the layer-appropriate quality fixer;
5. run `detect_changes(scope: "all", repo: "PilingTrack")`;
6. obtain review, then create one narrow commit for that completed task.

No end-of-project mega-commit is permitted.

## Batch approval gate

Approval was explicitly granted in the implementation-batch conversation on
2026-07-29 for the following wording:

> Approve Phases 1–11 as one implementation batch under the dirty-tree ledger,
> GitNexus checkpoints, per-task quality/commit cycle, disposable-database
> migration/seed scope, and non-production rollback boundaries defined in this
> Work Plan.

That approval permits repository-local execution of TR-100 through TR-1104,
including additive migrations only in disposable/dev/test databases, dev/test
seed and backfill rehearsals, progressive generated-test unskipping,
deterministic OpenAPI regeneration after dirty-diff preservation, per-task
quality-fixer and narrow commits, and local HTTP browser/role scenario testing.

It does **not** authorize:

- production migration, production seed, feature-flag enablement, tenant
  allowlist change, or deploy;
- destructive database rollback, drop, truncate, rechain, or deletion;
- overwriting, resetting, cleaning, staging, or committing unrelated dirty
  files;
- assigning production users to `MECHANIC`;
- accepting HIGH/CRITICAL GitNexus blast radius without a new explicit
  sequence decision;
- resolving open security-owner decisions about audit retention, dispatcher
  permission, or external anchoring by assumption;
- exposing or modifying secrets.

Approval may be revoked before the next task starts. Completed narrow task
commits remain independently reviewable and revertible. Task 00 rollback is to
delete only this ledger after verifying no other owner has extended it.
