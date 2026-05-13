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

> **Off-site copy is NOT configured.** Dumps live on the same VPS as
> the database — if the VPS itself is lost (datacenter incident,
> account suspension, disk corruption beyond the LVM layer), the
> backups go with it. Wire `rclone` to an external bucket via the
> commented hook in `scripts/backup-postgres.sh:62` when this matters.

---

## Daily health check (manual)

```bash
ls -lh /var/backups/pilingtrack/ | tail -5
journalctl -u pilingtrack-backup.service --since "yesterday" | tail -20
```

A dump for *today* should exist, log line `✓ Backup complete: <size>`
must be present.

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
