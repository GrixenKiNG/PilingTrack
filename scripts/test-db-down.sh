#!/usr/bin/env bash
set -euo pipefail
name="${1:-}"
if [[ ! "$name" =~ ^codex-pg-[a-f0-9]{12}$ ]]; then
  echo 'Usage: bash scripts/test-db-down.sh codex-pg-<12 hex digits>' >&2
  exit 64
fi
label="$(docker inspect --format '{{ index .Config.Labels "pilingtrack.codex.test-db" }}' "$name")"
if [[ "$label" != '1' ]]; then
  echo 'Refusing to remove a container without the test-db ownership label' >&2
  exit 64
fi
docker rm -fv "$name" >/dev/null
