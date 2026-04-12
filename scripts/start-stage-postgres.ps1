$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'docker-compose.production.yml'

Write-Host 'Starting local PostgreSQL stage container...'
docker compose -f $composeFile up -d postgres

Write-Host 'Waiting for PostgreSQL healthcheck...'
docker compose -f $composeFile ps
