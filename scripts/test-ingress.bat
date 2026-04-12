@echo off
REM ========================================
REM PilingTrack — Full Access Test
REM Tests all endpoints via k8s port-forward
REM ========================================

set INGRESS=http://127.0.0.1:8080
set HOST=app.pilingtrack.local

echo ============================================
echo  PilingTrack — Endpoint Tests
echo ============================================
echo.

echo [1/6] Health Check...
curl -s -H "Host: %HOST%" %INGRESS%/api/health
echo.
echo.

echo [2/6] Readiness...
curl -s -H "Host: %HOST%" %INGRESS%/api/ready
echo.
echo.

echo [3/6] Login (admin)...
curl -s -X POST -H "Host: %HOST%" -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@piling.ru\",\"password\":\"admin123\"}" ^
  %INGRESS%/api/auth/login
echo.
echo.

echo [4/6] Get crews...
curl -s -H "Host: %HOST%" %INGRESS%/api/crews
echo.
echo.

echo [5/6] Get sites...
curl -s -H "Host: %HOST%" %INGRESS%/api/sites
echo.
echo.

echo [6/6] Get dictionaries...
curl -s -H "Host: %HOST%" %INGRESS%/api/dictionary/all
echo.
echo.

echo ============================================
echo  All tests completed!
echo ============================================
echo.
pause
