@echo off
setlocal

cd /d "%~dp0"

echo Stopping PilingTrack on port 3000...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$connections = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "if (-not $connections) { Write-Host 'No process is listening on port 3000.'; exit 0 }; " ^
  "foreach ($procId in $connections) { if ($procId -and $procId -ne 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped process ' + $procId) } }"

endlocal
