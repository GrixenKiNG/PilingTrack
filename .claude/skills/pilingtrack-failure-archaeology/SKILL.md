---
name: pilingtrack-failure-archaeology
description: >-
  Use before re-attempting a reverted approach (UI redesign, event-bus
  migration, workers-pdf split, k8s stack, migrate-image pruning,
  telemetry map), when asking "why was X removed", "did we already try
  Y", "has this bug happened before", investigating an IDOR/tenancy
  incident's history, or weighing a new agent finding against a
  previously-downgraded or refuted one. Chronicles PilingTrack's
  investigations, dead ends, and reverts with symptom, root cause,
  evidence, and status.
---

# PilingTrack Failure Archaeology

The full incident record: what broke, why, how it was found, what was
tried, what was rejected, and whether it's actually closed. This skill
owns **detail and narrative** — the resulting rules live in
`pilingtrack-change-control`, live triage lives in
`pilingtrack-debugging-playbook`. All facts below were checked against the
repository on **2026-07-08** (branch `chore/project-skills`); every commit
hash was verified to exist with `git cat-file -e <hash>` before being cited.
A hash that could not be verified is explicitly labeled
"unverified, reported 2026-07-08" rather than presented as fact.

## When NOT to use

- **A symptom is happening right now and you need to fix it** →
  `pilingtrack-debugging-playbook` (symptom → check → cause → fix, one
  line each). Come back here afterward for the full story if you want it.
- **You're about to make a change and want to know which rules/gates
  apply** → `pilingtrack-change-control` (the rules this history produced).
- **You want architecture invariants, not incident history** →
  `pilingtrack-architecture-contract`.
- **You're deciding module vs dictionary vs enum, or Russian↔code
  vocabulary** → `module-vs-dictionary`, `domain-glossary`.
- **You're about to run a deploy or write a migration** → `deploy`,
  `create-migration`, `qa-checklist` — this skill explains *why* those
  gates exist, it does not replace them.

## How to use this file

Skim the table of contents, jump to the area, read the entry. Every entry
uses the same template (see "Entry template" below the table of contents)
so `status` and `evidence` are always in the same place. "Settled" means
the pattern is fixed, ruled against, and rule-of-record lives in
`pilingtrack-change-control`; re-litigating a Settled entry needs a new
finding, not a re-read. "Open" means genuinely undecided or unfixed —
check current code before assuming it's still true; the "Provenance and
maintenance" section at the bottom gives one-line re-checks.

---

## Table of contents

| Area | Entries |
|---|---|
| [A. UI / Design](#a-ui--design) | A1 five-commit redesign wave (reverted) |
| [B. Tenancy & Security](#b-tenancy--security) | B1 `IS NULL OR tenantId` IDOR + same-evening revert; B2 Equipment not tenant-scoped; B3 crews-list IDOR + dead `/api/crews/manage`; B4 exportReportsCsv tenant scoping (stray-worktree recovery); B5 WS `sessionVersion` bypass; B6 refresh-token TOCTOU; B7 equipment outbox non-atomicity; B8 PDF job-id IDOR + billing tenantId override; B9 device-keys cross-tenant + 4 more ASVS L1 findings; B10 `ensureTenantAccess` ADMIN/DISPATCHER bypass (OPEN); B11 "P0/P1 tenant mixing" QA-council finding, downgraded |
| [C. DB / Migrations](#c-db--migrations) | C1 stale migrate-image gotcha; C2 `crew_equipment_active_unique` failed mid-deploy; C3 User.tenantId schema drift → 500 on create; C4 FORCE RLS rollout |
| [D. Analytics / Projections](#d-analytics--projections) | D1 nightly weekly-trend rebuild self-destructs; D2 2026-07-07 data-flow bug wave (5 bugs); D3 outbox event-context drop (OPEN) |
| [E. Infra / Deploy](#e-infra--deploy) | E1 prod disk-full (WAL); E2 prod found on stray hotfix branch; E3 seed-on-prod hazard; E4 off-site backup to R2 (restore drill OPEN) |
| [F. Dead ends & rejected designs](#f-dead-ends--rejected-designs) | F1 workers-pdf container split; F2 k8s/Helm/ArgoCD stack; F3 migrate-stage Docker prune (unverified/dead end); F4 TelemetryBuffer race — refuted; F5 telemetry simulator + Leaflet map MVP — dropped; F6 modern event-bus (Kafka/NATS adapters) — deleted; F7 `src/modules/reports/api/**` — dead duplicate, removed |
| [G. Open battles](#g-open-battles) | CSP on `/monitoring`; `ensureTenantAccess` bypass (cross-ref B10); RLS fail-open on unset session var; restore drill never run; Telegram alerts for PM scheduler unbuilt; H3/H5/M2 from the 2026-07-02 independent audit |

## Entry template

Every entry below follows this shape. When you add one, copy it exactly.

```
### <ID>. <Short title>

- **Symptom:** what was observed, by whom/how, when.
- **Root cause:** the actual mechanism, not the surface description.
- **Evidence:** commit hash(es) — verified with `git cat-file -e <hash>` —
  plus file paths / doc paths. If a hash cannot be verified, write
  "unverified, reported <date>" instead of guessing.
- **Status:** Settled (date, rule-of-record) | Open (date, what's missing).
- **Lesson:** one or two sentences — the generalizable takeaway.
```

---

## A. UI / Design

### A1. Five-commit redesign wave, fully reverted

- **Symptom:** across one session, five sequential UI/UX changes landed on
  admin screens: hero KPI cards, "neutral secondary" cards + grouped nav,
  typography discipline + cleaner page headers, a dark-mode toggle with
  semantic tokens threaded through the layout shell and dashboards, and a
  grouped sidebar nav by domain with wider content on xl screens. All five
  were then reverted the same day.
- **Root cause:** none of the five was requested. The work was
  competently executed (verified: each revert commit cleanly undoes a
  real, coherent `feat`/`refactor` commit, not a broken one) but was an
  unsolicited visual overhaul — CLAUDE.md's "Simplicity First" / "Surgical
  Changes" principles were not followed, and the owner reviews diffs
  directly, so five waves of unrequested styling changes were rejected in
  one pass.
- **Evidence:** originals — `718698c` (`refactor(admin-dashboard): hero KPI
  + neutral secondary cards + grouped nav`), `78ae4dd` (`refactor(ui):
  apply typography discipline + cleaner page headers`), `f286fe9`
  (`feat(ui): dark-mode toggle + semantic tokens in layout shell +
  dashboards`), `a7705fe` (`feat(layout): grouped sidebar nav by domain +
  wider content on xl`), `97fe84f` (`feat(ui): hero KPI on all admin
  screens`). Reverts, all dated Thu Apr 30 2026 10:16:42 +0300 (a single
  batch revert) — `b490dcc`, `38890c3`, `213be3f`, `13febdf`, `afb3712`.
- **Status:** Settled 2026-04-30. Rule-of-record: `pilingtrack-change-control`
  §3.3 "No unsolicited UI redesigns".
- **Lesson:** "this would look nicer" is not a mandate. Any visual/UX
  change — typography, nav grouping, color tokens, dark mode, KPI
  layout — needs an explicit ask before it's touched, no matter how clean
  the diff is in isolation. See `pilingtrack-change-control` for the
  standing rule this created.

---

## B. Tenancy & Security

This project has had more IDOR (Insecure Direct Object Reference — reading
another tenant's or user's row by id) findings than any other category.
Read this section in full before touching anything tenant-scoped.

### B1. `IS NULL OR tenantId` fail-open pattern — found, fixed, reverted, re-fixed within one evening

- **Symptom:** a tenant-scoped Equipment query used the pattern
  `tenantId IS NULL OR "tenantId" = $1`. With a null tenant (the natural
  state for some code paths), this returns **every** tenant's rows.
- **Root cause:** the pattern looks like defensive coding ("don't
  silently empty a list just because tenant is unset") but is actually a
  fail-open IDOR. It was fixed once, then a session re-introduced it a few
  hours later on the plausible reasoning that strict equality would break
  list rendering — proving the antipattern is attractive precisely because
  it looks safe.
- **Evidence:** `22bf1a5` (`revert(analytics): restore IS NULL OR tenant
  guard on Equipment select`, 2026-05-31 19:49) re-introduced the fail-open
  form; six minutes later `10fc759` (`fix(analytics): fail closed on
  missing tenantId`, 19:55) replaced both branches with a throw plus a
  regression test. Policy home: `src/services/auth/resource-access-service.ts`.
- **Status:** Settled 2026-05-31. Rule-of-record: `pilingtrack-change-control`
  §3.1, CLAUDE.md pitfalls table, `pilingtrack-debugging-playbook` row 11.
- **Lesson:** if you ever see `IS NULL OR` in a tenant filter, it is a bug,
  not a feature — full stop, no exceptions, do not re-derive "but what if
  tenant is legitimately null" from first principles again. That question
  was already asked and answered live, twice, on 2026-05-31.

### B2. Equipment table not tenant-scoped at all

- **Symptom:** the `Equipment` table had no `tenantId` column or RLS —
  any authenticated user, regardless of tenant, could read/write any
  equipment row.
- **Root cause:** Equipment predates the tenancy retrofit; when
  `tenantId` was added to `Report`, `Site`, etc., Equipment was missed.
- **Evidence:** design docs `cf19615`/`730f1e0`; schema+RLS migration
  `b483cbe` (`feat(equipment): add tenantId column + RLS migration`,
  folder `20260528000000_...`); thread-through — `145129d` (schema +
  Report drift), `ce2b88d` (aggregate/mapper/repository), `aee7a2b`
  (scope all queries), `eb6e28b` (document + maintenance guards),
  `159ac4f` (create/update/delete scoping), `ecfa59e` (route handlers),
  `a6a0cee` (fleet snapshot + analytics), `bdf8c1a` (source tenantId from
  actor, not Equipment). The `IS NULL OR` regression during this exact
  work is B1 (`22bf1a5`/`10fc759`).
- **Status:** Settled 2026-05-28. 8 prod Equipment rows were backfilled to
  tenant `orion` at deploy time (per operator memory of the same date);
  re-verify current row count matches expectations before assuming this
  is still true on a fresh prod snapshot.
- **Lesson:** when adding tenancy to a new entity, budget for a full
  vertical slice (schema → aggregate → repository → every command/query →
  every route) — a partial pass leaves exactly the kind of query B1 found.

### B3. Crews-list IDOR + dead `/api/crews/manage` route

- **Symptom:** the crews list endpoint did not fail closed on missing
  tenant context; a separate, undocumented `/api/crews/manage` route
  existed that could force-delete reports as a side effect of crew
  management.
- **Root cause:** `ef30404` fixed the crews-list fail-open gap directly.
  The `/api/crews/manage` route was found to be dead (no live caller) and
  dangerous (force-deleted reports), so it was removed rather than fixed.
- **Evidence:** `ef30404` (`fix(crews): fail-closed tenant scope on crews
  list (IDOR guard)`); `5a93ce1` (`fix(crews): harden crew write path —
  atomicity, tenant + rig integrity, soft-delete only`) hardened the
  surviving write path to soft-delete only.
- **Status:** Settled 2026-06-22 (per operator memory of the same date).
- **Lesson:** an undocumented admin-adjacent route with destructive side
  effects and no tenant check is exactly the shape that hides for months —
  audit routes, not just the models they touch.

### B4. `exportReportsCsv` tenant scoping — recovered from a stray worktree

- **Symptom:** `exportReportsCsv` did not scope by tenant. The fix for it
  existed but had been produced in a background session whose worktree
  was never merged, so it sat un-landed while the main branch stayed
  vulnerable.
- **Root cause:** two independent background sessions (found via a
  routine ESLint-ignore audit, not because anyone was looking for them)
  had already produced real, correct IDOR fixes — crews tenant guard
  (overlaps B3) and `exportReportsCsv` tenant scoping — sitting unmerged
  in stray worktrees.
- **Evidence:** `7f1fff3` (`fix(security): merge 2 stray-worktree IDOR
  fixes (crews tenant guard, exportReportsCsv)`), applied via `git apply`
  per operator memory of 2026-06-30.
- **Status:** Settled 2026-06-30 (merge landed; worktrees themselves were
  not immediately deleted — check `.claude/worktrees` / `git worktree
  list` if you need to confirm cleanup happened later).
- **Lesson:** a background/stray session's fix is not "lost work to
  ignore" — it can be a real, already-verified security fix. Before
  discarding an old worktree, diff it; see also
  `superpowers:using-git-worktrees`.

### B5. WebSocket auth never checked `sessionVersion` revocation

- **Symptom:** a forced logout (password/PIN change, account
  deactivation) did not disconnect live WebSocket sessions — they kept
  working with stale privileges until the JWT's natural 12h expiry.
- **Root cause:** `src/lib/auth.ts` checked `sessionVersion` on every HTTP
  request, but the WS auth path never got the same check when
  `sessionVersion` was introduced.
- **Evidence:** `830f241` (`fix(security,reliability): close 5 real bugs
  found by full security-review pass`, 2026-06-28) — added the same
  `sessionVersion` check to WS auth (now in
  `src/core/realtime/server/auth.ts`).
- **Status:** Settled 2026-06-28. Invariant recorded in
  `pilingtrack-architecture-contract` §"Security invariants" #5.
- **Lesson:** any auth invariant added to the HTTP path (`src/lib/auth.ts`)
  needs an explicit check for whether the WS path (a parallel, separately
  implemented auth check) also needs it. They do not share code by
  default.

### B6. Refresh-token rotation TOCTOU (check-then-revoke race)

- **Symptom:** two concurrent requests presenting the *identical* raw
  refresh token could both pass validation and each mint a new child
  token from the same parent — not just a duplicate-token bug, but a
  silent bypass of the token family's own reuse/compromise-detection
  mechanism (which only scans for *other* token hashes in the family, so
  it can't see two requests using the same hash).
- **Root cause:** the per-token revoke was an unconditional `update`,
  which always "succeeds" regardless of whether another request already
  revoked the row — classic time-of-check-to-time-of-use race.
- **Evidence:** `b8a0593` (`fix(security): close refresh-token TOCTOU +
  equipment outbox atomicity`, 2026-07-04). Fixed by making the revoke an
  atomic `updateMany` conditioned on `revoked: false` (claim-and-check-
  count pattern, mirroring `outbox-publisher.ts`'s existing concurrent-
  consumer handling); the loser (`count: 0`) is now treated as a
  sibling-reuse event — family revoked, re-authentication required.
  Test-first per CLAUDE.md's security-critical-code rule.
- **Status:** Settled 2026-07-04. Invariant recorded in
  `pilingtrack-architecture-contract` §"Security invariants" #4.
- **Lesson:** "the existing reuse-detection scan already covers token
  abuse" is not the same claim as "concurrent identical-token requests are
  handled" — check the exact comparison the scan performs, not just its
  stated purpose.

### B7. Equipment outbox event loss on partial write

- **Symptom:** `equipment.repository.ts`'s `save()` called
  `db.equipment.upsert()` as a standalone write, then separately ran
  `Promise.all(outboxEvent.create(...))`. If the upsert committed but any
  outbox create failed, the domain event was permanently lost with no
  retry, while the equipment change itself stuck.
- **Root cause:** `site.repository.ts` and `report.repository.ts` (the
  DDD-migration reference shape per CLAUDE.md) already wrapped the
  equivalent write in `db.$transaction`; `equipment.repository.ts` was
  the one outlier that didn't.
- **Evidence:** `b8a0593` (same commit as B6) — wrapped upsert + outbox
  create in one transaction.
- **Status:** Settled 2026-07-04.
- **Lesson:** when a pattern exists in two of three sibling repositories,
  treat the third's deviation as a bug to investigate, not a stylistic
  choice — this is the second time (see D3) that outbox/write atomicity
  was the actual defect behind a symptom that looked like something else.

### B8. PDF job-id IDOR + billing tenantId client override

- **Symptom:** PDF status/download had no authorization on the GET path;
  BullMQ's default `jobId` was a small sequential integer, so any
  authenticated user could enumerate jobs and read other tenants'
  period/single reports (and, in local-disk mode, the unsanitized jobId
  flowed straight into a filesystem path — path traversal). Separately,
  the billing/tenancy endpoint accepted `tenantId` from the query string
  (GET) or body (POST) instead of only the session.
- **Root cause:** predictable, enumerable ids as the sole access
  credential; a caller-supplied field that should always come from the
  session used instead.
- **Evidence:** `c58ef71` (`fix(security): close PDF jobId IDOR + billing
  tenantId IDOR`, 2026-06-27). `pdf-queue` now issues
  `crypto.randomUUID()` job ids; `reports/pdf` requires
  `reports.read_all`; `reports/single-pdf` checks stored owner via
  `assertCanAccessReportOwner`; billing tenantId comes from session only
  on both GET and POST.
- **Status:** Settled 2026-06-27.
- **Lesson:** a queue library's default id generator is not an access
  control mechanism — treat any externally-visible id used for lookup as
  a capability and make it unguessable, or add an explicit ownership
  check (do both where you can, as this fix did).

### B9. Device-keys cross-tenant access + 5 more findings from an OWASP ASVS L1 sweep

- **Symptom:** a whole-application (not diff-scoped) security-reviewer
  sweep across 91 routes plus the auth/crypto core found 6 real issues out
  of a much longer "checked, clean" list: PDF job ownership failed *open*
  once BullMQ pruned a completed job by count, letting any authenticated
  user poll/download any job; equipment `device-keys` routes
  (provision/list/revoke — the credential that authenticates telemetry
  ingestion) resolved equipment by id alone with no tenant check;
  `/api/auth/refresh` leaked tokens in the JSON body in addition to the
  httpOnly cookies that already deliver them; `buildMediaKey()` derived
  the file extension from the client-supplied filename, letting a crafted
  name escape the tenant/entity S3 key prefix; a webhook token compare
  used `===` instead of constant-time comparison; the admin layout gated
  on the JWT role claim only, not live `sessionVersion`.
- **Root cause:** varied per finding (see evidence commit for detail); the
  common thread is a second, independent whole-application sweep finding
  issues that earlier diff-scoped reviews hadn't covered.
- **Evidence:** `3103731` (`fix(security): close 6 OWASP ASVS L1 findings
  from full-codebase sweep`, 2026-06-30). Each finding got a regression
  test (single-pdf ownership, device-key tenant scoping x2, refresh-token
  body leak, media extension injection, webhook auth, admin layout
  sessionVersion). Full suite green: 1245 tests, 0 lint errors/warnings.
- **Status:** Settled 2026-06-30.
- **Lesson:** diff-scoped security review and whole-codebase sweeps find
  different bug populations — neither substitutes for the other. Schedule
  whole-codebase sweeps periodically even when no single diff looks risky.

### B10. `ensureTenantAccess` unconditionally bypasses ADMIN/DISPATCHER — OPEN

- **Symptom:** while fixing B3/B5 in the same pass, the fix's own commit
  message flagged that PUT/DELETE `/api/crews/[id]` now matches GET's
  *existing* tenant-check behavior — but that existing behavior itself
  unconditionally lets ADMIN/DISPATCHER roles bypass the tenant check.
- **Root cause:** `ensureTenantAccess` in
  `src/services/auth/resource-access-service.ts` contains
  `if (user.role === 'ADMIN' || user.role === 'DISPATCHER') return;`
  before any tenant comparison runs. Verified still present 2026-07-08:
  `grep -n "user.role === 'DISPATCHER'" src/services/auth/resource-access-service.ts`
  → 1 hit, line 81.
- **Evidence:** flagged in `830f241`'s commit message (2026-06-28,
  "NOTE: ensureTenantAccess itself bypasses ADMIN/DISPATCHER
  unconditionally... Flagging that as a separate, bigger architectural
  question"); the underlying single-tenant no-op behavior was added
  earlier by `cd7455a` (`fix(auth): ensureTenantAccess no-ops in
  single-tenant deployments`, 2026-04-25) for a legitimate reason (an
  operator couldn't preview their own report because null-tenant
  comparisons were hitting 403 in the natural single-tenant state).
- **Status:** **OPEN** since 2026-06-28. This is an explicitly deferred
  product decision, not an oversight — do not "fix" it either
  direction without a decision. It blocks two known IDOR fixes (media,
  report history). Current call-site count is owned by
  `pilingtrack-architecture-contract` §"Known-weak points" item 1 (3 caller
  files / 4 call sites as of 2026-07-08) — don't restate a number here, it
  drifts; re-verify there. Re-surface when second-tenant onboarding starts
  (hybrid-SaaS decision horizon **2026-11-24**, see `product-bible`).
- **Lesson:** "is this a gap or a deliberate platform-admin design"
  questions should be raised explicitly and left open, not resolved by
  guessing inside an unrelated change. Full context and current invariant:
  `pilingtrack-architecture-contract` §"Known-weak points and OPEN
  questions" item 1, and `pilingtrack-change-control` §3.1 "Known open
  edge".

### B11. "P0/P1 tenant mixing" QA-council finding — downgraded, not closed

- **Symptom:** a 25-role QA-council-style audit flagged tenant isolation
  allowing privileged-role (ADMIN/DISPATCHER) cross-tenant access as a
  release-blocking **P1**, alongside RLS running in "permissive audit
  mode" rather than fail-closed as a second P1.
- **Root cause of the downgrade (not of the finding — the finding was and
  remains technically accurate):** the same document's own correction
  note observes that prod runs `MULTI_TENANT_MODE=single`
  (`.env:7`), so with only one tenant in existence, cross-tenant access is
  not currently *exploitable* — there is no second tenant's data to leak
  into. The finding is real code (see B10) but not a live-prod risk today.
- **Evidence:** `docs/qa-council/2026-06-21-release-audit.md`, correction
  note lines 6–8 ("в проде `MULTI_TENANT_MODE=single`... понижаются до
  «долг до подключения второго тенанта»"), original P1 findings at
  lines 31–55 (`resource-access-service.ts:65-95`,
  `src/app/api/crews/all/route.ts:25-29`,
  `tests/integration/tenant-isolation.spec.ts:39-45`).
- **Status:** Downgraded 2026-06-21 from release-blocker to "debt owed
  before second-tenant onboarding" — same substance as B10, tracked there
  going forward. Not settled, not a live P1 either: this is the
  reference example of a correctly-downgraded (not dismissed) finding.
- **Lesson:** "is this exploitable in our actual current deployment
  configuration" is a legitimate and necessary question to ask about a
  theoretically-correct finding — but the answer is a downgrade with a
  tracked re-open trigger (second tenant), never a silent close. See
  `pilingtrack-research-methodology` for the general acceptance discipline
  this exemplifies.

---

## C. DB / Migrations

### C1. Stale migrate-image gotcha — migration silently skipped on deploy

- **Symptom:** deploy exit code 0 across the board; `migrate` service log
  said "No pending migrations to apply"; the app then crashed on a table
  (`MaintenanceRecord`) that the just-shipped migration was supposed to
  create.
- **Root cause:** the `migrate` Docker service **bakes
  `prisma/migrations` into its image at build time** (no volume mount).
  `docker compose build app workers` without rebuilding `migrate` leaves
  it on the old baked-in migration set — genuinely no pending migrations
  from its own point of view, exits 0, schema stays stale.
- **Evidence:** live incident 2026-05-27
  (`docs/runbooks/008-manual-deploy.md`); hardening — `558f4e4` (docs the
  gotcha), `80dc56c` (auto-rebuild migrate on new migration + sequential
  build), `0a6dffe` (dedicated lean migrate stage, 2.46 GB → 2.14 GB,
  same baked-in behavior by design).
- **Status:** Settled as a known, permanently-guarded pattern (inherent to
  baking migrations into an image — detected-and-handled every deploy, not
  fixed away). Detect:
  `git diff --name-only --diff-filter=A HEAD@{1}..HEAD -- 'prisma/migrations/**'`;
  handle: `docker compose build migrate app workers`, verify via
  `_prisma_migrations` — never trust the exit code alone. Rule-of-record:
  `pilingtrack-change-control` §2.2, `pilingtrack-debugging-playbook` row 3.
- **Lesson:** a green CI/deploy exit code proves the *step ran*, not that
  it *did what you assumed*. For anything with a baked-in artifact
  (migrations here; the same class of bug as C2/D1's stale-state
  problems), verify the actual post-state, not the process's own reported
  success.

### C2. `crew_equipment_active_unique` migration failed mid-deploy on duplicate prod data

- **Symptom:** during the 2026-06-30 deploy (218 commits, `5500dd5` →
  `830f241`), a unique-constraint migration adding
  `crew_equipment_active_unique` failed against prod because prod already
  had duplicate "active crew" rows the new constraint forbade.
- **Root cause:** the migration's pre-flight data check was written as
  one multi-statement paste rather than separate statements — when the
  failure happened, isolating which statement/row caused it took longer
  than it should have, and the migration had to be recovered mid-deploy.
- **Evidence:** `eeac4f5` (`fix(crews): close double-active-crew gap on
  reactivation + DB invariant`) is the code-level companion fix (closes
  the gap that let duplicate active crews occur in the first place);
  migration folder `prisma/migrations/20260624000000_crew_equipment_active_unique`.
  Deploy incident narrative: operator memory of 2026-06-30 ("prod was on
  a stray hotfix branch... crew_equipment_active_unique migration failed
  on duplicate active crew, recovered").
- **Status:** Settled — recovered same deploy, 2026-06-30.
- **Lesson:** for any migration adding a uniqueness constraint, pre-flight
  data checks (does prod already violate the constraint you're about to
  add?) must run as **separate statements**, not one combined script —
  you need to see each check's own result before the next runs. Rule-of-
  record: `pilingtrack-change-control` §2.4.

### C3. `User.tenantId` schema drift → prod 500 on user create

- **Symptom:** `POST /api/users` returned 500 in production only; local
  dev worked fine.
- **Root cause:** the live prod `User.tenantId` column was `NOT NULL`,
  but `prisma/schema.prisma` declared it nullable. `createUser` therefore
  sometimes wrote `NULL`, violating the live constraint that the schema
  file didn't even know existed.
- **Evidence:** `5500dd5` (`fix(users): set tenantId on user create to
  satisfy NOT NULL (prod 500)`, 2026-06-17, branch
  `hotfix/user-create-tenantid`) — `createUser` now sets `tenantId`
  explicitly and fails closed.
- **Status:** Settled 2026-06-17.
- **Lesson:** a prod-only 500 with no local repro is almost always schema
  drift between the live database and `schema.prisma` — diff the live
  schema (`\d "TableName"` in psql) against the file before writing any
  application-level workaround. Same lesson produced D1's fix pattern.
  Rule-of-record: `pilingtrack-debugging-playbook` row 6.

### C4. FORCE RLS rollout

- **Symptom:** row-level security policies existed but ran in "permissive
  audit mode" (the table-owner role the app connects as bypasses RLS by
  default in PostgreSQL unless `FORCE ROW LEVEL SECURITY` is set) — flagged
  as a P1 in the 2026-06-21 QA-council audit (see B11) alongside the
  tenant-mixing finding.
- **Root cause:** RLS policies were written and attached but never forced,
  so they were defense-in-depth in name only for the app's own connection
  role.
- **Evidence:** migration `20260701020000_force_row_level_security`,
  deployed 2026-07-03 per operator memory — 25 tables now
  `FORCE ROW LEVEL SECURITY`.
- **Status:** Settled 2026-07-03, with a documented residual: the
  policies themselves are written fail-*open* when
  `app.current_tenant` is unset (a deliberate scope cut recorded in the
  migration header) — see Open Battles below. FORCE RLS closes the
  table-owner-bypass gap; it does not make RLS the primary guard. The
  app layer (`ensureTenantAccess` et al.) remains the primary guard, RLS
  is defense-in-depth. Detail: `pilingtrack-architecture-contract`
  §"Security invariants" #2.
- **Lesson:** "RLS is enabled" and "RLS is enforced against the app's own
  role" are different claims — check `FORCE ROW LEVEL SECURITY`
  specifically, not just `ENABLE ROW LEVEL SECURITY`.

---

## D. Analytics / Projections

### D1. Nightly `SiteWeeklyTrend` rebuild destroys the table then crashes

- **Symptom:** `SiteWeeklyTrend` had 2 rows while the daily-summary table
  had ~56 — the weekly aggregate was near-empty despite being a "nightly
  safety-net" job that should have kept it current.
- **Root cause:** the rebuild job did `deleteMany({})` (wipe the whole
  table) and then tried to insert fresh rows **without setting
  `tenantId`** — the same NOT-NULL-vs-nullable schema drift family as C3.
  On prod, where `tenantId` is NOT NULL, every nightly run wiped the table
  and then crashed on the very first insert, while the worker process
  itself stayed reported as "healthy" (the crash was inside the job logic,
  not the worker process).
- **Evidence:** `a8b1aa4` (`fix(analytics): stop nightly destruction of
  the weekly trend projection`, 2026-07-03) — resolves `tenantId` from
  `Site`, makes the rebuild transactional (no more wipe-then-crash
  window).
- **Status:** Settled 2026-07-03 as a code fix. The *pattern* (wipe-then-
  rewrite as the shape of a "safety net") is flagged as a standing risk
  in `pilingtrack-architecture-contract` §"Honest weak points" — treat any
  destructive-then-repopulate job as needing the same transactional
  scrutiny, not just this one instance.
- **Lesson:** "the healthier the schedule, the emptier the table" is the
  signature of a destructive job masquerading as a safety net — when a
  read-model table shrinks on a predictable cadence, suspect the rebuild
  job before the data source. Backfill/repair path:
  `POST /api/admin/projections/rebuild?name=site-weekly` (or `all`).

### D2. 2026-07-07 data-flow bug wave — 5 confirmed cross-module bugs

- **Symptom:** a data-flow audit against a prod-data copy found five
  independent, confirmed bugs, all shipped the same day: (1) the Equipment
  active/inactive toggle was a no-op — `isActive` never flowed from
  command → `aggregate.update()`; (2) downtime is stored in **hours**, but
  three consumers assumed three different units — the alert thresholded it
  as *minutes* (≤120 practically never fired), the fleet tile rendered it
  as *days* (`ceil(hours/24)` — 11h shown as "1 дн"), and `downtimeRatio`
  divided hours by shift-*minutes* (~60× too small); (3) deleting a report
  left orphaned `ReportAnalytics`/`SiteDailySummary`/`OperatorPerformance`
  rows with no reprojection; (4) `SiteDailySummary` hard-skipped whenever
  the outbox event was missing `siteId` and looked reports up by the wrong
  key (`id` vs `reportId`); (5) the report-submitted Telegram/PDF
  notification was silently dropped because `DEFAULT_TENANT_ID` reached
  the `workers` container but not `app` — and the handler that fires this
  notification (`registerAllEventHandlers`) runs **in-process inside
  `app`**, not `workers`.
- **Root cause:** independent per bug (see commits), but 1–4 share a
  theme — a value or event context silently dropped or misread between
  write and projection — while 5 is a deploy-config gap (env var present
  in one container, assumed present in both).
- **Evidence:** `e79c5da` (`fix(reports,equipment): honest downtime units,
  working active toggle, delete reprojection`, 2026-07-07) closes 1–4;
  `1008ae1` (`fix(monitoring): don't zero a fleet card when the analytics
  projection lags`, 2026-07-07) is a related but distinct fix — see below;
  `c3a1774` (`fix(deploy): pass DEFAULT_TENANT_ID to the app container`,
  2026-07-07) closes 5.
- **Status:** Settled 2026-07-07 for items 1–5 above. A **separate**,
  related bug shipped the same day in `1008ae1`: `getFleetSnapshot` used
  to skip a today's report entirely (`if (!a) continue`) whenever its
  `ReportAnalytics` projection row was missing, rendering a card "active"
  with all-zero piles/drilling/downtime and undercounting the fleet
  header totals. Fixed to use the projection when present and fall back
  to summing raw `Report` rows when the projection is absent/lagging.
- **Lesson:** when investigating "wrong numbers" bugs, check the stored
  unit against every consumer's assumed unit explicitly — don't trust that
  because one consumer got it right, they all did (this project has hit
  the same hours/minutes/days confusion multiple times). See
  `piling-domain-reference` for the canonical downtime-unit invariant
  (HOURS) this incident hardened.

### D3. Outbox drops event context (`siteId`, tenant/actor) — OPEN at the root

- **Symptom:** the `SiteDailySummary` handler in D2 had to hard-skip when
  `event.siteId` was missing from the outbox payload — the outbox event
  itself didn't reliably carry `siteId`. Separately, projections generally
  fall back to `DEFAULT_TENANT_ID` when an event lacks explicit tenant
  context.
- **Root cause (of the symptom, item 4 in D2):** worked around by
  resolving both `siteId` and `date` via a `reportId` lookup instead of
  trusting the event payload, matching how the analytics handler already
  did it (`e79c5da`). This is a mitigation, not a fix of the outbox
  publisher itself.
- **Evidence:** `e79c5da` for the reportId-lookup mitigation; `c3a1774`
  for the specific deploy-level manifestation (missing
  `DEFAULT_TENANT_ID` in the app container feeding the same class of
  fallback-context bug). `pilingtrack-architecture-contract`
  §"Honest weak points" explicitly carries this forward as OPEN:
  "Tenant context in events... Root-cause hardening — events carrying
  explicit tenant/actor context — is still OPEN per the 2026-07-07
  data-flow audit."
- **Status:** **OPEN**. The specific symptoms found on 2026-07-07 are
  mitigated (handlers now resolve missing context via lookup rather than
  trusting the event), but the outbox publisher does not yet guarantee
  every event carries full context (siteId, tenantId, actorId) at publish
  time. Do not assume a new handler can trust the event payload alone —
  check whether it needs the same reportId-lookup fallback pattern.
- **Lesson:** a lookup-based workaround at the consumer is a legitimate
  short-term fix but is not the same claim as "the producer emits complete
  events" — track the two separately, and don't let a fixed symptom read
  as a fixed root cause.

---

## E. Infra / Deploy

### E1. Prod disk-full incident (2026-06-24) — root cause fixed

- **Symptom:** "users can't log in" / whole-app failures on prod. Hours
  went into auth-side debugging before the actual cause was found.
- **Root cause:** a broken `archive_command` for WAL (Write-Ahead Log)
  archiving accumulated 9.6 GB of un-recycled WAL files, filling the 30 GB
  VPS disk to 100%. The visible symptom ("cannot log in") had nothing
  directly to do with auth — a full disk breaks Postgres writes, which
  breaks session/login writes, which surfaces as "login broken".
- **Evidence:** `7e5ab49` (`fix(ops): disable broken WAL archiving that
  filled the prod disk`) is the immediate fix (`archive_mode=off`);
  `0d74d97` (`feat(ops): independent host-level disk guard (survives
  full-disk when Prometheus can't)`) and `df910b0` (`fix(ops): silence
  disk-guard cooldown-stamp error on non-root manual runs`) are the
  standing prevention. Runbook 009 (`docs/runbooks/009-pitr-restore.md`)
  documents that PITR is unavailable as a direct consequence
  (`archive_mode=off` since this date).
- **Status:** Settled 2026-06-24; disk stable ~63–66% since (per operator
  memory). Disk-guard timer + alert pipeline live
  (`scripts/disk-guard.sh`, `deploy/systemd/pilingtrack-disk-guard.{service,timer}`).
- **Lesson:** on any prod login outage or blanket 500s, run `df -h /`
  **before** touching auth code — this is now rule #1 in
  `pilingtrack-debugging-playbook`. A full disk masquerades as almost any
  other failure because it breaks every DB write, not just the one you
  happen to be looking at.

### E2. Prod found running a stray hotfix branch instead of `main`

- **Symptom:** during the 2026-06-30 deploy effort, prod was discovered
  to be running a stray hotfix branch rather than `main` — 218 commits
  (`5500dd5` → `830f241`, later extended to `830f241`) had never actually
  reached the deployed environment.
- **Root cause:** an earlier hotfix deploy branched off `main` for a
  narrow fix and was never merged back / prod was never repointed at
  `main` afterward, so subsequent `main` work silently accumulated
  without reaching production.
- **Evidence:** operator memory of the 2026-06-30 deploy ("prod was on a
  stray hotfix branch (not main); crew_equipment_active_unique migration
  failed on duplicate active crew, recovered" — see C2 for that part of
  the same deploy).
- **Status:** Settled 2026-06-30 — prod repointed at `main`,
  218 commits caught up in one deploy.
- **Lesson:** periodically verify what commit/branch prod is *actually*
  running (`git rev-parse --short HEAD` inside the running container, or
  `/api/health`'s reported `APP_VERSION` — see M2 in Open Battles for a
  related but distinct gap in that same verification chain) rather than
  assuming "we deployed `main`" stays true across every subsequent deploy.

### E3. Seed-on-prod hazard

- **Symptom:** running the seed script against a running production
  database is a data-loss risk in principle for any Prisma-seeded app.
- **Root cause / history:** the original defense was a bare
  `new PrismaClient()` construction that happened to crash under the
  driver-adapter setup used in this project — an *accidental* safety net,
  not a designed one.
- **Evidence:** the driver-adapter crash was fixed 2026-05-24 (seed now
  constructs the client with `PrismaPg`, so dev/CI run it cleanly) —
  which *removed* the accidental protection. Real, intentional
  protections now: `SKIP_SEED=1` set in `.env` on prod (defence in depth)
  and `assertNotProduction()` inside `prisma/seed.ts` itself.
- **Status:** Settled — two independent, intentional guards now exist
  where before there was one accidental one.
- **Lesson:** when you fix a bug that happens to also be an accidental
  safety mechanism, check whether anything was relying on the broken
  behavior for safety, not just for correctness — and replace it with an
  intentional guard before shipping the fix.

### E4. Off-site backup to Cloudflare R2 — live, restore drill OPEN

- **Symptom / motivation:** prod backups existed only as local nightly
  logical dumps on the same VPS — a host-level disaster (disk failure,
  provider issue) would take out the backups along with the primary data.
- **Fix:** a nightly systemd timer pushes dumps to Cloudflare R2, reusing
  the app's existing `S3_*` media credentials.
- **Evidence:** `0910129` (`feat(ops): wire off-site backup copy to
  Cloudflare R2`); live and verified running per operator memory
  (2026-07-01).
- **Status:** the *push* is Settled and verified running. The *restore*
  side is **OPEN**: a full restore from R2 has never been rehearsed. Per
  `pilingtrack-architecture-contract` §"Known-weak points": "the backup is
  unproven until restored once."
- **Lesson:** a backup pipeline that has only ever been tested in the
  write direction is a hypothesis, not a guarantee. Schedule an actual
  restore drill on a separate host before trusting it under pressure —
  this is explicitly flagged as unresolved, not forgotten.

---

## F. Dead ends & rejected designs

Read this section before re-proposing any of the following — each was
tried, evaluated, and explicitly not pursued (or reversed after being
tried), with a stated reason.

### F1. `workers-pdf` container split — reverted (premature optimization)

- **Symptom / motivation:** PDF rendering was believed to warrant its own
  container, separate from the general `workers` container, presumably
  for isolation or independent scaling.
- **Root cause of the revert:** per operator memory, the split was
  premature optimization for this project's actual scale and the single
  VPS it runs on — no profiling data justified the added operational
  complexity of a second worker container (its own image, its own compose
  service, its own failure mode) before this decision was made.
- **Evidence:** `9f9c979` (`fix(compose): remove orphan workers-pdf
  overlay so prod compose validates`) — the removal of the leftover
  compose overlay after the split was abandoned. PDF processing lives back
  in the single `pilingtrack-workers` container.
- **Status:** Settled — decision recorded, don't re-attempt without
  profiling data showing the single-container setup is actually a
  bottleneck (e.g. PDF jobs measurably delaying outbox/projection
  processing under real load).
- **Lesson:** splitting a container is an operational cost (compose
  service, image, deploy step, another thing that can be unhealthy) that
  needs a measured justification, not a plausible-sounding architectural
  instinct. See the `ai-development-guide` skill's anti-pattern guidance
  on premature abstraction.

### F2. Kubernetes / Helm / ArgoCD stack — deleted, no migration path within ≤1 year

- **Symptom / motivation:** a full k8s/Helm/ArgoCD deployment stack existed
  in the repo alongside (or instead of) the Docker Compose setup actually
  used in production.
- **Root cause of the removal:** the project runs on a single VPS with
  Docker Compose; there was no near-term (within the stated ≤1 year
  horizon) plan or need to migrate to Kubernetes, so maintaining a second,
  unused deployment stack was pure carrying cost — divergent configs to
  keep in sync, no operational benefit.
- **Evidence:** `ddb6a85` (`chore(infra): remove Kubernetes/Helm/ArgoCD
  stack`), part of the 2026-05-31 simplify-and-harden pass (same session
  that also produced B1's `IS NULL OR` fix and closed the initial round of
  IDOR findings, per `pilingtrack-research-methodology`'s cited history).
- **Status:** Settled 2026-05-31.
- **Lesson:** infrastructure code for a deployment target you're not using
  and have no near-term plan to use is dead weight, not "future-proofing"
  — CLAUDE.md's Simplicity First principle applies to infra as much as
  application code. If Kubernetes becomes a real near-term need, design
  it fresh against the current architecture rather than resurrecting this.

### F3. Migrate-stage Docker prune — dead end (unverified in git history, reported by operator)

- **Symptom / motivation:** after the successful lean migrate-stage
  rewrite (`0a6dffe`, C1 evidence — 2.46 GB → 2.14 GB by dropping the
  `builder` target's Next.js build output and dev tree), a further
  optimization was attempted: pruning devDependencies from the migrate
  stage's `node_modules`, then reinstalling only `prisma` + `tsx` as
  production dependencies.
- **Root cause of the dead end:** the packages this approach would prune
  away and then reinstall (`prisma` + `tsx`) are themselves most of the
  weight being targeted — net size savings measured at approximately
  zero.
- **Evidence:** **unverified, reported 2026-07-08** — no corresponding
  commit was found in git history (`git log --all --grep` for
  prune/devDependencies/Prisma-engine terms around the migrate Dockerfile
  turned up only the successful `0a6dffe` and unrelated workers/ws prune
  commits `39f4922`, `a213808`). This entry is carried from operator
  session memory of the experiment, not from a landed commit — treat it
  as a documented negative result, not a verified historical fact, until
  a commit or written note surfaces.
- **Status:** Settled as "don't retry this specific approach" — but see
  the caveat above on evidence quality.
- **Lesson:** if you want to shrink the migrate image further, the
  Prisma engine binaries (not JS devDependencies) are reportedly the
  actual weight — profile there before retrying a prune-and-reinstall
  approach that nets nothing.

### F4. TelemetryBuffer race condition — investigated and refuted

- **Symptom / claim:** an independent codebase anomaly review flagged a
  CRITICAL data race in `TelemetryBuffer` between two statements.
- **Investigation result:** refuted. The two statements in question have
  no `await` between them; Node's single-threaded event loop guarantees
  they execute atomically with respect to any other JS callback — there
  is no actual race.
- **Evidence:** stated directly in `b8a0593`'s commit message: "one
  CRITICAL finding from the same review, a claimed TelemetryBuffer data
  race, was investigated and rejected: the two statements in question have
  no `await` between them, so Node's single-threaded event loop makes them
  atomic — not a real race."
- **Status:** Settled — refuted, not fixed (there was nothing to fix).
- **Lesson:** "no `await` between two statements in Node" is a valid,
  checkable proof of atomicity for that specific pair of statements — an
  agent or reviewer flagging a "race condition" in synchronous-looking JS
  needs to show where the interleaving point actually is, not just that
  two operations touch shared state. See `pilingtrack-research-methodology`
  for the two-part evidence bar (mechanism + survives adversarial
  refutation) this exemplifies passing in the negative direction.

### F5. Telemetry simulator + Leaflet map MVP — dropped (dormant strategy, not abandoned feature)

- **Symptom / motivation:** a `/monitoring` page with a Leaflet map
  showing simulated GPS markers, plus a telemetry data simulator, was
  built as an MVP for live equipment tracking.
- **Root cause of the drop:** built before the data-source strategy was
  settled. Once decided — data comes from operator reports today, OEM
  APIs / aftermarket telematics boxes (Teltonika / LiDAT / B-Tronic /
  Junttan Life) later — the Leaflet map of synthetic markers was the
  wrong shape: it laid no foundation that would be reused, only code to
  migrate away from.
- **Evidence:** `f320e53` (`revert(telemetry): drop simulator + Leaflet
  map MVP`, 2026-05-17) removed `scripts/telemetry-simulator.ts`, the
  monitoring page, the map component, the `CHANNEL_TELEMETRY` fan-out
  hook, the nav entry, and the `leaflet` dependency — while deliberately
  **keeping** OPERATOR/ASSISTANT scoping on the telemetry GET route, the
  `equipmentIds[]` range param, and unrelated cleanups. Originating
  commits: `734e062`, `defbd8e`.
- **Status:** Settled as a strategy decision, 2026-05-17. The telemetry
  *ingestion* path (routes, `TelemetryRecord` model, MQTT ingestion
  service) is explicitly **dormant, not dead** — per
  `pilingtrack-change-control` §3.2, do not delete it; it wakes up when a
  real telematics box connects to a rig. It has since received live
  security fixes (`370e592`, `f36707c` — 2026-07-01/2026-06-xx tenant-
  scoping of the batch ingest endpoint), which is itself evidence of
  active maintenance, not abandonment.
- **Lesson:** a UI/MVP built ahead of a settled data strategy is a real
  cost even when the code is fine — it creates something to migrate away
  from. Settle the strategy (what will actually produce the data) before
  building the consumer of that data. This does not mean don't prototype;
  it means don't build the "map" before you know what's plotting the
  points.

### F6. Modern event bus (Kafka/NATS adapters) — built, zero callers, deleted

- **Symptom / motivation:** ADR-0006 (2026-04-08, originally Accepted)
  planned a migration to a "modern" event bus in `core/event-bus/` with
  Kafka/NATS adapters, ~947 lines, intended to replace the legacy bus.
- **Root cause of the deletion:** the modern bus was built but never
  actually adopted by any production code path — it had zero callers. A
  2026-05-20 monitoring incident, initially suspected to implicate "the
  event bus" broadly, was root-caused to a handler *registration race* in
  the legacy bus, which proved the legacy bus itself ran production fine.
  There was no evidence justifying a migration to unproven, callerless
  code.
- **Evidence:** ADR-0006 marked Superseded (reversed 2026-05-21) in
  `docs/adr/`; per `pilingtrack-architecture-contract` §"ADRs":
  "the modern bus had zero callers and was deleted; the legacy bus is the
  single source of truth." The legacy bus in
  `src/services/reports/domain-events.ts` remains the production event
  bus; `core/event-bus/` retains only the schema registry.
- **Status:** Settled 2026-05-21 (ADR superseded same week it was tested
  against a real incident). Rule-of-record:
  `pilingtrack-architecture-contract` invariant checklist item 6
  (`grep -rln "core/event-bus/event-bus" src` must stay empty).
- **Lesson:** "we built the replacement, we should migrate to it" is not
  sufficient justification on its own — a migration needs a demonstrated
  problem with the current system that the replacement actually solves.
  Here, the incident that could have justified the migration instead
  exonerated the system being replaced. A future Kafka/NATS need means
  building a new `event-bus-v3` with a demonstrated caller first, not
  resurrecting this one from git history.

### F7. `src/modules/reports/api/**` — dead, stale duplicate, removed

- **Symptom:** two sets of report-related route-shaped code existed:
  `src/modules/reports/api/**` and the live `src/app/api/reports/**`.
- **Root cause:** the `modules/reports/api/**` tree was a stale duplicate
  left over from an earlier structuring attempt — it was never the live
  route path (Next.js App Router routes are resolved from
  `src/app/api/**` only) and had drifted out of sync.
- **Evidence:** removed in `e6ce96b` (`feat(reports): optimistic-locking
  on report upsert + remove dead api duplicate`). Verified removed as of
  2026-07-07: `ls src/modules/reports/api` fails;
  `ls src/app/api/reports` exists (per
  `pilingtrack-architecture-contract` invariant checklist item 7).
- **Status:** Settled. Rule-of-record: `pilingtrack-architecture-contract`
  §"The half-done services→modules migration" — "Do not recreate an
  `api/` directory inside a module — HTTP lives in `src/app/api/` only."
- **Lesson:** a module folder that visually mirrors the App Router's `api`
  naming convention (`modules/<x>/api/`) is not itself wired into routing
  in this framework — if you find one, check whether it's live or a stale
  duplicate before assuming symmetry with `src/app/api/`.

---

## G. Open battles

These are stated plainly as OPEN — do not oversell them as fixed, and do
not silently resolve one inside an unrelated change.

| Battle | One-line status | Owner / detail |
|---|---|---|
| CSP violation blocking a JS chunk on `/monitoring` | OPEN (confirmed unsolved 2026-07-08) | Full campaign lives in `pilingtrack-csp-monitoring-campaign` — don't patch CSP headers blind. Referenced by `pilingtrack-debugging-playbook` row 8; see also `pilingtrack-architecture-contract` §"Security invariants" #7. |
| `ensureTenantAccess` ADMIN/DISPATCHER bypass | OPEN, deferred decision | See B10; decision horizon 2026-11-24. |
| RLS policies fail-open on unset `app.current_tenant` | OPEN, documented scope cut | See C4; closing it needs auditing every raw-SQL/admin path. Never treat RLS as the primary tenant guard. |
| Restore drill for off-site (R2) backups never performed | OPEN | See E4. |
| Telegram alerts for the PM (preventive-maintenance) scheduler | OPEN, unbuilt | Per operator memory: the ТО (maintenance) CMMS roadmap (P1a→P5) is complete and deployed; this one alerting leftover was never built — a deferred nice-to-have, not a bug. |
| H3 — health endpoints / deploy gate check the wrong things | OPEN | `reports/production-audit-2026-07-02-independent.md` §H3: `/api/health` doesn't check workers/Redis/storage/projections/real WS state; deep health treats a Redis `GET` succeeding as WS "up" with zero real heartbeats; GitHub deploy gate only calls `/api/health`. Readiness/liveness split proposed, not confirmed implemented. |
| H5 — PgBouncer deployed but bypassed by runtime | Reported **Settled** | Per `pilingtrack-architecture-contract` #4, routed via `pgbouncer:5432` since `6b6a3d7` — listed here because the audit that raised it is a cited source and it moved OPEN→Settled between audit date and 2026-07-07. |
| M2 — `/api/health` version didn't identify the deployed artifact | Reported Settled by later commits | Audit found `version: 2.6.0` while deployed HEAD was `2a97afc` (§M2, 2026-07-02). `93425a6` and `c555422` post-date it and appear to close it — re-verify against a live deploy before calling it fully closed; not independently re-audited. |

---

## For future maintainers: how to add an entry

1. **Confirm it's archaeology, not triage.** A live bug goes to
   `pilingtrack-debugging-playbook` first; come back here once it's
   resolved (or definitively still open) to record the story.
2. **Verify every commit hash before citing it**, with
   `git cat-file -e <hash>`. Can't verify one (chat/memory/teammate note,
   not in `git log --all`)? Write `<description> (unverified, reported
   <date>)` instead of presenting it as fact — see F3 for the template.
3. **Use the exact entry template**: Symptom / Root cause / Evidence /
   Status / Lesson. Settled entries name the rule-of-record (usually
   `pilingtrack-change-control` or `pilingtrack-architecture-contract`);
   Open entries name what's missing and, if known, the horizon that
   reopens the decision.
4. **Add it to the correct area** (A–G) and update the table of contents
   with its ID and short title.
5. **Cross-reference, don't duplicate.** This skill owns narrative detail.
   A standing rule belongs in `pilingtrack-change-control`; an
   architecture invariant belongs in `pilingtrack-architecture-contract`;
   a recurring triage row belongs in `pilingtrack-debugging-playbook`.
   Link to those, don't copy their content — and the reverse: a full
   incident narrative belongs here, not duplicated into them.
6. **When an OPEN item closes**, move it out of section G (or mark its
   area entry Settled) with the closing commit. Don't leave closed items
   in the Open Battles table.
7. **Re-verify volatile facts before reusing them** — dates, "still true
   as of" claims, and file:line citations all drift.

---

## Provenance and maintenance

Written 2026-07-08, branch `chore/project-skills`. Every commit hash above
was checked with `git cat-file -e <hash>` before being cited (all
verified present in this repository's history). Doc citations
(`docs/qa-council/2026-06-21-release-audit.md`,
`reports/production-audit-2026-07-02-independent.md`) were read directly,
not summarized from memory.

Re-verification commands, grouped by section:

```bash
# A — UI redesign wave (originals + reverts all exist, same-day batch revert)
git log --format='%h %ad %s' --date=iso -1 718698c 78ae4dd f286fe9 a7705fe 97fe84f
git log --format='%h %ad %s' --date=iso -1 b490dcc 38890c3 213be3f 13febdf afb3712

# B — tenancy/security series (spot-check a few load-bearing ones)
git cat-file -e 22bf1a5 && git cat-file -e 10fc759   # B1
git cat-file -e b483cbe && git cat-file -e 145129d   # B2
git cat-file -e ef30404 && git cat-file -e 7f1fff3   # B3/B4
git cat-file -e 830f241 && git cat-file -e 3103731   # B5/B9
git cat-file -e b8a0593                              # B6/B7
git cat-file -e c58ef71                              # B8
grep -n "user.role === 'DISPATCHER'" src/services/auth/resource-access-service.ts  # B10 still open (1 hit expected)

# C — migrations
git cat-file -e 0a6dffe && git cat-file -e 80dc56c   # C1
ls prisma/migrations | grep crew_equipment_active_unique   # C2
git cat-file -e 5500dd5                              # C3
ls prisma/migrations | grep force_row_level_security # C4

# D — analytics/projections
git cat-file -e a8b1aa4                              # D1
git cat-file -e e79c5da && git cat-file -e 1008ae1 && git cat-file -e c3a1774  # D2/D3

# E — infra/deploy
git cat-file -e 7e5ab49 && git cat-file -e 0d74d97   # E1
git cat-file -e 0910129                              # E4

# F — dead ends
git cat-file -e 9f9c979                              # F1
git cat-file -e ddb6a85                              # F2
git cat-file -e f320e53                              # F5
grep -n "core/event-bus/event-bus" -r src            # F6 (should be empty)
ls src/modules/reports/api 2>&1                      # F7 (should fail / not exist)

# G — open battles: re-check current OPEN status before trusting this file
grep -n "user.role === 'DISPATCHER'" src/services/auth/resource-access-service.ts
grep -n "FORCE ROW LEVEL SECURITY\|current_tenant.*IS NULL" prisma/migrations/20260701020000_force_row_level_security/migration.sql
ls .claude/skills | grep -i csp-monitoring-campaign   # confirm whether this skill now exists
curl -s https://orionpiling.ru/api/health | grep -o '"version":"[^"]*"'   # cross-check against `git -C /opt/pilingtrack rev-parse --short HEAD` on the VPS for M2
```

Dated facts that will go stale on their own schedule:
- **2026-11-24** — hybrid-SaaS go/no-go decision. B10, B11, and F2's
  "no k8s migration needed within ≤1 year" all unfreeze around this date.
- **F3** (migrate-stage prune) is sourced from operator memory only, not
  git history — if a commit ever surfaces for it, replace the
  "unverified" label with the verified hash.
- **G's H5 and M2 rows** were re-classified from OPEN (as of their audit
  date) to Settled based on later commits found during this file's
  authoring (2026-07-08) — they have not been independently re-audited
  since; treat with slightly less confidence than entries with a
  dedicated fix commit and no audit contradicting it.
- Anything marked "per operator memory" in this file (E1's disk
  percentage, E2, B2's backfill count, B4's worktree cleanup) reflects
  session memory rather than a re-derived fact from the repository —
  re-derive from prod directly (SSH, `docker compose`, `psql`) if the
  claim matters for a decision.
