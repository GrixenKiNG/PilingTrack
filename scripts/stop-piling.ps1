# Stop processes listening on PilingTrack ports.
# Kills Next.js dev/standalone (3000) and unified worker (3002) — the same
# ports that start.bat / start-prod.bat occupy.

$ErrorActionPreference = 'Continue'
$ports = @(3000, 3002)
$killed = 0

foreach ($port in $ports) {
  $procIds = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  if (-not $procIds) {
    Write-Host "  port $port - nothing listening"
    continue
  }

  foreach ($procId in $procIds) {
    if (-not $procId -or $procId -eq 0) { continue }
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host ("  port {0} - stopped {1} (PID {2})" -f $port, $proc.ProcessName, $procId)
      $killed++
    } catch {
      $msg = $_.Exception.Message
      Write-Warning ("  port {0} - failed to stop PID {1}: {2}" -f $port, $procId, $msg)
    }
  }
}

Write-Host ""
if ($killed -eq 0) {
  Write-Host "Nothing was running."
} else {
  Write-Host ("Stopped {0} process(es)." -f $killed)
}
