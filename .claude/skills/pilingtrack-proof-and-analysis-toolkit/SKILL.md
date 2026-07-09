---
name: pilingtrack-proof-and-analysis-toolkit
description: Recipes for turning a suspicion about PilingTrack code into a CONFIRMED/REFUTED/DOWNGRADED verdict — verifying an audit/agent finding, proving an IDOR, judging projection-completeness results, proving a race/TOCTOU, proving a query is slow, running a restore drill, and proving timing-safety. Use when a finding needs a verdict, data trustworthiness is in question, a race condition is suspected, or a backup's restorability is claimed without having run it.
---

# PilingTrack Proof and Analysis Toolkit

Written 2026-07-08. Every worked example below cites a commit verified with
`git show --stat <hash>` (or, for facts without a commit, a doc/runbook read
directly) on 2026-07-08. Anything that could not be verified this way is
labeled **"unverified, reported 2026-07-08"** rather than stated as fact.

This skill is a set of **recipes** — repeatable step sequences for turning a
suspicion into a verdict. It is the "how do I prove X" companion to
`pilingtrack-research-methodology`, which owns the *bar* a proof must clear
(one mechanism explains all observations, survives adversarial refutation)
and the idea lifecycle a proof feeds into. Read that skill for the
philosophy; read this one for the mechanics of seven specific proof types
that recur in this codebase.

## Vocabulary (defined once)

- **IDOR** (Insecure Direct Object Reference) — a request succeeds in
  returning or mutating another tenant's or user's row because the query
  never checked that the caller is allowed to see that row, only that the
  row exists. In this codebase the recurring shape is a query missing a
  `tenantId` (or site-ownership) filter.
- **TOCTOU** (Time-Of-Check-To-Time-Of-Use) — code reads a row, decides it's
  safe to act on ("not yet revoked"), then acts on it with a separate
  write — and between the read and the write, a concurrent request can
  invalidate the assumption the write relies on.
- **Projection** — a derived read-model table rebuilt asynchronously from
  events/reports; can lag or be missing for a row that exists in the source
  of truth. Full definition: `pilingtrack-architecture-contract` Vocabulary.
- **RLS** (Row-Level Security) — a Postgres feature enforcing a
  `tenantId`-matching policy at the database layer, second layer behind
  application-level tenant checks, not a replacement for them. Full
  definition: `pilingtrack-architecture-contract` Vocabulary.
- **Timing attack** — an attacker distinguishes a "close" wrong guess from a
  "far" wrong guess by measuring how long a comparison takes, because naive
  string/byte comparison (`===`, `Buffer.equals`) short-circuits on the
  first mismatched byte. `crypto.timingSafeEqual` compares in constant time
  regardless of where the difference is.

## When NOT to use

- **Running the actual measurement tooling** (profilers, log pipelines,
  the SQL to compute a specific number) → `pilingtrack-diagnostics-and-tooling`
  owns the runnable scripts; this skill owns the *method*, not the tool.
  Recipe 3 and Recipe 5 below point there explicitly.
- **Deciding whether an idea is worth pursuing, or retiring one** — the
  hunch→spec→plan→deploy-or-retire lifecycle, experiment hygiene, and the
  evidence bar itself → `pilingtrack-research-methodology`.
- **A full security-review sweep of a diff** (auth changes, new endpoints,
  dependency bumps) → the `security-reviewer` skill and subagent; this
  toolkit is for proving one specific claim, not auditing a whole change.
- **A symptom you already recognize** (silent Telegram, "downtime in
  days", fleet card zeros, "no pending migrations" lie) →
  `pilingtrack-debugging-playbook` maps it straight to a fix; you don't
  need a proof recipe for an already-solved symptom, only for a new one.
- **Full audit or PR review workflow** → `fullstack-audit` and
  `gitnexus-pr-review`; this skill is one technique those workflows call
  into, not a replacement for them.

---

## Recipe 1 — Verify an audit finding against code

**Purpose.** Audits and agent findings drift from reality fast — this
project measured ~30% of "open" items already closed in a single May 2026
review series, and 2 of 7 findings in one 2026-07-07 agent audit turned out
not to be live bugs. Never treat a finding as actionable until you've read
the code yourself.

**Steps.**
1. Locate the exact path/symbol the finding names. Do not trust file:line —
   agent-generated line numbers are frequently stale.
2. Read the code **at current HEAD**, not from memory or from the finding's
   quoted snippet.
3. Reproduce the claim logically (trace the code path by hand) or with a
   targeted test/query if the claim is quantitative.
4. Write a one-line verdict: **CONFIRMED** (bug is real and live),
   **REFUTED** (the mechanism claimed does not hold), or **DOWNGRADED**
   (the code pattern is real but not currently exploitable/live — e.g.
   single-tenant deployment, dormant code path, or hinges on an open design
   question).
5. Record the verdict where the next person will actually see it — a fix
   commit, a `CLAUDE.md` rule, an audit entry, or a skill update (see
   `pilingtrack-research-methodology` §6, "one home per fact").

**Worked example — REFUTED: "TelemetryBuffer race condition" (2026-07-04).**
An independent codebase-anomaly review reported three CRITICAL findings.
Verified with `git show --stat b8a0593`: the commit message documents that
the TelemetryBuffer claim was "investigated and rejected: the two statements
in question have no `await` between them, so Node's single-threaded event
loop makes them atomic — not a real race." Same report, same confidence
level, as the two findings (refresh-token TOCTOU, equipment outbox
atomicity) that *were* real and got fixed in the same commit. Only reading
the actual lines — checking for an `await`/IO boundary between them —
separated the true positives from the false one.

**Worked example — DOWNGRADED: "P0 tenant mixing" (2026-07-07 data-flow
audit).** An agent flagged a P0 for cross-tenant data mixing. Verdict on
review: not a live leak, because prod runs a single tenant (`orion`) today
— the underlying code pattern (the `ensureTenantAccess` bypass for
ADMIN/DISPATCHER roles) is real and worth tracking, but it is an *open
design question* (documented separately: is the bypass intentional
platform-admin design, or a gap?), not an active exploit. Downgrading here
did not mean discarding — the question stays open and becomes live again
the moment a second tenant is onboarded (`product-bible` roadmap decision
due 2026-11-24).

**What counts as done.** A verdict line (CONFIRMED/REFUTED/DOWNGRADED) with
the specific code you read to reach it, filed in one of the four homes
above — not left as an unlabeled chat message.

---

## Recipe 2 — IDOR proof

**Purpose.** Prove (or disprove) that a query lets a caller reach another
tenant's or user's row by ID, independent of authorization.

**Steps.**
1. Trace the suspect endpoint down to its actual Prisma/SQL `WHERE` clause
   — not the route handler's intent, the literal filter object.
2. Check whether a missing/null `tenantId` **fails closed** (throws) or
   **fails open** (falls back to returning everything). The specific
   fail-open shape seen twice in this codebase is `siteId ? { siteId } : {}`
   or `tenantId IS NULL OR tenantId = $1` — both silently drop the tenant
   filter instead of rejecting the request.
3. Check whether RLS is present as a second layer on the underlying table
   (`FORCE RLS` — see the Vocabulary section). RLS is defense-in-depth, not
   a substitute for the application-level check; a table can have RLS and
   still leak via a raw/unscoped query executed with elevated DB
   privileges.
4. Write (or reason through) a minimal repro: two tenants, one caller
   authenticated as tenant A, request an object that belongs to tenant B by
   ID. Expected: reject or empty result, not the object.
5. Fix by making the missing-tenant case throw, and by using strict
   equality (`tenantId: tenantId`) instead of an `OR`/optional filter.

**Worked example — Crews list IDOR, commit `ef30404` (2026-06-22).**
`GET /api/crews` (via `getAccessibleCrews`) used
`where: siteId ? { siteId } : {}` — no tenant filter at all, and no
`ensureTenantAccess` call, unlike the sibling `/[id]` and `/my` routes.
`Crew` has no `tenantId` column of its own; its tenant is inherited from
the owning `Site`. The fix (verified via `git show --stat ef30404`, 4 lines
changed in `src/app/api/crews/route.ts`) rescoped the query to
`where: { site: { tenantId } }`, resolving `tenantId` from
`user.tenantId ?? DEFAULT_TENANT_ID` and **throwing** when that resolves to
nothing, instead of silently returning every tenant's crews. Harmless
*today* only because prod runs a single tenant — same class of bug as the
next example, and exploitable the moment a second tenant exists.

**Worked example — Equipment tenant isolation, commit `b483cbe` +
follow-ups (2026-05-28).** `Equipment` originally had no `tenantId` column
at all. The fix landed as a commit sequence (`git log --oneline -- 'prisma/migrations/20260528000000*'`
confirms the migration is `b483cbe feat(equipment): add tenantId column +
RLS migration`, 56-line migration adding the column and RLS policy),
followed by `145129d` (schema), `ce2b88d` (aggregate/mapper/repository),
`aee7a2b` (scope all queries by tenantId), `eb6e28b` (document/maintenance
commands), `159ac4f`/`ecfa59e` (route handlers), with 8 existing prod rows
backfilled to `orion`. This is the largest IDOR fix in the project's
history — worth reading as the template for "how to retrofit tenancy onto
an existing table" if another dictionary-shaped table turns out to need it.

**What counts as done.** The `WHERE` clause read at HEAD, a stated verdict
on fail-open vs fail-closed, and (for a real finding) a fix that throws on
missing tenant rather than defaulting to "all rows."

---

## Recipe 3 — Projection-completeness proof

**Purpose.** Never trust a dashboard/analytics number by itself — it may be
reading a derived projection table that lags or is missing rows relative to
the source of truth (raw `Report` rows, in this project). Prove
completeness by comparing the two directly.

**Steps.**
1. Identify the source-of-truth table (usually `Report` or another
   append-only operational table) and the projection table the UI actually
   reads (`ReportAnalytics`, `SiteDailySummary`, `SiteWeeklyTrend`,
   `OperatorPerformance`).
2. Run parallel counts for the same time window/site — source count vs.
   projection count. A gap means the projection is behind or a rebuild
   wiped it.
3. Check the outbox backlog: unpublished events, unprojected events, and
   dead-letter-queue depth. A stuck worker or a poison event explains a
   growing gap.
4. If the code path that reads the projection silently skips rows with no
   projection entry (`if (!a) continue` is the exact anti-pattern seen
   here), that is itself the bug — independent of whether the projection
   backlog is currently zero.
5. Fix by falling back to the source of truth when the projection entry is
   absent, not by "waiting for the worker to catch up" (that just hides the
   symptom until the next lag).

**Worked example — fleet card zeroing, commit `1008ae1` (2026-07-07).**
`getFleetSnapshot` (`src/modules/monitoring/application/queries/fleet-monitoring.service.ts`)
did `const a = analyticsByReport.get(r.reportId); if (!a) continue;` — a
today's report with a missing or lagging `ReportAnalytics` row was dropped
from the fleet card entirely, so the card showed status "active" with
all-zero piles/drilling/downtime, and the fleet header totals (summed from
the same per-card figures) undercounted too. Verified via
`git show 1008ae1 -- '*fleet-monitoring.service.ts'`: the fix replaces the
`continue` with `a?.totalPiles ?? piles.reduce(...)`-style fallbacks for
each of the four metrics, using the already-loaded raw report rows
(`r.piles`, `r.drillings`, `r.downtimes`) when the projection entry is
absent — 12 insertions, 6 deletions, one file.

**Runnable SQL to reproduce the source-vs-projection gap check lives in the
sibling `pilingtrack-diagnostics-and-tooling` skill — this recipe owns the
method (what to compare and why), not the query text.**

**What counts as done.** A stated source-count vs. projection-count
comparison for the affected window, an outbox-backlog check, and — if a
code path skips on missing projection — a fallback to raw data rather than
a silent zero.

---

## Recipe 4 — Race/atomicity analysis (TOCTOU)

**Purpose.** Prove whether a check-then-act sequence is actually atomic
under concurrency, and if not, close it with a claim-and-verify pattern
rather than a mutex/lock this codebase doesn't otherwise use.

**Steps.**
1. Identify the "check" (a read that establishes a precondition, e.g. "this
   token is not yet revoked") and the "act" (a later, separate write that
   assumes the precondition still holds).
2. Ask: can two concurrent callers both pass the check before either
   completes the act? If the write is an unconditional `update`, the answer
   is yes — it always "succeeds" regardless of what happened in between.
3. Fix with the **claim-and-check-count pattern**: replace the unconditional
   `update` with `updateMany` conditioned on the same predicate the check
   used (e.g. `revoked: false`), then inspect the returned `count`. `count
   === 0` means you lost the race — someone else already flipped that row —
   and the loser must be treated as if it *knew* an anomaly occurred (e.g.
   revoke the whole session family), not silently ignored.
4. Write a test that fires the two "concurrent" calls without an `await`
   between the conflicting operations (i.e., actually racing them, not
   serializing them) and asserts the loser is rejected.
5. For a claim of "no race, because synchronous" (the counter-case): confirm
   there is genuinely no `await`/IO boundary between the two statements —
   Node's single-threaded event loop makes strictly synchronous code
   atomic. If there's any `await` in between, that claim is false.

**Worked example — refresh-token TOCTOU, commit `b8a0593` (2026-07-04).**
`rotateRefreshToken` (`src/core/security/refresh-tokens.ts`) read a
refresh-token row, checked it wasn't revoked, then called
`db.refreshToken.update({ where: { id }, data: { revoked: true, ... } })`
— unconditional. Two concurrent requests presenting the *identical* raw
token both passed the check (the sibling-reuse scan a few lines up only
looks for *other* token hashes in the family, so it can't see this) and
both minted a child token from the same parent — silently bypassing the
family's own compromise-detection mechanism. Fix (verified via
`git show b8a0593 -- src/core/security/refresh-tokens.ts`): the revoke
became `updateMany({ where: { id: existingToken.id, revoked: false }, ... })`;
when `claim.count === 0`, the loser now revokes the entire token family and
throws "refresh token was reused. All sessions revoked." — the exact same
claim-and-check-count shape already used for concurrent outbox consumers at
`src/services/reports/outbox-publisher.ts:131` (`const claim = await
db.outboxEvent.updateMany({ where: { published: false, ... } })`). The fix
was test-first per `CLAUDE.md`'s security-critical-code rule: a failing
test reproduced the double-mint before the fix landed.

**Worked example (companion, same commit) — equipment outbox atomicity.**
`equipment.repository.ts`'s `save()` called `db.equipment.upsert()` as a
standalone write, then separately `Promise.all(outboxEvent.create(...))`.
If the upsert committed and any outbox create failed, the domain event was
lost with no retry while the equipment change stuck — not a race between
two callers, but a non-atomicity between two statements that must succeed
or fail together. Fixed by wrapping both in `db.$transaction`, matching the
pattern already used in `site.repository.ts` and `report.repository.ts`
(the DDD-migration reference per `CLAUDE.md`).

**What counts as done.** The check and the act identified as separate
statements, a stated answer to "can two callers both pass the check", and
— if real — an atomic claim-and-count fix with a test that actually races
the two calls (no `await` serializing them out of contention).

---

## Recipe 5 — Query-plan proof

**Purpose.** Prove a query is slow (or fast) with `EXPLAIN ANALYZE`, not by
feel. Distinguish a sequential scan on a large table from an index scan,
and check buffer/row estimates against reality.

**Steps.**
1. Run `npm run postgres:explain-analyze` (wraps
   `npx tsx scripts/explain-analyze.ts`) — it runs `EXPLAIN ANALYZE` against
   a fixed list of representative queries (`Report` by site+date, `User` by
   email for login, etc.) and checks each against a `maxDurationMs` and an
   `expectIndexScan` flag defined per query.
2. For a query not already in that list, add it there rather than
   one-off-testing in `psql` and discarding the result — the script is
   meant to be the durable record, and it can run in CI.
3. Read the plan bottom-up: the innermost node is where the time is really
   spent. A `Seq Scan` on a table with more than a trivial row count next
   to a `Filter:` clause is the classic missing-index smell.
4. Compare `rows=` (planner estimate) against `actual rows=` — a large gap
   means the planner's statistics are stale (`ANALYZE` the table) or the
   query shape defeats estimation (e.g. a function wrapped around the
   indexed column).
5. Fix with an index, a rewritten predicate, or — per `CLAUDE.md`'s
   performance guidance — profile first, then fix; don't add an index
   speculatively.

**What counts as done.** An `EXPLAIN ANALYZE` output showing the plan node
that dominates execution time, a before/after duration if a fix was
applied, and (if the query is one worth guarding permanently) an entry
added to `scripts/explain-analyze.ts`'s `QUERIES` array.

For running the script and interpreting project-specific tuning knobs
(connection pooling via pgbouncer, cache strategy in
`src/lib/cache-strategies.ts`), defer to
`pilingtrack-diagnostics-and-tooling` — this recipe is the proof method,
not the tuning guide.

---

## Recipe 6 — Restore-drill protocol

**⚠️ Status: this drill has NEVER been executed as of 2026-07-08.** Nightly
off-site backups to Cloudflare R2 are live and verified as *running*
(confirmed on prod via SSH 2026-07-01, per `docs/runbooks/006-postgres-backup-restore.md`)
— but "a backup ran successfully" and "a backup can be restored" are two
different claims, and only the first has been proven here. A backup is not
a backup until it has been restored.

**Purpose.** Prove that the nightly dump can actually rebuild a working
database, end to end, without touching production.

**Steps (built on `docs/runbooks/006-postgres-backup-restore.md` and
`docs/runbooks/009-pitr-restore.md`).**
1. Pick a recent nightly dump from R2 (`db-backups/pilingtrack-YYYYMMDD-HHMMSS.sql.gz`,
   under the `pilingtrack` bucket via the app's own `S3_*` media creds — see
   runbook 006). Download it to a scratch location, not the prod host.
2. Spin up a throwaway Postgres instance (a separate local/Docker container
   — never restore into anything reachable from prod or from the real
   `orionpiling.ru` app).
3. Restore the dump (`pg_restore`/`psql < dump.sql`, per the runbook's exact
   invocation) into the throwaway instance.
4. **Checkpoint 1 — row-count parity.** Compare row counts for a handful of
   key tables (`User`, `Report`, `Site`, `Equipment`) between the restored
   DB and a fresh count from prod at roughly the dump's timestamp. They
   should match (barring writes between dump and now).
5. **Checkpoint 2 — app boots against the restored DB.** Point a local
   `npm run dev` (or a throwaway container) at the restored database via
   `DATABASE_URL` and confirm the app starts without schema-mismatch
   errors.
6. **Checkpoint 3 — `/api/health` reports OK.** Hit the health endpoint
   against the app instance from step 5; it should report `ok` (or at worst
   `degraded` with an explained, unrelated cause — e.g. Telegram/Redis not
   configured in the scratch environment), not `unhealthy`.
7. Record the outcome (pass/fail, what broke if anything) as a dated result
   — this is exactly the kind of fact `pilingtrack-research-methodology`
   requires to land in one of its four "homes" (fix / rule / audit entry /
   skill update), not stay an unlabeled claim.
8. Note the current PITR (point-in-time recovery) status while you're in
   this territory: `archive_mode=off` since the 2026-06-24 WAL-disk
   incident (see `pilingtrack-debugging-playbook` row #1), so real recovery
   point objective today is ~24h via the nightly dump, not continuous. This
   is a known, accepted limitation — not a bug to fix blind.

**What counts as done.** All three checkpoints (row-count parity, app
boots, `/api/health` OK) individually confirmed and dated, against a
throwaway environment — never against prod. Until this has run once, treat
"our backups work" as an unproven claim, however confident it sounds.

---

## Recipe 7 — Timing-safety proof

**Purpose.** Prove that a secret comparison (password hash, PIN, webhook
signature, device key) cannot be distinguished byte-by-byte by an attacker
measuring response time.

**Steps.**
1. Find every place a secret value is compared: string `===`, `Buffer`
   equality, or a manually written loop that returns early on the first
   mismatch. Any of these leaks timing information proportional to how many
   leading bytes matched.
2. Confirm the comparison instead goes through `crypto.timingSafeEqual`
   (Node's `node:crypto` built-in, constant-time regardless of where the
   difference is) — and that both buffers are the same length before
   calling it (`timingSafeEqual` throws, rather than compares, on
   length mismatch — so a length check must exist too, and that length
   check must not itself leak information about the true value's length
   when the two values are supposed to be fixed-length hashes/HMACs).
3. Confirm the value being compared is itself a fixed-length, high-entropy
   value (a hash or HMAC output) — timing-safety of the *comparison* is
   moot if the *value* varies in ways an attacker can exploit some other
   way (e.g. comparing a user-supplied plaintext password directly, instead
   of comparing hashes).
4. Test by asserting the code path is reached for both a "close" wrong
   value (shares a long prefix with the real one) and a "far" wrong value
   (shares nothing) — a timing-safety bug is invisible to a normal
   correctness test, since both cases should just return "no match" either
   way; the point is *how long* wrong takes, which a unit test typically
   can't assert directly, so the practical check is "is
   `timingSafeEqual` actually being called on this path", not a timing
   measurement in CI.

**Where this project already does it right (verified via
`grep -rn "timingSafeEqual" src/`, 2026-07-08).** Four independent call
sites use `crypto.timingSafeEqual`, each on a fixed-length buffer:
- `src/services/auth/auth-service.ts` (two call sites) — password/token hash
  comparison.
- `src/app/api/alerts/webhook/route.ts` — Alertmanager webhook shared-secret
  check.
- `src/app/api/metrics/route.ts` — metrics endpoint auth.
- `src/services/telemetry/device-key-service.ts` — device key comparison,
  with an explicit length check (`a.length !== b.length ||
  !timingSafeEqual(a, b)`) guarding the call, and a code comment noting
  *why* `timingSafeEqual` is unnecessary on an adjacent, differently-shaped
  comparison in the same file (worth reading in place — not every
  comparison in a security file needs to be constant-time, only ones
  comparing attacker-influenced secrets against the true value).

**What counts as done.** Every comparison of a secret value against a
caller-supplied value in the code path under review is confirmed to route
through `timingSafeEqual` on equal-length buffers, or a written justification
exists (as in `device-key-service.ts`) for why a specific adjacent
comparison doesn't need it.

---

## Recipe 8 — The refutation bar (cross-cutting)

This is not a standalone recipe so much as the test every recipe above must
pass before its output is trusted. It is owned in full by
`pilingtrack-research-methodology` §1 — read it there for the general
statement. Restated for this toolkit's purposes:

**A proof is not done when it explains the failing case. It is done when
one mechanism explains every observation, including the ones where things
worked.** A hypothesis that only accounts for the broken behavior and is
silent about the working behavior has not located the actual mechanism yet
— it has located *a* plausible-sounding story.

**Worked example — silent Telegram notifications, fixed `c3a1774`
(2026-07-07): mechanism was `DEFAULT_TENANT_ID` wired into `workers` but not
`app`, while the Telegram handler runs in-process inside `app`.** One
mechanism explained all four observations (config row fine, workers fine,
exact log message, proxy fine) with zero left unexplained — that is what
"passes the refutation bar" looks like in practice. Full observation-by-
observation walkthrough: `pilingtrack-failure-archaeology` D2.

**What counts as done.** Every recipe's output above should be checked
against this bar before being written down as CONFIRMED: state the
mechanism in one sentence naming actual code/config, list every
observation including the ones that "still worked", and confirm the
mechanism accounts for each one — not just the failing one.

---

## Provenance and maintenance

Written 2026-07-08. All commits below were verified with
`git show --stat <hash>` against the repo at that date, on branch
`chore/project-skills`. Re-verify with:

```bash
# Every cited commit still exists and matches its description:
git show -s --format='%h %ad %s' --date=short \
  1008ae1 b8a0593 c3a1774 ef30404 b483cbe

# Equipment tenant migration + full follow-up sequence (Recipe 2):
git log --oneline -- 'prisma/migrations/20260528000000*'
git log --oneline | grep -E "^(145129d|ce2b88d|aee7a2b|eb6e28b|159ac4f|ecfa59e)"

# Claim-and-check-count pattern still exists in outbox publisher (Recipe 4):
grep -n "updateMany" src/services/reports/outbox-publisher.ts

# Explain-analyze script still wired (Recipe 5):
grep -n "postgres:explain-analyze" package.json
ls scripts/explain-analyze.ts

# Restore-drill runbooks still exist, drill status unchanged (Recipe 6):
ls docs/runbooks/006-postgres-backup-restore.md docs/runbooks/009-pitr-restore.md
# Search this skill's own text and any docs/ notes for "restore drill" —
# if one has since been run, update the ⚠️ status line at the top of Recipe 6.

# timingSafeEqual call sites unchanged (Recipe 7):
grep -rn "timingSafeEqual" src/

# Fleet-monitoring fallback still present (Recipe 3):
grep -n "totalPiles ??" src/modules/monitoring/application/queries/fleet-monitoring.service.ts
```

If a re-verification command fails or returns something different from what
this file claims, the underlying fact has moved — update this file in the
same change rather than leaving a stale worked example. Volatile facts to
re-check on a longer horizon: the single-tenant assumption behind Recipe 1's
"P0 tenant mixing" DOWNGRADED example (multi-tenant shakeout decision due
2026-11-24, per `product-bible`), and the restore-drill status in Recipe 6
(the one item in this file most likely to change from "never executed" to
"executed" — check before repeating the warning).
