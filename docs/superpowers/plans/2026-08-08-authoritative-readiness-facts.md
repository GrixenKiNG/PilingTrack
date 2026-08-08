# Authoritative Readiness Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every decision-bearing element of the technical-readiness center derive from the persisted authoritative snapshot facts, while marking old snapshots with missing facts as incomplete historical evidence.

**Architecture:** Add a nullable JSON `facts` column to immutable readiness snapshots and populate it only for newly evaluated snapshots through the existing central repository. Expose and validate those facts at the API boundary, convert snapshots into a single presentation model, and make the center render only that model; legacy client calculations remain available outside the center but cannot silently influence its decision.

**Tech Stack:** PostgreSQL, Prisma 7, Next.js 16 route handlers, React 19, TypeScript 6, Zod 4, Vitest, Testing Library, Playwright.

## Global Constraints

- Existing snapshots keep `facts = null`; do not infer or backfill historical facts from mutable current rows.
- Every newly created authoritative snapshot persists the exact `AuthoritativeReadinessFacts` used by the evaluator.
- Current and history APIs expose `facts` as the exact object or `null`.
- Status, score, blockers, warnings, next action, five stages, and evidence cards in the readiness center come from one authoritative presentation model.
- A legacy snapshot with `facts = null` is labelled `Исторические доказательства неполны`.
- Missing or malformed authoritative data produces an explicit unconfirmed/blocked-safe state, never a legacy fallback.
- Preserve tenant isolation, RBAC, audit/idempotency behavior, immutable snapshot semantics, state machines, the global shell, one left menu, and one tab row.
- Do not add a second scoring engine, a new dependency, or a broad UI redesign.
- Before modifying an existing function or component, run package-scoped GitNexus impact analysis and record any HIGH/CRITICAL risk.
- Before each commit, run GitNexus change detection and stage only files belonging to this feature.

---

### Task 1: Nullable snapshot facts schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260808130000_readiness_snapshot_facts/migration.sql`
- Modify: `tests/integration/tech-readiness-projection.spec.ts`

**Interfaces:**
- Produces: `ReadinessScoreSnapshot.facts: Prisma.JsonValue | null` in the generated client.
- Preserves: all existing rows with SQL `NULL` in `facts`.

- [ ] **Step 1: Write the failing migration assertion**

Add the migration path to `migrationPaths`, create the fixture table without `facts`, apply the migration, and assert nullability:

```ts
const columns = await sql.query<{is_nullable: string; data_type: string}>(`
  SELECT is_nullable, data_type
  FROM information_schema.columns
  WHERE table_name = 'ReadinessScoreSnapshot' AND column_name = 'facts'
`);
expect(columns.rows).toEqual([{is_nullable: 'YES', data_type: 'jsonb'}]);
```

- [ ] **Step 2: Run the focused integration test and verify failure**

Run: `npm.cmd run test:integration -- tests/integration/tech-readiness-projection.spec.ts`

Expected: FAIL because the migration file/column does not exist. If `DATABASE_URL_POSTGRES` is absent, record the test as skipped and additionally verify the SQL with the migration checker in Step 5.

- [ ] **Step 3: Add the nullable Prisma field and additive SQL migration**

In `ReadinessScoreSnapshot` add:

```prisma
facts          Json?
```

Create the migration:

```sql
ALTER TABLE "ReadinessScoreSnapshot"
ADD COLUMN "facts" JSONB;
```

Do not set a default and do not run an `UPDATE`; pre-existing snapshots must remain `NULL`.

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npm.cmd run db:generate`

Expected: exit 0 and generated `ReadinessScoreSnapshot` types include nullable `facts`.

- [ ] **Step 5: Run schema and migration verification**

Run: `npm.cmd run db:check-migrations`

Run: `npm.cmd run test:integration -- tests/integration/tech-readiness-projection.spec.ts`

Expected: migration check passes; integration test passes or is explicitly skipped only because disposable PostgreSQL is unavailable.

- [ ] **Step 6: Commit the schema slice**

```powershell
git add prisma/schema.prisma prisma/migrations/20260808130000_readiness_snapshot_facts/migration.sql tests/integration/tech-readiness-projection.spec.ts src/generated/postgres-client
git commit -m "feat: add nullable facts to readiness snapshots"
```

### Task 2: Persist exact facts in every new snapshot

**Files:**
- Modify: `src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts`
- Modify: `tests/integration/tech-readiness-projection.spec.ts`
- Modify: `tests/integration/tech-readiness-shifts.spec.ts`

**Interfaces:**
- Consumes: `AuthoritativeEvaluation.facts: AuthoritativeReadinessFacts`.
- Produces: immutable snapshot rows whose `facts` JSON equals `evaluation.facts`.

- [ ] **Step 1: Extend the repository integration test with exact round-trip assertions**

After `createDeduplicatedSnapshot`, assert:

```ts
const stored = await prisma.readinessScoreSnapshot.findUniqueOrThrow({
  where: {id: first.id},
  select: {facts: true},
});
expect(stored.facts).toEqual(facts);
```

In the shift integration fixture, add nullable `"facts" JSONB` to the manual table definition and assert the blocked and corrected `SHIFT_START_DECISION` rows both have non-null facts matching their decisions.

- [ ] **Step 2: Run the two integration files and verify failure**

Run: `npm.cmd run test:integration -- tests/integration/tech-readiness-projection.spec.ts tests/integration/tech-readiness-shifts.spec.ts`

Expected: FAIL because newly inserted snapshots currently leave `facts` null.

- [ ] **Step 3: Extend the central insert with evaluation facts**

Change the raw insert column/value lists in `createDeduplicatedSnapshot`:

```ts
INSERT INTO "ReadinessScoreSnapshot"
  (..., "blockers", "warnings", "evidence", "facts", "factsHash", "calculatedAt")
VALUES
  (..., ${JSON.stringify(evaluation.blockers)}::jsonb,
   ${JSON.stringify(evaluation.warnings)}::jsonb,
   ${JSON.stringify(evaluation.evidence)}::jsonb,
   ${JSON.stringify(evaluation.facts)}::jsonb,
   ${factsHash}, ${evaluation.calculatedAt})
```

Keep deduplication identity and `factsHash` computation unchanged so retries return the original immutable row.

- [ ] **Step 4: Run the focused integration tests**

Run: `npm.cmd run test:integration -- tests/integration/tech-readiness-projection.spec.ts tests/integration/tech-readiness-shifts.spec.ts`

Expected: PASS, including exact persisted facts for projection and shift-start snapshots.

- [ ] **Step 5: Run caller coverage**

Run: `npm.cmd run test:integration -- tests/integration/tech-readiness-write-pipeline.spec.ts tests/integration/tech-readiness-projection.spec.ts tests/integration/tech-readiness-shifts.spec.ts`

Expected: PASS; projection, backfill-triggered code paths, and direct shift decisions continue using the same repository.

- [ ] **Step 6: Commit persistence**

```powershell
git add src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts tests/integration/tech-readiness-projection.spec.ts tests/integration/tech-readiness-shifts.spec.ts
git commit -m "feat: persist authoritative readiness facts"
```

### Task 3: Runtime-validated current and history API contracts

**Files:**
- Modify: `src/app/api/readiness/current/route.ts`
- Modify: `src/app/api/readiness/history/route.ts`
- Modify: `src/components/piling/to/readiness/api/contracts.ts`
- Modify: `src/components/piling/to/readiness/api/client.ts`
- Modify: `src/components/piling/to/readiness/api/__tests__/contracts.test.ts`
- Modify: `src/components/piling/to/readiness/api/__tests__/client.test.ts`
- Modify: `tests/contract/tech-readiness-api.spec.ts`

**Interfaces:**
- Produces: `AuthoritativeReadinessFactsDto`, `CurrentReadinessDto.facts`, `ReadinessSnapshotDto.facts`.
- Produces: `parseCurrentReadinessResponse(value)` and `parseReadinessHistoryResponse(value)` that reject malformed facts.

- [ ] **Step 1: Add contract tests for full, legacy, and malformed facts**

Use the exact 12-field shape:

```ts
const completeFacts = {
  inspectionCompleted: true,
  inspectionProgress: 1,
  healthScore: 97,
  meterKnown: true,
  permitValid: true,
  permitExpired: false,
  maintenanceConfigured: true,
  maintenanceOverdueHours: 0,
  maintenanceOverdueDays: 0,
  accepted: true,
  criticalDefect: false,
  findings: 0,
};
```

Assert that a response with `facts: completeFacts` parses, `facts: null` parses, and a response with a missing boolean or `inspectionProgress: "1"` throws.

- [ ] **Step 2: Run the contract/client tests and verify failure**

Run: `npx.cmd vitest run src/components/piling/to/readiness/api/__tests__/contracts.test.ts src/components/piling/to/readiness/api/__tests__/client.test.ts tests/contract/tech-readiness-api.spec.ts`

Expected: FAIL because current/history responses are unchecked and their DTOs do not contain facts.

- [ ] **Step 3: Define strict Zod schemas and inferred DTOs**

In `contracts.ts`, define a strict facts schema:

```ts
export const authoritativeReadinessFactsSchema = z.object({
  inspectionCompleted: z.boolean(),
  inspectionProgress: z.number().min(0).max(1),
  healthScore: z.number().min(0).max(100).nullable(),
  meterKnown: z.boolean(),
  permitValid: z.boolean().nullable(),
  permitExpired: z.boolean(),
  maintenanceConfigured: z.boolean(),
  maintenanceOverdueHours: z.number().min(0),
  maintenanceOverdueDays: z.number().min(0),
  accepted: z.boolean(),
  criticalDefect: z.boolean(),
  findings: z.number().int().min(0),
}).strict();
```

Add `facts: authoritativeReadinessFactsSchema.nullable()` to current/history schemas and export types inferred from those schemas. Define response envelope schemas matching `readinessResponse` (`data`, `page`, and `filters` where applicable).

- [ ] **Step 4: Make API routes explicitly serialize facts**

In both routes return:

```ts
facts: item.facts ?? null,
```

Keep tenant filtering, date serialization, `factsHash` hex encoding, correlation IDs, and paging unchanged.

- [ ] **Step 5: Parse at the client boundary**

Replace generic casts in `fetchCurrentReadiness` and `fetchReadinessHistory` with the new response parsers. A schema mismatch must reject the request and be handled by the existing query error path; it must not become `[]` inside the API client.

- [ ] **Step 6: Run focused contract tests**

Run: `npx.cmd vitest run src/components/piling/to/readiness/api/__tests__/contracts.test.ts src/components/piling/to/readiness/api/__tests__/client.test.ts tests/contract/tech-readiness-api.spec.ts`

Expected: PASS for full and null facts; PASS for rejection of malformed facts.

- [ ] **Step 7: Commit API contracts**

```powershell
git add src/app/api/readiness/current/route.ts src/app/api/readiness/history/route.ts src/components/piling/to/readiness/api tests/contract/tech-readiness-api.spec.ts
git commit -m "feat: expose validated readiness facts"
```

### Task 4: Single authoritative presentation adapter

**Files:**
- Create: `src/components/piling/to/readiness/authoritative-presentation.ts`
- Create: `src/components/piling/to/readiness/authoritative-presentation.test.ts`

**Interfaces:**
- Consumes: `CurrentReadinessDto | ReadinessSnapshotDto | null`.
- Produces: `buildAuthoritativeReadinessPresentation(snapshot): AuthoritativeReadinessPresentation`.
- Produces modes: `'authoritative' | 'historical-incomplete' | 'missing' | 'malformed'`.

- [ ] **Step 1: Write table-driven presentation tests**

Cover at least:

```ts
it.each([
  ['READY facts', readySnapshot, 'authoritative', 'READY'],
  ['BLOCKED facts', blockedSnapshot, 'authoritative', 'BLOCKED'],
  ['legacy null facts', legacySnapshot, 'historical-incomplete', 'UNCONFIRMED'],
  ['missing snapshot', null, 'missing', 'UNCONFIRMED'],
  ['malformed snapshot', malformedSnapshot, 'malformed', 'UNCONFIRMED'],
])('%s', (_name, snapshot, mode, status) => {
  expect(buildAuthoritativeReadinessPresentation(snapshot as never)).toMatchObject({mode, status});
});
```

Also assert READY/BLOCKED models contain five stage cards in order (`INSPECTION`, `ENGINE_HOURS`, `PERMIT`, `MAINTENANCE`, `ACCEPTANCE`), evidence cards from snapshot evidence/facts, blocker/warning copy, and a deterministic next action.

- [ ] **Step 2: Run the adapter test and verify failure**

Run: `npx.cmd vitest run src/components/piling/to/readiness/authoritative-presentation.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the explicit presentation type**

Define:

```ts
export interface AuthoritativeReadinessPresentation {
  mode: 'authoritative' | 'historical-incomplete' | 'missing' | 'malformed';
  status: 'READY' | 'BLOCKED' | 'UNCONFIRMED';
  score: number | null;
  title: string;
  description: string;
  nextAction: string;
  blockers: readonly PresentationNotice[];
  warnings: readonly PresentationNotice[];
  stages: readonly [PresentationStage, PresentationStage, PresentationStage, PresentationStage, PresentationStage];
  evidence: readonly PresentationEvidence[];
  calculatedAt: string | null;
  ruleSetVersion: string | null;
}
```

Build `authoritative` strictly from persisted `status`, `score`, `blockers`, `warnings`, `evidence`, and `facts`. For null facts return `historical-incomplete` with title `Исторические доказательства неполны`. For null/malformed input return `UNCONFIRMED`, null score, and a safe next action instructing the user to run or refresh authoritative evaluation. Never import `deriveEquipmentReadiness`, `computeReadinessScore`, or legacy UI facts.

- [ ] **Step 4: Run adapter tests**

Run: `npx.cmd vitest run src/components/piling/to/readiness/authoritative-presentation.test.ts`

Expected: PASS for all four modes and both authoritative verdicts.

- [ ] **Step 5: Commit the adapter**

```powershell
git add src/components/piling/to/readiness/authoritative-presentation.ts src/components/piling/to/readiness/authoritative-presentation.test.ts
git commit -m "feat: add authoritative readiness presentation"
```

### Task 5: Switch the readiness center to the authoritative model

**Files:**
- Modify: `src/components/piling/to/readiness-reference-ui.tsx`
- Modify: `src/components/piling/to/to-module.tsx`
- Create: `src/components/piling/to/__tests__/readiness-reference-authority.test.tsx`
- Modify: `src/components/piling/to/__tests__/to-module-shell.test.tsx`

**Interfaces:**
- Consumes: `buildAuthoritativeReadinessPresentation(authoritativeCurrent)`.
- Preserves: props/data needed by non-center tabs and the existing shell/tab structure.

- [ ] **Step 1: Write UI tests proving authoritative-only behavior**

Render the center with conflicting inputs: an authoritative BLOCKED snapshot and legacy READY calculation. Assert BLOCKED status, authoritative score/blocker/next action/five stages are shown and legacy READY text/score are absent.

Render `facts: null` and assert `Исторические доказательства неполны` plus no legacy status/score. Render no snapshot and assert explicit unconfirmed state. Add a source guard:

```ts
expect(readinessReferenceSource).not.toMatch(/scoreResult\?\.score\s*\?\?/);
expect(readinessReferenceSource).not.toMatch(/authoritativeCurrent\?\.score\s*\?\?/);
```

- [ ] **Step 2: Run the UI tests and verify failure**

Run: `npx.cmd vitest run src/components/piling/to/__tests__/readiness-reference-authority.test.tsx src/components/piling/to/__tests__/to-module-shell.test.tsx`

Expected: FAIL because status, blockers, next action, and stages still come from legacy calculations and score has fallback chaining.

- [ ] **Step 3: Replace the center calculation with the adapter**

At the selected-equipment boundary:

```ts
const authoritativeCurrent = props.currentReadiness.find((item) => item.equipmentId === selected.id) ?? null;
const presentation = buildAuthoritativeReadinessPresentation(authoritativeCurrent);
```

Render every decision-bearing center element from `presentation`: badge/title, ring/score, blockers, warnings, next action, all five stages, evidence cards, timestamp, and rule version. Use explicit `historical-incomplete`, `missing`, and `malformed` callouts. Remove center-only uses of `readiness`, `scoreResult`, and legacy `facts`; do not remove data still needed by reports/settings/other tabs.

- [ ] **Step 4: Keep loading and API failure distinct from no snapshot**

In `to-module.tsx`, preserve the current query error instead of converting authoritative current/history fetch failures to empty arrays. Pass loading/error state to the center so a network or schema failure displays `Авторитетная оценка недоступна`, while a successful empty response displays `Авторитетная оценка ещё не выполнена`.

- [ ] **Step 5: Run focused component tests**

Run: `npx.cmd vitest run src/components/piling/to/__tests__/readiness-reference-authority.test.tsx src/components/piling/to/__tests__/to-module-shell.test.tsx src/components/piling/to/readiness/tech-readiness-module.test.tsx`

Expected: PASS; shell test still proves one module tab row and existing global composition.

- [ ] **Step 6: Commit the center switch**

```powershell
git add src/components/piling/to/readiness-reference-ui.tsx src/components/piling/to/to-module.tsx src/components/piling/to/__tests__
git commit -m "feat: render readiness center from authoritative snapshots"
```

### Task 6: Contract and regression verification

**Files:**
- Modify only if a failing test exposes a feature-owned defect.

**Interfaces:**
- Verifies the complete path: evaluator facts → immutable snapshot → current/history API → strict client → presentation → center UI.

- [ ] **Step 1: Run the focused unit and contract suite**

Run:

```powershell
npx.cmd vitest run src/modules/readiness/domain/evaluation/__tests__/evaluator.test.ts src/components/piling/to/readiness/authoritative-presentation.test.ts src/components/piling/to/readiness/api/__tests__/contracts.test.ts src/components/piling/to/readiness/api/__tests__/client.test.ts src/components/piling/to/__tests__/readiness-reference-authority.test.tsx tests/contract/tech-readiness-api.spec.ts
```

Expected: PASS with no skipped unit/contract assertions.

- [ ] **Step 2: Run readiness integration coverage**

Run:

```powershell
npm.cmd run test:integration -- tests/integration/tech-readiness-write-pipeline.spec.ts tests/integration/tech-readiness-projection.spec.ts tests/integration/tech-readiness-shifts.spec.ts
```

Expected: PASS when disposable PostgreSQL is configured. If skipped, report it plainly and do not claim database proof.

- [ ] **Step 3: Run static checks**

Run: `npm.cmd run lint`

Run: `npx.cmd tsc --noEmit`

Run: `npm.cmd run db:check-migrations`

Expected: all exit 0; no text-integrity regression in Russian UI copy.

- [ ] **Step 4: Run the production build**

Run: `npm.cmd run build`

Expected: exit 0 and readiness current/history routes compile with the generated nullable facts type.

- [ ] **Step 5: Inspect the final diff and detect changed symbols**

Run: `git status --short`

Run package-scoped GitNexus `detect_changes`; confirm no unrelated dirty files are staged and no unexpected dependent flow was changed.

- [ ] **Step 6: Commit any verification-only fixes**

Stage only feature-owned files and commit:

```powershell
git commit -m "test: verify authoritative readiness evidence flow"
```

Skip this commit if verification required no code changes.

### Task 7: Desktop/mobile and role smoke proof

**Files:**
- Create: `tests/e2e/authoritative-readiness-center.spec.ts`
- Create: `output/playwright/authoritative-readiness-desktop.png`
- Create: `output/playwright/authoritative-readiness-mobile.png`

**Interfaces:**
- Verifies: ADMIN/DISPATCHER can view the center; an unauthorized role cannot gain readiness access; desktop and mobile retain the approved shell and authoritative evidence warning behavior.

- [ ] **Step 1: Add a browser scenario with deterministic seeded snapshots**

The test must log in through the existing auth fixture, open the readiness center, select equipment with a complete authoritative snapshot, and assert status/score/five stages. It must then select an equipment or seeded historical record with `facts = null` and assert `Исторические доказательства неполны`. Reuse existing login/seed helpers; do not introduce image hotspots or a second navigation shell.

- [ ] **Step 2: Run desktop Chromium smoke**

Run: `npx.cmd playwright test tests/e2e/authoritative-readiness-center.spec.ts --project=chromium --workers=1`

Expected: PASS and screenshot at `output/playwright/authoritative-readiness-desktop.png`.

- [ ] **Step 3: Run mobile viewport smoke**

Run the same test at the repository's mobile project/viewport.

Expected: PASS, no horizontal loss of decision controls, screenshot at `output/playwright/authoritative-readiness-mobile.png`.

- [ ] **Step 4: Run role-access smoke**

Assert ADMIN and DISPATCHER access according to current capabilities, and assert the existing denied behavior for a role without `readiness.read`. Do not broaden RBAC to make the test pass.

- [ ] **Step 5: Commit browser coverage**

```powershell
git add tests/e2e/authoritative-readiness-center.spec.ts
git commit -m "test: cover authoritative readiness center workflows"
```

Keep generated screenshots as evidence artifacts unless repository policy explicitly tracks them.
