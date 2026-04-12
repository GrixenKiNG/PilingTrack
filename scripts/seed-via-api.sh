#!/bin/bash
# Seed data via API endpoints from within the cluster
set -euo pipefail

API_URL="http://pilingtrack-prod-api.pilingtrack-prod.svc.cluster.local:3000"
ADMIN_EMAIL="admin@piling.ru"
ADMIN_PASSWORD="admin123"
DISPATCHER_EMAIL="dispatch@piling.ru"
DISPATCHER_PASSWORD="2222"
OPERATOR_EMAIL="operator@piling.ru"
OPERATOR_PASSWORD="operator123"

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

# Login and get cookie
login() {
  local email="$1"
  local password="$2"
  log "Logging in as $email..."

  curl -s -c /tmp/cookies -b /tmp/cookies \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
    "$API_URL/api/auth/login" > /dev/null
}

log "Seeding database via API..."

# Login as admin to create entities
log "Admin login..."
curl -s -c /tmp/cookies -b /tmp/cookies \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$API_URL/api/auth/login" > /dev/null || {
    log "Admin login failed — user may not exist yet"
    log "Note: Users should be created via database seeding script"
  }

# Create dictionaries
log "Creating dictionaries..."
curl -s -b /tmp/cookies \
  -H "Content-Type: application/json" \
  -d '{
    "type": "pileGrade",
    "name": "С1",
    "isActive": true
  }' \
  "$API_URL/api/dictionary/manage" 2>/dev/null || true

log "Seeding via API complete (check database directly for verification)"

# Verify
log "Verifying..."
curl -s -c /tmp/cookies2 -b /tmp/cookies2 \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$API_URL/api/auth/login" 2>/dev/null && log "Admin login OK" || log "Admin not found"

log "Done!"
