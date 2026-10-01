#!/usr/bin/env bash
# Restore only into a NEW labelled disposable container, never a supplied target.
set -euo pipefail
cd "$(dirname "$0")/.."
dump="${1:-}"
manifest="${2:-${dump}.manifest.json}"
if [[ -z "$dump" || ! -s "$dump" || ! -s "$manifest" ]]; then
  echo 'Usage: bash scripts/restore-drill.sh dump.sql.gz [dump.sql.gz.manifest.json]' >&2
  exit 64
fi
if ! gzip -t "$dump" 2>/dev/null; then
  echo 'Invalid gzip dump: refusing to create a container' >&2
  exit 65
fi
node scripts/restore-drill-verify.cjs "$dump" "$manifest"
suffix="$(node -e "process.stdout.write(require('node:crypto').randomBytes(6).toString('hex'))")"
name="codex-pg-$suffix"
export POSTGRES_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then bash scripts/test-db-down.sh "$name" >&2; fi
}
trap cleanup EXIT
started=$SECONDS
docker run -d --name "$name" --label pilingtrack.codex.test-db=1 \
  -e POSTGRES_USER=piling -e POSTGRES_DB=codex_test -e POSTGRES_PASSWORD postgres:16 >/dev/null
created=1
unset POSTGRES_PASSWORD
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$name" pg_isready -U piling -d codex_test >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Restore Postgres did not become ready' >&2; exit 1; }
gzip -dc "$dump" | docker exec -i "$name" pg_restore -U piling -d codex_test \
  --no-owner --no-acl --exit-on-error --single-transaction
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U piling -d codex_test < scripts/app-role-grants.sql >/dev/null
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U piling -d codex_test < scripts/identity-role-grants.sql >/dev/null
node scripts/restore-drill-verify.cjs "$dump" "$manifest" "$name"
printf 'Restore duration (synthetic local drill): %ss\n' "$((SECONDS - started))"
