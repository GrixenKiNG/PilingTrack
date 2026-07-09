---
name: pilingtrack-config-and-flags
description: >-
  Catalog of every PilingTrack configuration axis — env vars, defaults, what
  validates them, which container(s) consume them, and prod vs dev vs dormant
  behavior. Use when adding or renaming an env var, a container is missing a
  config value it needs, `validate-env.ts` fails, something "works locally but
  not in the container", diagnosing a silently-skipped feature (Telegram,
  metrics scrape, alerts webhook), or deciding where a new config axis's
  default should live.
---

# PilingTrack — Configuration and Feature Flags

Ground truth verified against the repo on **2026-07-08** (branch
`chore/project-skills`). Every fact below traces to a specific file; re-run the
commands in "Provenance and maintenance" (§8) before trusting this after a
schema/compose change.

**Never print or log real secret values** (`SESSION_SECRET`, `ENCRYPTION_KEY`,
`POSTGRES_PASSWORD`, etc.) — this skill and any session using it should only
ever handle variable *names*.

## When NOT to use this skill

| You need... | Go to |
|---|---|
| The actual deploy procedure / command block | `deploy` skill (generates the paste-block) + CLAUDE.md's "Deploy runbook" |
| Prod operations, container health, logs, backups | `pilingtrack-run-and-operate` |
| Local dev environment setup/repair (fresh clone, broken dev, DB reset) | `pilingtrack-build-and-env` |
| Writing a new Prisma migration | `create-migration` skill |
| Pre-merge/pre-deploy checklist | `qa-checklist` skill |
| Where an entity/table belongs (module vs dictionary vs enum) | `module-vs-dictionary` skill |
| Architecture invariants (RLS, CSRF, JWT, outbox) — the WHY, not the env var | `pilingtrack-architecture-contract` skill |
| Doc style / where to write things up | `pilingtrack-docs-and-writing` skill |
| Measuring `/api/health`, `/api/metrics`, query plans, outbox lag | `pilingtrack-diagnostics-and-tooling` skill |
| Verifying whether a suspected config bug is actually real | `pilingtrack-proof-and-analysis-toolkit` skill |

This skill answers "what is this env var, what's its default, who reads it,
and what breaks if it's missing" — nothing about *how* to deploy or operate.

---

## 1. The authoritative source, and why it's incomplete

`scripts/validate-env.ts` is the only *enforced* env contract — it runs before
`dev`, `build`, and `start` (see `package.json`'s `predev`/`build`/`start`
scripts) and fails fast with a clear error if a required var is missing or
malformed. But it is **not a full inventory**: it only lists vars someone
bothered to add validation for. Several load-bearing vars used throughout the
app (`DEFAULT_TENANT_ID`, `TELEGRAM_API_BASE`, `TRUST_PROXY`, `APP_VERSION`,
`METRICS_SCRAPE_TOKEN`, all `S3_*`, `WS_URL`/`WS_PORT`...) are **not**
validated at all — a typo or missing value fails silently at the call site,
not at boot. This catalog (§2) covers both: what `validate-env.ts` checks, and
everything else grep found actually being read.

`validate-env.ts` also still mentions `DATABASE_PROVIDER: sqlite | postgres`
and a bare `DATABASE_URL_POSTGRES` — this predates the current PgBouncer setup
and multi-container split (§3). Treat its *validation logic* (required/format
checks) as current, but its *comments/description text* as sometimes stale;
docker-compose.yml is more current for how these vars are actually wired.

---

## 2. Full environment-variable table

Legend: **Req** = required (blank/missing fails validation or throws at
runtime) · **Prod-req** = required only when `NODE_ENV=production` · **cond.**
= conditionally required.

### Core / database

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `DATABASE_PROVIDER` | Req | — | `validate-env.ts` (must be `sqlite`\|`postgres`) | Legacy; runtime code always returns `'postgres'` (`src/lib/db.ts` `getDatabaseProvider()`, ADR-0001 removed SQLite) | Set to `postgres` everywhere; the SQLite branch is dead |
| `DATABASE_URL` | cond. | — | not validated directly | `src/lib/db.ts` `createPrismaClient()` — **preferred** at runtime | In docker-compose, points at **PgBouncer** (`pgbouncer:5432`, `?pgbouncer=true` — disables prepared-statement caching, required in transaction-pool mode). App/workers/ws containers all set this |
| `DATABASE_URL_POSTGRES` | cond. (Req if `DATABASE_PROVIDER=postgres`) | — | `validate-env.ts` (must start `postgresql://`/`postgres://`) | `src/lib/db.ts` (fallback if `DATABASE_URL` unset), `prisma.config.ts` (`datasource.url`, used by `prisma migrate`/`generate`/seed CLI) | Points **directly at postgres** (bypasses PgBouncer) — migrations need a direct session, not a pooled transaction connection |
| `DATABASE_URL_PGBOUNCER` | No | — | not validated | **No consumer found in `src/`** — declared in local `.env` only (verified via grep, 2026-07-08); `scripts/switch-db.js`'s regex rewrites it if present, so it is touched by tooling even though nothing reads it at runtime | No consumer found as of 2026-07-08 — mention, don't delete; re-run the §8 grep before touching |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `POSTGRES_PASSWORD` Req (compose `:?`) | user/db default to `postgres`/`pilingtrack_test` | `validate-env.ts` warns on the placeholder value for `POSTGRES_PASSWORD` | `docker-compose.yml` postgres/pgbouncer/migrate/app/workers/ws service env blocks (interpolated into each `DATABASE_URL*`) | Compose hard-fails at `up` if `POSTGRES_PASSWORD` is unset (`:?` syntax) |
| `DATABASE_LOG_QUERIES` | No | `false` | not validated | `src/lib/db.ts` `getPrismaLogLevels()` — `'true'` adds the `query` log level | Leave off in prod (query-level logging is noisy/slow) |
| `PRISMA_POOL_TIMEOUT` | No | `10` (seconds) | not validated | `src/lib/db.ts` `createPrismaClient()` — connection-acquire timeout | — |
| `PRISMA_CONNECTION_LIMIT` | No | `20` | not validated | `src/lib/db.ts` `createPrismaClient()` — pg pool max size | With PgBouncer's `DEFAULT_POOL_SIZE=40` shared across 3 services × Prisma max 20 = 60 potential clients; see PgBouncer row in §3 |

### Security secrets

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `SESSION_SECRET` | Req (always) | — | `validate-env.ts` (≥32 chars, rejects known placeholders) | JWT session signing (`src/services/auth/`); also re-checked in `src/instrumentation.ts` (`register()` throws if `NODE_ENV=production` and unset) | Compose `app`/`ws` services fail hard (`:?`) without it |
| `DEVICE_KEY_LOOKUP_SECRET` | Prod-req | — | `validate-env.ts` (≥32 chars; required when `NODE_ENV=production`) | HMAC hashing of device API keys (telemetry device auth) | Compose `app`/`ws` fail hard (`:?`) |
| `PIN_LOOKUP_SECRET` | Prod-req | — | `validate-env.ts` (≥32 chars; required in prod; **must differ from `SESSION_SECRET`** in prod — validator rejects if equal) | PIN-login lookup hashing | Rotating it invalidates all existing PIN logins — see `docs/encryption-key-rotation.md`-style caution |
| `ENCRYPTION_KEY` (+ `ENCRYPTION_KEY_V1`, `_V2`, ... + `ENCRYPTION_KEY_VERSION`) | Req in prod (throws) | — | not in `validate-env.ts`; validated in `src/core/security/encryption.ts` at first use | Encrypts Telegram bot tokens and other at-rest secrets in DB. **Both `app` and `workers` containers need it** — the outbox event handler that decrypts the Telegram config runs inside `workers` | Versioned format `enc:v1:<base64>` supports dual-decrypt during rotation: set `ENCRYPTION_KEY_V2`, `ENCRYPTION_KEY_VERSION=v2`, restart (new writes go out as v2, old `enc:`/`enc:v1:` still decrypt), then sweep with `reEncrypt()`, then drop the old key. See `src/core/security/encryption.ts` header comment for the full rotation steps |
| `ALERTMANAGER_WEBHOOK_TOKEN` | No (fails closed) | unset → endpoint always rejects | not validated | `src/app/api/alerts/webhook/route.ts` `isAuthorized()` — constant-time compare against `Authorization: Bearer` or `?token=` | Fail-closed by design (M-10-class fix): unset means every Alertmanager webhook call gets 401, not "auth skipped" |
| `METRICS_SCRAPE_TOKEN` | No (fails closed, falls through) | unset → token path never matches | not validated | `src/app/api/metrics/route.ts` `isValidScrapeToken()` | Fail-closed but with a fallback: no/bad token falls through to normal session auth (`system.read` permission), so a logged-in admin can still open `/api/metrics` in a browser. Fixed in commit `64228fc` (M-10b) |

### Multi-tenancy

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `MULTI_TENANT_MODE` | No | `false` | `validate-env.ts` (must be `false`\|`single`\|`multi`\|legacy `true`) | `src/services/tenancy/tenant-context-service.ts` — only `'multi'` or legacy `'true'` enable multi-tenant enforcement; anything else (including `'single'`, unset) disables it | Prod runs single-tenant (`orion`); multi-tenant enforcement is currently OFF by design — see `product-bible` skill for the hybrid-SaaS roadmap decision (2026-11-24) |
| `DEFAULT_TENANT_ID` | No | `''`/unset (docker-compose default) / `"default"` (`.env.example`) | not validated | 62 files across `src/app/api/**`, `src/services/tenancy/`, `prisma/seed.ts`, etc. (grep, 2026-07-08) — the fallback tenant for background/system paths and Telegram config lookup | **CRITICAL — must be set in BOTH `app` and `workers` containers.** A missing app-side value silently killed all Telegram report-submission notifications (app logged "Telegram not configured — skipping document" despite a valid `TelegramConfig` row) until commit `c3a1774` (2026-07-07) added it to the `app` service's env block in `docker-compose.yml`. Prod value is `orion` |

### Redis

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `REDIS_URL` | No (warns if missing) | — | `validate-env.ts` (must start `redis://`/`rediss://`); warns if unset | Rate limiting (`src/lib/rate-limiter.ts`), WS pub/sub (`src/core/realtime/redis/pubsub.ts`), session service, PDF queue, unified-worker config | Without it, rate limiting falls back to in-memory (not distributed-safe across containers) — the validator warns but doesn't fail. In compose, points at the **state** Redis (`redis` service — AOF durability on, `noeviction`) with password auth |
| `REDIS_URL_CACHE` | No | — | not validated | `src/lib/redis-cache.ts` | Separate Redis instance in compose (`redis-cache` — no AOF, `allkeys-lru`) so cache churn can't evict rate-limit/queue state. Not declared in `validate-env.ts` at all |
| `REDIS_PASSWORD` | Req in compose (`:?`) | — | not validated by app; compose fails at `up` if unset | Interpolated into both `REDIS_URL` and `REDIS_URL_CACHE` connection strings, and into the `redis`/`redis-cache` containers' own `--requirepass` | — |

### Reverse proxy / networking

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `TRUST_PROXY` | No | unset (= false) | not validated | `src/lib/rate-limiter.ts` `resolveClientIp()` | **Security-relevant.** Only when `TRUST_PROXY==='true'` does the app honor `x-forwarded-for`/`x-real-ip` for rate-limit bucketing. Left unset, an attacker behind a reverse proxy could otherwise rotate the header to mint unlimited rate-limit buckets. Set `true` on prod (behind Caddy) |
| `WS_URL` | No | — | not validated | Server-side WS client target (workers/app talking to the ws service) | Compose sets `ws://ws:3001` internally |
| `WS_PORT` | No | `3001` | not validated | `src/core/realtime/server/ws-server.ts` — the port the ws server binds | Compose sets `WS_PORT=3001` explicitly on the `ws` service |
| `NEXT_PUBLIC_WS_URL` | Prod-req (compose overlay `:?`) | `ws://localhost:3001` (base compose) | not validated | `src/components/piling/monitoring/fleet-dashboard.tsx` — browser-side WS connection target; baked into the client bundle at build time (Next.js `NEXT_PUBLIC_*` convention) | `docker-compose.prod.yml` makes this hard-required — a missing value there breaks realtime fleet monitoring in every browser tab, not just one request |

### Object storage (S3 / MinIO / R2)

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `S3_ENDPOINT` | No | unset → falls back to local filesystem | `validate-env.ts` declares it as optional, no format check | `src/core/storage/s3-service.ts`, `src/core/media/media-service.ts`, `src/lib/pdf-generator/storage.ts`, health checks | Prod points at MinIO (`http://minio:9000` internally) or could point at Cloudflare R2. Off-site backup (§ below) reuses these same `S3_*` creds against R2 — separate from the app's own MinIO storage, same env var family |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | No | — | `validate-env.ts` declares as optional | Same files as above | — |
| `S3_REGION` | No | `auto` | not validated | `src/core/storage/s3-service.ts` | `auto` works for both MinIO and R2 |
| `S3_BUCKET` | No | `pilingtrack-reports` | not validated | compose `minio-init` service (bucket bootstrap), storage service | — |
| `S3_FORCE_PATH_STYLE` | No | — | not validated | **No consumer found in `src/`** (grep, 2026-07-08) — only appears in `scripts/generate-env-docker.ps1`'s template output | No consumer found as of 2026-07-08 — mention, don't delete; MinIO path-style addressing may be handled elsewhere (SDK default) or this was never wired up. Re-run the §8 grep before touching |

### Telegram

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `TELEGRAM_API_BASE` | No | `https://api.telegram.org` | not validated | `src/core/notifications/telegram.ts` (3 call sites: sendMessage, sendDocument, getChat) | **`api.telegram.org` is blocked at the ISP level on the VPS.** Prod sets this to a Cloudflare Worker proxy (`https://pilingtrack-tg-proxy.sasorion02.workers.dev`) in both `app` and `workers`. If the var disappears, every Telegram fetch fails silently (network error, not an auth error) |

### Versioning / observability

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `APP_VERSION` | No | `npm_package_version` → `"unknown"` | not validated | `next.config.ts` (bakes into bundle via `env:` block — **wins over** a plain runtime `process.env.APP_VERSION` read, see below), `/api/health`, `/api/metrics`, health-tracker aggregate | Docker-supplied value **must win** over the npm package version — fixed in commit `c555422`. Before that fix, `next.config.ts`'s `env` block preferred `npm_package_version` unconditionally, so `/api/health` reported a stale `2.6.0` forever even after the Dockerfile's `ARG APP_VERSION` carried the real deploy SHA. Deploy runbook sets `export APP_VERSION=$(git rev-parse --short HEAD)` before `docker compose build` so this resolves correctly; `Dockerfile`'s `ARG APP_VERSION=unknown` / `ENV APP_VERSION=$APP_VERSION` (both build stages) carries it into the image |
| `NODE_ENV` | No (Next.js/Node convention) | `development` locally, `production` in compose | Several conditional checks read it directly (`validate-env.ts`, `src/instrumentation.ts`, `prisma/seed.ts`'s `assertNotProduction()`, `src/lib/db.ts`) | Everywhere | `NODE_ENV=production` triggers: `DEVICE_KEY_LOOKUP_SECRET`/`PIN_LOOKUP_SECRET` become required, `SESSION_SECRET` is re-checked at instrumentation boot, seed refuses to run |
| `SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | No | `SENTRY_PROJECT` defaults to `pilingtrack` in examples | `validate-env.ts` warns if `SENTRY_AUTH_TOKEN` missing (unless `.env.sentry-build-plugin` supplies it) | `next.config.ts`'s `withSentryConfig` (source-map upload, release tagging), `sentry.client.config.ts`/`sentry.server.config.ts` | `SENTRY_AUTH_TOKEN` only affects **build-time** source-map upload; missing it just means unreadable stack traces in the Sentry UI, app still builds and runs. `sourcemaps.deleteSourcemapsAfterUpload: true` prevents `.js.map` files leaking source on prod regardless |
| `SENTRY_RELEASE` | No | `pilingtrack@${npm_package_version}` | not validated | `next.config.ts` release naming | — |
| `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` / `OTEL_TRACES_SAMPLER_ARG` | No | — | not validated | **No consumer found in `src/`** (grep, 2026-07-08 — no `instrumentation.ts` OTel SDK wiring despite `@opentelemetry/*` packages in `package.json`) | Declared in `.env.docker`/`.env.production.example` templates only. No consumer found as of 2026-07-08 — mention, don't delete; the OpenTelemetry packages are installed but not actively initialized, which reads as a paused wiring effort, not a var to remove. Re-run the §8 grep (`grep -r "NodeSDK\|OTEL_" src/`) before touching |

### Seeding / migration

| Var | Req | Default | Validated by | Consumed where | Prod semantics |
|---|---|---|---|---|---|
| `SKIP_SEED` | No | `0` (base compose), `1` (prod overlay) | not validated | `docker-compose.yml`'s `migrate` service command (`sh -c` conditional) | Defense in depth: prod also has `prisma/seed.ts`'s own `assertNotProduction()` guard, so even `SKIP_SEED=0` on prod would be refused by the seed script itself |

### Logging / debug switches (read directly, not validated)

| Var | Consumed where | What it does |
|---|---|---|
| `LOG_LEVEL` | `src/lib/logger.ts` | Log verbosity threshold |
| `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE` | Logged at boot by `src/instrumentation.ts`'s `logEffectiveRuntimeFlags()`; individually gate verbose logging in their respective subsystems (e.g. `LOG_WORKER_LIFECYCLE` gates embedded-worker leader-election logs, `LOG_WORKER_STATS` gates periodic outbox-stats logging) | All boolean-ish (`'true'` to enable); all default to off/silent |
| `EMBEDDED_WORKERS` | `src/workers/embedded-workers.ts` `parseEnabledWorkers()` | See §4 — controls which workers run embedded in the Next.js process |
| `ENABLED_WORKERS` | `src/workers/unified-worker/config.ts` | Comma list gating the **standalone** `workers` container's worker set (default `outbox,projection,pdf`) — a **different variable** from `EMBEDDED_WORKERS` above; don't confuse them |
| `PDF_WORKER_CONCURRENCY` | `docker-compose.yml` workers env (`=2`) | Not read from a shell default — hardcoded to `2` in the compose file itself, no `${...}` interpolation |
| `OUTBOX_INTERVAL_MS` / `PROJECTION_INTERVAL_MS` | `docker-compose.yml` workers env | Poll intervals, default `10000`/`5000` ms |
| `WORKER_HEALTH_PORT` | `docker-compose.yml` workers env (`=3002`) | Port for the workers container's `/health` endpoint |
| `ASYNC_OUTBOX` | **No consumer found in `src/`** (grep, 2026-07-08) | Declared in local `.env` and `scripts/generate-env-docker.ps1`'s template only. No consumer found as of 2026-07-08 — mention, don't delete; re-run the §8 grep before touching |

### Other

| Var | Req | Default | Consumed where | Notes |
|---|---|---|---|---|
| `ALLOWED_DEV_ORIGIN` | No | — | `next.config.ts` `allowedDevOrigins` | Dev-only CORS allowlist addition beyond `127.0.0.1`/`localhost` |
| `NEXT_TELEMETRY_DISABLED` | No | `1` in Dockerfile | Next.js built-in (opts out of Next's own anonymous telemetry — unrelated to this project's `Telemetry`/equipment-monitoring feature) | Don't confuse with equipment telemetry ingest, a completely different subsystem |
| `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` | `PGADMIN_PASSWORD` Req (`:?`) if `dev` profile enabled | `PGADMIN_EMAIL` defaults to `admin@pilingtrack.local` | `docker-compose.yml` `pgadmin` service (gated behind `profiles: [dev]`) | Never starts unless you explicitly run `docker compose --profile dev up` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | No | `minioadmin`/`minioadmin` | `docker-compose.yml` `minio`/`minio-init` services | Change from the default for anything beyond throwaway local dev |

**Count: ~50 distinct config axes** catalogued above (env vars + the two
`ENABLED_WORKERS`/`EMBEDDED_WORKERS` flags), spanning `validate-env.ts`,
`docker-compose.yml`/`docker-compose.prod.yml`, `next.config.ts`, and direct
`process.env` reads across `src/`.

---

## 3. DATABASE_URL vs DATABASE_URL_POSTGRES — the PgBouncer routing distinction

Two different connection strings exist **on purpose**, verified from
`docker-compose.yml` (app/workers/ws service comments) and `prisma.config.ts`:

- **`DATABASE_URL`** → routed through **PgBouncer** (`pgbouncer:5432`,
  `?pgbouncer=true`) in **transaction pooling** mode. Used by `src/lib/db.ts`
  for all **runtime** app/worker/ws queries. `pgbouncer=true` tells Prisma to
  disable prepared-statement caching, which transaction-pool mode requires
  (a prepared statement can't safely survive across pooled connections that
  get handed to different transactions).
- **`DATABASE_URL_POSTGRES`** → connects **directly to `postgres:5432`**,
  bypassing PgBouncer. Used by: (a) `prisma.config.ts`'s `datasource.url` —
  everything the Prisma CLI does (`migrate deploy`, `generate`, `db seed`)
  needs a direct session-mode connection, not a pooled transaction one; (b)
  `src/lib/db.ts` as a **fallback** if `DATABASE_URL` is unset (so local dev
  without PgBouncer still works — pointing straight at postgres is "equally
  fine" per the code comment, since there's no pooling contention at
  single-developer scale).
- The `migrate` container's `DATABASE_URL` env var is *also* set to the
  direct (non-PgBouncer) connection string in `docker-compose.yml` — migrate
  never goes through PgBouncer at all, only app/workers/ws do.
- **`DATABASE_URL_PGBOUNCER`** (seen in local `.env`) is a **third, unused**
  name — not read anywhere in `src/`, likely a naming experiment that never
  got wired up. Don't add logic depending on it existing.
- Tenant isolation depends on this pooling being transaction-scoped: the only
  tenant-context mechanism in use is transaction-local `set_config`
  (`withTenantContext`) — a session-level `SET` variant would be unsafe under
  PgBouncer transaction pooling (a session-level setting could leak across
  pooled connections to a different tenant's transaction) but has no callers,
  per the `src/lib/db.ts` comment (audit H5).

There is **no separate `DIRECT_URL` variable** in this project (grep,
2026-07-08) — `DATABASE_URL_POSTGRES` fills that Prisma convention's usual
role.

---

## 4. Feature-flag-like switches

### 4a. Embedded workers vs standalone `workers` container

Two independent variables, easy to confuse (verified by reading both
source files, 2026-07-08):

- **`EMBEDDED_WORKERS`** (`src/workers/embedded-workers.ts`
  `parseEnabledWorkers()`) — controls workers started **inside the Next.js
  server process** itself (`src/instrumentation.ts`'s `register()` calls
  `startEmbeddedWorkers()` on boot, skipped during the Next.js build phase).
  - Unset/empty → `['outbox', 'projection']` in every env **except**
    `NODE_ENV=test` (empty in test).
  - `'0'`/`'false'`/`'off'`/`'none'`/`'disabled'` → no embedded workers.
  - `'1'`/`'true'`/`'on'`/`'default'` → the default set.
  - Comma list (e.g. `outbox`) → that subset only. PDF is never embedded —
    only `outbox`/`projection` are valid embedded worker names.
  - **`docs/dev-modes.md` calls this `ENABLED_EMBEDDED_WORKERS`, which is
    stale/wrong** — the actual variable the code reads is `EMBEDDED_WORKERS`.
    Verified 2026-07-08 by reading `src/workers/embedded-workers.ts` line 43.
    If you're troubleshooting "embedded workers won't turn off," use the
    real name.
- **`ENABLED_WORKERS`** (`src/workers/unified-worker/config.ts`) — a
  completely separate variable gating which workers the **standalone**
  `workers` Docker container runs (`outbox,projection,pdf` by default, set
  explicitly in `docker-compose.yml`). This is the one PDF generation
  actually depends on, since PDF is never embedded.

Both use Redis leader-election (`getOutboxLeaderElection`,
`getProjectionLeaderElection`) so only one process — embedded or
containerized — actually does the work if both happen to be running; see
`docs/dev-modes.md` "Outbox leader" section for the two-processes-racing
failure mode. That leader-election mechanic itself belongs to
`pilingtrack-architecture-contract`, not here.

### 4b. Dormant telemetry (equipment monitoring)

Not an env-var flag — activation is physical, not configuration. The
telemetry ingest endpoints (`src/app/api/telemetry/*`) authenticate via a
per-equipment `x-device-key` header checked against
`DEVICE_KEY_LOOKUP_SECRET`-hashed keys in the DB. The subsystem is dormant
(no data flowing) simply because no physical hardware is currently sending
telemetry — not because a flag is off. See `pilingtrack-architecture-contract`
for the full dormant-vs-dead distinction and the multi-tenancy dormancy
rationale (hybrid-SaaS go/no-go due 2026-11-24).

### 4c. Dev-mode selection (`start.bat` / `docs/dev-modes.md`)

Not an env var either — `start.bat [dev|docker|prod]` picks between three
run configurations (local Next.js + Docker DB / full Docker stack / local
build against Docker DB). Full detail already lives in `docs/dev-modes.md`
and `pilingtrack-build-and-env`; not duplicated here.

---

## 5. Where config lives per environment

| Environment | File(s) | Notes |
|---|---|---|
| Local dev (`npm run dev`) | `.env` (repo root, gitignored) | Loaded by `dotenv.config({ path: '.env' })` in `scripts/validate-env.ts`; Next.js also auto-loads `.env`/`.env.local`. Verified present var names (2026-07-08): `ALERTMANAGER_WEBHOOK_TOKEN`, `ASYNC_OUTBOX`, `DATABASE_LOG_QUERIES`, `DATABASE_PROVIDER`, `DATABASE_URL`, `DATABASE_URL_PGBOUNCER`, `DATABASE_URL_POSTGRES`, `DEFAULT_TENANT_ID`, `DEVICE_KEY_LOOKUP_SECRET`, `ENCRYPTION_KEY`, `MULTI_TENANT_MODE`, `NEXT_PUBLIC_WS_URL`, `NEXT_TELEMETRY_DISABLED`, `PIN_LOOKUP_SECRET`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_USER`, `REDIS_PASSWORD`, `REDIS_URL`, `S3_ACCESS_KEY_ID`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_REGION`, `S3_SECRET_ACCESS_KEY`, `SESSION_SECRET`, `TELEGRAM_API_BASE`, `WS_URL` |
| Full local Docker stack (`start.bat docker`) | `.env.docker` (repo root, gitignored) | Generated by `scripts/generate-env-docker.ps1`; superset includes `ALERTMANAGER_WEBHOOK_TOKEN`, `MINIO_ROOT_USER/PASSWORD`, `OTEL_ENABLED`, `OUTBOX_INTERVAL_MS`, `PGADMIN_EMAIL/PASSWORD`, `PROJECTION_INTERVAL_MS`, `PROMETHEUS_ENDPOINT`, `SKIP_SEED` on top of the dev set |
| Templates (checked into git, no real values) | `.env.example`, `.env.docker.example`, `.env.production.example` | Reference lists of variable **names** only — the sanctioned place to add a new var's name + a placeholder/comment (see §7 checklist) |
| Production VPS | `/opt/pilingtrack/.env` and `.env.production` on the server (not in this repo) | `docker compose` reads `.env` at the compose-file's directory by default; `docker-compose.prod.yml` is applied as an overlay (`-f docker-compose.yml -f docker-compose.prod.yml`). See `pilingtrack-run-and-operate` for server access |
| Per-service overrides | `docker-compose.yml` service `environment:` blocks | The **actual wiring** — a var existing in `.env` does nothing for a container unless that container's `environment:` list references it. This is the #1 source of "works locally, not in container" bugs (§7) |
| Sentry build plugin | `.env.sentry-build-plugin` (gitignored) | Separate from `.env` — `validate-env.ts` checks this file directly (not via `dotenv`) to decide whether to warn about a missing `SENTRY_AUTH_TOKEN` |

---

## 6. DB switching (`scripts/switch-db.js`)

```
npm run db:use-prod    # point local DATABASE_URL* at pilingtrack_prod_copy
npm run db:use-dev     # point back at pilingtrack_test
npm run db:status      # show which one is currently active
```

Mechanics (`scripts/switch-db.js`, read in full 2026-07-08):
- Rewrites the **database name segment** of *every* line matching
  `^DATABASE_URL[A-Z_]*=postgresql://...` in `.env` — this covers
  `DATABASE_URL`, `DATABASE_URL_POSTGRES`, and `DATABASE_URL_PGBOUNCER` in one
  regex pass, host/user/password untouched.
- Safety: doesn't touch anything if already on the target DB; prints
  "restart `npm run dev`" as a reminder (Next.js caches env at boot, so a
  swap while the dev server is running has no effect until restart).
- `npm run db:refresh-prod-snapshot` (`scripts/refresh-prod-snapshot.sh`) is a
  separate, heavier operation: SSHes to the VPS, `pg_dump`s prod, downloads,
  and restores into local `pilingtrack_prod_copy` — the source `db:use-prod`
  actually points at. Requires the SSH key described in `reference_prod_ssh`
  (user memory) / `pilingtrack-run-and-operate`. Recommended weekly, not
  automated.
- **This is a read-only-mindset tool** — `db:use-prod` points your local app
  at a *copy* of prod data, not prod itself. There is no `db:use-prod-live`;
  nothing in this repo lets local dev write to the real production database.

---

## 7. "Add a new config axis" checklist

Grounded in the `DEFAULT_TENANT_ID` incident (commit `c3a1774`) where a var
existed and was validated-in-spirit but simply wasn't wired into one
container's `environment:` block, breaking Telegram notifications silently
for an unknown period before discovery.

1. **Declare it in `scripts/validate-env.ts`** if it has a correctness
   invariant worth enforcing at boot (format, min length, required-in-prod).
   Not everything needs this — plenty of real vars above (`DEFAULT_TENANT_ID`,
   `TELEGRAM_API_BASE`, `TRUST_PROXY`) skip it and rely on fail-closed
   behavior at the call site instead. Pick one deliberately, don't assume
   `validate-env.ts` catches a missing value if you didn't add it there.
2. **Document the default** at the call site (a `process.env.X || default`
   expression) or explicitly note "no default, must be set" — don't leave a
   bare `process.env.X` with unclear fallback behavior for the next reader.
3. **Wire it into every compose service that actually needs it.** A single
   var frequently needs to be repeated across `app`, `workers`, and `ws`
   service blocks in `docker-compose.yml` — Docker Compose does **not**
   share env between services. Ask explicitly: does the app container need
   this at request-time? Does the workers container need it for background
   processing (outbox/projection/pdf)? Does ws need it for realtime? Missing
   any one of these silently breaks only that container's code path — the
   `DEFAULT_TENANT_ID` incident (§2, commit `c3a1774`) is exactly this
   failure: present in `workers`, absent from `app`, and the app-side
   Telegram notification path silently no-op'd for an unknown period.
4. **Update `.env.example`** (and `.env.docker.example` /
   `.env.production.example` if the var is Docker/prod-specific) with the
   name and a placeholder or empty value — never a real value.
5. **Add a row to this catalog** (§2) — Req/default/validated-by/consumed-
   where/prod-semantics — and re-run the grep in "Provenance and
   maintenance" (§8) to confirm the "consumed where" column before writing
   it down.

---

## 8. Provenance and maintenance

Every fact above traces to a file read on **2026-07-08**. Re-verify with:

```bash
# Full validated list (should match §2's "Core/Security/Multi-tenancy/Redis" rows)
grep -n "required:\|description:" scripts/validate-env.ts

# Which containers get which var (source of truth for §3's "wire into every service")
grep -n "environment:" -A 30 docker-compose.yml

# Confirm a var has a real consumer before trusting a "consumed where" cell
grep -rn "process\.env\.YOUR_VAR" src/

# Confirm EMBEDDED_WORKERS vs ENABLED_WORKERS haven't merged/renamed
grep -n "process.env.EMBEDDED_WORKERS\|process.env.ENABLED_WORKERS" src/workers -r

# Confirm the DEFAULT_TENANT_ID incident fix is still in place (app service must have it)
grep -n "DEFAULT_TENANT_ID" docker-compose.yml

# Orphaned-var check (re-run before assuming ASYNC_OUTBOX / S3_FORCE_PATH_STYLE / OTEL_* / DATABASE_URL_PGBOUNCER are still unused)
grep -rn "ASYNC_OUTBOX\|S3_FORCE_PATH_STYLE\|OTEL_ENABLED\|DATABASE_URL_PGBOUNCER" src/
```

If any of these come back different from what's written above, this file is
stale — update the affected row/section and bump this date rather than
leaving silent drift for the next reader.
