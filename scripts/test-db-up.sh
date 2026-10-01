#!/usr/bin/env bash
# Stdout contains shell exports with generated, disposable credentials.
# Logs go to stderr. Evaluate the exports in the current shell; never commit them.
set -euo pipefail
cd "$(dirname "$0")/.."
for command in docker node npx; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
suffix="$(node -e "process.stdout.write(require('node:crypto').randomBytes(6).toString('hex'))")"
name="codex-pg-$suffix"
owner_password="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
app_password="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then bash scripts/test-db-down.sh "$name" >&2; fi
}
trap cleanup EXIT
export POSTGRES_PASSWORD="$owner_password"
docker run -d --name "$name" --label pilingtrack.codex.test-db=1 \
  -e POSTGRES_USER=piling -e POSTGRES_DB=codex_test -e POSTGRES_PASSWORD \
  -p 127.0.0.1::5432 postgres:16 >&2
created=1
unset POSTGRES_PASSWORD
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$name" pg_isready -U piling -d codex_test >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Disposable Postgres did not become ready' >&2; exit 1; }
port="$(docker port "$name" 5432/tcp)"
port="${port##*:}"
export INTEGRATION_DATABASE_URL_OWNER="postgresql://piling:$owner_password@127.0.0.1:$port/codex_test"
npx --no-install prisma migrate deploy --config prisma.integration.config.ts >&2
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U piling -d codex_test < scripts/app-role-grants.sql >&2
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U piling -d codex_test < scripts/identity-role-grants.sql >&2
printf "ALTER ROLE pilingtrack_app PASSWORD '%s';\n" "$app_password" | \
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U piling -d codex_test >&2
printf 'export INTEGRATION_DB_CONTAINER=%q\n' "$name"
printf 'export INTEGRATION_DATABASE_URL_OWNER=%q\n' "$INTEGRATION_DATABASE_URL_OWNER"
printf 'export INTEGRATION_DATABASE_URL_APP=%q\n' "postgresql://pilingtrack_app:$app_password@127.0.0.1:$port/codex_test"
created=0
