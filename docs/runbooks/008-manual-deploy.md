# Runbook 008 — Manual deploy to prod (zero-downtime)

For automated deploy via GitHub Actions, see `007-github-actions-deploy.md`.
This runbook is for the case when you SSH in and deploy by hand —
hotfixes, CI outages, or just verifying a deploy lands cleanly.

## Principle: build first, swap when ready

The old runbook stopped the running container, removed the image, then
built. If `npm run build` failed (typo in code, broken barrel-export,
missing env var) the prod app stayed dead for the duration of the
fix-rebuild loop — observed at ≥15 min on 2026-05-21.

The new sequence keeps the old container running until the new image is
built and tested. `docker compose up -d` does the swap atomically.

## Pre-flight

```bash
ssh -i ~/.ssh/orionpiling user1@87.242.102.125
cd /opt/pilingtrack

# 1. Disk check — a single image export needs ~5-6 GB transient headroom.
# Start the build at <=75% (≈7 GB free); even then it can dip toward 100%
# mid-export. Free space first if tight:
df -h /
docker builder prune -af   # frees ~2-3 GB
docker image prune -af     # frees more if old images linger

# 2. Pull
git pull origin main
git log -1 --oneline       # confirm expected HEAD

# 3. Export the commit so /api/health reports it (see Dockerfile ARG
# APP_VERSION) instead of the static package.json version.
export APP_VERSION=$(git rev-parse --short HEAD)
```

## Deploy

```bash
# Build first — old containers keep serving traffic during this step.
# BUILD SEQUENTIALLY on this 30 GB VPS — do NOT use `build app workers`.
# BuildKit builds the two targets in parallel, and exporting both images at
# once roughly doubles peak transient disk use; observed live 2026-05-28 the
# parallel build filled the disk to 100% ("no space left on device") at the
# workers export. Sequential + a prune between keeps the peak survivable.
docker compose build app
docker builder prune -af          # reclaim this build's cache before the next
docker compose build workers
# NOTE: if the diff adds a new prisma/migrations/* folder, build `migrate`
# too (separately, same pattern) — see the "Migrations" section below.

# Atomic swap. Compose stops the old container only after the new one
# starts and reports healthy. If the new container fails to start,
# the old one keeps running.
docker compose up -d app workers
```

Add `ws` to both lines only if the WebSocket server changed (rare —
look for `src/core/realtime/server/` in the diff).

## Migrations (if the diff adds a `prisma/migrations/*` folder)

**The `migrate` service bakes `prisma/migrations` into its image at build
time** (it builds from `target: builder`, which `COPY`s the source — it
does NOT volume-mount the host dir). `app` depends on `migrate`
(`service_completed_successfully`), so `up -d app` *runs* migrate — but if
migrate's image predates the `git pull`, it runs with **stale baked-in
migrations**, logs `"N migrations found … No pending migrations to apply"`,
and **exits 0**. The deploy looks green while the schema never changed,
leaving new app code pointed at a missing table.

Observed live 2026-05-27 deploying `20260526202204_equipment_maintenance`:
migrate said "no pending", `MaintenanceRecord` was absent, app was already
serving code that needed it.

So when the diff includes a new migration, **rebuild `migrate` too**:

```bash
# detect: does the diff add a migration?
git diff --name-only --diff-filter=A HEAD@{1}..HEAD -- 'prisma/migrations/**'

# if yes, add `migrate` to the build line:
docker compose build migrate app workers
docker compose up -d app workers          # runs the fresh migrate via depends_on
```

Then **verify the migration actually applied — don't trust exit 0**:

```bash
docker compose logs --tail 15 migrate     # must show "Applying migration ..."
docker compose exec -T postgres psql -U piling -d pilingtrack -c \
  "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;"
# must be the migration you just shipped, not the previous one.
```

If the migration is **destructive** (Prisma prints a `Warnings:` /
`DROP COLUMN` / `DROP TABLE` block in the `.sql`), check the target on prod
*before* swapping — e.g. `SELECT count("col") FROM "Table";` — and confirm
the data is expendable. Prod data is not in your local DB.

## Verify

```bash
# 1. Containers healthy
docker compose ps app workers
# Expect: Up X seconds (healthy) for both. If "(unhealthy)" persists
# past 30s, dump logs:
docker compose logs --tail 100 app
docker compose logs --tail 100 workers

# 2. Outbox pipeline healthy (no silent breakage)
docker compose exec -T postgres psql -U piling -d pilingtrack <<'SQL'
SELECT 'outbox_unpublished' m, count(*)::text v FROM "OutboxEvent" WHERE published = false
UNION ALL SELECT 'outbox_unprojected', count(*)::text FROM "OutboxEvent" WHERE projected = false
UNION ALL SELECT 'outbox_failed_3plus', count(*)::text FROM "OutboxEvent" WHERE attempts >= 3
UNION ALL SELECT 'dlq_pending', count(*)::text FROM "DeadLetterQueue" WHERE status = 'pending';
SQL
# All four counters should be 0 (or close to 0 and shrinking).
```

## Confirm fix in real traffic (for projection / event-bus fixes)

After a fix that touches handlers, projections, or the outbox, wait
~1 hour and re-check `ReportAnalytics` freshness:

```bash
docker compose exec -T postgres psql -U piling -d pilingtrack -c \
  "SELECT count(*) FROM \"ReportAnalytics\" WHERE \"lastEventAt\" > now()-interval '1 hour';"
```

If there were operator submissions in the last hour, this should match.
If it's 0 but `SELECT count(*) FROM \"Report\" WHERE \"createdAt\" > now()-interval '1 hour'`
shows submissions came in, the realtime handler isn't running — go to
runbook 004 (outbox backlog).

## Backfill if needed (after delayed fix)

```bash
npm run backfill:analytics             # last 7 days, idempotent
npm run backfill:analytics -- --days=2 # narrower window
```

## Rollback

If the new deploy is bad:

```bash
git log --oneline -5
git checkout <previous-good-sha>
docker compose build app workers
docker compose up -d app workers
```

Image registry isn't used here, so rollback also rebuilds. A future
improvement (M-12 — not yet tagged): tag the previous image as
`:previous` before deploy, so rollback is `docker tag previous latest
&& up -d` (under 1 minute instead of 5).

## When the old runbook IS the right choice

If the build itself OOMs (this VPS has 3.8 GB RAM; large Turbopack
builds occasionally OOM the kernel), the old `stop && rm` sequence
frees the RAM of the running container so the build can complete.
Symptoms:
  - `docker compose build` exits with no clear error
  - `dmesg | grep -i kill` shows OOM messages
  - Available memory <500 MB during build

In that case, take the outage knowingly:

```bash
docker compose stop app workers
docker compose rm -f app workers
docker rmi pilingtrack-app:latest pilingtrack-workers:latest
docker compose build app workers && docker compose up -d app workers
```
