#!/usr/bin/env bash
# .claude/hooks/lib/common.sh
#
# Shared helpers for the security-reviewer hooks.
# Source this from each hook: . "$(dirname "$0")/lib/common.sh"
#
# All hooks emit JSON on stdout that conforms to Claude Code's hook contract:
#   { "hookSpecificOutput": { "hookEventName": "...", ... } }
#
# Plus they write human-readable progress to stderr (visible in Claude Code's
# transcript-mode log but not injected into the model context).

set -uo pipefail

# Resolve a Python interpreter that actually works. On Windows Git Bash,
# `python3` commonly resolves to the Microsoft Store app-execution-alias
# stub, which prints an install prompt to stderr and exits non-zero instead
# of running — silently breaking every python3-based check here (the guard
# would always fall through to "allow"). Probe candidates and cache the
# first one that runs real Python.
resolve_python() {
  if [[ -n "${SECURITY_REVIEWER_PY:-}" ]]; then
    printf '%s' "$SECURITY_REVIEWER_PY"
    return
  fi
  local candidate
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'pass' >/dev/null 2>&1; then
      SECURITY_REVIEWER_PY="$candidate"
      export SECURITY_REVIEWER_PY
      printf '%s' "$candidate"
      return
    fi
  done
  printf ''
}

# Project root — try git first, fall back to CWD
project_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Detect ecosystems by manifest presence. Prints one ecosystem per line.
detect_ecosystems() {
  local root; root="$(project_root)"
  local found=()

  [[ -f "$root/package.json" ]]       && found+=("nodejs")
  [[ -f "$root/pyproject.toml" ]] || [[ -f "$root/requirements.txt" ]] || [[ -f "$root/Pipfile" ]] || [[ -f "$root/setup.py" ]] && found+=("python")
  [[ -f "$root/go.mod" ]]             && found+=("go")
  [[ -f "$root/Cargo.toml" ]]         && found+=("rust")
  [[ -f "$root/pom.xml" ]] || ls "$root"/build.gradle* >/dev/null 2>&1 && found+=("java")
  [[ -f "$root/Gemfile" ]]            && found+=("ruby")
  ls "$root"/*.csproj >/dev/null 2>&1 || ls "$root"/*.sln >/dev/null 2>&1 && found+=("dotnet")
  [[ -f "$root/composer.json" ]]      && found+=("php")

  printf '%s\n' "${found[@]}" | awk 'NF' | sort -u
}

# Tool availability
have() { command -v "$1" >/dev/null 2>&1; }

# JSON-encode a string for safe inclusion in JSON output.
# Uses a working Python (see resolve_python) — falls back to jq if not.
# PYTHONIOENCODING=utf-8: on Windows, Python's stdin defaults to the console
# codepage (cp1252/cp866) rather than UTF-8, which mangles any non-ASCII
# character (e.g. em dash) read from stdin into mojibake before it's even
# JSON-encoded. Forcing UTF-8 here fixed it (verified during install).
jsonenc() {
  local py; py="$(resolve_python)"
  if [[ -n "$py" ]]; then
    PYTHONIOENCODING=utf-8 "$py" -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")'
  elif have jq; then
    jq -Rs .
  else
    # last-resort manual encoding — escapes the bare minimum
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g' -e 's/\r/\\r/g' -e 's/\t/\\t/g' \
      | awk 'BEGIN{printf "\""} {printf "%s", $0} END{printf "\""}'
  fi
}

# Emit a JSON hook response. $1 = hookEventName, $2 = key, $3 = value (already JSON-encoded).
emit_json() {
  local event="$1" key="$2" value="$3"
  printf '{"hookSpecificOutput":{"hookEventName":"%s","%s":%s}}\n' "$event" "$key" "$value"
}

# Log to stderr (won't pollute the JSON channel)
log() {
  printf '[security-reviewer] %s\n' "$*" >&2
}

# Cache directory under the project (gitignored by convention)
cache_dir() {
  local root; root="$(project_root)"
  local d="$root/.claude/.cache/security-reviewer"
  mkdir -p "$d"
  printf '%s' "$d"
}

# Read stdin into a variable, safely (handles empty input)
read_stdin() {
  if [[ -t 0 ]]; then
    printf ''
  else
    cat
  fi
}

# Extract a JSON field from stdin payload using Python (most portable).
# Usage: get_json_field <input> <jq-style.path>   (dotted path only, no arrays)
get_json_field() {
  local input="$1" path="$2"
  local py; py="$(resolve_python)"
  [[ -z "$py" ]] && { log "no working python interpreter found — get_json_field returning empty"; return; }
  PYTHONIOENCODING=utf-8 "$py" -c "
import json,sys
try:
    d = json.loads(sys.argv[1])
    for p in sys.argv[2].split('.'):
        if p == '': continue
        d = d.get(p) if isinstance(d, dict) else None
        if d is None: break
    print(d if d is not None else '')
except Exception:
    pass
" "$input" "$path" 2>/dev/null
}
