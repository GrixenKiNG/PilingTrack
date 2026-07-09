# Runbook: Point-in-time recovery (PITR)

> ## ⚠️ PITR СЕЙЧАС НЕДОСТУПЕН (с 2026-06-24)
>
> `archive_mode=off` в `docker-compose.prod.yml` — осознанное решение после
> инцидента, когда сломанный `archive_command` накопил 9,6 ГБ WAL и заполнил
> диск до 100 %. WAL-архив пуст, восстановление «на любую секунду» из этого
> runbook **невозможно**.
>
> **Фактически доступно сегодня:** ночной logical dump (runbook 006, локально
> + off-site в Cloudflare R2) и еженедельный basebackup. **Реальный RPO — до
> ~24 часов** (последний ночной дамп), не секунды. Таймер
> `pilingtrack-pitr-basebackup` делает только базовую копию, без WAL.
>
> Всё ниже — инструкция на случай, если WAL-архивирование решат включить
> обратно (с починенным no-clobber `archive_command` и мониторингом
> `pg_stat_archiver`). До этого раздел «Restore» этого runbook неприменим.

| Metadata | Value |
|---|---|
| **Severity** | 🟢 preventive / 🔴 P0 during restore |
| **SLA** | ~~Restore < 60 min to any second~~ — недоступно, см. предупреждение выше |
| **Owned by** | Whoever holds prod SSH |

PITR is the *layer on top of* the nightly logical dump (runbook 006). The
logical dump gives daily granularity. PITR gives **second-level** granularity
by replaying WAL files between a base backup and the chosen recovery point.

Both are kept. If WAL/archive is corrupted, you still have the nightly
dump from runbook 006. If the nightly dump is corrupted, you still have
PITR. They fail independently.

---

## How it works (one-paragraph version)

Postgres ships every completed WAL segment to a host directory
(`/opt/pilingtrack/wal-archive/`) via `archive_command`. Once a week we
run `pg_basebackup` to capture a full file-level snapshot
(`/opt/pilingtrack/basebackups/base-YYYYMMDD-*.tar.gz`). To restore to a
moment `T`: start from the most recent base backup ≤ T, then replay
WAL up to T.

---

## Setup (one time, on orionpiling.ru)

```bash
# 1. Create directories with the right owner. uid 70 is the postgres user
#    inside the alpine container — it must be able to write WAL files.
sudo mkdir -p /opt/pilingtrack/wal-archive /opt/pilingtrack/basebackups
sudo chown 70:70 /opt/pilingtrack/wal-archive
sudo chown user1:user1 /opt/pilingtrack/basebackups
sudo chmod 700 /opt/pilingtrack/wal-archive

# 2. Pull the new docker-compose config and recreate just postgres so
#    archive_mode takes effect. This briefly restarts the DB (~5 sec).
cd /opt/pilingtrack
git pull origin main
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate postgres

# 3. Verify archive_mode is on:
docker compose exec postgres psql -U piling -d pilingtrack \
  -c "SHOW archive_mode; SHOW archive_command;"

# 4. Force a WAL switch so the first segment lands in the archive
#    (otherwise the first base backup has no .backup label):
docker compose exec postgres psql -U piling -d pilingtrack \
  -c "SELECT pg_switch_wal();"

# 5. Install the systemd timer for weekly base backups:
sudo install -m 644 deploy/systemd/pilingtrack-pitr-basebackup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/pilingtrack-pitr-basebackup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pilingtrack-pitr-basebackup.timer

# 6. Take the FIRST base backup immediately (don't wait for Sunday):
sudo systemctl start pilingtrack-pitr-basebackup.service
sudo journalctl -u pilingtrack-pitr-basebackup.service -n 50

# 7. Verify the base backup is present:
ls -lh /opt/pilingtrack/basebackups/

# 8. Verify WAL is being archived (file count grows over time):
ls -1 /opt/pilingtrack/wal-archive/ | wc -l
```

Verify timer:
```bash
systemctl list-timers pilingtrack-pitr-basebackup.timer
```

---

## Smoke test (MUST do at setup)

Before you trust PITR, do one full restore into a throwaway DB.
A backup you never restore is not a backup — it's a hope.

```bash
# Pick the latest base backup
BASE=$(ls -1 /opt/pilingtrack/basebackups/base-*.tar.gz | sort | tail -1)
echo "Restoring from $BASE"

# Make a workspace matching prod's PG18 layout
sudo mkdir -p /tmp/pitr-test/pg-volume/18/docker
sudo chown -R 70:70 /tmp/pitr-test

# Unpack base into the workspace
sudo tar xzf "$BASE" -C /tmp/pitr-test/pg-volume/18/docker
sudo chown -R 70:70 /tmp/pitr-test/pg-volume

# Tell Postgres how to find the WAL archive when it replays. Use echo|tee
# instead of a heredoc — heredocs with indented terminators break when
# pasted through some SSH terminals.
echo "restore_command = 'cp /var/lib/postgresql/wal-archive/%f %p'" \
  | sudo tee /tmp/pitr-test/pg-volume/18/docker/postgresql.auto.conf
sudo touch /tmp/pitr-test/pg-volume/18/docker/recovery.signal
sudo chown 70:70 /tmp/pitr-test/pg-volume/18/docker/postgresql.auto.conf \
                /tmp/pitr-test/pg-volume/18/docker/recovery.signal

# Start a temporary Postgres pointing at the unpacked base + WAL archive.
# Different port (5433) so it doesn't fight the live container.
#
# CRITICAL: pass the SAME tuning params the primary uses. Postgres aborts
# recovery with "recovery aborted because of insufficient parameter
# settings" if max_connections (and a few others) are lower than what
# the primary had at backup time. Keep this list in sync with the
# postgres command in docker-compose.prod.yml.
#
# PG18 docker image: PGDATA lives at /var/lib/postgresql/<MAJOR>/docker
# so we mount the parent (/var/lib/postgresql), and unpack the base
# tarball into /tmp/pitr-test/pg-volume/18/docker on the host.
docker run --rm -d --name pitr-test \
  -e POSTGRES_PASSWORD=ignored \
  -v /tmp/pitr-test/pg-volume:/var/lib/postgresql \
  -v /opt/pilingtrack/wal-archive:/var/lib/postgresql/wal-archive:ro \
  -p 127.0.0.1:5433:5432 \
  postgres:18-alpine \
  postgres -c max_connections=200 -c shared_buffers=256MB -c wal_level=replica

# Wait until recovery pauses (logs should say "recovery has paused")
docker logs -f pitr-test
# Ctrl-C once you see "recovery has paused" or "consistent recovery state reached"

# Smoke-check: connect and count reports
docker exec -it pitr-test psql -U piling -d pilingtrack \
  -c 'SELECT count(*) FROM "Report";'

# Tear down
docker stop pitr-test
sudo rm -rf /tmp/pitr-test
```

If you saw a sensible row count and no errors, PITR is real. If recovery
fails — most likely WAL gap or permission issue — STOP and triage before
relying on this.

---

## Real restore (production has been corrupted at time T)

This destroys the current `pilingtrack` DB. Stop the app first.

```bash
# 0. Decide the recovery point. Examples:
#    - "5 minutes ago"       → 2026-05-24 12:30:00+03
#    - "before the bad deploy" → look at git log for the deploy time
TARGET="2026-05-24 12:30:00+03"

# 1. Stop the app + workers (keeps writing during restore = lost data)
cd /opt/pilingtrack
docker compose stop app workers workers-pdf ws

# 2. Stop Postgres (we will replace its data directory)
docker compose stop postgres

# 3. Back up the corrupted PGDATA in case the restore goes wrong and you
#    need to forensics-investigate later. ~12 MB so cheap.
sudo cp -a /var/lib/docker/volumes/pilingtrack_postgres_data /var/lib/docker/volumes/pilingtrack_postgres_data.bak-$(date +%Y%m%d-%H%M%S)

# 4. Wipe and re-unpack the base backup INTO the docker volume.
#    Adjust the path if your Docker root is non-default.
PGDATA=/var/lib/docker/volumes/pilingtrack_postgres_data/_data/18/docker
sudo rm -rf "$PGDATA"
sudo mkdir -p "$PGDATA"
BASE=$(ls -1 /opt/pilingtrack/basebackups/base-*.tar.gz | sort | tail -1)
sudo tar xzf "$BASE" -C "$PGDATA"
sudo chown -R 70:70 "$PGDATA"

# 5. Configure recovery
sudo tee "$PGDATA/postgresql.auto.conf" > /dev/null <<CONF
restore_command = 'cp /var/lib/postgresql/wal-archive/%f %p'
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'
CONF
sudo touch "$PGDATA/recovery.signal"
sudo chown 70:70 "$PGDATA/postgresql.auto.conf" "$PGDATA/recovery.signal"

# 6. Start Postgres — it will replay WAL up to TARGET then promote.
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
docker compose logs -f postgres
# Wait for "archive recovery complete" / "database system is ready to accept connections"

# 7. Smoke check
docker compose exec postgres psql -U piling -d pilingtrack \
  -c 'SELECT count(*) FROM "Report"; SELECT max("createdAt") FROM "Report";'

# 8. Bring the app back
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Monitoring & failure modes

- **`archive_command` keeps failing.** Postgres will refuse to recycle
  WAL → disk fills → DB stops accepting writes. Symptoms in
  `docker compose logs postgres`: "archive command failed". Fix is
  usually permissions on `/opt/pilingtrack/wal-archive/`. After fixing,
  Postgres retries automatically.
- **No base backup ≤ TARGET.** You can only restore as far back as the
  oldest base backup. With 4-week retention, max is ~28 days.
- **WAL gap.** If a WAL file was deleted but later WAL still exists,
  recovery halts at the gap. Don't manually delete WAL — let
  `scripts/pitr-basebackup.sh` handle cleanup via `pg_archivecleanup`.
- **Off-site.** WAL + base backups live on the same VPS as the DB. If
  the VPS dies, both are gone. Off-site is a separate concern — see the
  strategy backlog. The nightly logical dump in runbook 006 is also on
  the same VPS, so this is consistent with the current risk posture.

---

## Health checks

Add to your weekly review:

```bash
# WAL accumulation — should be roughly constant after a base backup,
# not unbounded growth.
du -sh /opt/pilingtrack/wal-archive/
ls -1 /opt/pilingtrack/wal-archive/ | wc -l

# Base backups present
ls -lh /opt/pilingtrack/basebackups/

# Last successful base backup
systemctl status pilingtrack-pitr-basebackup.timer
journalctl -u pilingtrack-pitr-basebackup.service --since "8 days ago" | tail -20
```
