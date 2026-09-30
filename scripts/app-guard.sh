#!/usr/bin/env bash
# ============================================================
# PilingTrack — independent host-level app guard (dead-man switch)
# ============================================================
# Runs from a systemd timer ON THE HOST (not in Docker), so it still fires when
# the app itself is down. This closes the blind spot of R69 finding 1: every
# monitoring alert (including APIEndpointDown / TargetDown) is delivered by the
# very application whose failure it reports — Alertmanager POSTs to
# http://app:3000/api/alerts/webhook, which is dead in exactly that scenario.
# scripts/disk-guard.sh has the same blind spot: it also reports through the
# app's Alertmanager webhook.
#
# Therefore this guard sends its message to Telegram DIRECTLY, bypassing the
# app, Alertmanager, Prometheus and Docker entirely. It only watches: it never
# restarts containers.
#
# Rules: 3 consecutive failed health checks (2 min apart on the timer) => ONE
# "app is down" message. The message is sent once per outage (state file), and
# one "app answers again" message when it recovers.
#
# Secrets: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are read from the SAME compose
# .env as the rest of the deployment (names documented below). The
# token is handed to curl through stdin (--config -), never as a command-line
# argument, so it never appears in `ps`/`/proc/<pid>/cmdline`.
#
# Install (on the host, as root — do NOT run this from the repo checkout):
#   install -m 0755 scripts/app-guard.sh /opt/pilingtrack/scripts/app-guard.sh
#   install -m 0644 deploy/systemd/pilingtrack-app-guard.service /etc/systemd/system/
#   install -m 0644 deploy/systemd/pilingtrack-app-guard.timer   /etc/systemd/system/
#   systemctl daemon-reload
#   systemctl enable --now pilingtrack-app-guard.timer
#   systemctl list-timers pilingtrack-app-guard.timer
#   journalctl -u pilingtrack-app-guard.service -n 20 --no-pager
#
# Env (override via the systemd unit or an EnvironmentFile; otherwise read from
# $APP_GUARD_COMPOSE_DIR/.env):
#   APP_GUARD_COMPOSE_DIR   Dir holding .env. Default: /opt/pilingtrack
#   APP_GUARD_HEALTH_URL    URL to poll. Default: http://127.0.0.1:3000/api/health
#                           (port 3000 is the host mapping of the app container,
#                            docker-compose.yml ports "3000:3000")
#   APP_GUARD_FAIL_THRESHOLD  Consecutive failures before alerting. Default: 3
#   APP_GUARD_TIMEOUT_SEC   Per-check timeout. Default: 10
#   APP_GUARD_STATE_FILE    Failure counter + last reported state.
#                           Default: /run/pilingtrack-app-guard.state
#                           (use /var/lib/pilingtrack/app-guard.state to survive
#                            a reboot without losing the counter)
#   APP_GUARD_TELEGRAM_BOT_TOKEN / APP_GUARD_TELEGRAM_CHAT_ID
#                           Direct (infrastructure) bot. Fall back to
#                           TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in .env.
#   TELEGRAM_API_BASE       Telegram API root (the ISP blocks api.telegram.org
#                           from the VPS — in prod this is the Cloudflare Worker
#                           proxy). Default: https://api.telegram.org
# ============================================================

set -euo pipefail

COMPOSE_DIR="${APP_GUARD_COMPOSE_DIR:-/opt/pilingtrack}"
ENV_FILE="$COMPOSE_DIR/.env"
HEALTH_URL="${APP_GUARD_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
FAIL_THRESHOLD="${APP_GUARD_FAIL_THRESHOLD:-3}"
TIMEOUT="${APP_GUARD_TIMEOUT_SEC:-10}"
STATE_FILE="${APP_GUARD_STATE_FILE:-/run/pilingtrack-app-guard.state}"

# Read KEY= from .env (last occurrence wins). `|| true` keeps a non-matching
# grep from aborting the script under `set -e`.
env_get() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true
}

# .env values in this project are quoted (see .env.production.example).
strip_quotes() {
  local v="$1"
  v="${v%\"}"; v="${v#\"}"
  v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

pick() { # pick <env-var> <fallback-name-in-.env>
  local v="${1:-}"
  if [ -z "$v" ]; then v="$(env_get "$2")"; fi
  strip_quotes "$v"
}

TG_TOKEN="$(pick "${APP_GUARD_TELEGRAM_BOT_TOKEN:-}" "APP_GUARD_TELEGRAM_BOT_TOKEN")"
if [ -z "$TG_TOKEN" ]; then TG_TOKEN="$(pick "${TELEGRAM_BOT_TOKEN:-}" "TELEGRAM_BOT_TOKEN")"; fi
TG_CHAT_ID="$(pick "${APP_GUARD_TELEGRAM_CHAT_ID:-}" "APP_GUARD_TELEGRAM_CHAT_ID")"
if [ -z "$TG_CHAT_ID" ]; then TG_CHAT_ID="$(pick "${TELEGRAM_CHAT_ID:-}" "TELEGRAM_CHAT_ID")"; fi
TG_API_BASE="$(pick "${TELEGRAM_API_BASE:-}" "TELEGRAM_API_BASE")"
TG_API_BASE="${TG_API_BASE:-https://api.telegram.org}"

# ------------------------------------------------------------
# Telegram, directly — the whole point of this guard
# ------------------------------------------------------------
# The URL (and thus the bot token) and the body go to curl over stdin via
# `--config -`. Nothing secret touches argv, so `ps aux`, `/proc/*/cmdline` and
# journald stay clean. The message text must contain no double quote and no
# backslash, so no escaping is needed inside the curl config format.
send_telegram() {
  local text="$1"
  if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
    echo "app-guard: cannot notify — TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing in $ENV_FILE" >&2
    return 1
  fi
  curl -fsS --max-time 20 -o /dev/null --config - <<CFG
url = "$TG_API_BASE/bot$TG_TOKEN/sendMessage"
data-urlencode = "chat_id=$TG_CHAT_ID"
data-urlencode = "text=$text"
CFG
}

# ------------------------------------------------------------
# State: line 1 = consecutive failures, line 2 = last reported state (up|down)
# ------------------------------------------------------------
count=0
state="up"
if [ -f "$STATE_FILE" ]; then
  count="$(sed -n '1p' "$STATE_FILE" 2>/dev/null | tr -dc '0-9' || true)"
  state="$(sed -n '2p' "$STATE_FILE" 2>/dev/null | tr -dc 'a-z' || true)"
fi
case "$count" in ''|*[!0-9]*) count=0 ;; esac
case "$state" in up|down) ;; *) state="up" ;; esac

# Best-effort, same as disk-guard: a non-writable path on a manual run as a
# non-root user must not turn into a redirect error.
write_state() {
  ( umask 077; printf '%s\n%s\n' "$1" "$2" > "$STATE_FILE" ) 2>/dev/null || true
}

host="$(hostname)"

# ------------------------------------------------------------
# The single check
# ------------------------------------------------------------
if curl -fsS -o /dev/null --max-time "$TIMEOUT" "$HEALTH_URL"; then
  # Healthy. If we had reported an outage, say so exactly once.
  if [ "$state" = "down" ]; then
    msg="PilingTrack: приложение снова отвечает — $HEALTH_URL проходит проверку после $count неудачных подряд. Сторож app-guard (хост $host)."
    if ! send_telegram "$msg"; then
      # Keep state=down so the recovery message is retried on the next run.
      echo "app-guard: app is back ($HEALTH_URL) but the Telegram recovery message failed" >&2
      exit 1
    fi
    echo "app-guard: recovery message sent (was down, $count failed checks)"
  fi
  write_state 0 up
  exit 0
fi

# Unhealthy: count it, alert once per outage.
if [ "$count" -lt 100000 ]; then count=$((count + 1)); fi
if [ "$count" -ge "$FAIL_THRESHOLD" ] && [ "$state" != "down" ]; then
  msg="PilingTrack: приложение не отвечает — $count проверок подряд не прошли: $HEALTH_URL (таймаут ${TIMEOUT} с). Сервер $host. Проверь контейнер app (docker compose ps). Сторож app-guard, независим от приложения."
  if ! send_telegram "$msg"; then
    # state stays "up" and count is preserved, so the next run retries.
    echo "app-guard: $count failed checks but the Telegram alert failed" >&2
    write_state "$count" "$state"
    exit 1
  fi
  state="down"
  echo "app-guard: down alert sent ($count consecutive failures)"
fi
write_state "$count" "$state"
exit 0
