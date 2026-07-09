---
name: pilingtrack-research-methodology
description: The discipline that turns a hunch into an accepted result in PilingTrack. Use when deciding whether a suspected bug/optimization is worth accepting as fact, agent audit results arrive, an experiment is being designed, a result is about to be accepted as fact, or retiring an idea is under discussion. Covers the two-part evidence bar, numeric predictions before measuring, the idea lifecycle, and experiment hygiene for a solo-prod project.
---

# PilingTrack Research Methodology

Written 2026-07-07. Every example below is anchored to a real commit, document, or
dated decision in this repository — nothing here is generic advice. When a date or
commit is given, it was verified against `git log` and `docs/` on 2026-07-07.

This project is solo-operated (non-programmer owner) and entirely AI-authored.
That means there is no senior human reviewer to catch a confidently wrong claim.
The methodology below is the substitute: it is how a hunch becomes an accepted
result here, extracted from the cases where the process worked and the cases
where skipping it cost real time.

## Vocabulary (defined once)

- **Mechanism** — the specific causal chain that produces a symptom
  ("`DEFAULT_TENANT_ID` is absent from the app container's env, so `getConfig()`
  returns null, so the Telegram handler logs 'not configured' and drops the
  message"). Not a restatement of the symptom ("Telegram is broken").
- **Adversarial refutation** — a second review pass whose *explicit assignment*
  is to kill the hypothesis: find the observation it does not explain, the code
  path it ignores, or the concurrency it wrongly assumes. Not a friendly
  re-read.
- **Projection** — a derived read-model table rebuilt from reports/events.
  Several confirmed bugs here were projection bugs; the word appears
  throughout. Full definition: `pilingtrack-architecture-contract` Vocabulary.
- **Dormant code** — code that is wired and reachable but produces no data yet
  because an external precondition is missing (telemetry: no hardware connected).
  Owner rule since 2026-05-31: dormant ≠ dead. Do not delete it.
- **Retirement** — the documented decision to stop pursuing an idea, with the
  reason and the do-not-retry condition written down.

---

## 1. The evidence bar

A hypothesis is **accepted** in this project only when BOTH hold:

1. **One mechanism explains ALL observations — including the negatives.**
   If your explanation covers the failing case but not the case that works,
   you have not found the mechanism.
2. **It survived adversarial refutation** — a pass (second agent, second
   session, or a deliberate self-pass) whose stated job was to prove it wrong.

### Worked example: the bar catching a false positive

**TelemetryBuffer "race condition" — REFUTED (2026-07-04).** A codebase-anomaly
agent reported three CRITICAL findings. Two were real (refresh-token TOCTOU and
equipment outbox atomicity, both fixed test-first in `b8a0593`). The third — a
claimed race in TelemetryBuffer — died on adversarial review: the two lines in
question are synchronous with no `await` between them, and single-threaded
Node.js cannot interleave them. Same agent, same report, same confidence level
on all three claims. Only code verification separated the two real bugs from
the plausible-sounding fake.

### Worked example: the bar passing a true positive

**Telegram silence (fixed `c3a1774`, 2026-07-07).** Observations: reports never
arrived in Telegram; the `TelegramConfig` row was present and enabled; logs said
"Telegram not configured — skipping document"; **and the workers container was
fine**. The accepted mechanism — `DEFAULT_TENANT_ID` was wired into the
*workers* service in `docker-compose.yml` but not the *app* service, while the
ReportSubmitted→Telegram handler runs in-process in the **app** container —
explains every one of those, *including the negative* (workers fine, because
workers had the var). A weaker hypothesis ("Telegram proxy broken", "config row
missing") fails on at least one observation. Post-deploy, delivery was confirmed
by an actual report arriving — not by the absence of the error log. Full
observation-by-observation walkthrough: `pilingtrack-failure-archaeology` D2.

### Worked example: the bar applied at scale

**Data-flow audit, 2026-07-07.** An agent audit produced 7 findings. Each was
verified by reading the actual code before acceptance. Result: **5 CONFIRMED**
(equipment `isActive` toggle is a no-op; downtime hours/minutes confusion;
report delete recomputes no projections; outbox drops event context;
daily-summary fallback queries the wrong key) and **2 DOWNGRADED** (a "P0
tenant mixing" that is not a live leak on the single-tenant prod, and a dormant
telemetry-whitelist issue with no hardware attached). A 5/7 hit rate from a
good agent is normal. Accepting 7/7 would have meant two wasted fixes.

### Checklist — before you claim a result

- [ ] State the mechanism in one sentence naming specific code/config, not the symptom.
- [ ] List ALL observations, including "X still works" negatives. Does the mechanism cover each?
- [ ] Run (or assign) a refutation pass: "assume this is wrong — what would disprove it?"
- [ ] For concurrency claims: is there actually an `await`/IO boundary between the racing lines? (TelemetryBuffer test.)
- [ ] For agent findings: did you read the cited code yourself? Line numbers in agent reports are frequently stale or wrong.

## 2. Predict the number before you measure

A quantitative hypothesis must state its **expected magnitude before running
anything**. If units or ratios are involved, derive what the error factor should
be, then check the data against it.

**Real example (fixed `e79c5da`).** The downtime form takes HOURS (label «Часы»)
but `downtimeRatio = totalDowntime / totalShiftMinutes` divides by MINUTES, and
the alert threshold `if (duration <= 120)` treats the value as minutes.
Prediction: the ratio is understated by **~60×**, and the alert effectively
never fires. The observed data matched — and the same mechanism explained the
user's plain-Russian symptom «простой показывается в днях, не часах». One
mechanism, one predicted factor, all symptoms covered.

**Forbidden as evidence:** "looks better now", "seems faster", "the error
stopped appearing". None of these are a number that was predicted in advance.
An error log going quiet is compatible with the handler being silently skipped
(exactly what the Telegram bug did for weeks). If you cannot state what number
you expect and why, you do not yet have a hypothesis — you have a mood.

For the concrete measurement recipes themselves (how to profile, EXPLAIN,
reproduce, time things), use `pilingtrack-proof-and-analysis-toolkit`.

## 3. The idea lifecycle as practiced here

Every stage below corresponds to a real artifact type that exists in this repo
(all verified 2026-07-07):

```
hunch
  → design spec         docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md   (16 exist, 2026-05-28 … 2026-07-05)
  → implementation plan docs/superpowers/plans/YYYY-MM-DD-<slug>.md          (15 exist)
  → thin slices with verify gates (plans are task-by-task, checkbox steps, test-first)
  → deploy (operator-driven; the owner drives it step-by-step over SSH — default since 2026-05-31)
  → outcome recorded (docs/audit.md item with tag+commit, or a failure-archaeology entry)
  → OR documented retirement
```

Real pair to look at: `docs/superpowers/specs/2026-07-05-per-equipment-tile-photos-design.md`
and `docs/superpowers/plans/2026-07-05-per-equipment-tile-photos.md`. The spec
states goal, user scenario, data architecture, and compatibility; the plan
breaks it into tasks with explicit interfaces and steps like "Write failing
identity tests" → "Run the focused test and verify it fails" — a verify gate
per slice, not one big verification at the end. (Templates for these documents
belong to `pilingtrack-docs-and-writing`, not here.)

### Documented retirements — the lifecycle's other exit

A retired idea is a *result*, not a failure, but only if it is written down
with a do-not-retry condition. Four real ones:

| Idea | Fate | Evidence | Do-not-retry condition |
|---|---|---|---|
| `workers-pdf` container split | Built, then reverted 2026-05-24 | half-done overlay had already broken `docker compose` once (fixed `9f9c979`) | Real profiling data showing PDF throughput or crash isolation is an actual problem — not a theoretical SPOF at ~10 users on a 3.8 GB-RAM VPS |
| Kubernetes/Helm/ArgoCD stack | Deleted 2026-05-31 | `ddb6a85` (~31 files removed) | An actual migration decision; owner confirmed no k8s move within ≥1 year |
| Telemetry simulator + Leaflet map MVP | Reverted 2026-05-17 | `f320e53` (785 deletions) | Real hardware producing real telemetry. Simulated evidence is not evidence — a map animated by a fake-data generator proves nothing about the product |
| `migrate`-image devDeps prune | Measured dead end (2026-06-28 pass) | image 2.04 GB before AND after — `prisma`+`tsx`+esbuild (~190 MB of binaries) are themselves the weight being "kept" | A different strategy entirely (e.g. trimming Prisma engine binaries via `PRISMA_CLI_BINARY_TARGETS`), not prune+reinstall |

The full retirement ledger and its maintenance rules belong to
`pilingtrack-failure-archaeology`. This skill's rule is only: **a negative
result gets WRITTEN DOWN so no one re-runs the experiment.** The migrate-prune
entry has already paid for itself once — it is the difference between "we
measured 0 savings, here is why" and a future session burning an afternoon
rediscovering it.

## 4. Where good ideas historically came from

Mined from git history and dated decisions — one verified example per source.
Weight your attention accordingly: these five channels produced essentially all
the validated improvements to date.

1. **Production incidents.** The 2026-06-24 login outage traced to 9.6 GB of
   un-recycled WAL from a broken `archive_command` (`7e5ab49` disabled it) —
   and produced the host-level disk guard `0d74d97` (2026-07-01) plus the alert
   pipeline. The incident was the research; the guard was the accepted result.
2. **User-reported symptoms in plain Russian.** «Простой показывается в днях»
   — a non-programmer's observation — led straight to the 60× units bug
   (`e79c5da`). Treat operator phrasing as data, not noise; translate it via
   `domain-glossary` and look for the mechanism that produces *exactly* that
   wording.
3. **Adversarial audits before deploys.** The 2026-06-28 security-review pass
   over the undeployed 218-commit diff (4 scoped review agents + a
   silent-failure hunter, in parallel) yielded 5 confirmed-real fixes in
   `830f241` — including a WS `sessionVersion` bypass that survived every
   normal review. Note also what that pass did NOT do: two cross-tenant IDOR
   findings were deliberately left unfixed because they hinged on an unresolved
   architecture question (is the ADMIN/DISPATCHER tenant bypass by design?).
   Blocking on the question beat shipping a cosmetic fix.
4. **Honesty cross-checks.** The data-source audit that produced
   `docs/DATA-SOURCES.md` — a full map of where every displayed number comes
   from — established the "no fake data" doctrine and is why the telemetry
   simulator (`f320e53`) had to go.
5. **Settled-battle reviews.** `docs/qa-council/2026-06-21-release-audit.md`
   (QA Council Level 3, 25 roles, verdict NO-GO) surfaced, among others, the P1
   that pile meters were computed by regexing `\d{3}` out of a grade *name* —
   which became the stored `PileGrade.lengthMm` + single-resolver fix. That same
   document also demonstrates the evidence bar applied to auditors: a same-day
   code-check appendix downgraded two of its own P1s after verifying
   `MULTI_TENANT_MODE=single` in prod.

## 5. Experiment hygiene (solo-prod project)

- **Never experiment on prod.** There is one production and one operator. The
  lab is the local prod-snapshot database: `npm run db:refresh-prod-snapshot`
  (wraps `scripts/refresh-prod-snapshot.sh`). Local has real prod-shaped data;
  use it.
- **Prod drift makes prod a different machine.** The nightly
  `rebuildSiteWeeklyTrend` worked locally but wiped the table and crashed on
  prod, because prod's `tenantId` column was NOT NULL while `schema.prisma` said
  nullable (fixed `a8b1aa4`, 2026-07-03 — rebuild made tenant-aware and
  non-destructive). "It works locally" is one observation, not a mechanism.
- **Back up before destructive ops.** `scripts/backup-local-db.ps1` exists and
  runs on a 3-day schedule; run it manually before any experiment that mutates
  or drops local data.
- **Experiment flags and dormant code stay in-tree.** Telemetry ingestion,
  device keys, and the monitoring tab are live-wired but empty pending hardware
  (decision 2026-05-31). Dormant ≠ dead. Deleting dormant code is a product
  decision (see `product-bible`), not cleanup.
- **A negative result gets written down** — in the failure ledger
  (`pilingtrack-failure-archaeology`), with the measurement and the
  do-not-retry condition. See the retirement table in §3.

### Checklist — before you run an experiment

- [ ] Stated hypothesis with a predicted number/magnitude (§2)?
- [ ] Running against local prod-snapshot, not prod?
- [ ] Snapshot fresh enough to represent prod (re-run `db:refresh-prod-snapshot` if in doubt)?
- [ ] Destructive step anywhere? → back up first.
- [ ] Decided in advance where the result will be recorded — for BOTH outcomes?

## 6. The acceptance path — one home per fact

A validated result must land in exactly ONE of these homes:

1. **A fix** — shipped through the `qa-checklist` gates (`npm run verify` etc.)
   and the change classes in `pilingtrack-change-control`.
2. **A rule** — a line in `CLAUDE.md` (Common Pitfalls table) or in
   `pilingtrack-change-control`. Precedent: audit item M-3 was closed not by
   code but by the rule "one migration = one logical change" written into
   CLAUDE.md; the `IS NULL OR tenantId` row cites its 2026-05-31 IDOR origin.
3. **An audit entry** — `docs/audit.md`, tagged (`N-N+1` for new findings —
   never revive an old tag number), with the closing commit cited so
   `git log --grep '\(C-1\)'` style archaeology works.
4. **A skill update** — when the fact changes how future sessions should work.

What a validated result NEVER becomes: **an unlabeled claim** — a sentence in a
chat, a note with no artifact behind it, a "known issue" that lives nowhere.
Unlabeled claims are how the May-2026 30% stale rate happened (§7).

If two homes seem to apply, pick the one future sessions will actually hit
first, and cross-reference from the other. Do not duplicate the fact.

## 7. Anti-patterns observed in this project

Each of these cost real time here. One line of story each:

- **Trusting an agent audit without code verification.** May 2026: ~30% of
  audit items marked "open" were already closed (H-2 key versioning, M-5
  coverage thresholds, M-6 no-explicit-any, all three M-1 oversized files) —
  three audit-vs-reality mismatches surfaced in a single day. `docs/audit.md`
  now carries a header policy block saying exactly this; obey it.
- **"Roadmap memory" going stale.** 2026-06-24: two ТО-module phases believed
  pending were already fully built and merged; 855+1353 lines of spec and plan
  were read before anyone opened `/admin/checklists` and saw it working. Verify
  actual repo state (grep for the models/routes the phase would need, `git log
  --grep`, or open the screen) BEFORE reading design docs or planning a phase.
- **Bundling many fixes into one giant deploy without per-fix verification.**
  The 2026-06-30 deploy shipped 218 accumulated commits; mid-deploy, the
  `crew_equipment_active_unique` migration failed on pre-existing duplicate
  data, and prod turned out to be on a stray hotfix branch. Contrast 2026-07-07:
  two same-day deploys (`c3a1774`, then `1008ae1`), each verified via
  `/api/health` version and, for the Telegram fix, by a real message arriving.
  Small, individually verified deploys are the practiced norm now.
- **Fixing symptoms of an unidentified mechanism.** The live counter-example is
  the CSP violation on `/monitoring` (a Turbopack chunk refused under
  `strict-dynamic`): the obvious "fix" — re-adding `'self'`/`'unsafe-inline'` —
  would silence the symptom by weakening the policy. It was deliberately parked
  with a local-repro plan instead (owned by `pilingtrack-csp-monitoring-campaign`).
  The positive example is `1008ae1`: fleet cards showing active-but-all-zeros
  were not patched cosmetically; the mechanism (analytics projection lagging
  behind the raw report) was identified first, and the fix falls back to raw
  report sums.

### Checklist — when agent audit results arrive

- [ ] For each finding: read the cited code yourself before accepting.
- [ ] Classify: CONFIRMED / DOWNGRADED (real but not live — e.g. dormant path, single-tenant) / REFUTED.
- [ ] Expect and accept a non-trivial false-positive rate (2/7 on 2026-07-07; 1/3 on 2026-07-04).
- [ ] Downgraded ≠ discarded: record where it becomes live (e.g. "on second tenant onboarding").
- [ ] Fix in mechanism order, not report order; verify each fix separately.

## 8. The «совет» (council) — an owner review ritual

Established 2026-06-15 and owner-invoked since: for large/net-new work, for
decisions with a real cost of being wrong, when something feels off, or on
explicit request («вызови совет» / "pressure-test this"), the owner runs a
**manual 5-role council** — Contrarian, First Principles, Expansionist,
Outsider, Executor — each grounded in actual code/context, followed by peer
critique and a chairman verdict naming exactly one first action. It is done
inline **without spawning agents** (tested agent-free; the ~11-subagent version
was rejected as too token-expensive) and replied in Russian. It has already
vetoed at least one sunk-cost decision. Treat it as an available escalation of
the adversarial-refutation bar in §1, invoked by the owner — do not run it
unprompted for trivial or factual questions.

## When NOT to use this skill

- **You need a concrete proof recipe** — how to profile, EXPLAIN a query, write
  the reproducing test, measure a ratio → `pilingtrack-proof-and-analysis-toolkit`.
- **You are deciding WHAT to research next** — the open-questions list and its
  priorities → `pilingtrack-research-frontier`.
- **Routine bugfixing with a known symptom** — prod login outage, silent
  Telegram, "no pending migrations" lie, zeroed fleet card, etc. →
  `pilingtrack-debugging-playbook` maps symptom → check → fix directly; you do
  not need a methodology for a mapped symptom.
- **Pre-merge / pre-deploy mechanics** → `qa-checklist` and the `deploy` skill.
- **Which gates apply to a change class** → `pilingtrack-change-control`.
- **Retirement-ledger bookkeeping detail** → `pilingtrack-failure-archaeology`.
- **Spec/plan document templates** → `pilingtrack-docs-and-writing`.

## Provenance and maintenance

Written 2026-07-07 from repository ground truth. All claims re-verifiable from
the repo root:

- Key commits (units bug, simulator revert, analytics rebuild, Telegram env,
  security pass, k8s removal, WAL, disk guard, TOCTOU, fleet fallback):
  `git show -s --format='%h %ad %s' --date=short e79c5da f320e53 a8b1aa4 c3a1774 830f241 ddb6a85 7e5ab49 0d74d97 b8a0593 1008ae1`
- Spec/plan artifact naming and counts: `ls docs/superpowers/specs docs/superpowers/plans`
- Audit header policy (verify-before-trusting, tag+commit, N-N+1):
  `Get-Content docs/audit.md -TotalCount 16`
- QA-council release audit and its same-day self-correction:
  `Get-Content docs/qa-council/2026-06-21-release-audit.md -TotalCount 10`
- Lab and backup tooling exist:
  `Select-String db:refresh-prod-snapshot package.json; ls scripts/refresh-prod-snapshot.sh, scripts/backup-local-db.ps1`
- Honesty doctrine artifact: `ls docs/DATA-SOURCES.md`

If a re-verification command fails, the underlying fact may have moved —
update this file in the same change, and prefer deleting a stale example over
keeping an unverifiable one. When adding a new example, hold it to this skill's
own bar: mechanism stated, commit or document cited, date-stamped.
