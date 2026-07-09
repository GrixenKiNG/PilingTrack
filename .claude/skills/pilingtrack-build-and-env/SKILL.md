---
name: pilingtrack-build-and-env
description: Use when setting up a fresh clone, the dev env is broken, port 3000 is busy, prisma generate/postinstall errors appear, python/python3 is "not found", npm run dev/build/verify fails on env validation on a local machine, Docker DB containers won't start, or the local DB needs reset/backup/prod-snapshot refresh. Recreates and repairs the PilingTrack LOCAL dev environment on Windows; covers setup.bat vs. the daily npm-dev workflow and Windows-specific traps.
---

# PilingTrack — Build & Local Environment

Verified against the repo on **2026-07-07** (branch `chore/project-skills`). Repo root in examples: `C:\PillingR\my-project`. All npm scripts quoted here exist verbatim in `package.json`; all referenced files under `scripts/` were confirmed present.

**Stack:** Next.js 16 + React 19 + TypeScript 6, Prisma 7 + PostgreSQL 18 (Docker), Redis 7 (Docker), MinIO (Docker, S3-compatible). Dev machine: Windows 11, PowerShell 5.1 + Git Bash.

## When NOT to use this skill

| You need... | Go to |
|---|---|
| Production deploy, VPS operations, prod DB access | `pilingtrack-run-and-operate` + the `deploy` skill |
| Meaning/semantics of individual env vars and feature flags | `pilingtrack-config-and-flags` |
| Test philosophy, what to test, evidence standards | `pilingtrack-testing-and-evidence` |
| Writing a new Prisma migration | `create-migration` skill |
| Pre-merge quality gate details | `qa-checklist` skill |

This skill = getting a working local dev loop and not breaking it.

---

## Two setup paths — pick one

### Path A — daily workflow (PREFERRED, owner rule)

Run Next.js **locally** with `npm run dev`; use Docker **only** for infrastructure (postgres, redis, pgbouncer, minio). Do NOT rebuild the full Docker stack for routine work — hot reload beats container rebuilds by minutes per change.

```powershell
# 1. Infra containers only (NOT app/workers/ws)
docker compose --env-file .env.docker up -d postgres redis pgbouncer minio minio-init

# 2. (separate terminal) PDF worker — BullMQ consumer, needed for PDF export
npm run worker:pdf

# 3. (separate terminal) dev server with hot reload
npm run dev
```

Or one command: `start.bat` (Windows launcher) — it stops any conflicting Docker `app`/`ws`/`workers` containers, brings up the DB stack, and opens worker + dev in separate windows. `start.bat docker` = full stack; `start.bat prod` = local `npm run build && npm run start`. `stop.bat` stops everything.

**Use Path A when:** editing anything in `src/` — UI, API routes, CQRS logic, Prisma schema (migrate via `npm run db:migrate`). That is 99% of work.

**Use the full Docker stack only when:** changing `Dockerfile*`, `docker-compose.yml`, healthchecks, or reproducing a prod-only/cold-start bug. Full stack: `docker compose --env-file .env.docker up -d` (rebuild on code change: `up -d --build app`, ~1–3 min per change).

#### Trap: outbox leader-election conflict (dated 2026, still current)

The outbox/projection workers use **Redis leader-election** — only one process holds the lease and publishes events. If the Docker `workers` container is running while you use `npm run dev`, the container may hold the lease with OLD code: reports "submit" but Telegram stays silent, projections don't grow, your fix "doesn't work".

```powershell
# Who is leader?
docker exec pilingtrack-redis redis-cli GET pilingtrack:leader:outbox-worker
docker exec pilingtrack-redis redis-cli GET pilingtrack:leader:projection-worker
# Wrong instance? Drop the lease (re-election happens in <=1 s):
docker exec pilingtrack-redis redis-cli DEL pilingtrack:leader:outbox-worker
# Prevention:
docker compose stop app ws workers
```

Also verify `ENCRYPTION_KEY` is **identical** in `.env` and `.env.docker` (`grep ENCRYPTION_KEY .env .env.docker` in Git Bash) — a mismatch makes one process decrypt the Telegram token into garbage, and notifications silently fail. Full write-up: `docs/dev-workflow.md`, `docs/dev-modes.md`.

### Path B — one-command bootstrap on a FRESH machine

`setup.bat` (Windows) / `setup.sh` (Linux/macOS) in the repo root. Appropriate for: a brand-new clone, a demo box, or after `docker compose down -v` wiped everything. Not for daily use.

**`setup.bat` (Windows) does, in order:**
1. Verifies Docker + Node on PATH (recommends "Node.js 22 LTS").
2. If `.env.docker` missing → runs `scripts/generate-env-docker.ps1`, which writes **both** `.env.docker` (Docker-network hostnames) and `.env` (localhost) with **matching** random secrets (`SESSION_SECRET`, `PIN_LOOKUP_SECRET`, `DEVICE_KEY_LOOKUP_SECRET`, `ENCRYPTION_KEY`, Postgres password) — matching so local dev and containers share one DB and can decrypt the same data.
3. `npm ci` (postinstall generates the Prisma client — see checklist below).
4. Starts DB-only services, waits for `pg_isready`.
5. `npm run db:migrate:deploy` then `npm run db:seed` (seed failure on a non-empty DB is a warning, not fatal).
6. Prints URLs and default seed logins.

**`setup.sh` differs:** it generates only `.env.docker` and brings up the **full** stack (`docker compose --env-file .env.docker up -d --build`), waiting for the `migrate` container to finish migrations + seed.

**Seed default logins (fresh DB only, change after first login):** `admin@piling.ru`/`admin123`, `dispatch@piling.ru`/`dispatch123`, `operator@piling.ru`/`operator123`, `helper@piling.ru`/`helper123`.

**Reset everything:** `docker compose --env-file .env.docker down -v` then re-run `setup.bat`.

---

## From-scratch checklist (manual, when setup.bat isn't wanted)

1. **Node version.** No `engines` field in `package.json` and no root `.nvmrc` — nothing enforces a version. `setup.bat` recommends Node 22 LTS; this machine runs v25.6.1 (2026-07-07) and works. Anything ≥22 is a safe bet.

2. **Install:** `npm ci` (or `npm install`). `postinstall` runs `npm run db:generate` = `prisma generate && node scripts/patch-postgres-client.js`.
   - Prisma client is generated into `src/generated/postgres-client/` (checked path, not the default `node_modules` location).
   - **Why the patch exists:** `scripts/patch-postgres-client.js` rewrites the generated client for the Next.js **standalone** build — it marks the client as bundled, removes `process.cwd()`-relative lookups of `query_engine-windows.dll.node` / `schema.prisma` (which break when the app runs from `.next/standalone/`), nulls `relativeEnvPaths`, strips the `warnEnvConflicts` call, and tags `process.cwd()` in `runtime/library.js` with `/*turbopackIgnore*/`. If the client behaves oddly after a manual `npx prisma generate`, you skipped the patch — always regenerate via `npm run db:generate`, never bare `prisma generate`.

3. **Env bootstrapping.** Need both `.env` (local dev) and `.env.docker` (compose). Fresh machine: let `scripts/generate-env-docker.ps1` create both (`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-env-docker.ps1`), or `cp .env.example .env` and fill in.
   - `scripts/validate-env.ts` runs **before** `dev`, `build`, and `start` and **fails fast**. Hard requirements: `DATABASE_PROVIDER` (`sqlite`|`postgres`), `SESSION_SECRET` (≥32 chars, not a placeholder), and `DATABASE_URL_POSTGRES` when provider is `postgres`. `REDIS_URL` missing = warning only (rate limiting falls back to in-memory). Manual check: `npm run validate:env`.
   - `docker-compose.yml` itself fails with `... must be set` if `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `DEVICE_KEY_LOOKUP_SECRET`, or `PIN_LOOKUP_SECRET` are absent from `.env.docker`.

4. **Start infra containers** (service names from `docker-compose.yml`; container names are `pilingtrack-<service>`):

   ```powershell
   docker compose --env-file .env.docker up -d postgres redis pgbouncer minio minio-init
   ```

   | Service | Container | Host port | Note |
   |---|---|---|---|
   | postgres | pilingtrack-postgres | **5435**→5432 | 5435 to dodge a host Postgres on 5432 |
   | redis | pilingtrack-redis | **6380**→6379 | 6380 to dodge old native Windows Redis 3.x, which BullMQ can't use (needs ≥5.0) |
   | pgbouncer | pilingtrack-pgbouncer | 6432 | transaction pooling |
   | minio | pilingtrack-minio | 9000 (S3), 9001 (console) | console login minioadmin/minioadmin by default |
   | minio-init | pilingtrack-minio-init | — | creates bucket `pilingtrack-reports`, exits |

   So in `.env`: DB at `localhost:5435`, Redis at `localhost:6380`. Inside compose: `postgres:5432`, `redis:6379`.

5. **Migrate + seed:**

   ```powershell
   npm run db:migrate:deploy   # apply committed migrations (no new ones)
   npm run db:seed             # idempotent upserts; prisma/seed.ts refuses to run on prod
   ```

   During schema work use `npm run db:migrate` (`prisma migrate dev`). `npm run db:reset` wipes and re-applies everything — **back up first** (below).

6. **Smoke it:** `npm run dev` → http://localhost:3000 → log in.

**DB naming gotcha (this machine vs fresh setup):** compose defaults are `POSTGRES_USER=postgres`, `POSTGRES_DB=pilingtrack_test` (used when `.env.docker` doesn't override); `generate-env-docker.ps1`/`setup.sh` instead write `piling`/`pilingtrack` (matching prod's naming). **This dev machine runs the defaults: user `postgres`, db `pilingtrack_test`** — the backup/snapshot scripts hardcode that. Check yours: `docker exec pilingtrack-postgres psql -U postgres -l` (if that user fails, try `-U piling`).

---

## The dev loop

```powershell
npm run dev        # predev hook first kills whatever holds port 3000, then validate-env, then next dev -p 3000
npm run verify     # FULL gate before push — see below
```

- **Port 3000 zombies:** `predev`/`prestart` run `node scripts/kill-port.js 3000` (Windows: `netstat -ano` + `taskkill /F`). It only helps for processes; if the Docker `app` container holds 3000, stop it: `docker compose stop app`.
- **`npm run verify`** = `db:check-migrations && lint && typecheck && test:unit && build && test:smoke:auth-access`. Two things to know:
  - **It is SLOW.** `typecheck` is `npm run build && tsc --noEmit` — a full Next.js production build *before* type-checking, and `verify` then runs `build` *again* and once more inside the smoke test. Expect many minutes; don't panic, don't kill it mid-build.
  - `db:check-migrations` (`scripts/check-migrations.js`) is the **migration guard**: it fails on any `DROP COLUMN`/`DROP TABLE`/`TRUNCATE` in a migration not allowlisted in `scripts/.migration-guard-baseline.txt` (a stray autogenerated DROP COLUMN broke prod on 2026-05-30). Intentional destructive change → read the .sql, then add the migration dir name to the baseline.
  - `lint` = `eslint . && node scripts/check-text-integrity.js` — the second part catches mojibake (broken UTF-8 Cyrillic like `Р'`/`вЂ`) in source files; it fires when a file was saved in the wrong encoding (see Windows traps).

**Test commands at a glance** (what/how belongs to `pilingtrack-testing-and-evidence`):

| Command | Runs |
|---|---|
| `npm run test:unit` | vitest, all unit tests (`src/**/__tests__/`) |
| `npm run test:unit:watch` | vitest watch mode |
| `npm run test:contract` | vitest on `tests/contract` |
| `npm run test:integration` | vitest on `tests/integration` |
| `npm run test:e2e` | Playwright (`test:e2e:ui` for headed UI mode) |
| `npm run test:smoke:auth-access` | build + `scripts/smoke-auth-access.js` |
| `npm run test:coverage` | vitest with coverage |

---

## Local DB management

The local DB was **reloaded from a prod snapshot on 2026-05-26**, so it contains realistic Orion data, not just seed data.

**Local admin login (LOCAL DEV ONLY — this is not a prod credential):** `admin@orionpiling.ru` / `admin123`. On a freshly seeded (non-snapshot) DB use the `admin@piling.ru`/`admin123` seed login instead.

### Two databases, one switch

`.env` points at one of two databases in the same container; `scripts/switch-db.js` swaps the DB name on **every** `DATABASE_URL*` line:

```powershell
npm run db:status      # which DB is active: pilingtrack_test (dev) or pilingtrack_prod_copy
npm run db:use-prod    # switch to the prod snapshot (treat it read-only)
npm run db:use-dev     # back to the throwaway dev DB
```

Stop `npm run dev` before switching — Next.js caches env on boot; restart it after.

### Refreshing the prod snapshot

```powershell
npm run db:refresh-prod-snapshot   # runs: bash scripts/refresh-prod-snapshot.sh (Git Bash)
```

SSHes to prod, `pg_dump`s, downloads, then **drops and recreates** `pilingtrack_prod_copy` locally and restores into it. Needs the prod SSH key configured on this machine (prod specifics: `pilingtrack-run-and-operate`). Weekly is enough. It never touches `pilingtrack_test`.

### Backups (owner rule: every 3 days, and ALWAYS before destructive ops)

`scripts/backup-local-db.ps1` dumps `pilingtrack_test` from `pilingtrack-postgres` to gzipped SQL in `backups\`, keeping the 10 newest. It is meant to run **every 3 days via Windows Task Scheduler**. Note: the script's comment references `scripts\register-backup-task.ps1`, which does **not exist** in the repo (verified 2026-07-07) — the scheduled task was registered manually; if it's gone, re-register by hand pointing at the backup script.

```powershell
# Manual backup — run this BEFORE db:reset, destructive migrations, snapshot restores:
powershell -ExecutionPolicy Bypass -File scripts\backup-local-db.ps1

# Restore (Git Bash):
gunzip -c backups/local_pilingtrack_test_<stamp>.sql.gz | docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test
```

Direct psql into local DB: `docker exec -it pilingtrack-postgres psql -U postgres -d pilingtrack_test`.

---

## Windows traps (this machine, verified 2026-07-07)

| Trap | Fix |
|---|---|
| Bare `python` or `python3` "succeeds" silently or opens the Microsoft Store — they hit the **Windows Store stub**, not a real interpreter | Use the full path `C:\Python314\python.exe` (real interpreter on this machine; on other machines locate yours with `where.exe python`) |
| Python mangles non-ASCII (Cyrillic) piped via stdin | Set `$env:PYTHONIOENCODING = 'utf-8'` before invoking (bash: `PYTHONIOENCODING=utf-8 python ...`) |
| PowerShell 5.1 has **no** `&&` / `\|\|` pipeline chains — parser error | `A; if ($?) { B }`, or run the chain in Git Bash |
| `Out-File` / `>` in PowerShell 5.1 writes **UTF-16 LE with BOM** — Node/git/eslint read it as garbage, and `check-text-integrity` then fails the lint | Always `Out-File -Encoding utf8` / `Set-Content -Encoding utf8`, or create files from Git Bash |
| Windows paths in Git Bash tools | Forward slashes: `C:\PillingR\my-project` → `/c/PillingR/my-project` |
| `bash`-shebang npm scripts (`db:refresh-prod-snapshot`, `backfill:analytics`) | They invoke `bash scripts/...` — fine from any shell as long as Git Bash is installed and on PATH |

---

## Known build traps

- **Standalone output.** `npm run build` = validate-env → `db:generate` → `next build` → `node scripts/copy-standalone-assets.js`. The copy step exists because Next standalone tracing misses things: it copies `.next/static` and `public/` into `.next/standalone/`, plus `src/generated/postgres-client/` (the Prisma client is imported by a concrete relative path Next can't trace), and drops `scripts/release-start.bat` in as `start.bat`. **Never run `next build` bare** — `.next/standalone/server.js` will start but serve without static assets or crash on Prisma. Same rule for `npm run start`: it runs `node .next/standalone/server.js`, which only works after the full `npm run build`.
- **`prisma generate` after every schema change** — and always via `npm run db:generate` so the standalone patch (checklist step 2) is re-applied. Symptoms of a stale client: TS errors on model fields that exist in `schema.prisma`, or runtime `Unknown field` errors.
- **Port-3000 zombies** — handled by the `predev`/`prestart` kill-port hook; the one case it can't fix is the Docker `app` container (stop it manually).
- **Full local prod-mode check** before a deploy: `start.bat prod` (build ~1 min+, workers run embedded in-process).

---

## Provenance and maintenance

Written 2026-07-07 from direct reads of the repo (no commands executed that mutate state). Sources: `package.json`, `README.md`, `docs/dev-workflow.md`, `docs/dev-modes.md`, `docker-compose.yml`, `setup.bat`, `setup.sh`, `start.bat`, and `scripts/{kill-port.js, validate-env.ts, switch-db.js, backup-local-db.ps1, refresh-prod-snapshot.sh, patch-postgres-client.js, check-migrations.js, copy-standalone-assets.js, check-text-integrity.js, generate-env-docker.ps1}` — all confirmed present. Machine facts (Python path, Node v25.6.1, local DB identity) are **this-machine** observations, not repo guarantees.

Re-verify before trusting, one-liners:

| Claim | Check |
|---|---|
| npm scripts unchanged | `Get-Content package.json \| Select-String '"(dev\|build\|verify\|typecheck\|db:generate\|postinstall)"'` |
| Compose ports/services | `Select-String -Path docker-compose.yml -Pattern '"\d+:\d+"\|container_name'` |
| Helper scripts still exist | `ls scripts\kill-port.js, scripts\validate-env.ts, scripts\switch-db.js, scripts\backup-local-db.ps1, scripts\refresh-prod-snapshot.sh, scripts\patch-postgres-client.js` |
| Node version guidance appeared? | `Select-String -Path package.json -Pattern '"engines"'; Test-Path .nvmrc` |
| Python interpreter | `Test-Path C:\Python314\python.exe` |
| Which local DB is active | `npm run db:status` |
| Leader-election doc current | `Select-String -Path docs\dev-modes.md -Pattern 'leader'` |
