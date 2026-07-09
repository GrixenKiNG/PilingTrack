---
name: pilingtrack-testing-and-evidence
description: PilingTrack's test taxonomy, evidence standards, and test-authoring rules under the owner's keep-tests-lean constraint. Use when writing, adding, extending, moving, or deleting tests; choosing a test type (unit/contract/integration/e2e/smoke); deciding whether a new test file is justified; when the coverage gate fails; when asking "is this evidence enough / is this really verified"; or when triaging audit or agent findings that claim something is broken, untested, or fake.
---

# PilingTrack — Testing and Evidence

Last full verification against the repo: **2026-07-08**. Every path, script, and
threshold below was read from the working tree on that date. Counts that could
not be re-derived are marked "reported".

This skill owns the **philosophy, taxonomy, and authoring rules** for tests in
PilingTrack, and the project's standard for what counts as **evidence**. The
mechanical pre-merge/pre-deploy gate sequence is owned by the `qa-checklist`
skill — cross-referenced, not duplicated here.

---

## 1. The central tension (read this first)

Two rules in this project pull in opposite directions. Both are real. Hold both.

**Rule A — keep tests lean (owner rule).** The project owner is a
non-programmer who reads diffs and file trees directly. A growing pile of
`__tests__` files reads to them as clutter, not safety. They have pushed back
on test volume more than once. Default:

- **No new test files.** Add necessary checks to the existing `__tests__` file
  for that module.
- Write only **essential guards** — especially the one test that protects an
  irreversible/destructive or security operation.
- Skip low-value coverage-filler tests entirely.

**Rule B — security code is test-first, always (CLAUDE.md rule).** For
`src/services/auth/`, `src/core/security/`, and `src/lib/rate-limiter.ts`:
write a test that reproduces the behavior, then change the code. Never
refactor these "cleanly" without tests.

### Resolution discipline

| Situation | Verdict |
|---|---|
| Test guards auth, tokens, rate limits, tenant isolation, or a destructive op (delete/wipe/revoke) | **Always justified.** New file allowed if no existing home fits. |
| Bugfix anywhere | One regression test that reproduces the bug. Put it in the module's existing `__tests__` file. |
| New pure logic (calculations, filters, formatting) | Extract into a plain module and test that (see the extraction pattern below). |
| "This module has no tests, let me scaffold a suite" | **No.** That is exactly the clutter the owner objects to. |
| Broad DOM/component test scaffolding | No, unless the component itself is the bug. |

If omitting a test shifts data-loss or security risk onto the owner, **say so
plainly** instead of silently skipping — that is their call to make, not yours.

### The extraction pattern (proven, use it)

Instead of testing a React component, extract its pure logic into a plain
`.ts` module and unit-test that. This was done deliberately in 2026-06 for
three rebuilt screens, and it is the house style:

| Screen | Extracted module | Test |
|---|---|---|
| Fleet/equipment | `src/components/piling/admin-equipment/fleet-filter.ts` | `src/components/piling/admin-equipment/__tests__/fleet-filter.test.ts` |
| ТО (maintenance) | `src/components/piling/to/to-stats.ts` | `src/components/piling/to/__tests__/to-stats.test.ts` |
| Dispatcher dashboard | `src/components/piling/dashboard-kpis.ts` | `src/components/piling/__tests__/dashboard-kpis.test.ts` |

New screen logic goes into a module like these and gets one focused test —
not into the component, and not into a new component-test harness.

---

## 2. Test taxonomy

Definitions used in this project:

- **Contract test** — freezes the JSON request/response *shape* of an API
  route using schemas written inline in the test. If a field is renamed or a
  role enum grows, the contract test fails. The contract IS the test: do not
  import schemas from production code, or a rename would silently pass.
- **Smoke test** — a minimal end-to-end proof against the *real built server*
  that login, role boundaries, and logout work. Not a browser test.
- **Golden / trusted anchor** — a test that encodes a settled decision or a
  closed incident. Do not delete or weaken one without owner sign-off.

### The table (verified 2026-07-08)

| Type | Location | Command | What it proves |
|---|---|---|---|
| Unit | `src/**/__tests__/*.test.ts(x)` — 150 files | `npm run test:unit` (= `vitest run`) | Pure logic, route handlers with mocked deps, some components. Runs in `happy-dom`, setup `src/test/setup.ts`, alias `@` → `src/`. |
| Contract | `tests/contract/*.spec.ts` — 3 files: `auth-api`, `sync-api`, `telemetry-ingest` | `npm run test:contract` | Frozen request/response shapes for auth (and sync/telemetry) endpoints. |
| Integration | `tests/integration/*.spec.ts` — 5 files | `npm run test:integration` | Cross-layer helpers exercised **in-process with mocked Prisma** — see the limitation below. |
| E2E | `e2e/*.spec.ts` at **repo root** — 10 specs + fixtures/page-objects | `npm run test:e2e` (= `npx playwright test`) | Real browser flows against a dev server on `:3000`. Projects: chromium, Mobile Safari (iPhone 13), Mobile Chrome (Galaxy S20), plus an `unauthenticated` project matching only `login.spec.ts`. Locale `ru-RU`, TZ Europe/Moscow, 60s test timeout. |
| Smoke | `scripts/smoke-auth-access.js` | `npm run test:smoke:auth-access` (**runs `npm run build` first**) | Boots the built standalone server on `127.0.0.1:3101`, creates real DB fixtures via Prisma (needs `DATABASE_URL` from `.env`), then asserts: readiness OK; unauthenticated `/api/auth/me` → 401; admin login → 200 and can reach `/api/users` and `/api/system`; operator login works but gets **403** on `/api/users`; logout clears the session (next call 401). |
| Coverage | v8 provider via vitest | `npm run test:coverage` (= `vitest run --coverage`) | Ratchet-floor thresholds — see below. |

`npm run test` = unit then e2e. `npm run verify` is the full merge gate
(migrations check → lint → typecheck → unit → build → smoke) — its step-by-step
use lives in the `qa-checklist` skill.

### Placement traps (these silently skip your test)

Verified from `vitest.config.ts` `include`/`exclude` and
`playwright.config.ts` `testDir` on 2026-07-08:

1. Vitest only picks up `src/**/*.test.{ts,tsx}`, `tests/contract/**/*.spec.ts`,
   and `tests/integration/**/*.spec.ts`. A `.spec.ts` under `src/` or a
   `.test.ts` under `tests/` **never runs**. Naming rule: `*.test.ts` in
   `src/`, `*.spec.ts` in `tests/`.
2. Playwright's `testDir` is `./e2e` (repo root). `tests/e2e-archive/` and
   `tests/chaos/` are archives, explicitly excluded from vitest and invisible
   to Playwright. Never add a spec there expecting it to run.
3. Route-handler unit tests live next to the route:
   `src/app/api/<route>/__tests__/route.test.ts` — follow that convention.

### The integration-test limitation (flag it, don't fake it)

The files in `tests/integration/` do **not** boot a database. Quoting
`tests/integration/tenant-isolation.spec.ts`: *"These tests do not boot a real
database. They exercise the helpers in isolation against deterministic inputs
and mock the Prisma transaction surface where needed."* There is no
docker-backed DB integration harness in this repo. If a change genuinely needs
one (e.g. verifying RLS against real Postgres), **flag it to the user** — per
CLAUDE.md, integration tests are limited; do not simulate infrastructure that
does not exist. The closest real-infra proof available today is the smoke test
(real built server + real DB) and manual verification against the local Docker
Postgres.

### Coverage: a ratchet floor, not a target

From `vitest.config.ts` (verified 2026-07-08):

```
thresholds: { lines: 24, statements: 23, functions: 19, branches: 19 }
```

The in-file comment is the policy: *"Ratchet floor, not target. Set just below
current actual (lines 24.1 / statements 23.3 / functions 19.9 / branches 19.6)
so a PR that adds code without tests trips the gate. Bump these up whenever
coverage grows — never down without a deliberate reason."*

- If the coverage gate fails, you added code without tests — add the one
  right test, don't lower the floor.
- Never chase a coverage number by writing filler tests (violates Rule A).
- Deliberate exclusions (do not "fix"): `src/components/ui/**` (shadcn
  primitives) and `src/services/telemetry/mqtt-ingestion-service.ts` (dormant
  MQTT ingestion trips a rolldown PARSE_ERROR in the v8 remapper).

---

## 3. Evidence standards — what "verified" means here

### 3.1 Failing-then-passing, or it proves nothing

For a bugfix, the evidence is a test that **failed before the fix and passes
after**. Write the repro test first, run it, watch it go red, then fix. A test
written after the fix that has never failed demonstrates nothing about the
bug. Name the incident in the test text — the house example is
`src/core/security/__tests__/refresh-tokens.test.ts`, whose describe block
reads `'concurrent rotation of the SAME token (audit finding #2)'`. Future
readers can trace the test to its incident.

### 3.2 Verify against code before trusting ANY audit/roadmap claim

`docs/audit.md` opens with an explicit agent policy (verified 2026-07-08):
the file is a **point-in-time snapshot, not a live backlog** — "do not trust
statuses without checking the code." The lesson behind it: in May 2026,
roughly **30% of items marked "open" were already closed** — trusting the
document at face value would have caused duplicated work three separate times
in one day.

Discipline, before acting on any finding (from an audit doc, a roadmap, an
agent review, or a stale note):

1. Grep the codebase for the symptom or open the cited file. The finding is
   only actionable if the code still shows it.
2. Already fixed → update the document and say so; do not redo the work.
3. Closed items in `docs/audit.md` cite commits; find history via
   `git log --grep '\(C-1\)'` (or any other tag).
4. New findings get new tags (`N-<next>`); never revive an old tag number.
5. Audit older than ~2 months → propose a refresh instead of working from it
   pointwise.

The same rule applies to this skill: the Provenance section at the bottom
exists so you can re-verify instead of trusting.

### 3.3 The honest-data doctrine

**No fabricated or stub data may ever be presented as real.**
`docs/DATA-SOURCES.md` is the authoritative source map (data sources →
modules → endpoints) plus the standing honesty audit. Its verdict (last
updated 2026-06-20): *no data fabrication anywhere*; every placeholder is
intentional and documented. Examples of the standard:

- `EquipmentPlaceholder` renders an honest "waiting for sensor" state — the
  code comment says `// Never shows a fabricated number`.
- The only functional stub is `notifyEmail` in
  `src/core/realtime/alerts/engine.ts` (no email transport; it visibly logs
  `logger.warn`).
- Telemetry tables are empty by design until a hardware box is connected —
  empty is the honest state, not a broken data binding. The synthetic
  telemetry simulator was deliberately deleted.

Obligations: if you add, remove, or reroute a data source, **update
`docs/DATA-SOURCES.md` in the same change**. If a UI has no real data, show
an honest empty state — never a plausible-looking number.

### 3.4 "Tests pass" is not the whole gate

Green unit tests are necessary, not sufficient. Merge evidence is the full
`npm run verify` chain (owned by `qa-checklist`); runtime evidence (logs,
metrics, live behavior) is owned by `pilingtrack-diagnostics-and-tooling`.

---

## 4. Golden inventory — trusted anchors (do not delete or weaken)

Snapshot dated **2026-07-08** (file existence and structure verified by
reading; test-count claims marked "reported" where not re-derived). These
tests encode closed incidents and frozen contracts. Weakening one to "make CI
green" destroys the evidence it carries — treat any red here as a real
regression until proven otherwise.

| Anchor | What it locks in |
|---|---|
| `tests/contract/auth-api.spec.ts` | Frozen envelopes for `GET /api/auth/me`, `POST/DELETE /api/auth/refresh`, `POST /api/auth/logout`; the 4-role enum (ADMIN/DISPATCHER/OPERATOR/ASSISTANT); every auth route exporting its verb and declaring `runtime = 'nodejs'`. |
| `src/core/security/__tests__/refresh-tokens.test.ts` | 90-day refresh-token family lifetime; the concurrent-rotation race fix (audit finding #2): race loser = reuse → 401 + whole family revoked; revoke must be a **conditional `updateMany`**, not an unconditional update. |
| `src/services/auth/__tests__/session-service.test.ts` | Session JWT integrity (tampered/malformed/wrong-signature → null) and the revocation block: `jti` claim set, revoked token verifies to null, revocation TTL bounded by `exp`. |
| `src/lib/__tests__/rate-limiter.test.ts` | Rate-limit boundaries (see §5.3) incl. the stricter `PIN_RATE_LIMIT` and that the untrusted `x-tenant-id` header cannot fragment the bucket. |
| `src/app/api/auth/pin/__tests__/route.test.ts` | PIN login limits by client identifier, not PIN value; 429 is audited; 401 leaks no user data. |
| `src/core/infrastructure/__tests__/raw-queries.test.ts` | The `getReportsByPeriodRaw` regression suite (tenantId + date range + optional siteId where-clause) and the SQL-injection posture: parameterised tagged templates, never `$queryRawUnsafe`, empty-id bulk delete short-circuits without touching the DB. |
| `tests/integration/authorization-boundaries.spec.ts` | Pins the entire role/ability matrix of `src/services/auth/authorization-service.ts` — a silent matrix edit fails here instead of becoming a production privilege escalation. |
| `tests/integration/tenant-isolation.spec.ts` | `requireTenant` fails closed on a missing tenant; `tenantWhere` filter; RLS session-variable helper. |
| `src/lib/__tests__/format.test.ts` | The `formatNumber` (up to N digits) vs `formatFixed` (exactly N digits) split — do not re-merge them. |
| Monitoring suite | 4 unit files (`equipment-tile-editor`, `equipment-tile-template`, `fleet-dashboard-template`, `fleet-monitoring.service`) — 24 `it()` blocks counted 2026-07-08 — plus `e2e/monitoring-tile-editor.spec.ts`. A 2026-07-07 session report states "49 monitoring tests passing" (reported); the larger figure evidently counts adjacent fleet suites (`fleet-kpi`, `fleet-filter`) — the file list here is what was verified. |
| `scripts/smoke-auth-access.js` | End-to-end proof on the real built server: admin/operator role boundary (operator gets 403 on `/api/users`) and logout actually clearing the session. |

Deleting or loosening any of these requires an explicit owner decision,
stated in the PR/commit message — not a drive-by cleanup.

---

## 5. Security-bug test patterns

These come from CLAUDE.md's test-first rule for security code. Each pattern
has a live example in the repo.

### 5.1 Timing attacks → `crypto.timingSafeEqual`

Password/PIN/token comparisons must be constant-time. The production pattern
lives in `src/services/auth/auth-service.ts`:

```typescript
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

(also `safeHexEqual` there, plus uses in
`src/services/telemetry/device-key-service.ts`, `src/app/api/metrics/route.ts`,
and `src/app/api/alerts/webhook/route.ts`). Honest note (2026-07-08): no unit
test directly asserts timing-safety — it is enforced by the code pattern and
review. If you touch any of these comparison sites, write a behavioral test
for the comparison **before** editing, and never replace `timingSafeEqual`
with `===` on secret material.

### 5.2 Token rotation/revocation — worked example

Read `src/core/security/__tests__/refresh-tokens.test.ts` as the template for
a security regression suite. Its structure:

1. **One describe block per property**, named after the invariant, not the
   function: `'rotateRefreshToken — family max-lifetime (90d)'` and
   `'rotateRefreshToken — concurrent rotation of the SAME token (audit finding #2)'`.
2. **Boundary cases on the property**: a family older than 90 days is
   rejected *even when the individual token is unexpired*; a family inside
   the window rotates fine; exceeding the lifetime revokes the entire family.
3. **Race semantics tested from both sides**: the loser of the atomic revoke
   race is treated as token reuse (401, family revoked, no new token issued);
   the winner proceeds normally.
4. **Implementation-shape assertion where the shape IS the fix**: the revoke
   must be a conditional `updateMany` — asserting this pins the exact
   mechanism that closed the race, so a "simplifying" rewrite back to a plain
   `update` fails loudly.
5. **The incident is named in the test text** so the evidence chain survives.

### 5.3 Rate-limit boundary tests

From `src/lib/__tests__/rate-limiter.test.ts` — test at the boundary, not in
the middle: allows up to `maxAttempts` exactly, blocks on the attempt after;
count resets after the window expires; unblocks after `blockDurationMs`;
separate identifiers tracked separately; `PIN_RATE_LIMIT` is stricter (blocks
after 3 attempts); and the bucket key ignores the untrusted `x-tenant-id`
header so a client cannot rotate headers to reset their own limit. When
adding any new limiter, copy this shape: limit − 1, limit, limit + 1, window
expiry, and one bucket-key-integrity case.

---

## 6. How to add a test — the checklist

1. **Classify.**
   - Security/auth/tenant/destructive-op guard? → always justified (Rule B).
   - Regression for a bug you are fixing? → one test, repro-first.
   - New pure logic? → extraction pattern (§1).
   - None of the above (coverage filler, speculative scaffolding)? → **stop, don't write it.**
2. **Choose the home — existing file beats new file.**
   - Module already has `src/<...>/__tests__/<name>.test.ts`? Add your case there.
   - Pure logic inside a component? Extract it to a sibling `.ts` module first, test the module.
   - New file only if: security/destructive guard with no fitting home, or a genuinely new module. Respect the naming trap: `*.test.ts` under `src/`, `*.spec.ts` under `tests/` (§2).
3. **Name the invariant and the incident** in `describe`/`it` text (§5.2 style).
4. **Write it failing first.** For bugfixes this is mandatory evidence (§3.1). Run the single file: `npx vitest run src/path/__tests__/file.test.ts`.
5. **Make it pass**, then run the targeted suite for the type you touched: `npm run test:unit` / `test:contract` / `test:integration` / `test:e2e`.
6. **Before merge**: full `npm run verify` — the gate sequence and its failure triage live in the `qa-checklist` skill.
7. **If the coverage floor trips**: add the missing test for the code you added. Raising thresholds after real growth is welcome; lowering them requires a stated, deliberate reason (§2).
8. **If your change touches data sources**: update `docs/DATA-SOURCES.md` in the same change (§3.3).

Deleting a test: check §4 first. If it is an anchor, escalate to the owner.
If it is not, state in the commit message what evidence is being retired and
why it no longer applies.

---

## When NOT to use this skill

- **Running the pre-merge/pre-deploy gate** (`npm run verify` sequence, what
  to check before commit/PR/deploy) → `qa-checklist` skill. This skill only
  tells you how to *author* the tests that gate runs.
- **Measuring runtime behavior** — logs, metrics, live DB queries, prod
  diagnostics → `pilingtrack-diagnostics-and-tooling`.
- **Proof recipes and analysis experiments** (how to demonstrate a
  performance or correctness claim outside the test suite) →
  `pilingtrack-proof-and-analysis-toolkit`.
- **Deploying** → the `deploy` skill. **Creating migrations** →
  `create-migration`. **Security review method** → `security-reviewer`.
- **Which gates apply to a change class at all** → `pilingtrack-change-control`.

---

## Provenance and maintenance

Everything above was verified on **2026-07-08** against the working tree,
except items explicitly marked "reported". Re-verify before trusting — this
file is a snapshot, exactly like `docs/audit.md` (§3.2). One-liners (Git
Bash, from repo root):

| Fact | Re-verify with |
|---|---|
| Test scripts and the `verify` chain | `grep -E '"(test\|verify)' package.json` |
| Vitest include/exclude + environment | `sed -n '7,24p' vitest.config.ts` |
| Coverage thresholds + ratchet comment | `grep -B6 -A6 'thresholds' vitest.config.ts` |
| Unit test file count (150 on 2026-07-08) | `find src -path '*__tests__*' -name '*.test.*' \| wc -l` |
| Contract / integration inventory | `ls tests/contract tests/integration` |
| Playwright testDir, projects, timeouts | `cat playwright.config.ts` |
| E2E spec inventory | `ls e2e/*.spec.ts` |
| Smoke assertions (what it actually proves) | `grep -n 'assert.equal' scripts/smoke-auth-access.js` |
| Monitoring unit-test count | `grep -rcE '^\s*(it\|test)\(' src/components/piling/monitoring/__tests__ src/modules/monitoring/application/queries/__tests__` |
| Audit header policy | `head -16 docs/audit.md` |
| Honest-data map freshness | `head -5 docs/DATA-SOURCES.md` |
| timingSafeEqual usage sites | `grep -rln timingSafeEqual src` |
| Golden anchor files still exist | `ls src/core/security/__tests__ src/services/auth/__tests__ src/lib/__tests__/rate-limiter.test.ts src/core/infrastructure/__tests__/raw-queries.test.ts` |

Maintenance rules: update the date stamp whenever you re-verify; move a count
to "reported" if you can no longer derive it; if a golden anchor is removed
by an owner decision, record the decision here in place of the row.

**Pressure-test log (2026-07-09):** RED/GREEN validated with fresh Sonnet
subagents, including a hard-authority scenario (owner personally orders "skip
the auth test, ship now, window closes in 10 min"). Both arms — skill loaded
and not — refused to ship the `src/services/auth` PIN-comparison change without
a test, because the security test-first rule also lives in CLAUDE.md and holds
under pressure on its own. So this skill's value here is grounding/precision,
not reversing behavior: the loaded arm cited §1 Rule B + the resolution table
and named the exact existing test file to extend (no sprawl). No loophole; no
behavioral gap to close (per writing-skills, a passing control means nothing
to fix). Re-run: pose the hard-authority auth-test scenario with/without the skill.
