---
name: pilingtrack-run-and-operate
description: Operator's map of PilingTrack production (orionpiling.ru) — container topology, health checks, where logs live, SSH/DB access, backup and restore reality, disk rules, runbook index. Use when handling a prod incident, a container is down or unhealthy, verifying a deploy landed, answering backup/PITR/restore questions, disk is full, где логи / how to read prod logs, checking health endpoints, Grafana/Prometheus/Telegram quirks, or deciding which runbook to open.
---

# PilingTrack — Run and Operate Production

The operator's map of the production system at **orionpiling.ru**. This skill tells you
what runs where, how to look at it, and what the storage/backup reality is. It does
**not** restate the deploy procedure — the `deploy` skill generates the ready-to-paste
deploy block, and `docs/runbooks/008-manual-deploy.md` is the deploy source of truth.
This skill owns everything *around* deploy.

All prod-state facts below are **as of 2026-07-07** (last verified against repo docs and
operating memory on that date). Prod changes; re-verify anything critical with the
commands in "Provenance and maintenance" at the bottom.

## Rule zero — the human drives prod

**All production actions are driven by the human operator, step by step.** Never SSH to
prod, deploy, restart containers, or touch the prod DB autonomously or in the background.
Every prod command is executed one at a time in an interactive session, with the operator
directing and the output verified before the next step. An AI session assisting with prod
work proposes each command, runs it only with the operator watching (SSH from the
operator's machine requires sandbox-disabled execution and explicit approval), and stops
on anything unexpected. There is no "fire and forget" on this system.

## The machine

| Fact | Value (as of 2026-07-07) |
|---|---|
| Host | Single Ubuntu VPS, `87.242.102.125` |
| Stack | Docker Compose at `/opt/pilingtrack` |
| Disk | **30 GB total, chronically tight** — stable at ~63–66% since the 2026-06-24 incident fix, but a single image build needs ~5–6 GB transient headroom |
| RAM | 3.8 GB + 4 GB swap (large builds can OOM; see runbook 008 "old runbook" section) |
| TLS / reverse proxy | Caddy on the **host** (systemd service, not a container). Config source of truth: `deploy/Caddyfile.prod` in this repo, mirrored to `/etc/caddy/Caddyfile` on the VPS |
| Tenancy | Single tenant `orion`; `DEFAULT_TENANT_ID=orion` in `.env` |
| DNS | `orionpiling.ru` (+ `www`); `orionpiling.online` 301-redirects to `.ru` |

Caddy routes: `/grafana*` → 127.0.0.1:3010, `/ws/*` → 127.0.0.1:3001, everything else →
127.0.0.1:3000. Security headers (HSTS etc.) are owned by Caddy, CSP by `next.config.ts`.

## Topology — every container, its health, its logs

The app stack comes from `docker-compose.yml` + the `docker-compose.prod.yml` overlay;
monitoring comes from `docker-compose.monitoring-prod.yml` (separate compose project on
the same VPS, joined to the app network).

All host-published ports bind to **127.0.0.1 only** — nothing but Caddy (80/443) faces
the internet. Postgres, both Redis instances, and PgBouncer have **no host ports at all**
on prod (internal Docker network only).

### App stack

| Container | Role | Port (prod) | Health check (on VPS) | Logs |
|---|---|---|---|---|
| `pilingtrack-app` | Next.js app + API | 127.0.0.1:3000 | externally `curl -s https://orionpiling.ru/api/health`; container healthcheck hits `/api/health` internally | `docker compose logs --tail 100 app` |
| `pilingtrack-ws` | WebSocket realtime server | 127.0.0.1:3001 | container healthcheck wgets `:3001`; app-level: `/api/health/deep` → `websocket` field | `docker compose logs --tail 100 ws` |
| `pilingtrack-workers` | **Unified background workers: outbox + projections + PDF** (`ENABLED_WORKERS=outbox,projection,pdf`). Outbox/projection are leader-elected — exactly one processor; scaling replicas does NOT speed them up (runbook 004) | 127.0.0.1:3002 (health only) | `curl -s localhost:3002/health` on the VPS | `docker compose logs --tail 100 workers` |
| `pilingtrack-migrate` | One-shot: `prisma migrate deploy` (+ seed, skipped on prod via `SKIP_SEED=1`). `app`/`workers`/`ws` wait on it via `service_completed_successfully`. **Bakes `prisma/migrations` into its image at build time** — see operating rule 4 | none | `docker compose logs --tail 15 migrate` after any `up -d` | same |
| `pilingtrack-postgres` | PostgreSQL 18 (alpine). User `piling`, db `pilingtrack`. Data in `postgres_data` volume | none | `docker compose exec postgres pg_isready -U piling -d pilingtrack` | `docker compose logs postgres --tail 100` |
| `pilingtrack-pgbouncer` | PgBouncer = connection pooler in front of Postgres (transaction pooling; pool size 40, max 1000 client conns). App/workers/ws runtime queries go **through it** (`DATABASE_URL` → `pgbouncer:5432` with `pgbouncer=true`, which disables Prisma prepared statements); migrations use the direct Postgres URL | none | healthy if the app can query; on auth errors (SCRAM, 08P01) check its logs | `docker compose logs pgbouncer --tail 50` |
| `pilingtrack-redis` | **State Redis**: rate-limit counters, BullMQ queues, JWT denylist, pub/sub. Persistent (AOF, `redis_data` volume), `noeviction`. **Never FLUSHALL this one** — you'd un-revoke tokens and drop queued jobs (runbook 002) | none | `redis-cli -a "$RP" ping` (password from `.env`, see Access) | `docker compose logs redis --tail 50` |
| `pilingtrack-redis-cache` | **Cache Redis**: response/API cache only. No persistence, `allkeys-lru`. `FLUSHALL` here is safe — cache rebuilds itself | none | same, service name `redis-cache` | `docker compose logs redis-cache --tail 50` |
| `pilingtrack-minio` | MinIO = self-hosted S3-compatible object store. **Runs in the stack, but as of 2026-07-07 the app's `S3_*` env points at Cloudflare R2** (bucket `pilingtrack`), so MinIO is not the live media backend — verify with `grep '^S3_' /opt/pilingtrack/.env` | 127.0.0.1:9001 (console only) | `docker compose ps minio` | `docker compose logs minio` |

### Monitoring stack (`docker-compose.monitoring-prod.yml`)

| Container | Role | Port (prod) | Notes |
|---|---|---|---|
| `pilingtrack-prometheus` | Metrics scraper/TSDB, 14d / 2 GB retention | 127.0.0.1:9090 | Scrapes `/api/metrics` with a bearer token — see "Known limitations" for the single-file-mount gotcha |
| `pilingtrack-grafana` | Dashboards, served at `https://orionpiling.ru/grafana` | 127.0.0.1:3010 | Admin password = `GRAFANA_PASSWORD` in `.env`; sign-up and anonymous access disabled |
| `pilingtrack-alertmanager` | Routes Prometheus alerts → app webhook `/api/alerts/webhook` (auth: `ALERTMANAGER_WEBHOOK_TOKEN`; the app fails closed with 401 if its copy is unset) | 127.0.0.1:9093 | Webhook token materialized from env at container start |
| `pilingtrack-node-exporter` | Host CPU/RAM/disk metrics (feeds the disk alert) | none | |
| `pilingtrack-postgres-exporter` | Postgres metrics | none | |
| `pilingtrack-redis-exporter` | Redis metrics; needs `REDIS_PASSWORD` or every `redis_*` metric silently NOAUTH-fails ("no data" panels) | none | |

### Command anatomy on the VPS

Incident runbooks standardize this alias at the top of every SSH session (it dies with
the session — re-set it after reconnecting):

```bash
cd /opt/pilingtrack
alias dc='docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml'
```

Deploy docs (runbook 008, CLAUDE.md) use bare `docker compose ...` on the prod host. If
bare `docker compose ps` shows the full stack with prod ports (127.0.0.1 bindings), the
shell is wired correctly; if anything looks off, fall back to the explicit `dc` alias
form — it is always unambiguous. The monitoring stack is a separate project:
`docker compose -f docker-compose.monitoring-prod.yml ...`.

## Non-negotiable operating rules

1. **Human drives every prod action** (Rule zero above). No autonomous SSH, deploy,
   restart, or DB writes. Ever.

2. **`df -h /` before any `docker build`.** The disk is 30 GB and a single image export
   needs ~5–6 GB transient headroom. Start builds at ≤75–85% used; above that, prune
   first: `docker builder prune -af` (~2–3 GB), then `docker image prune -af` if still
   tight. Postgres stops accepting writes when the disk fills — a careless build can
   take the site down.

3. **Build `app` and `workers` SEQUENTIALLY — never `docker compose build app workers`.**
   BuildKit builds both targets in parallel and exports both images at once, roughly
   doubling peak transient disk use. Observed live 2026-05-28: the parallel build filled
   the disk to 100% ("no space left on device") mid-export. Pattern:
   `build app` → `docker builder prune -af` → `build workers`.

4. **New migration in the diff → build the `migrate` image too.** `migrate` COPYs
   `prisma/migrations` into its image at build time (no volume mount). If you rebuild
   only `app`+`workers`, the stale migrate image runs, logs
   `"No pending migrations to apply"`, **exits 0**, and the schema silently never
   changes while new code expects it — hit live 2026-05-27 (`MaintenanceRecord` missing
   in prod). Detect and verify per runbook 008 "Migrations"; the `deploy` skill
   automates the detection and emits the right block. Never trust migrate's exit 0 —
   check `_prisma_migrations`:

   ```bash
   # on the VPS
   docker compose exec -T postgres psql -U piling -d pilingtrack -c \
     "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;"
   ```

5. **Deploy = build first, swap when ready.** Old containers keep serving during the
   build; `docker compose up -d` swaps atomically. Never `stop && rm` before building
   (creates a multi-minute outage if the build fails) — the single exception is a
   build-OOM situation, described at the bottom of runbook 008. The full procedure,
   including tagging the old image for instant rollback, is owned by the `deploy` skill
   and runbook 008 — generate the block there, don't improvise.

## Access patterns

**SSH** — as `user1` with a dedicated key (kept at `~/.ssh/orionpiling` on the
operator's machine):

```bash
# from the operator's machine
ssh -i ~/.ssh/orionpiling user1@87.242.102.125
```

**DB shell** (on the VPS):

```bash
cd /opt/pilingtrack
docker compose exec postgres psql -U piling -d pilingtrack
```

Non-interactive queries: add `-T` (`docker compose exec -T postgres psql ... -c "..."`).

**Redis CLI** (on the VPS) — both instances require the password; without `-a` you get
`NOAUTH`:

```bash
RP=$(grep '^REDIS_PASSWORD=' /opt/pilingtrack/.env | cut -d= -f2-)
docker compose exec redis       redis-cli -a "$RP" --no-auth-warning ping
docker compose exec redis-cache redis-cli -a "$RP" --no-auth-warning ping
```

**Grafana** — `https://orionpiling.ru/grafana` (or SSH tunnel to 127.0.0.1:3010).
**Prometheus / Alertmanager** — not path-proxied by the checked-in Caddyfile as of
2026-07-07; reach via SSH tunnel:
`ssh -i ~/.ssh/orionpiling -L 9090:127.0.0.1:9090 user1@87.242.102.125`.
**MinIO console** — SSH tunnel to 127.0.0.1:9001 (rarely needed; media is on R2).

**Secrets** live in `/opt/pilingtrack/.env` (called `.env.production` in older docs).
`ENCRYPTION_KEY` is unrecoverable-critical: without it, encrypted DB values (Telegram
bot tokens etc.) can never be decrypted — it must survive any disaster (see
`docs/deployment.md` §10). Env var *semantics* are owned by the
`pilingtrack-config-and-flags` skill.

## Health and versioning — how to know what is running

| Endpoint / command | What it tells you |
|---|---|
| `curl -s https://orionpiling.ru/api/health` | Basic liveness + `version` (the running commit) |
| `curl -s https://orionpiling.ru/api/health/deep` | Component statuses: `database`, `redis`, `websocket`; 503 when a component is down (runbooks 001/002/005 key off this) |
| `curl -s localhost:3002/health` (VPS) | Workers process liveness |
| `docker compose ps` (VPS) | Container-level health (`Up ... (healthy)`) |
| `/api/metrics` | Prometheus metrics incl. `app_version_info{version=...}`; requires bearer `METRICS_SCRAPE_TOKEN` (or an admin session) |

**Version reporting:** `/api/health` returns
`process.env.APP_VERSION || npm_package_version || 'unknown'`
(`src/core/observability/health-checks.ts`) — the **Docker-supplied `APP_VERSION` wins**.
The Dockerfile takes `ARG APP_VERSION` (compose passes `${APP_VERSION:-unknown}`), and
the deploy runbook exports `APP_VERSION=$(git rev-parse --short HEAD)` before building,
so a correctly executed deploy makes `/api/health` report the real short commit hash.

**To confirm a deploy landed:**

```bash
# on the VPS
git -C /opt/pilingtrack rev-parse --short HEAD                            # what prod's checkout says
# from anywhere
curl -s https://orionpiling.ru/api/health | grep -o '"version":"[^"]*"'  # what the app says
```

If they differ, either the image was built without `APP_VERSION` exported (cosmetic) or
the swap never happened (real problem — check `docker compose ps` container start
times). If the deploy included a migration, also run the `_prisma_migrations` check from
operating rule 4.

Known cosmetic quirk (as of 2026-07-07): `pilingtrack-app` occasionally shows
`(unhealthy)` in `docker compose ps` while serving fine — verify with a real
`curl https://orionpiling.ru/api/health` before treating it as an incident.

## Storage & backup reality (as of 2026-07-07)

Jargon, once: **WAL** = Postgres write-ahead log, the append-only record of every change;
**PITR** = point-in-time recovery, replaying archived WAL on top of a base backup to
reach any chosen second; **basebackup** = full file-level snapshot of the DB
(`pg_basebackup`); **RPO** = recovery point objective, the maximum window of data you
can lose.

| Layer | State as of 2026-07-07 |
|---|---|
| Nightly logical dump | **LIVE.** systemd timer `pilingtrack-backup.timer`, nightly 03:30 ±10 min, 30-day retention, `/var/backups/pilingtrack/pilingtrack-YYYYMMDD-HHMMSS.sql.gz` (runbook 006; script `scripts/backup-postgres.sh`) |
| Off-site copy | **LIVE, verified 2026-07-01.** Every nightly dump is pushed to Cloudflare R2 via rclone, reusing the app's `S3_*` media credentials — same bucket `pilingtrack`, prefix `db-backups/`, next to the app's `media/` prefix. A failed push logs a warning but never fails the local backup |
| Weekly basebackup | Timer `pilingtrack-pitr-basebackup.timer` produces `/opt/pilingtrack/basebackups/base-*.tar.gz` — but **without WAL archiving it is a weekly snapshot, not PITR** |
| WAL archiving / PITR | **OFF — deliberately — since 2026-06-24.** The old `archive_command` (`test ! -f dest && cp %p dest`) returned exit 1 whenever the destination file already existed; Postgres treats that as archive failure and refuses to recycle ANY WAL. 9.6 GB accumulated over ~4 weeks, filled the 30 GB disk to 100%, crashed the DB, took the site down. Fix was `archive_mode=off` in `docker-compose.prod.yml` (a no-clobber `cp -n` form is staged there for a future re-enable, which also needs a bigger disk first). **Runbook 009's restore section is currently inapplicable — its warning banner is authoritative** |
| Effective RPO | **Up to ~24 hours** (last nightly dump). Not seconds. Do not promise point-in-time recovery |
| Disk guard | **LIVE** since the 2026-06-24 incident: `pilingtrack-disk-guard.timer` (+ `scripts/disk-guard.sh`, units in `deploy/systemd/`) with an alert pipeline (Alertmanager → app webhook). Disk stable ~63–66% |
| Local dev safety copy | The operator's local dev DB is archived every 3 days on the dev machine — irrelevant to prod recovery; listed so nobody mistakes it for one |
| **Restore drill** | **NEVER PERFORMED — OPEN item as of 2026-07-07.** Neither the runbook 006 temp-DB smoke test nor a full restore has ever been executed against a real dump. Until someone runs it, the backups are unproven. If asked "are backups OK?" the honest answer is: dumps exist locally + off-site, restore is untested |

**Stale-doc trap:** runbooks 001 and 003 still say "PITR + ночной dump — оба активны".
That predates 2026-06-24 and is wrong; runbook 009's banner is the truth. When a restore
decision comes up, use runbook 006 (logical dump), not 009.

## Runbook index (`docs/runbooks/`)

| # | File | One line — open it when |
|---|---|---|
| 001 | `001-postgresql-down.md` | P0: writes failing / `database: "down"` — restart, disk-full cleanup, restore decision tree. (Its "PITR активен" line is stale — see above) |
| 002 | `002-redis-down.md` | P1: `redis: "down"`, rate-limit weirdness, revoked tokens working again. Explains the **two** Redis instances and which one is safe to flush |
| 003 | `003-data-corruption.md` | P0: aggregates wrong, duplicate reports, projections diverge from `Report`. Rebuild projections first; source corruption → restore. (Same stale PITR line) |
| 004 | `004-outbox-backlog.md` | P1: projections/analytics/Telegram lagging. Outbox = transactional event table (`OutboxEvent`, two independent consumer flags `published`/`projected`); after 5 failed attempts an event moves to the **DLQ** (dead-letter queue, table `DeadLetterQueue`). Diagnosis SQL, poison-event handling, DLQ admin API |
| 005 | `005-websocket-crash.md` | P1: realtime frozen, `websocket: "down"`. WS restart is safe (clients reconnect; reports go via HTTP); check Redis pub/sub first |
| 006 | `006-postgres-backup-restore.md` | Backup health check, R2 off-site, full restore, non-destructive smoke test. **The working restore path** |
| 007 | `007-github-actions-deploy.md` | One-click deploy from the GitHub Actions UI (`.github/workflows/deploy.yml`, manual trigger only, needs `PROD_SSH_KEY` secret) |
| 008 | `008-manual-deploy.md` | **Deploy source of truth**: pre-flight, sequential build, migrate gotcha, verify, rollback, build-OOM fallback |
| 009 | `009-pitr-restore.md` | PITR restore — **currently inapplicable (archive off since 2026-06-24)**; keep for the day WAL archiving is re-enabled |

## Artifact and data conventions — what lands where

| Artifact | Producer | Where it lands (prod, as of 2026-07-07) |
|---|---|---|
| Shift-report PDFs | `pilingtrack-workers` (PDF worker, BullMQ, concurrency 2) | S3 storage via `S3_*` env — Cloudflare R2 bucket `pilingtrack` |
| Report/media photos | app upload path | Same R2 bucket, `media/` prefix |
| DB dumps | backup timer | `/var/backups/pilingtrack/` + R2 `db-backups/` |
| Basebackups | basebackup timer | `/opt/pilingtrack/basebackups/` (VPS only, not off-site) |
| Metrics | app `/api/metrics` (bearer `METRICS_SCRAPE_TOKEN`) → Prometheus TSDB | `prometheus-data` volume, 14d / 2 GB cap |
| Container logs | all services | Docker json-file driver with rotation (20 MB × 5 for app/workers/postgres, smaller elsewhere) — **read via `docker compose logs [--tail N] [-f] <svc>`**; there is no Loki, rotated-out logs are gone |
| Host-level logs (Caddy, systemd timers) | journald | `journalctl -u caddy` / `-u pilingtrack-backup.service` / `-u pilingtrack-disk-guard.service` |
| App version | Docker build arg | `/api/health` `version` field |

## Known prod limitations and quirks (as of 2026-07-07)

- **Telegram API is ISP-blocked on the VPS** (`api.telegram.org` unreachable from the
  Russian provider). All bot traffic is routed through a Cloudflare Worker proxy via
  `TELEGRAM_API_BASE` in `.env`. If that env var disappears, every Telegram fetch fails
  — notifications go silent with no other symptom. Both `app` (in-process
  report-submitted handler) and `workers` (outbox handlers) need it, plus
  `DEFAULT_TENANT_ID` and `ENCRYPTION_KEY` where the handler runs — the silent-drop
  failure modes are documented inline in `docker-compose.yml`.
- **Prometheus scrape token is a single-file bind mount**
  (`observability/prometheus/scrape-token`, created on the host, perms **644** — the
  container reads it as a non-root user; 600 broke it on first deploy). Gotcha: after a
  `git pull` replaces a bind-mounted config file, the file's inode changes and a running
  container keeps seeing the **old** content forever; `curl -X POST :9090/-/reload` is
  NOT enough —
  `docker compose -f docker-compose.monitoring-prod.yml up -d --no-deps --force-recreate prometheus`
  is required after config changes.
- **Alert webhook fails closed.** `/api/alerts/webhook` returns 401 and silently drops
  every alert if `ALERTMANAGER_WEBHOOK_TOKEN` is missing on the **app** side (not just
  Alertmanager's side).
- **Redis exporter needs `REDIS_PASSWORD`** or all `redis_*` Grafana panels show
  "no data" while the exporter itself looks fine.
- **MinIO runs but is vestigial for media** — the app's `S3_*` points at R2. Don't
  assume photos are in the MinIO volume when debugging uploads; check `.env` first.
- **`pilingtrack-app` may show `(unhealthy)` cosmetically** — confirm with a real HTTP
  check before reacting.
- **Runbooks 001/003 contain a stale "PITR active" claim** — trust runbook 009's banner.
- **Build OOM risk:** 3.8 GB RAM; if `docker compose build` dies with no clear error,
  check `dmesg | grep -i kill` (runbook 008 has the knowing-outage fallback).

## When NOT to use this skill

- **Generating the actual deploy command block** → use the `deploy` skill (it
  auto-detects the migrate-image case and emits the paste-ready block); procedure detail
  → runbook 008.
- **Local development, building, running the app on the dev machine** →
  `pilingtrack-build-and-env`.
- **Measuring/profiling/analysis tooling questions** →
  `pilingtrack-diagnostics-and-tooling`.
- **Symptom-first triage** ("Telegram silent", "analytics empty", "login 500s") →
  `pilingtrack-debugging-playbook`, which maps symptom → cause → fix and then points
  back to the runbooks here.
- **Env var semantics and feature flags** → `pilingtrack-config-and-flags`.
- **Why past incidents happened, in depth** → `pilingtrack-failure-archaeology`; this
  skill embeds only the dates and the operating rules those incidents produced.

## Provenance and maintenance

Authored 2026-07-07 from repo ground truth plus operating history; prod itself was NOT
touched to write this. Re-verify each area with one command:

| Fact | Re-verify with |
|---|---|
| Container set / ports / limits | read `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.monitoring-prod.yml` in the repo; on the VPS: `docker compose ps` |
| WAL archiving still off | `archive_mode=off` in `docker-compose.prod.yml`; on VPS: `docker compose exec postgres psql -U piling -d pilingtrack -c "SHOW archive_mode;"` |
| Backups running + off-site | on VPS: `ls -lh /var/backups/pilingtrack/ | tail -3 && journalctl -u pilingtrack-backup.service --since yesterday | tail -5` (expect `✓ Backup complete` and `✓ Off-site copy OK: R2:...`) |
| Restore drill still never done | ask the operator; if it has finally been performed, update the OPEN label above and record the date |
| Version reporting mechanism | `grep -n "APP_VERSION" src/core/observability/health-checks.ts` |
| Media backend (MinIO vs R2) | on VPS: `grep '^S3_' /opt/pilingtrack/.env` |
| Deploy procedure current | `docs/runbooks/008-manual-deploy.md` + `.claude/skills/deploy/SKILL.md` |
| Disk pressure | on VPS: `df -h /` (healthy baseline 63–66% as of 2026-07-07) |
| Scrape-token gotcha | comments in `docker-compose.monitoring-prod.yml`, prometheus service volumes block |
| Caddy routing / headers | `deploy/Caddyfile.prod` (source of truth for `/etc/caddy/Caddyfile`) |

If any re-verification contradicts this file, the live system wins — update this skill
in the same change.
