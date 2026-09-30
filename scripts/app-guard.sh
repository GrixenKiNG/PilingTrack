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
# Secrets: the PRIMARY source is the systemd EnvironmentFile
# /etc/pilingtrack/app-guard.env (see deploy/systemd/pilingtrack-app-guard.service)
# — on the prod host the app's bot lives in the database, so TELEGRAM_BOT_TOKEN
# is not in the compose .env at all. Reading TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
# from $APP_GUARD_COMPOSE_DIR/.env is only a fallback. The token is handed to curl
# through stdin (--config -), never as a command-line argument, so it never
# appears in `ps`/`/proc/<pid>/cmdline`.
#
# Install (on the host, as root — do NOT run this from the repo checkout):
#   install -m 0755 scripts/app-guard.sh /opt/pilingtrack/scripts/app-guard.sh
#   install -m 0644 deploy/systemd/pilingtrack-app-guard.service /etc/systemd/system/
#   install -m 0644 deploy/systemd/pilingtrack-app-guard.timer   /etc/systemd/system/
#
#   1) Credentials for the guard's own (infrastructure) bot. The values are NOT
#      in this repo — do not invent them. The file must stay root-owned, mode 0600:
#        install -d -m 0755 /etc/pilingtrack
#        install -m 0600 /dev/null /etc/pilingtrack/app-guard.env
#        # then edit it (keep owner root:root, mode 0600) and put three lines:
#        #   APP_GUARD_TELEGRAM_BOT_TOKEN=<token of the infrastructure bot>
#        #   APP_GUARD_TELEGRAM_CHAT_ID=<chat to alert>
#        #   TELEGRAM_API_BASE=<API root; in prod the Cloudflare Worker proxy>
#
#   2) State directory — only if you use the recommended
#      APP_GUARD_STATE_FILE=/var/lib/pilingtrack/app-guard.state (the default
#      /run/... is wiped on reboot and loses the counter):
#        install -d -m 0700 /var/lib/pilingtrack
#
#   3) Prove delivery BEFORE enabling the timer. A manual run does not inherit
#      the unit's EnvironmentFile, so read it in for the test:
#        set -a; . /etc/pilingtrack/app-guard.env; set +a
#        /opt/pilingtrack/scripts/app-guard.sh --test
#        systemctl daemon-reload
#        systemctl enable --now pilingtrack-app-guard.timer
#        systemctl list-timers pilingtrack-app-guard.timer
#        journalctl -u pilingtrack-app-guard.service -n 20 --no-pager
#
# Env (from the unit's EnvironmentFile, an Environment= override in the unit, or —
# for bot/chat/api-base only — from $APP_GUARD_COMPOSE_DIR/.env):
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
#                           Direct (infrastructure) bot, from the
#                           EnvironmentFile. Fall back to
#                           TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in .env.
#   TELEGRAM_API_BASE       Telegram API root (the ISP blocks api.telegram.org
#                           from the VPS — in prod this is the Cloudflare Worker
#                           proxy). Default: https://api.telegram.org
#
# Usage:
#   app-guard.sh          one check (what the systemd timer runs)
#   app-guard.sh --test   send one probe message and exit 0/1; touches no state
# ============================================================

set -euo pipefail

COMPOSE_DIR="${APP_GUARD_COMPOSE_DIR:-/opt/pilingtrack}"
ENV_FILE="$COMPOSE_DIR/.env"
HEALTH_URL="${APP_GUARD_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
FAIL_THRESHOLD="${APP_GUARD_FAIL_THRESHOLD:-3}"
TIMEOUT="${APP_GUARD_TIMEOUT_SEC:-10}"
STATE_FILE="${APP_GUARD_STATE_FILE:-/run/pilingtrack-app-guard.state}"
STATE_DIR="$(dirname "$STATE_FILE")"
# The systemd EnvironmentFile that carries this guard's own credentials
# (see the install header above and deploy/systemd/pilingtrack-app-guard.service).
GUARD_ENV_FILE="${APP_GUARD_ENV_FILE:-/etc/pilingtrack/app-guard.env}"

# ------------------------------------------------------------
# Secrets: environment (the systemd EnvironmentFile) first, .env only as fallback
# ------------------------------------------------------------
# Read KEY= from .env (last occurrence wins). `|| true` keeps a non-matching
# grep (or a missing file) from aborting the script under `set -e`.
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

# A value that ends up inside the curl --config stream must not contain a double
# quote, a backslash or a newline: `--config -` keeps the token out of argv, it
# does not make the config format escape-proof — such a value would change how
# curl parses it. Reject it instead of injecting it. The message texts are our
# own strings and contain none of these characters.
reject_unsafe_value() { # reject_unsafe_value <what> <value>
  case "$2" in
    *'"'* | *'\'* | *$'\n'* | *$'\r'*)
      echo "app-guard: refusing to use $1 — it contains a double quote, a backslash or a newline" >&2
      return 1
      ;;
  esac
  return 0
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
# backslash; credentials that would break the config parsing are rejected here.
send_telegram() {
  local text="$1"
  if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
    echo "app-guard: cannot notify — no Telegram credentials. Set APP_GUARD_TELEGRAM_BOT_TOKEN/APP_GUARD_TELEGRAM_CHAT_ID in $GUARD_ENV_FILE (or fall back to TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID in $ENV_FILE)" >&2
    return 1
  fi
  reject_unsafe_value "APP_GUARD_TELEGRAM_BOT_TOKEN" "$TG_TOKEN" || return 1
  reject_unsafe_value "APP_GUARD_TELEGRAM_CHAT_ID" "$TG_CHAT_ID" || return 1
  reject_unsafe_value "TELEGRAM_API_BASE" "$TG_API_BASE" || return 1
  reject_unsafe_value "the message text" "$text" || return 1
  curl -fsS --max-time 20 -o /dev/null --config - <<CFG
url = "$TG_API_BASE/bot$TG_TOKEN/sendMessage"
data-urlencode = "chat_id=$TG_CHAT_ID"
data-urlencode = "text=$text"
CFG
}

# ------------------------------------------------------------
# State: line 1 = consecutive failures, line 2 = last reported state (up|down)
# Written atomically — a temp file in the same directory, then mv — so a crash or
# a full disk can never leave a half-written counter. A write failure is FATAL
# and reported on stderr: swallowing it (the old `|| true`) made every run start
# the counter from zero, so with a missing state directory the threshold was
# never reached and no alert was ever sent (Codex review of d2aecd13).
# ------------------------------------------------------------
write_state() { # write_state <count> <state>
  local tmp
  tmp="$(umask 077; mktemp "$STATE_DIR/.app-guard.state.XXXXXX")" || {
    echo "app-guard: cannot create a temporary state file in $STATE_DIR (STATE_FILE=$STATE_FILE)" >&2
    return 1
  }
  if ! printf '%s\n%s\n' "$1" "$2" > "$tmp"; then
    rm -f "$tmp"
    echo "app-guard: cannot write the temporary state file $tmp" >&2
    return 1
  fi
  if ! mv -f "$tmp" "$STATE_FILE"; then
    rm -f "$tmp"
    echo "app-guard: cannot move $tmp to STATE_FILE=$STATE_FILE" >&2
    return 1
  fi
  return 0
}

# ------------------------------------------------------------
# Arguments
# ------------------------------------------------------------
TEST_MODE=0
case "${1:-}" in
  "") ;;
  --test) TEST_MODE=1 ;;
  *)
    echo "app-guard: unknown argument '$1' (only --test is supported)" >&2
    exit 2
    ;;
esac

# --test: prove delivery (credentials, network, proxy) BEFORE the timer is
# enabled. Sends one probe message, touches neither the health URL nor the state.
if [ "$TEST_MODE" = 1 ]; then
  if send_telegram "PilingTrack: проверка сторожа app-guard"; then
    echo "app-guard: test message sent"
    exit 0
  fi
  echo "app-guard: test message FAILED — check the credentials in $GUARD_ENV_FILE and TELEGRAM_API_BASE ($TG_API_BASE)" >&2
  exit 1
fi

# ------------------------------------------------------------
# State: read it back
# ------------------------------------------------------------
if [ ! -d "$STATE_DIR" ]; then
  echo "app-guard: state directory $STATE_DIR does not exist (STATE_FILE=$STATE_FILE) — create it at install time: install -d -m 0700 $STATE_DIR" >&2
  exit 2
fi

count=0
state="up"
if [ -f "$STATE_FILE" ]; then
  count="$(sed -n '1p' "$STATE_FILE" 2>/dev/null | tr -dc '0-9' || true)"
  state="$(sed -n '2p' "$STATE_FILE" 2>/dev/null | tr -dc 'a-z' || true)"
fi
case "$count" in ''|*[!0-9]*) count=0 ;; esac
case "$state" in up|down) ;; *) state="up" ;; esac

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
  write_state 0 up || exit 2
  exit 0
fi

# Unhealthy: count it, alert once per outage.
if [ "$count" -lt 100000 ]; then count=$((count + 1)); fi
if [ "$count" -ge "$FAIL_THRESHOLD" ] && [ "$state" != "down" ]; then
  msg="PilingTrack: приложение не отвечает — $count проверок подряд не прошли: $HEALTH_URL (таймаут ${TIMEOUT} с). Сервер $host. Проверь контейнер app (docker compose ps). Сторож app-guard, независим от приложения."
  if ! send_telegram "$msg"; then
    # state stays "up" and count is preserved, so the next run retries.
    echo "app-guard: $count failed checks but the Telegram alert failed" >&2
    write_state "$count" "$state" || exit 2
    exit 1
  fi
  state="down"
  echo "app-guard: down alert sent ($count consecutive failures)"
fi
write_state "$count" "$state" || exit 2
exit 0
