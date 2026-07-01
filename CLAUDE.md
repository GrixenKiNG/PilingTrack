# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Model Economy (a note for the human, not Claude)

Claude **cannot switch its own model mid-session** — it runs as one model until you change it with `/model`. This table is therefore a reminder for **you, the operator**, on when to switch:

| Task | Pick |
|------|------|
| Filtering, formatting, log greps, one-liners | **Haiku** — cheap, fast |
| Refactor a function, write tests, a small module | **Sonnet** — the everyday default |
| Architecture, a gnarly bug, multi-step or security-critical work | **Opus** — when getting it right matters more than cost |

Regardless of model, Claude should: keep answers terse on trivial tasks, and delegate large mechanical work (mass greps, bulk edits) to cheap-model subagents.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Optional: lay out a plan before level-5 work

For genuinely complex tasks **only** (architecture, security-critical changes, or 3+ files with unclear blast radius), it's worth pausing before touching code to surface:

```
Understanding: [2-3 sentences]
Assumptions:   [bullets]
Plan:          1. [step] → verify: [check]
               2. [step] → verify: [check]
Proceed?
```

For everyday edits, skip the ceremony — just do the work (a one-line plan only if it's multi-step). Don't apply this template to trivial tasks; that wastes tokens, which contradicts Simplicity First.

---

## Project-Specific Guidelines (PilingTrack)

### Architecture & Design

**Keep DDD/CQRS boundaries clear:**
- `src/modules/` = domain logic (commands, queries, entities)
- `src/services/` = legacy/shared services (auth, audit, notifications)
- `src/core/` = infrastructure (api-wrapper, observability, circuit-breakers)
- `src/app/api/` = route handlers (use `withApi`/`withMutation` wrappers)

**Simplicity rule:** New code should live in the simplest category possible:
- Try `modules/` first (DDD with clear boundaries)
- Fall back to `services/` only if cross-cutting
- Never add to `core/` unless it's true infrastructure

**Where to write new domain code (the modules↔services migration is half-done):**
The `services/ → modules/` migration was started and parked mid-way. Don't start a separate refactor to "finish" it — finish each domain *opportunistically*, the next time you're already editing it.
- `reports/` is the **fully-migrated reference**: real logic lives in `modules/reports/` (`domain/application/commands/queries/infrastructure`). New report code goes there.
- `users`, `analytics`, `telemetry`, `system`: `modules/<x>/index.ts` is a **re-export facade only** — the real code still lives in `src/services/<x>/`. For these, add new logic to `services/<x>/` and export it through the facade. Only relocate into a full `modules/<x>/` DDD layout when you're already substantially reworking that domain (mirror the `reports/` shape).
- Rule of thumb: **import from `@/modules/<x>`** (the public boundary) regardless of where the implementation currently sits, so callers don't churn when a domain finishes migrating.

**Module vs Dictionary rule** (where does an entity belong?):
- Table is `{ id, name, isActive }` referenced only by FK `onDelete: Restrict` → **dictionary** (a tab in `admin-dictionaries`; "what you pick in forms"). E.g. `PileGrade`, `DrillingType`, `DowntimeReason`.
- Table has state / lifecycle / history / child rows → **operational module** (a screen on `components/piling/ops-shell`; "where work is decided & controlled"). E.g. `Site`, `Crew`, `Report`, `MaintenanceRecord`, `Inspection`.
- A value that is a code `enum` (`EquipmentKind`, `MaintenanceType`, statuses, roles) → **stays in code**. "Move to dictionary" then means an enum→table migration (a feature, not cleanup) — don't do it without a proven business need. Full decision guide + enum traps: the `module-vs-dictionary` skill.

### API Routes

**Always wrap with `withApi` or `withMutation`:**
- `withApi` — query endpoints (GET), error handling only
- `withMutation` — command endpoints (POST/PUT/DELETE), adds CSRF + rate-limit

**Never duplicate CSRF/rate-limit inline.** The wrapper provides it centrally.

**Validation pattern:**
```typescript
const validated = schema.safeParse(body);
if (!validated.success) {
  return NextResponse.json({ error: 'Validation failed', details: ... }, { status: 400 });
}
const data = validated.data; // use only validated data
```

### Security-Critical Code

**Files that require extra caution** (test-first, careful code review):
- `src/services/auth/` — authentication, session, token logic
- `src/services/auth/authorization-service.ts` — permission checks
- `src/core/security/` — encryption, token rotation, CSRF
- `src/lib/rate-limiter.ts` — rate limiting logic

**When touching these:** Write a test that reproduces the behavior, then change it. Never refactor "cleanly" without tests.

### Testing

**Test-first for security bugs:**
- Timing attacks on password/PIN comparison → use `crypto.timingSafeEqual`
- Session/token leaks → test token rotation + revocation
- Rate limit bypasses → test limits at boundary conditions

**Unit tests are in `src/**/__tests__/`; integration tests are limited.**
You can write unit tests. Flag if you need integration test infrastructure.

### Common Pitfalls to Avoid

| Pitfall | Fix |
|---------|-----|
| Inline try/catch in routes when withApi/withMutation exist | Use the wrapper |
| Duplicating CSRF/rate-limit checks | Remove from route handler |
| Large files (>500 lines) | Split by concern (e.g., service + controller) |
| `as any` in security-critical code | Use proper types, especially in auth/ |
| `console.log` in production services | Use `logger.*` from `src/lib/logger` |
| Speculative abstractions (strategy pattern for one use case) | Write the simple version first |
| Bundling schema changes for 5+ models into one Prisma migration | One migration = one logical change. Splits keep PR review tractable as the model count grows. |
| `IS NULL OR tenantId` in a tenant-scoped query | Fail closed: throw on a missing `tenantId` + use strict equality. A null tenant via `IS NULL OR` returns **every** tenant's rows (IDOR — hit 2026-05-31). Policy: `resource-access-service.ts`. |

### Performance Considerations

**Respect existing patterns:**
- `src/lib/cache-strategies.ts` for caching decisions
- `src/lib/db-optimization.ts` for DB query patterns (`$queryRaw` over `$queryRawUnsafe`)
- Redis is used for cache + rate limiting, not database replacement

**Don't optimize prematurely.** Profile if slow, then fix.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Production (orionpiling.ru)

**Server:** single VPS, Ubuntu, Docker Compose stack at `/opt/pilingtrack`. 30 GB disk (often near-full — check `df -h /` before docker rebuild). 3.8 GB RAM + 4 GB swap.

**Tenancy:** single tenant `orion`. `DEFAULT_TENANT_ID=orion` in `.env.production` (and `.env`). All `User`, `Site`, `Report`, `ReportAnalytics`, `SiteWeeklyTrend` rows must have `tenantId='orion'`.

**Containers** (`docker compose ps`):
- `pilingtrack-app` — Next.js (port 3000, behind Caddy)
- `pilingtrack-ws` — websocket server
- `pilingtrack-workers` — outbox/projection/PDF workers
- `pilingtrack-postgres` — DB (user `piling`, db `pilingtrack`)
- `pilingtrack-redis`, `pilingtrack-minio`, `pilingtrack-pgbouncer`, `pilingtrack-grafana`, `pilingtrack-prometheus`

**DB access:**
```bash
docker compose exec postgres psql -U piling -d pilingtrack
```

**Deploy runbook (after pushing to `main`):** zero-downtime, build first, swap when ready. Full version in `docs/runbooks/008-manual-deploy.md`.
```bash
cd /opt/pilingtrack
df -h /                         # if >85%, prune first (see below)
git pull origin main
export APP_VERSION=$(git rev-parse --short HEAD)  # so /api/health reports the real commit
docker compose build app          # build SEQUENTIALLY — a parallel `build app workers`
docker compose build workers      # fills the 30 GB disk to 100% (run `docker builder prune -f`
                                  # between builds if `df -h /` is tight)
docker compose up -d app workers  # atomic swap; old containers keep serving until new ones are
                                  # healthy. Zero-downtime comes from build-before-swap, not parallelism.
# add 'ws' to the build/up lines if ws-server changed (rare)
```
Old runbook (`stop && rm && rmi → build → up`) created a 3–5 min outage window when the build crashed. Don't use it unless you specifically want to free RAM before the build (heavy on this VPS only).

**⚠️ New migration in the diff → build `migrate` too.** The `migrate` service bakes `prisma/migrations` into its image at build time, so `build app workers` alone leaves it stale: it runs, logs `"No pending migrations to apply"`, exits 0, and silently skips the migration — leaving new app code on an old schema. If `git diff --name-only --diff-filter=A HEAD@{1}..HEAD -- 'prisma/migrations/**'` shows a new folder, use `docker compose build migrate app workers`, then verify it landed (don't trust exit 0): `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;`. For destructive migrations (`DROP COLUMN`/`DROP TABLE` in the .sql), check prod data first. Hit live 2026-05-27. Full detail: runbook 008 "Migrations" section.

If disk tight (>85%): `docker builder prune -af` (~2 GB), `docker image prune -af`.

**Migrate service** runs `prisma migrate deploy` and seed. Seed stays skipped on prod (`SKIP_SEED=1` in `.env`) as defence in depth — `prisma/seed.ts` also has `assertNotProduction()`. The historical reason ("bare `new PrismaClient()` crashes on the driver-adapter") was fixed 2026-05-24 — seed now constructs the client with `PrismaPg`, so dev/CI run it cleanly.

**Known limitations:**
- **Telegram API blocked at provider** — `api.telegram.org` unreachable directly from the VPS (Russian ISP). Routed through a Cloudflare Worker proxy set via `TELEGRAM_API_BASE=https://pilingtrack-tg-proxy.sasorion02.workers.dev` in `.env`. Notifications work; if the env var disappears, fetches fail.

**User context:** non-programmer in Russian. Reply in Russian, prefer concrete commands the user can paste, avoid open-ended "what do you want to do" questions when the next step is obvious. See user memory for more.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **PilingTrack** (12686 symbols, 22638 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/PilingTrack/context` | Codebase overview, check index freshness |
| `gitnexus://repo/PilingTrack/clusters` | All functional areas |
| `gitnexus://repo/PilingTrack/processes` | All execution flows |
| `gitnexus://repo/PilingTrack/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
