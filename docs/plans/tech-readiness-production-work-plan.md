# Work Plan: production-модуль «Техготовность»

- Status: ready for batch approval
- Date: 2026-07-29
- Repository: `C:\PillingR\my-project`
- Baseline observed: branch `main`, HEAD `e94846733eaab9cff8aa3dcea0eaf1b53792ed2e`
- Scope: production implementation of the seven-view Tech Readiness module, its backend workflows, projections, audit, settings, and acceptance evidence
- Explicit non-scope of this planning change: product-code edits, database execution, seed execution, generated OpenAPI rewrite, commit, deploy

## 1. Inputs and governing decisions

Implementation must conform to:

- PRD: `docs/product/tech-readiness-production-prd.md`;
- UI Spec: `docs/ui-spec/tech-readiness-production-ui-spec.md`;
- backend Design: `docs/design/tech-readiness-production-backend-design.md`;
- frontend Design: `docs/design/tech-readiness-production-frontend-design.md`;
- ADR-0041: authoritative transactional workflows, strong optimistic concurrency, idempotency, outbox, synchronous shift-start decision;
- ADR-0042: `MECHANIC`, explicit abilities, session-owned tenant/timezone, safe `404`, composite tenant keys, fail-closed RLS;
- ADR-0043: tenant-scoped append-only `AuditLog` hash chain; `FeedbackEvent` is not the audit source;
- generated test scaffolds:
  - `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts`;
  - `tests/fixtures/tech-readiness.fixture.ts`;
  - `tests/contract/tech-readiness-api.spec.ts`;
  - `tests/integration/tech-readiness-write-pipeline.spec.ts`;
  - `e2e/tech-readiness-production.spec.ts`.

Non-negotiable invariants:

1. Tenant, actor, approval role, and workflow timezone come from the verified session and `TenantSettings`; Tech Readiness never uses `DEFAULT_TENANT_ID` and rejects client-supplied context fields.
2. A safety command never authorizes from an eventually consistent snapshot. Shift start evaluates authoritative rows and the latest published rule set in its serializable transaction.
3. Every successful mutation atomically persists aggregate change, masked audit event, outbox event, and idempotency result. Projection atomically persists one immutable snapshot and marks the outbox event projected.
4. UI actions come from server `actions[]`/capabilities and aggregate state, not a client-side role inference.
5. Production UI contains exactly seven module tabs and seven settings sections, inside the existing app shell. No duplicate navigation and no client-side readiness calculation.
6. Permits ship before shift start because published rules may require a valid permit.
7. Rollback is by feature flags/routes/consumer pause. Workflow, snapshot, and audit data are never deleted and the audit chain is never reversed.

## 2. Execution and dirty-tree protocol

The working tree is already materially dirty. At planning time it includes overlapping changes in `prisma/schema.prisma`, `public/openapi.json`, `scripts/generate-openapi.ts`, `src/app/(app)/layout.tsx`, `src/app/globals.css`, shared UI controls, `src/components/piling/to/*`, readiness domain/routes, the new readiness migration, and unrelated ORION/analytics/reporting work.

Rules for every implementation task:

1. Before work, capture `git status --short`, `git diff --name-status`, `git diff -- <target files>`, current HEAD, and an owner/disposition for every overlapping dirty file.
2. Never reset, checkout, clean, regenerate over, reformat, stage, or commit unrelated current changes.
3. Prefer new feature-local files under `src/modules/readiness/**` and `src/components/piling/to/readiness/**`. Edit shared files only when the acceptance gate cannot be met locally.
4. Before editing any existing function/class/method, run GitNexus `impact({target, direction:"upstream", repo:"PilingTrack"})`. Record direct callers, affected processes, modules, and risk in the task note. For a new symbol, run impact on the existing integration point before wiring it.
5. Stop and request sequence approval when GitNexus returns `HIGH` or `CRITICAL`; do not proceed merely because the change is planned.
6. After each task, run focused tests. After each slice, run GitNexus `detect_changes({scope:"all", repo:"PilingTrack"})`, compare changed paths to that slice allowlist, then run the slice validation bundle.
7. Run the layer-appropriate quality-fixer before each task commit. Commit only that completed task after approval; no end-of-project mega-commit.
8. A generated artifact may be updated only after preserving/reviewing its current dirty diff and proving deterministic generation.

Test graduation rule: the generated files currently use suite-level `describe.skip`/`test.describe.skip`. The first owning slice converts each affected suite to active `describe` and leaves not-yet-owned cases individually skipped with an issue/slice reference. Each subsequent slice removes only its case-level skips. No whole suite is unskipped against placeholder adapters.

## 3. Common paths and validation commands

Likely feature-local target roots:

- backend: `src/modules/readiness/domain/**`, `src/modules/readiness/application/**`, `src/modules/readiness/infrastructure/**`, `src/modules/readiness/index.ts`;
- routes: `src/app/api/readiness/**`, `src/app/api/readiness-rules/**`, `src/app/api/audit/**`;
- frontend: `src/components/piling/to/readiness/**`, with integration in `src/components/piling/to/to-module.tsx`;
- database: `prisma/schema.prisma`, ordered additive migrations under `prisma/migrations/**`, `prisma/seed.ts`;
- contract: `scripts/generate-openapi.ts`, `public/openapi.json`;
- tests: generated scaffolds above plus feature-local unit/component tests.

Standard commands (PowerShell/Windows):

```powershell
git status --short
git diff --name-status
npm.cmd run db:check-migrations
npm.cmd run db:generate
npm.cmd run check:text-integrity
npx.cmd tsc --noEmit
npx.cmd vitest run <focused files>
npm.cmd run test:contract
npm.cmd run test:integration
npm.cmd run openapi:generate
npm.cmd run build
npx.cmd playwright test e2e/tech-readiness-production.spec.ts --project=chromium --workers=1
```

Database tests and migration rehearsals must use an isolated disposable PostgreSQL database. Browser acceptance must use an allowed HTTP development/test server and the preferred project browser agent; `file://` evidence is not acceptance evidence.

---

## Phase 0 — Dirty-tree safeguard and executable baseline

### TR-000 — Freeze the implementation ledger

- Deliverable: a per-path ledger recording `existing/user-owned`, `generated scaffold`, `slice-owned`, or `unrelated/do-not-touch`, plus baseline HEAD and relevant diffs.
- Targets: implementation notes/PR description only; inspect all paths listed in §2.
- Dependencies: none.
- GitNexus checkpoint: read repository context/index freshness; if stale relative to HEAD, run `node .gitnexus/run.cjs analyze` before any impact claim.
- Tests: none unskipped.
- Validation: `git status --short`, `git diff --name-status`, targeted diffs, `git ls-files --others --exclude-standard`.
- Rollback: no mutation; discard only the new ledger if incorrect.
- Gate: every overlapping readiness/schema/OpenAPI/layout/shared-control path has an owner and merge strategy.

### TR-001 — Baseline existing behavior without claiming production readiness

- Deliverable: record current focused unit results, type/build status, route inventory, and known skipped production tests.
- Targets: read-only inspection of `package.json`, existing readiness tests/routes/components.
- Dependencies: TR-000.
- GitNexus checkpoint: `query` existing flows around `ToModule`, readiness rules, inspections, maintenance, meter readings, audit, outbox, and tenant enforcement.
- Tests: keep all generated production suites skipped; execute existing focused readiness/rules tests only.
- Validation:
  - `npx.cmd vitest run src/components/piling/to/__tests__/readiness-model.test.ts src/components/piling/to/__tests__/readiness-score.test.ts src/app/api/readiness-rules/__tests__/route.test.ts`;
  - `npx.cmd tsc --noEmit`;
  - `npm.cmd run db:check-migrations`.
- Rollback: none.
- Gate: baseline distinguishes pass/fail/skipped/no-harness and does not label static controls as passed workflows.

### TR-002 — Approve the slice/commit boundary

- Deliverable: batch approval covering Phases 1–11 and the one-task/quality-fixer/commit cycle.
- Dependencies: TR-000–TR-001.
- Tests: none.
- Validation: approval explicitly excludes production deploy, destructive schema rollback, production seed role assignments, secrets, and unrelated dirty changes.
- Rollback: revoke approval before the next task starts; completed task commits remain reviewable/revertible.
- Gate: no product-code implementation starts without batch approval.

## Phase 1 — Layout/accessibility safe fix

This slice is intentionally frontend-local and must not wait for backend schema work. It establishes a safe shell for later vertical slices without pretending that mocked data is production data.

### TR-100 — Isolate the production module shell

- Deliverable: `TechReadinessModule`, immutable seven-tab contract, bootstrap/view boundaries, live region, and feature-unavailable/forbidden states.
- Targets:
  - new `src/components/piling/to/readiness/tech-readiness-module.tsx`;
  - new `module-tab-list.tsx`, `live-region.tsx`, `boundaries/**`;
  - minimal integration in `src/components/piling/to/to-module.tsx`;
  - preserve `readiness-reference-ui.tsx` as legacy until per-tab parity.
- Dependencies: TR-002.
- GitNexus impact: `ToModule`, `parseView`, and current `ReadinessReferenceUi`; warn before editing if HIGH/CRITICAL.
- Tests: add component/DOM tests for exactly seven tabs, selected tab, forbidden/feature-off/error states, and one live region. Do not unskip generated E2E.
- Validation: focused Vitest, `npx.cmd tsc --noEmit`, existing ToModule tests.
- Rollback: feature flag routes back to existing readiness UI; new shell files can remain unused.
- Gate: existing global shell/left nav stays single; module has one tab row and no duplicate brand/navigation.

### TR-101 — Remove fixed-height overlap safely

- Deliverable: page/content geometry based on flex/grid/min-block-size and document flow; no module-owned fixed viewport subtraction.
- Targets:
  - feature-local styles/components first;
  - only if unavoidable, reviewed edits to `src/app/(app)/layout.tsx` and `src/app/globals.css`.
- Dependencies: TR-100.
- GitNexus impact: `AppLayout`/exported layout symbol, `ToModule`; shared CSS edits require a path-level blast-radius review and smoke tests on unrelated app pages.
- Tests: add geometry smoke assertions for 1440×900, 1280×800, 1024×768, 390×844, and 200% desktop zoom.
- Validation: browser screenshots plus DOM bounding-box assertions; no page-level horizontal scroll or sibling/sticky intersection.
- Rollback: revert feature-local geometry or disable new shell flag; do not revert unrelated current layout/CSS changes.
- Gate: UI Spec §13 invariants pass at all five target conditions.

### TR-102 — Keyboard/focus foundation

- Deliverable: semantic tabs, deterministic focus after tab change/retry, focus trap/return for shared command dialogs/drawers, status announcements without duplication.
- Targets: `module-tab-list.tsx`, `live-region.tsx`, `boundaries/**`, new `shared/command-dialog.tsx`, `shared/entity-detail-shell.tsx`.
- Dependencies: TR-100.
- GitNexus impact: impact any existing shared dialog/sheet symbol before reuse edits; prefer wrappers over changes to dirty `src/components/ui/dialog.tsx` and `sheet.tsx`.
- Tests: component keyboard/focus tests; axe smoke on shell states.
- Validation: Testing Library keyboard tests and browser keyboard-only smoke.
- Rollback: disable wrapper integration while retaining semantic tab markup.
- Gate: no keyboard trap, focus returns to launcher, one screen-reader announcement per state change.

### Phase 1 acceptance

- `detect_changes` shows only shell/layout test allowlist.
- Existing non-readiness shell routes receive responsive smoke coverage if shared layout/CSS changed.
- No production test is marked passed merely because the shell renders.

## Phase 2 — Platform tenancy/audit primitives

This slice provides cross-cutting write safety and a thin bootstrap vertical path. Audit storage/shadow append is introduced here; the real audit reader/UI is Phase 8.

### TR-200 — Tenant transaction wrapper and timezone

- Deliverable: verified-session tenant context, `SET LOCAL app.current_tenant`, request/worker transaction wrappers, IANA timezone normalization with `Europe/Moscow` fallback only in `TenantSettings`.
- Targets:
  - new `src/modules/readiness/infrastructure/tenant-transaction.ts`;
  - integration with `src/services/tenancy/tenant-context-service.ts`, database client wrapper, and readiness worker entry points;
  - route bootstrap path `src/app/api/readiness/bootstrap/route.ts`.
- Dependencies: Phase 1.
- GitNexus impact: `ensureTenantAccess`, tenant-context exported functions, Prisma transaction wrapper, worker entry symbols.
- Migration: `readiness_tenant_context` adds/validates timezone and composite parent uniques; preflight invalid timezone/orphan/duplicate checks.
- Seed: isolated tenant with `Europe/Moscow` plus foreign tenant `Asia/Yekaterinburg`.
- Tests to unskip: API contract safe missing/cross-tenant `404` case after harness binding; keep other cases individually skipped.
- Validation: tenant wrapper unit tests, safe-404 contract case, unset/wrong-tenant RLS tests in disposable DB.
- Rollback: flag new routes off; leave additive unique/timezone data; do not enforce RLS yet.
- Gate: no Tech Readiness path can obtain tenant from body/query/header/environment fallback.

### TR-201 — Role and capability registry

- Deliverable: `MECHANIC` role, explicit readiness abilities, `ADMIN` mechanic execution only with audited `actingAs=MECHANIC`, role change increments `sessionVersion`.
- Targets: existing authorization/session/user role files; new readiness capability mapper/read model; bootstrap response.
- Dependencies: TR-200.
- GitNexus impact: authorization `can`/ability registry, role validation schemas, session issuance/refresh, role navigation.
- Migration: `readiness_mechanic_role` remains string-backed and assigns no production users.
- Seed: distinct isolated ADMIN, MECHANIC, two DISPATCHERs, OPERATOR through the role service.
- Tests to unskip: API contract mechanic RBAC matrix and untrusted context input case.
- Validation: authorization/session/role-navigation unit tests; focused contract cases.
- Rollback: feature flags hide readiness commands; role string remains additive; revoke test/dev assignments through role service.
- Gate: cached sessions lose removed role powers; UI receives capabilities and never derives them from role names.

### TR-202 — Error, ETag, idempotency, correlation primitives

- Deliverable: common envelopes, strong ETag parser, `428/409/422` policy, tenant/scope/request-hash idempotency with exact response replay and `COMMAND_IN_PROGRESS`.
- Targets:
  - new `src/modules/readiness/application/command-pipeline/**`;
  - new route adapters under `src/app/api/readiness/_shared/**`;
  - additive `IdempotencyKey`/`OutboxEvent` fields in Prisma.
- Dependencies: TR-200–TR-201.
- GitNexus impact: existing API wrappers/mutation wrapper, existing idempotency and outbox publisher symbols.
- Migration: additive nullable columns, deterministic backfill where possible, constraints only after preflight; no stale processing-row reset mechanism.
- Tests to unskip: API contract strong ETag/missing/weak precondition and idempotent replay/mismatch cases when a thin test command is available.
- Validation: unit vectors plus focused contract tests; concurrency test for winner commit/rollback/lock timeout.
- Rollback: disable command routes; previous code remains compatible with additive nullable columns.
- Gate: same key/same request replays exact status/body/headers; same key/different payload is stable `409`.

### TR-203 — Audit chain append primitive and shadow write

- Deliverable: recursive masker, RFC 8785 canonicalization, ADR digest, tenant chain row lock, append-only guard, verifier API/service, shadow-write metrics.
- Targets:
  - new `src/modules/readiness/domain/audit/**`;
  - new `src/modules/readiness/infrastructure/audit/**`;
  - integration adapter around `src/core/infrastructure/audit-log-service.ts`;
  - Prisma `TenantAuditChain` and AuditLog v2 fields.
- Dependencies: TR-200–TR-202.
- GitNexus impact: existing audit-log service, `audit-service`, and current `/api/audit` reader. Do not switch the reader yet.
- Migration: `audit_chain_v1` in additive nullable/backfill/constraint stages; explicit mapping manifest or restricted quarantine for null-tenant legacy rows; append-only grants/trigger only after backfill verification.
- Seed: audit events created through append service; never inject fake hashes.
- Tests to unskip: `Audit canonicalization and hash chain` domain group only; leave API audit/CSV cases skipped.
- Validation: golden canonical/hash vectors, masking, concurrent contiguous sequence, DB-role update/delete rejection, verifier break detection.
- Rollback: disable shadow writes only with security-owner approval; never mutate/delete/rechain written events.
- Gate: masked payload is what is persisted and hashed; claims remain “tamper-evident for application role,” not electronic signature/privileged-owner proof.

### TR-204 — Minimal production bootstrap vertical path

- Deliverable: `GET /api/readiness/bootstrap` returns timezone, feature flags, selectors, counts, and screen/entity capabilities to the Phase 1 shell.
- Targets: bootstrap route/query, frontend `api/client.ts`, `api/contracts.ts`, `api/errors.ts`, `api/query-keys.ts`, `bootstrap-boundary.tsx`.
- Dependencies: TR-200–TR-203.
- GitNexus impact: `ToModule`, auth wrapper, equipment selector query integration point.
- Tests: bootstrap route contract/component loading/error/forbidden tests.
- Validation: focused API/component tests and manual role matrix.
- Rollback: feature flag returns legacy module.
- Gate: first real backend-to-frontend path contains no mocks and leaks no foreign tenant identifiers.

### Phase 2 acceptance

- Disposable DB migration rehearsal succeeds twice.
- All new route/worker tenant paths are fail-closed; full RLS enforcement remains gated until every reused source path is wrapped.
- Audit shadow verification is green before downstream workflow writes.

## Phase 3 — Permits before shifts

### TR-300 — WorkPermit schema and state machine

- Deliverable: `WorkPermit`/`WorkPermitApproval`, NORMAL/ELEVATED transitions, edit invalidation, expiry/revoke, self-approval prohibition.
- Targets: Prisma schema/migration; new `src/modules/readiness/domain/permits/**`.
- Dependencies: Phase 2.
- GitNexus impact: `READINESS_CRITERION_KEYS`, `DEFAULT_READINESS_RULES`, role/capability mapper.
- Migration: `readiness_workflows` creates permit plus forward-compatible shift/handover tables and partial indexes/checks; no synthetic production records.
- Seed: draft/pending/approved/revoked permits, NORMAL and ELEVATED approval stages via services.
- Tests to unskip: permit transition/approval/self-approval cases in production domain suite.
- Validation: focused domain tests, Prisma validation/generation, migration SQL constraint tests.
- Rollback: disable permit write flag; preserve rows.
- Gate: substantive edit invalidates approvals and increments version; author cannot approve own permit.

### TR-301 — Permit command/query API

- Deliverable: list/detail/create/update/submit/approve/revoke routes with tenant scope, capabilities, strong ETag, idempotency, audit, outbox.
- Targets: `src/modules/readiness/application/permits/**`, infrastructure repository, `src/app/api/readiness/work-permits/**`.
- Dependencies: TR-300.
- GitNexus impact: API mutation wrapper and new repository integration point; existing readiness rules service because permit change triggers readiness recalculation.
- Tests to unskip: contract spoof-context and idempotency cases against real routes; add NORMAL/ELEVATED, self-approval, edit/approval race, cross-tenant composite FK tests.
- Validation: unit/contract/integration DB tests, 20-way same-key/different-key command race where applicable.
- Rollback: disable `readiness_permits_v1`; retain read-only rows/audit/outbox.
- Gate: NORMAL needs one non-author DISPATCHER; ELEVATED needs distinct DISPATCHER and ADMIN, in either order.

### TR-302 — Permit UI vertical slice

- Deliverable: list/detail filters, create/edit/submit/approve/revoke dialogs, progress `1/2`, state-specific `409/422`, pending/success convergence.
- Targets: `src/components/piling/to/readiness/permits/**`, shared API/query/dialog/action components, deep-link URL state.
- Dependencies: TR-301.
- GitNexus impact: `ReadinessReferenceUi` permit section and `ToModule`; do not remove legacy permit view until parity.
- Tests: component tests for every role/state/action; progressively unskip E2E elevated approval and the permit portion of dispatcher journey only when isolated session harness is real.
- Validation: focused component tests, Playwright permit grep at 1440 and 390, keyboard dialog checks.
- Rollback: per-tab flag returns legacy/feature-unavailable view; API remains available.
- Gate: hidden/disabled actions exactly reflect server action contract; no optimistic claim of approval before response.

### Phase 3 acceptance

- Permit domain/API/UI works as one slice with audit/outbox evidence.
- The published `VALID_WORK_PERMIT_REQUIRED` vocabulary is represented but not yet used to start shifts.

## Phase 4 — Shifts and handover

### TR-400 — Shift/Handover domain and concurrency invariants

- Deliverable: state machines, one active shift/equipment, one live handover/shift, explicit DAY/NIGHT, production date from tenant timezone.
- Targets: new `src/modules/readiness/domain/shifts/**`; existing workflow migration indexes/checks.
- Dependencies: Phase 3.
- GitNexus impact: readiness evaluator integration point, tenant-date utility, relevant equipment lookup.
- Tests to unskip: shift and handover transition/terminal cases in production domain suite.
- Validation: domain tests, 20 parallel starts produce one winner and stable conflicts; two concurrent accepts produce one accepted handover/closed shift.
- Rollback: disable shift writes; preserve planned/workflow rows.
- Gate: DB invariant, conditional update predicate, and application conflict mapping all agree.

### TR-401 — Shift/Handover command/query API

- Deliverable: create/update/start/cancel/handover/accept/rework and list/detail routes; authoritative start evaluation; synchronous decision snapshot record; current safe resource on conflict.
- Targets: `src/modules/readiness/application/shifts/**`, repositories; `src/app/api/readiness/shifts/**`, `src/app/api/readiness/handovers/**`.
- Dependencies: TR-400 and permit APIs.
- GitNexus impact: `computeReadinessScore`, `blockerTriggered`, `readiness-facts` builder, command pipeline.
- Migration: ensure minimal `ReadinessScoreSnapshot` storage exists for `SHIFT_START_DECISION`; defer `Shift.startSnapshotId` FK until Phase 5.
- Tests to unskip:
  - API ETag/precondition;
  - mechanic RBAC;
  - handover stale conflict;
  - explainable blocked start;
  - integration authoritative shift-start case.
- Validation: focused API/integration tests, serializable retry tests, audit/outbox/idempotency atomicity.
- Rollback: disable `readiness_shifts_v1` tenant allowlist; keep reads/history.
- Gate: a stale snapshot cannot permit a blocked start; `422` carries blocker and correcting action.

### TR-402 — Shift/Handover UI vertical slice

- Deliverable: real shift bars/cards, list/detail, start/cancel/handover/accept/rework dialogs, conflict actor/time/current state recovery.
- Targets: `src/components/piling/to/readiness/shifts/**`, shared tenant date/action/dialog components.
- Dependencies: TR-401.
- GitNexus impact: legacy `ShiftsScreen`, `ToModule`, any existing shared chart/timeline symbol before editing.
- Tests to unskip: E2E second-dispatcher conflict and blocker scenario; dispatcher handover segment after deterministic fixture reset exists.
- Validation: component tests and Playwright at 1440/1280/1024/390; real vertical mobile cards by 1024/390.
- Rollback: shifts tab flag falls back; commands can be disabled independently.
- Gate: loser of concurrent accept sees who/when/current state and no longer sees accept action.

### Phase 4 acceptance

- Permit gate on/off behaviors are both proven.
- Start, handover, and accept each leave aggregate/audit/outbox/idempotency evidence.
- Shift bar geometry uses server display interval; unresolved `plannedEndAt` must be settled in read model before visual gate.

## Phase 5 — Snapshots, trends, and equipment projection

### TR-500 — Production readiness evaluator and source adapters

- Deliverable: backend evaluator with explicit `now`, tenant timezone, immutable rule snapshot, authoritative inspection/FAULT|REPAIR/meter/maintenance/permit facts.
- Targets:
  - new `src/modules/readiness/domain/evaluation/**`;
  - refactor/adapt `src/modules/readiness/application/readiness-facts.ts`, `readiness-score.ts`, `readiness-rules.ts`;
  - transaction-injectable adapters around inspection/equipment commands.
- Dependencies: Phase 4.
- GitNexus impact: `computeReadinessScore`, `blockerTriggered`, `deriveEquipmentReadiness`, inspection complete, `addMeterReading`, maintenance create/update. Stop on HIGH/CRITICAL.
- Tests to unskip: all readiness evaluation cases in production domain suite.
- Validation: rule absent fail-closed; permit blocker on/off; timezone/DST; no client-shaped input or process-local clock.
- Rollback: keep old read-only computation behind legacy tab only; safety commands remain disabled if evaluator is rolled back.
- Gate: command and projection call the same evaluator contract.

### TR-501 — Outbox projection and immutable snapshots

- Deliverable: deduplicated projection consumer, captured calculation clock, atomic snapshot/projected marker, current/history read model.
- Targets: `src/modules/readiness/application/projection/**`, infrastructure repositories, readiness worker integration, Prisma snapshot/outbox/idempotency schema.
- Dependencies: TR-500.
- GitNexus impact: `outbox-worker`, unified worker outbox handler, inspection/meter/maintenance command symbols.
- Migration: `readiness_snapshots_outbox_idempotency`, constraints after backfill; then `readiness_start_snapshot_fk`.
- Tests to unskip: full integration write-pipeline suite progressively:
  - atomic source/audit/outbox/idempotency;
  - rollback on append failure;
  - one immutable snapshot/projected marker;
  - projection rollback;
  - latest current without history mutation.
- Validation: focused integration suite, duplicate delivery, delayed event clock, source rollback.
- Rollback: pause readiness projection consumer only; leave unrelated outbox consumers running; retain events for forward replay.
- Gate: duplicate delivery yields one snapshot and event remains retryable after failed projection.

### TR-502 — Backfill and current coverage

- Deliverable: resumable `(tenantId,id)` cursor, batch 200, `MIGRATION` snapshot provenance, per-tenant counts/error rows.
- Targets: new readiness backfill script/service and progress schema/migration.
- Dependencies: TR-501.
- GitNexus impact: equipment/source query repositories.
- Migration/seed: production-like copy rehearsal twice; no synthetic permits/shifts/approvals.
- Tests: resume/idempotency/count/preflight and old-code compatibility.
- Validation: every active equipment has current backfill/newer snapshot or explicit error; compare source/evidence samples.
- Rollback: stop backfill; resume from checkpoint after forward fix; never delete generated snapshots.
- Gate: coverage report is reconciled per tenant before current-read flag.

### TR-503 — Equipment/current/history/trend API and UI

- Deliverable: batch equipment summary, current snapshot, immutable history, trend projection, explainable evidence, active workflow panel; no N+1/client recompute.
- Targets:
  - `src/app/api/readiness/equipment/**`, snapshots/trend routes;
  - `src/components/piling/to/readiness/center/**`, `equipment/**`, initial `reports/readiness-trend*`;
  - remove production imports of `deriveEquipmentReadiness`.
- Dependencies: TR-501–TR-502.
- GitNexus impact: `deriveEquipmentReadiness`, current readiness route, legacy `ReadinessCentre`/`FleetScreen`.
- Tests: API/component/current-history convergence; E2E current snapshot assertion can activate for all roles.
- Validation: list query count/batching, snapshot immutability, p95 center target under production-like data.
- Rollback: `readiness_snapshots_v1` read flag returns legacy view; consumer may continue safely.
- Gate: every visible value has server read-model/query-metadata provenance.

### Phase 5 acceptance

- Source → write → audit/outbox → projection → immutable snapshot → current/history/trend → UI is demonstrated on a real isolated DB.
- Snapshot visibility SLO (95% under 5s) and center p95 (<1s target) are measured, not inferred.

## Phase 6 — Mechanics workload and maintenance

### TR-600 — Transactionalize reused inspection/meter/maintenance commands

- Deliverable: commands accept transaction client and append audit/outbox in the same transaction without changing legacy semantics.
- Targets:
  - `src/modules/inspections/application/commands/inspection-commands.ts`;
  - `src/modules/equipment/application/commands/meter-reading.ts`;
  - `equipment-maintenance.ts`, `maintenance-plan.ts`;
  - relevant API routes.
- Dependencies: Phase 5.
- GitNexus impact: each named existing command symbol individually; HIGH/CRITICAL stops work.
- Tests: existing command tests plus integration atomicity/rollback triggers for each source type.
- Validation: focused unit/integration tests and `detect_changes` affected flows review.
- Rollback: feature-gate readiness side effects while preserving legacy command execution; do not partially commit source without outbox when gate is on.
- Gate: all snapshot trigger matrix sources are transaction-safe.

### TR-601 — Mechanic workload projection/API

- Deliverable: workload summary grouped by mechanic/state/due condition, tenant scoped, bounded and batch queried.
- Targets: new readiness workload query/projector; `/api/readiness/maintenance/workload`; existing maintenance repositories only via adapters.
- Dependencies: TR-600.
- GitNexus impact: maintenance query/service symbols and assignee route.
- Tests: role/tenant/query-count/workload-state tests.
- Validation: contract/component tests; no load-all/N+1.
- Rollback: hide workload panel while leaving maintenance source paths intact.
- Gate: workload is a server projection and never a static UI counter.

### TR-602 — Maintenance/workload UI vertical slice

- Deliverable: real inspections, defects, meters, maintenance, plans, and workload sections with role/state actions and convergence.
- Targets: `src/components/piling/to/readiness/maintenance/**`; integrate existing maintenance panels through adapters.
- Dependencies: TR-601.
- GitNexus impact: `MaintenancePlansPanel`, `MeterReadingsPanel`, legacy `MaintenanceScreen`; update API must be used where editing is offered.
- Tests: component role/state/empty/error/pending tests; viewport smoke.
- Validation: focused component + source integration tests, Playwright mechanic workflow smoke.
- Rollback: maintenance tab flag returns existing read-only panel.
- Gate: green status means an actual completed inspection with date/executor, not merely configured components.

### Phase 6 acceptance

- MECHANIC and explicitly acting ADMIN can execute allowed work; DISPATCHER is read-only where specified.
- Maintenance changes converge to current readiness without manual reload and preserve historical snapshots.

## Phase 7 — Settings draft/publish

### TR-700 — Typed rule lifecycle and publication fanout

- Deliverable: semantic business version `vN.N`, integer optimistic `revision`, DRAFT/PUBLISHED/ARCHIVED lifecycle, atomic publish, deduplicated equipment fanout.
- Targets: Prisma `ReadinessRuleSet`; `readiness-rules.ts`, `readiness-rules-service.ts`; readiness-rules routes.
- Dependencies: Phase 5.
- GitNexus impact: `READINESS_CRITERION_KEYS`, `DEFAULT_READINESS_RULES`, rules service draft/publish functions, current routes.
- Migration: `readiness_rules_typed`; preflight malformed versions/duplicate live rules; never cast semantic version to integer.
- Seed: one published and one draft rule through services; production seed creates only missing timezone/default draft, never publishes.
- Tests: existing rules route tests plus publish race/fanout/current snapshot coverage; OpenAPI contract later finalized in Phase 11.
- Validation: focused domain/route/integration tests; exactly one published version and fanout coverage.
- Rollback: disable publish flag, retain drafts/published history and queued events.
- Gate: past snapshots retain original rule version; publish creates new snapshots only.

### TR-701 — Seven settings sections with honest contracts

- Deliverable: exactly seven settings sections. Rules are editable/publishable; other sections either use real endpoints/capabilities or render explicit read-only/unavailable states—never fake enabled controls.
- Targets: `src/components/piling/to/readiness/settings/**`; supporting routes only when their actual domain exists.
- Dependencies: TR-700.
- GitNexus impact: legacy `SettingsWorkspace`, `RulesSettings`, workspace settings, dictionary/notification/integration/audit settings integration points.
- Tests: type/DOM count of seven, capability/state/action tests, draft conflict recovery.
- Validation: component/route tests, 1440 and 390 browser checks.
- Rollback: section-level flags/read-only states; rules data remains intact.
- Gate: settings controls have real endpoint ownership or are visibly unavailable.

### Phase 7 acceptance

- Draft/publish is production-real and audited; no settings placeholder can mutate local-only state while appearing successful.

## Phase 8 — Real audit

### TR-800 — Switch audit repository/API from FeedbackEvent to AuditLog

- Deliverable: `/api/audit` reads hash-chained `AuditLog` only after shadow parity; entity/filter pagination; verification status represented neutrally unless verifier projection exists.
- Targets: `src/app/api/audit/route.ts`, new readiness audit repository/query, retire adapter usage of `src/services/audit/audit-history-service.ts` for this API.
- Dependencies: TR-203 shadow verification and Phase 7 workflow event coverage.
- GitNexus impact: current `/api/audit` GET, `getEntityHistory`, audit service; review all consumers before semantics switch.
- Migration: complete `audit_chain_v1` NOT NULL/trigger/grants gates only after mapping/quarantine and verification.
- Tests to unskip: audit domain suite already active; API cursor mismatch may activate here; add repository spy proving only `AuditLog` is queried.
- Validation: parallel-read parity report, tenant sequence verification, missing/cross-tenant safe responses.
- Rollback: revert reader only with security-owner acceptance; preserve chain/shadow writes.
- Gate: UI/API never present `FeedbackEvent` as safety audit.

### TR-801 — Audit report/detail UI

- Deliverable: server-backed list/detail, actor/entity/action/timezone fields, hash/sequence presentation, honest integrity language.
- Targets: `src/components/piling/to/readiness/reports/audit-*`, report route composition.
- Dependencies: TR-800.
- GitNexus impact: legacy `ReportsScreen` and any current audit consumers.
- Tests: component role/permission/detail/unknown-verification tests.
- Validation: focused tests and keyboard/mobile detail drawer checks.
- Rollback: hide audit view/export capability without altering chain.
- Gate: no electronic-signature or privileged-owner tamper-proof claim.

### Phase 8 acceptance

- Audit append, query, detail, verification, tenant isolation, and workflow attribution (`actorRole`, `actingAs`) are demonstrated end-to-end.

## Phase 9 — Filters, actions, and CSV

### TR-900 — Canonical URL/API filter schema and cursor

- Deliverable: one normalized filter model for URL, JSON API, cursor HMAC/filter hash, reset/back/reload/deep links, exact totals.
- Targets:
  - frontend `url/schema.ts`, `normalize.ts`, `use-readiness-url-state.ts`, `shared/shared-list-filters.tsx`;
  - backend common filter/cursor canonicalizer and list repositories.
- Dependencies: Phases 3–8 list endpoints.
- GitNexus impact: `parseView`, each existing list query integration point.
- Tests to unskip: API list envelope/total/filters/cursor and cursor-filter mismatch cases.
- Validation: property/unit tests, route contracts, UI reload/back/reset E2E.
- Rollback: retain server defaults; disable deep-link enhancements, never accept unsigned/mismatched cursor.
- Gate: URL, response `meta.filters`, repository predicate, and cursor filter hash are identical canonical data.

### TR-901 — Unified command action pipeline

- Deliverable: shared action gate/dialog lifecycle across permits, shifts, maintenance, settings; request cancellation, pending lock, one success announcement, conflict/domain recovery.
- Targets: frontend shared API/idempotency/action/dialog/query state components and each feature controller.
- Dependencies: TR-900.
- GitNexus impact: all edited existing feature controllers; avoid shared dirty UI control edits.
- Tests: state matrix for loading/error/empty/pending/success/409/422/403/404 and stale request cancellation.
- Validation: component tests plus keyboard-only command smoke.
- Rollback: per-feature controllers can retain their prior tested pipeline; no server rollback needed.
- Gate: double submit cannot produce duplicate command; stale response cannot overwrite newer filters/detail.

### TR-902 — Server CSV parity and bounded streaming

- Deliverable: `/api/audit/export.csv` uses the same filter parser/repository query as JSON; BOM, CRLF, RFC 4180, formula defense, headers, bounded pagination/cancel.
- Targets: audit export route/service, OpenAPI generator, frontend `reports/server-csv-export.tsx`.
- Dependencies: TR-800, TR-900.
- GitNexus impact: audit query repository, current report/export utilities; legacy browser `downloadCsv` must not be used.
- Tests to unskip: API JSON/CSV filter-hash parity case.
- Validation: exact byte/header tests, 100,000-row bound/`413`, client disconnect cancellation, memory measurement.
- Rollback: disable export capability/route; retain JSON audit.
- Gate: exported rows and timezone/filter hash match JSON query; formula cells are neutralized.

### Phase 9 acceptance

- Filters/actions/export operate consistently across all relevant tabs and roles.
- Client contains no browser-built audit CSV and no permission inference.

## Phase 10 — Final accessibility and responsive hardening

### TR-1000 — Full geometry matrix

- Deliverable: all seven views and settings at 1440×900, 1280×800, 1024×768, 390×844, and 200% zoom; cards replace critical mobile tables.
- Targets: feature-local readiness components/styles; shared CSS only with new impact approval.
- Dependencies: all UI slices.
- GitNexus impact: every existing shared layout/control symbol considered for edit.
- Tests: geometry assertions for visible interactive elements, sibling panels, sticky/fixed regions, text/control clipping.
- Validation: browser screenshots/DOM assertions; no page-level X-scroll or overlaps.
- Rollback: feature-local responsive changes per component; preserve functional API.
- Gate: UI Spec §13 viewport-specific acceptance is fully green.

### TR-1001 — WCAG/keyboard/screen-reader pass

- Deliverable: labels/names/descriptions, semantic tabs/tables/cards, focus trap/return, validation associations, live-region dedupe, contrast/motion review.
- Dependencies: TR-1000.
- Targets: all readiness feature components and local wrappers.
- Tests: automated axe with zero critical/serious, keyboard-only journeys, focus assertions, reduced-motion checks.
- Validation: desktop/mobile role journey accessibility scan.
- Rollback: revert only faulty presentation wrapper; commands remain server-safe.
- Gate: no critical/serious automated findings and all critical command journeys complete without pointer.

### TR-1002 — Performance/cancellation/observability

- Deliverable: bounded queries, cancellation, no N+1/load-all, p95 dashboards for center/commands/snapshot lag, conflict/outbox/DLQ/chain/tenant-denial metrics.
- Targets: query clients, repositories, worker and existing observability integration.
- Dependencies: TR-1000–TR-1001.
- GitNexus impact: observability/outbox worker/query integration symbols.
- Tests: production-like performance/cancellation probes.
- Validation: center p95 <1s target; commands excluding fanout <1.5s target; snapshot 95% <5s; report actual measured dataset/load.
- Rollback: feature/consumer flags and query limit reduction; never discard queued events.
- Gate: metrics and alerts distinguish API success from projection/audit failure.

### Phase 10 acceptance

- Visual review confirms approved composition and production states, not only a screenshot match.
- Responsive/a11y/performance evidence is retained with test run metadata.

## Phase 11 — Role E2E, security, and OpenAPI release gate

### TR-1100 — Complete isolated fixture and E2E harness

- Deliverable: deterministic isolated tenant reset/seed and verified session mechanism for ADMIN, MECHANIC, two DISPATCHERs, OPERATOR, and foreign tenant.
- Targets: `tests/fixtures/tech-readiness.fixture.ts`, test seed/harness modules, Playwright setup; test-only headers must be impossible outside test mode.
- Dependencies: all functional slices.
- GitNexus impact: auth/session test adapter and seed role-service integration points.
- Tests to unskip: entire E2E file only after each previously activated case passes independently.
- Validation: repeat each scenario twice and in shuffled order.
- Rollback: remove/disable test adapter in production build; keep fixtures.
- Gate: no E2E uses unauthenticated static screen or production/default tenant.

### TR-1101 — Full role/state E2E

- Deliverable: operator read-only, NORMAL permit+handover, ELEVATED two-person approval, concurrent accept recovery, blocker start; expand to all seven tabs, settings, filters, CSV, current snapshot.
- Targets: `e2e/tech-readiness-production.spec.ts` and helpers.
- Dependencies: TR-1100.
- Tests to unskip: all remaining E2E cases; remove suite-level skip.
- Validation: Chromium single worker for deterministic mutation journeys, then supported project matrix; 1440/1280/1024/390 and keyboard.
- Rollback: no product rollback; failing scenario blocks release.
- Gate: every claimed role workflow performs a real API-backed mutation/read and verifies resulting state.

### TR-1102 — Security/RLS/IDOR/CSRF/rate-limit review

- Deliverable: cross-tenant path/body/query/link attempts, unset/wrong RLS tenant, composite FK denial, CSRF/rate limits, redaction across audit/log/Sentry/outbox.
- Targets: readiness routes/repositories, tenant wrapper, audit/outbox, RLS migration.
- Dependencies: TR-1100.
- GitNexus checkpoint: `explain` on readiness route/command files plus impact review of security fixes; absence of a taint finding is not proof of safety.
- Migration: `readiness_rls_enforce` only now, after verified request/worker wrappers on new and reused source tables; `ENABLE` + `FORCE`, non-owner app/worker roles, no `BYPASSRLS`.
- Tests: all contract role/tenant cases plus DB security suite.
- Validation: wrong/unset tenant denies, missing/cross-tenant same safe `404`, secrets/contacts absent from all sinks.
- Rollback: command/read flags off and forward fix; do not replace fail-closed RLS with a silent allow-all policy.
- Gate: zero cross-tenant read/write/link and no context spoofing.

### TR-1103 — OpenAPI materialization and conformance

- Deliverable: all readiness/audit operations, enums/read models/actions/page/error/conflict, cookie auth, ETag/idempotency, examples, CSV headers.
- Targets: `scripts/generate-openapi.ts`, generated `public/openapi.json`, `/api/openapi`, generated client/types check artifacts.
- Dependencies: stable route contracts and TR-1102.
- GitNexus impact: generator exports and `/api/openapi` handler; inspect all generated-client consumers.
- Tests: remove suite-level skip from API contract file only after every case is bound/passing; request/response conformance, operationId/security lint.
- Validation:
  - preserve/review pre-existing dirty spec/generator diff;
  - `npm.cmd run openapi:generate`;
  - regenerate again and require no diff;
  - OpenAPI 3.0.3 validation;
  - `npm.cmd run test:contract`.
- Rollback: revert only this task’s generator/spec hunk; do not erase prior dirty OpenAPI work.
- Gate: generated spec is deterministic and matches real handlers, including exact error envelopes and CSV headers.

### TR-1104 — Migration/seed/upgrade and final quality gate

- Deliverable: production-like upgrade twice, backfill resume, old-code compatibility, full focused/full suites, build, security review, rollout/rollback runbook.
- Dependencies: TR-1100–TR-1103.
- GitNexus checkpoint: `detect_changes({scope:"compare", base_ref:"chore/april-accumulated-work"})` as required project comparator, plus task-branch/unstaged review; investigate every unexpected process.
- Migration order:
  1. `readiness_tenant_context`;
  2. `readiness_mechanic_role`;
  3. `readiness_workflows`;
  4. `readiness_snapshots_outbox_idempotency`;
  5. `audit_chain_v1`;
  6. `readiness_rules_typed`;
  7. `readiness_rls_enforce`;
  8. `readiness_start_snapshot_fk`.
- Seed: dev/test only uses role/rule/workflow services; production command creates missing timezone/default draft only.
- Validation:
  - `npm.cmd run db:check-migrations`;
  - `npm.cmd run db:generate`;
  - focused domain/contract/integration/E2E suites;
  - `npm.cmd run lint`;
  - `npx.cmd tsc --noEmit`;
  - `npm.cmd run build`;
  - security reviewer approval or approved-with-notes.
- Rollback drill: disable audit shadow/read, snapshots read/consumer, permits, shifts, and commands independently in documented order; confirm no unrelated consumer stops and no data is removed.
- Gate: no skipped Tech Readiness acceptance case remains without an explicitly approved post-pilot issue; all migrations/backfill/security/OpenAPI/role journeys pass.

## 4. Release rollout

Feature flags and order:

1. `readiness_audit_chain_v1`: shadow append and verifier only.
2. `readiness_snapshots_v1`: backfill plus read-only center/equipment/trend.
3. `readiness_permits_v1`: permit commands for pilot tenant.
4. `readiness_shifts_v1`: shift/handover commands for pilot tenant allowlist.
5. Audit API/CSV switch after parity and security-owner gate.
6. Expand tenant allowlist only after p95, lag, conflicts, DLQ, audit-chain, and tenant-denial metrics remain within agreed thresholds.

Production enablement is a separate explicit approval. This Work Plan authorizes implementation planning and, after batch approval, repository-local implementation/testing only.

## 5. Risk register

| Risk | Impact | Required mitigation/gate |
|---|---|---|
| Dirty overlapping schema/OpenAPI/layout/readiness files | User work overwritten or mixed commits | TR-000 ledger, targeted patches, per-task diff and commit, never reset/clean |
| GitNexus index stale | Incorrect blast-radius claims | Check context freshness; re-analyze before impact work |
| `VALID_WORK_PERMIT_REQUIRED` absent/incompatible | Shift gate cannot meet PRD | Add typed versioned criterion in TR-300/TR-500 before enabling shifts |
| Existing RLS is fail-open when tenant setting absent | Cross-tenant exposure | Tenant wrapper first; enforce RLS only in TR-1102 after all paths pass |
| Existing source commands cannot share a transaction | Source commits without outbox/audit | TR-600 transactional adapters before source triggers are enabled |
| Audit API currently reads FeedbackEvent | False audit history | Shadow parity then explicit TR-800 switch; repository test |
| Legacy audit rows lack tenant | Invalid chain or silent default assignment | Approved manifest or quarantine; migration preflight abort |
| Settings sections lack backend ownership | Fake controls/placeholders | Honest unavailable/read-only state until real endpoint exists |
| Shift display interval unresolved | Incorrect bar geometry | Add server read-model interval before TR-402 gate |
| Snapshot lag/stale UI | Operator acts on old status | Authoritative command gate, stale banner, bounded convergence refetch, SLO |
| Client action inference | Unauthorized/confusing controls | Server capabilities/actions only; direct API RBAC tests |
| Generated suite unskipped too early | False red pipeline/noise | Per-case graduation rule and real harness binding |
| Audit hash overclaim | Compliance misrepresentation | Use limited tamper-evidence language; external anchoring is separate |
| CSV formula/memory exposure | Security/availability incident | Formula neutralization, bounded streaming, cancellation, 100k limit |
| Test-only auth headers leak | Authentication bypass | Compile/runtime hard gate and production-negative test |

## 6. Batch approval summary

One batch approval may authorize repository-local execution of TR-100 through TR-1104, including:

- additive migrations in disposable/dev/test databases;
- dev/test seed and backfill rehearsals;
- progressive generated-test unskipping;
- deterministic OpenAPI regeneration after dirty-diff preservation;
- per-task quality-fixer and narrow commits;
- local HTTP browser and role scenario testing.

The approval does **not** authorize:

- production migration, production seed, feature-flag enablement, tenant allowlist change, or deploy;
- destructive database rollback/drop/truncate/rechain;
- overwriting, resetting, cleaning, staging, or committing unrelated dirty files;
- assigning production users to `MECHANIC`;
- accepting HIGH/CRITICAL GitNexus blast radius without a new explicit sequence decision;
- resolving open security-owner decisions (audit retention/dispatcher permission/external anchoring) by assumption.

Approval gate wording:

> Approve Phases 1–11 as one implementation batch under the dirty-tree ledger, GitNexus checkpoints, per-task quality/commit cycle, disposable-database migration/seed scope, and non-production rollback boundaries defined in this Work Plan.

## 7. Final Definition of Done

Production Tech Readiness is ready for pilot only when:

1. seven module views and seven settings sections run inside the existing shell with no duplicate navigation;
2. permits precede and correctly gate shifts; all workflow transitions, concurrency, idempotency, and conflict recovery pass;
3. source writes atomically reach audit/outbox, immutable snapshots, current/history/trend/workload read models, and UI;
4. audit API/CSV reads only masked, hash-chained `AuditLog`;
5. every route/relation/read model is tenant scoped, fail-closed, and role/capability tested;
6. URL/API/CSV filters and filter hash are identical;
7. no production UI uses mocks, client readiness derivation, browser CSV, or fake enabled settings;
8. accessibility/responsive geometry passes all target viewports and keyboard journeys;
9. migration/backfill upgrade-twice, RLS, security, OpenAPI, contract, integration, role E2E, typecheck, lint, and build gates are green;
10. `detect_changes` shows only expected symbols/processes and unrelated current changes remain untouched;
11. rollout flags can stop writes/reads/consumer independently without deleting workflow, snapshot, or audit data.
