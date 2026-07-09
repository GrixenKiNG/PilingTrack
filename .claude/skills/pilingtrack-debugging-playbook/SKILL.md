---
name: pilingtrack-debugging-playbook
description: "Use when a PilingTrack symptom needs triage: prod login outage or app 500s, Telegram silent, migrate logs 'No pending migrations' but schema is stale, absurd downtime numbers ('downtime in days'), fleet card active-but-all-zeros, POST /api/users 500, weekly analytics near-empty, pilingtrack-app unhealthy, a console error mentions Content-Security-Policy on /monitoring (routes to the CSP campaign skill), or local Windows python/port-3000 traps. Maps symptom to check, cause, and fix."
---

# PilingTrack Debugging Playbook

Symptom → check → likely cause → fix, for THIS project's known failure
modes. Production is a single Ubuntu VPS at orionpiling.ru: Docker Compose
stack at `/opt/pilingtrack`, 30 GB disk (chronically near-full), 3.8 GB RAM
+ 4 GB swap, single tenant `orion`. Every trap below cost real time at
least once; the dates tell you when.

**Method note:** this skill is the project-specific symptom map. The
*general* debugging method (reproduce → hypothesize → discriminate →
verify) is `superpowers:systematic-debugging` — use that for a bug that
is not in the table. Use this file first: if your symptom is listed, the
root cause is probably already known.

## When NOT to use

- **Writing new features or refactoring** → `pilingtrack-architecture-contract`, `module-vs-dictionary`, CLAUDE.md.
- **General debugging technique** (no matching symptom below) → `superpowers:systematic-debugging`.
- **Running a deploy** → `deploy` skill and `docs/runbooks/008-manual-deploy.md`; this file only tells you how deploys *fail*.
- **CSP violations on /monitoring** → `pilingtrack-csp-monitoring-campaign` owns that campaign; do not patch CSP headers blind from here.
- **Full incident narratives / post-mortems** → `pilingtrack-failure-archaeology`; this file keeps only the one-line triage version.
- **Building measurement tooling** (profilers, log pipelines) → `pilingtrack-diagnostics-and-tooling`.

## Environment map (30 seconds)

| Thing | Value |
|---|---|
| Prod stack dir | `/opt/pilingtrack` (Docker Compose) |
| Containers | `pilingtrack-app` (Next.js :3000 behind Caddy), `pilingtrack-ws`, `pilingtrack-workers` (outbox/projection/PDF), `pilingtrack-postgres`, `pilingtrack-redis`, `pilingtrack-minio`, `pilingtrack-pgbouncer`, `pilingtrack-grafana`, `pilingtrack-prometheus`, plus one-shot `pilingtrack-migrate` |
| DB shell | `docker compose exec postgres psql -U piling -d pilingtrack` |
| Health endpoint | `GET /api/health` → `{ status: ok\|degraded\|unhealthy, checks, uptime }` (503 only when `unhealthy`) |
| Tenant | single tenant `orion`; `DEFAULT_TENANT_ID=orion` in `.env` / `.env.production`; FORCE RLS on 25 tables (since 2026-07-03) |
| Runbooks | `docs/runbooks/001..009` — index at the bottom of this file |

All `docker compose ...` commands below run on the VPS from
`/opt/pilingtrack` unless marked LOCAL.

---

## THE TRIAGE TABLE

Work top to bottom within your symptom row. "First check" is always cheap.

| # | Symptom | First check (cheap) | Likely cause | Fix / reference |
|---|---------|--------------------|--------------|-----------------|
| 1 | **Login outage / whole app 500s on prod** | `df -h /` — BEFORE reading any app logs | Disk full. 2026-06-24: a broken `archive_command` accumulated 9.6 GB of un-recycled WAL and filled the disk to 100%; the visible symptom was "cannot log in". | Free space: `docker builder prune -af` (~2 GB), `docker image prune -af`. WAL archiving is now OFF (`archive_mode=off` since 2026-06-24, see runbook 009 header) and a disk-guard timer alerts at ≥85% (`scripts/disk-guard.sh`, `deploy/systemd/pilingtrack-disk-guard.{service,timer}`). If disk is fine, proceed to runbook 001 (postgres) / normal triage. |
| 2 | **Telegram notifications silent** (config row exists and is enabled) | `docker compose exec app env \| grep -E 'DEFAULT_TENANT_ID\|TELEGRAM_API_BASE'` — and the same for `workers` | (a) `DEFAULT_TENANT_ID` missing in the **app** container: the ReportSubmitted→PDF notification handler runs IN-PROCESS in the app (registered via `registerAllEventHandlers` in `src/app/api/route.ts`), and `telegram.ts getConfig()` resolves the bot config by `DEFAULT_TENANT_ID`. Until commit `c3a1774` (2026-07-07) the var was wired only into workers — app logged "Telegram not configured — skipping document" and dropped every PDF notification. (b) `TELEGRAM_API_BASE` missing: `api.telegram.org` is ISP-blocked from the VPS; all traffic must route via the Cloudflare Worker proxy URL in `.env`. | Ensure both env vars present in BOTH `app` and `workers` services (`docker-compose.yml` now passes `DEFAULT_TENANT_ID` to both), then `docker compose up -d app workers`. Grep app logs for `Telegram not configured` to confirm which container was starved. Proxy details: `pilingtrack-config-and-flags`. |
| 3 | **Deploy "succeeded" but new table/column missing; migrate logs "No pending migrations to apply"** | `docker compose logs --tail 15 migrate` and the SQL check in the next column | Stale migrate image. The `migrate` service **bakes `prisma/migrations` into its image at build time** (Dockerfile `migrate` stage `COPY prisma ./prisma` — no volume mount). `build app workers` alone leaves it on old migrations; it exits 0 looking green. Live incident 2026-05-27 (`20260526202204_equipment_maintenance`: "no pending", `MaintenanceRecord` absent, app already serving code that needed it). | `docker compose build migrate && docker compose up -d app workers`, then verify — never trust exit 0: `docker compose exec -T postgres psql -U piling -d pilingtrack -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;"` must name the migration you just shipped. Detection one-liner: `git diff --name-only --diff-filter=A HEAD@{1}..HEAD -- 'prisma/migrations/**'`. Full section: runbook 008 "Migrations". |
| 4 | **Absurd downtime numbers** ("простой 1 дн" for an 11-hour entry; downtime alerts never firing; downtimeRatio near zero) | Which units does the code path assume? Downtime duration is stored in **HOURS** (report form). | Hours-vs-minutes/days unit mix. Pre-`e79c5da` (2026-07-07): the downtime alert thresholded the value as *minutes* (≤120 never fired), the fleet tile/table rendered it as *days* (`ceil(h/24)`), and `downtimeRatio` divided hours by shift-*minutes* — ~60× too small. | Fixed in commit `e79c5da`: alert thresholds in hours (>2 warn, >4 high), tile/table show "ч". If a new consumer of downtime appears with weird magnitudes, check its unit assumption first — the stored unit is hours, full stop. |
| 5 | **Fleet/monitoring card shows "active" with all-zero piles/drilling/downtime** (header totals undercount too) | Compare raw vs projection for that site+date: `SELECT count(*) FROM "Report" WHERE ...` vs `SELECT count(*) FROM "ReportAnalytics" WHERE ...` | `ReportAnalytics` projection lag. `getFleetSnapshot` used to skip a today's report entirely when its projection row was missing (`if (!a) continue`). | Fixed in commit `1008ae1` (2026-07-07): uses projection when present, falls back to summing already-loaded raw `Report` rows when absent. If zeros reappear, the projection worker is behind → runbook 004 (outbox backlog), and see "Discriminating experiments" below. |
| 6 | **POST /api/users returns 500 on create** (prod only, local fine) | `\d "User"` on prod — is `tenantId` NOT NULL? | Schema drift: prod `User.tenantId` is NOT NULL while `schema.prisma` declared it nullable; create wrote NULL and violated the constraint. | Fixed 2026-06-17, commit `5500dd5`: `createUser` now sets `tenantId` and fails closed. General lesson: on any prod-only constraint violation, diff `schema.prisma` against the live prod schema before touching app code. |
| 7 | **Weekly analytics near-empty** (`SiteWeeklyTrend` has 2 rows while daily has ~56) | `SELECT count(*) FROM "SiteWeeklyTrend"; SELECT count(*) FROM "SiteDailySummary";` | The nightly safety-net `rebuildSiteWeeklyTrend` did `deleteMany({})` then created rows WITHOUT `tenantId`; prod's NOT NULL `tenantId` (same drift family as #6) made every nightly run wipe the table and crash on the first insert — while the worker stayed "healthy". | Fixed in commit `a8b1aa4` (2026-07-03, "stop nightly destruction"): tenantId resolved from Site, rebuild transactional. Backfill after any projection gap: `POST /api/admin/projections/rebuild?name=site-weekly` (or `all`; needs `projections.rebuild` permission — route at `src/app/api/admin/projections/rebuild/route.ts`). For `ReportAnalytics` itself: `npm run backfill:analytics` (last 7 days, idempotent). |
| 8 | **CSP violation blocking a JS chunk on /monitoring** | Browser console: which directive, which chunk | Known campaign with its own history and constraints. | Do NOT patch headers blind. Route to `pilingtrack-csp-monitoring-campaign`. |
| 9 | **`pilingtrack-app` container shows "(unhealthy)"** | `curl -s https://orionpiling.ru/api/health` and `docker compose ps app` | Historically this was cosmetic — the app served traffic fine while the container health status lagged (unverified as a permanent guarantee; last confirmed benign 2026-07-01). | Trust `/api/health` (`ok`/`degraded` = serving) over the Docker health column. Per runbook 008: if "(unhealthy)" persists past ~30 s after a deploy, dump `docker compose logs --tail 100 app` before concluding anything. |
| 10 | **Outbox/DLQ backlog; projections stale across the board** | Four counters in one query — see below | Worker crashed, poison event, or handler bug after a deploy. | Runbook 004. Counter query (from runbook 008 "Verify"): all four ≈ 0 and shrinking:<br>`SELECT 'outbox_unpublished', count(*) FROM "OutboxEvent" WHERE published=false UNION ALL SELECT 'outbox_unprojected', count(*) FROM "OutboxEvent" WHERE projected=false UNION ALL SELECT 'outbox_failed_3plus', count(*) FROM "OutboxEvent" WHERE attempts>=3 UNION ALL SELECT 'dlq_pending', count(*) FROM "DeadLetterQueue" WHERE status='pending';` |
| 11 | **A tenant-scoped query returns another tenant's rows (or none)** | Does the query contain `IS NULL OR tenantId` or a nullable tenant fallback? | Fail-open tenancy. A null tenant via `IS NULL OR` returns EVERY tenant's rows (IDOR — hit 2026-05-31). | Fail closed: throw on missing `tenantId`, strict equality. Policy home: `src/services/auth/resource-access-service.ts` and CLAUDE.md pitfalls table. |

---

## Trap stories (one line each — why the table says what it says)

- **2026-06-24, disk full:** "users can't log in" was really 9.6 GB of WAL from a broken `archive_command`; hours went into auth debugging before anyone ran `df -h /`. Hence rule #1: disk first.
- **2026-05-27, silent migration skip:** deploy exit code 0, migrate log said "No pending migrations to apply", app crashed on a missing `MaintenanceRecord` table. The green pipeline lied; only the `_prisma_migrations` SQL check told the truth.
- **2026-07-07, Telegram starved in-process:** the PDF notification handler lives in the *app* container, not workers — everyone checked workers' env and found it correct, while app lacked `DEFAULT_TENANT_ID` (fixed `c3a1774`). Know which container actually runs the handler.
- **2026-07-07, "downtime in days":** one stored unit (hours), three consumers, three different unit assumptions (minutes, days, minutes again) — a ~60× error that looked like corrupt data but was pure arithmetic (fixed `e79c5da`).
- **2026-07-03, self-destructing projection:** a nightly *safety-net* job was the destroyer — `deleteMany({})` then crash meant the healthier the schedule, the emptier the table (fixed `a8b1aa4`). When a table shrinks on a schedule, suspect the rebuild job itself.
- **2026-06-17, prod-only 500:** schema.prisma said nullable, prod said NOT NULL. Local couldn't reproduce by definition. Diff live schema vs `schema.prisma` before blaming code (fixed `5500dd5`).

---

## Discriminating experiments (cheap tests that split hypothesis space)

Run these BEFORE forming a theory. Each answers one binary question.

### Is it data or projection?

Compare the source of truth against the read model for the same site/date:

```bash
docker compose exec -T postgres psql -U piling -d pilingtrack <<'SQL'
SELECT 'raw_reports_today' k, count(*)::text v
  FROM "Report" WHERE "createdAt" > now() - interval '1 day'
UNION ALL
SELECT 'analytics_rows_fresh', count(*)::text
  FROM "ReportAnalytics" WHERE "lastEventAt" > now() - interval '1 day';
SQL
```

- Raw > 0, analytics ≈ 0 → **projection problem** (rows #5/#7/#10: worker lag, outbox backlog, or a rebuild that destroys). Backfill: `npm run backfill:analytics` or `POST /api/admin/projections/rebuild`.
- Both 0 → **ingestion problem**: reports are not being submitted/saved at all — go upstream (API route, auth, RLS).
- Both present, numbers wrong → **transformation problem**: unit mix (#4) or handler logic.

### Is it app or workers?

The event handler set is registered in BOTH places; find which container
actually logs the handler you care about:

```bash
docker compose logs --tail 200 app     | grep -i telegram
docker compose logs --tail 200 workers | grep -i telegram
```

Rule of thumb (verified 2026-07-07): ReportSubmitted→Telegram/PDF
notification fires **in the app container** (`registerAllEventHandlers`
in `src/app/api/route.ts`); outbox publishing / projections / scheduled
rebuilds run in **workers**. An env var present in one container and not
the other reproduces symptom #2 exactly.

### Is it code or schema drift?

Prod-only failure with a constraint error → compare declared vs live:

```bash
# declared (LOCAL): grep the model in prisma/schema.prisma
# live (VPS):
docker compose exec -T postgres psql -U piling -d pilingtrack -c '\d "User"'
```

Any NOT NULL / type mismatch between the two is the bug (pattern behind
#6 and #7). Do not "fix" it with app-side null checks; reconcile the
schema (migration) or set the value explicitly like `5500dd5` did.

### Is it the environment or the code? (prod misbehaving after deploy)

```bash
df -h /                                   # rule #1, always
docker compose ps                         # anything restarting?
curl -s https://orionpiling.ru/api/health # ok / degraded / unhealthy + per-check detail
```

`/api/health` returns per-dependency checks; a `degraded` verdict names
the failing dependency and usually maps straight to runbooks 001 (postgres)
or 002 (redis).

---

## Local Windows traps (dev machine)

| Trap | Symptom | Fix |
|---|---|---|
| Bare `python` / `python3` | Silently "succeeds" doing nothing, or opens the Microsoft Store — both resolve to the Windows Store stub | Use the full path `C:\Python314\python.exe` (verified present 2026-07-07). Any script/hook that shells out to python must resolve and verify the interpreter, not assume `PATH`. |
| Non-ASCII (Cyrillic) mangled on Python stdin | Garbage characters in output of a piped script | Set `PYTHONIOENCODING=utf-8` before piping non-ASCII into Python. |
| "Port 3000 already in use" on `npm run dev` | Usually is NOT a trap here | `predev`/`prestart` already run `node scripts/kill-port.js 3000` (see `package.json`). If it still fails, a non-node process holds the port: `netstat -ano \| findstr :3000` then kill the PID. |
| Local dev stack | Full Docker rebuilds for routine work waste time | Preferred workflow: `npm run dev` locally + Docker only for postgres/redis. |

---

## Runbook index (`docs/runbooks/`)

| # | File | Covers |
|---|------|--------|
| 001 | `001-postgresql-down.md` | PostgreSQL down |
| 002 | `002-redis-down.md` | Redis down |
| 003 | `003-data-corruption.md` | Data corruption |
| 004 | `004-outbox-backlog.md` | Outbox backlog / Dead Letter Queue |
| 005 | `005-websocket-crash.md` | WebSocket server crash |
| 006 | `006-postgres-backup-restore.md` | Postgres backup & restore (nightly logical dump; off-site to Cloudflare R2) |
| 007 | `007-github-actions-deploy.md` | GitHub Actions manual deploy |
| 008 | `008-manual-deploy.md` | Manual zero-downtime deploy — the migrate-image gotcha, verify queries, rollback |
| 009 | `009-pitr-restore.md` | PITR — **currently unavailable** (`archive_mode=off` since 2026-06-24 after the WAL incident; real RPO ≈ 24 h via nightly dump) |

---

## Provenance and maintenance

All commit hashes, paths, and SQL verified against the repo on
**2026-07-07** (branch `chore/project-skills`). Re-verify with:

```bash
# Commits cited above still exist:
git log --oneline --all | grep -E "^(c3a1774|e79c5da|1008ae1|a8b1aa4|5500dd5)"
# Migrate stage still bakes migrations at build time:
grep -n "COPY prisma" Dockerfile
# Telegram env resolution unchanged:
grep -n "TELEGRAM_API_BASE" src/core/notifications/telegram.ts
# DEFAULT_TENANT_ID wired to BOTH app and workers:
grep -n "DEFAULT_TENANT_ID" docker-compose.yml
# Rebuild endpoint + backfill script still exist:
ls src/app/api/admin/projections/rebuild/route.ts && grep -n "backfill:analytics" package.json
# Disk guard still installed:
ls scripts/disk-guard.sh deploy/systemd/pilingtrack-disk-guard.timer
# Runbook count / titles:
head -1 docs/runbooks/00*.md
```

Volatile facts to re-check when stale: the "unhealthy is cosmetic" claim
(#9 — last confirmed benign 2026-07-01), `archive_mode=off` / PITR
unavailability (runbook 009 header), the 30 GB disk pressure numbers, and
the single-tenant assumption (multi-tenant shakeout decision due
2026-11-24 per product direction — see `product-bible`).
