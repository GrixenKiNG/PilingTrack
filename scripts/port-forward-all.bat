@echo off
REM ========================================
REM PilingTrack — Local Access Setup
REM Opens port-forwards for all services
REM ========================================

echo ============================================
echo  PilingTrack — Local Access Setup
echo ============================================
echo.

REM 1. Ingress Controller → localhost:8080 (API via Ingress)
echo [1/4] Starting Ingress port-forward (port 8080)...
start "Ingress (API)" cmd /k "kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80"

REM 2. Grafana → localhost:3010
echo [2/4] Starting Grafana port-forward (port 3010)...
start "Grafana" cmd /k "kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 3010:80 --address 127.0.0.1"

REM 3. PostgreSQL → localhost:5432
echo [3/4] Starting PostgreSQL port-forward (port 5432)...
start "PostgreSQL" cmd /k "kubectl port-forward -n pilingtrack-prod svc/postgresql 5432:5432 --address 127.0.0.1"

REM 4. Redis → localhost:6379
echo [4/4] Starting Redis port-forward (port 6379)...
start "Redis" cmd /k "kubectl port-forward -n pilingtrack-prod svc/redis-master 6379:6379 --address 127.0.0.1"

echo.
echo ============================================
echo  All services started!
echo ============================================
echo.
echo  API:       http://localhost:8080 (via Ingress, Host: app.pilingtrack.local)
echo  Grafana:   http://localhost:3010 (admin/admin) — NEEDS separate Grafana container
echo  PostgreSQL: localhost:5432 (user: postgres, pass: pilingtrack)
echo  Redis:     localhost:6379
echo.
echo  To test API:
echo    curl -H "Host: app.pilingtrack.local" http://localhost:8080/api/health
echo.
pause
