#!/usr/bin/env bash
# ============================================================
# PilingTrack — independent host-level disk guard
# ============================================================
# Runs from a systemd timer ON THE HOST (not in Docker), so it still fires when
# the Docker / Prometheus monitoring stack is itself a casualty of a full disk —
# the exact blind spot of the Prometheus HostDiskSpace* alerts, which live on
# the disk they watch and stop evaluating when the TSDB can no longer write.
#
# It POSTs a firing alert to the app's Alertmanager webhook (the same path the
# real alerts use), so delivery goes out over the existing Telegram notifier.
# The shared secret is read from the compose .env — no new secret to manage.
#
# Install: see deploy/systemd/pilingtrack-disk-guard.{service,timer}.
#
# Env (override via the systemd unit or an EnvironmentFile):
#   DISK_GUARD_COMPOSE_DIR   Dir holding .env. Default: /opt/pilingtrack
#   DISK_GUARD_THRESHOLD     Alert at/above this used%. Default: 85
#   DISK_GUARD_PATH          Filesystem to check. Default: /
#   DISK_GUARD_WEBHOOK_URL   App webhook. Default: http://localhost:3000/api/alerts/webhook
#   DISK_GUARD_COOLDOWN_SEC  Min seconds between alerts. Default: 21600 (6h)
# ============================================================

set -euo pipefail

COMPOSE_DIR="${DISK_GUARD_COMPOSE_DIR:-/opt/pilingtrack}"
THRESHOLD="${DISK_GUARD_THRESHOLD:-85}"
CHECK_PATH="${DISK_GUARD_PATH:-/}"
WEBHOOK_URL="${DISK_GUARD_WEBHOOK_URL:-http://localhost:3000/api/alerts/webhook}"
COOLDOWN="${DISK_GUARD_COOLDOWN_SEC:-21600}"
STAMP="/run/pilingtrack-disk-guard.last"

used="$(df -P "$CHECK_PATH" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [ "${used:-0}" -lt "$THRESHOLD" ]; then
  exit 0
fi

# Cooldown so a sustained full disk doesn't re-alert every run.
now="$(date +%s)"
if [ -f "$STAMP" ]; then
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [ $((now - last)) -lt "$COOLDOWN" ]; then
    exit 0
  fi
fi

token="$(grep -E '^ALERTMANAGER_WEBHOOK_TOKEN=' "$COMPOSE_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
if [ -z "$token" ]; then
  echo "disk-guard: disk ${used}% >= ${THRESHOLD}% but ALERTMANAGER_WEBHOOK_TOKEN missing in $COMPOSE_DIR/.env" >&2
  exit 1
fi

avail="$(df -Ph "$CHECK_PATH" | awk 'NR==2 {print $4}')"
host="$(hostname)"
payload="$(printf '{"alerts":[{"status":"firing","labels":{"alertname":"HostDiskGuard","severity":"critical","service":"host"},"annotations":{"summary":"%s: disk %s at %s%% used (%s free)","description":"Independent host disk guard. Free space (docker builder prune, logs) before it reaches 100%%."}}]}' "$host" "$CHECK_PATH" "$used" "$avail")"

if curl -fsS --max-time 20 -X POST "$WEBHOOK_URL" \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $token" \
     -d "$payload" >/dev/null; then
  mkdir -p "$(dirname "$STAMP")" 2>/dev/null || true
  echo "$now" > "$STAMP" 2>/dev/null || true
  echo "disk-guard: alert sent (disk ${used}%)"
else
  echo "disk-guard: disk ${used}% but webhook POST failed" >&2
  exit 1
fi
