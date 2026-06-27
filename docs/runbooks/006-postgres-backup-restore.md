# Runbook: Postgres backup & restore

| Metadata | Value |
|---|---|
| **Severity** | 🟢 L-3 (preventive) / 🔴 P0 during restore |
| **SLA** | Restore < 30 min for current dump |
| **Owned by** | Whoever holds prod SSH |

---

## Setup (one time, already done on orionpiling.ru)

```bash
sudo install -m 644 deploy/systemd/pilingtrack-backup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/pilingtrack-backup.timer   /etc/systemd/system/
sudo mkdir -p /var/backups/pilingtrack
sudo chown user1:user1 /var/backups/pilingtrack
sudo systemctl daemon-reload
sudo systemctl enable --now pilingtrack-backup.timer
```

Verify timer:
```bash
systemctl list-timers pilingtrack-backup.timer
```

Defaults: nightly 03:30 (±10 min jitter), 30-day retention, dumps in
`/var/backups/pilingtrack/pilingtrack-YYYYMMDD-HHMMSS.sql.gz`.

---

## Off-site copy (Cloudflare R2)

Every nightly dump is also pushed to a Cloudflare R2 bucket via `rclone`,
so a VPS-level disaster (datacenter incident, account suspension, disk
corruption beyond the LVM layer) doesn't take the backups down with it.
A failed off-site push only logs a warning — it never fails the local
backup job.

**One-time setup:**

1. Cloudflare dashboard → R2 → create a bucket, e.g. `pilingtrack-backups`.
2. R2 → Manage API tokens → create a token scoped to that bucket with
   Object Read & Write permission. Note the **Access Key ID**, **Secret
   Access Key**, and your **Account ID** (shown on the R2 overview page).
3. Install rclone on the VPS (one time):
   ```bash
   ssh -i ~/.ssh/orionpiling user1@87.242.102.125
   curl https://rclone.org/install.sh | sudo bash
   ```
4. Add the credentials to `/opt/pilingtrack/.env` (same file the backup
   timer already reads — see `deploy/systemd/pilingtrack-backup.service`):
   ```bash
   R2_BUCKET=pilingtrack-backups
   R2_ACCOUNT_ID=<your Cloudflare account id>
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret access key>
   ```
5. Test it manually:
   ```bash
   cd /opt/pilingtrack
   ENV_FILE=.env BACKUP_DIR=/var/backups/pilingtrack bash scripts/backup-postgres.sh
   ```
   Look for `✓ Off-site copy OK: R2:pilingtrack-backups/...` in the output.
   If `R2_BUCKET` is unset the script logs "Off-site copy skipped" and
   exits 0 — that's the safe default until the four env vars above exist.

---

## Daily health check (manual)

```bash
ls -lh /var/backups/pilingtrack/ | tail -5
journalctl -u pilingtrack-backup.service --since "yesterday" | tail -20
```

A dump for *today* should exist, log line `✓ Backup complete: <size>`
must be present, followed by `✓ Off-site copy OK: ...` (once R2 is
configured — see "Off-site copy" above). A `WARNING: off-site copy to
R2 failed` line means the local dump is fine but R2 needs attention.

---

## Restore — full DB recovery

> Stop the app and workers first so they don't write into a recovering DB.

```bash
ssh -i ~/.ssh/orionpiling user1@87.242.102.125
cd /opt/pilingtrack

# 1. Stop writers.
docker compose stop app workers ws

# 2. Pick the dump.
LATEST=$(ls -t /var/backups/pilingtrack/*.sql.gz | head -1)
echo "Restoring: $LATEST"

# 3. Drop + recreate target DB (DESTRUCTIVE).
set -a && . .env && set +a
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB WITH (FORCE);"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE $POSTGRES_DB;"

# 4. Restore.
gunzip -c "$LATEST" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" \
  pilingtrack-postgres pg_restore -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" --no-owner --no-privileges

# 5. Verify table count.
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
# Should print 43 (or current schema count).

# 6. Bring writers back.
docker compose up -d app workers ws
```

---

## Smoke-test (non-destructive — restore into a temp DB)

Run any time to confirm the dump is readable.

```bash
ssh -i ~/.ssh/orionpiling user1@87.242.102.125
cd /opt/pilingtrack
set -a && . .env && set +a
LATEST=$(ls -t /var/backups/pilingtrack/*.sql.gz | head -1)

docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE restore_test;"

gunzip -c "$LATEST" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" \
  pilingtrack-postgres pg_restore -U "$POSTGRES_USER" \
  -d restore_test --no-owner --no-privileges

# Compare table counts source vs restore — should be equal.
SRC=$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
DST=$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d restore_test -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
echo "src=$SRC restored=$DST"

docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" pilingtrack-postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE restore_test;"
```

Quarterly smoke-test is recommended — a broken dump that nobody
notices is worse than no backup at all.
