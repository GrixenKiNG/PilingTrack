@echo off
REM ========================================
REM PilingTrack — API Access via Ingress
REM Forwards k8s Ingress to localhost:8080
REM ========================================

echo ============================================
echo  PilingTrack — API Access
echo ============================================
echo.
echo Starting Ingress port-forward...
echo.
echo  API URL: http://localhost:8080
echo  Host header: app.pilingtrack.local
echo.
echo Test with:
echo   curl -H "Host: app.pilingtrack.local" http://localhost:8080/api/health
echo.
echo Press Ctrl+C to stop
echo ============================================
echo.

kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80 --address 127.0.0.1
