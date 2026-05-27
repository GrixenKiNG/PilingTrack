# Local PilingTrack DB backup.
# Dumps the local dev database (Docker container `pilingtrack-postgres`,
# db `pilingtrack_test`) to backups\ as a gzipped plain-SQL file, then keeps
# only the most recent N copies. Intended to run every 3 days via Windows
# Task Scheduler (see scripts\register-backup-task.ps1).
#
# Restore:  gunzip -c <file>.sql.gz | docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test

$ErrorActionPreference = 'Stop'

$container = 'pilingtrack-postgres'
$dbUser    = 'postgres'
$dbName    = 'pilingtrack_test'
$keep      = 10
$backupDir = Join-Path $PSScriptRoot '..\backups'

if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }

# Skip silently if the local DB container isn't running (laptop off / stack down).
$running = docker ps --filter "name=$container" --filter 'status=running' --format '{{.Names}}'
if ($running -notcontains $container) {
    Write-Output ("[{0}] {1} not running - backup skipped." -f (Get-Date -Format s), $container)
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$name  = 'local_' + $dbName + '_' + $stamp + '.sql.gz'
$dest  = Join-Path $backupDir $name
$tmp   = '/tmp/' + $name

# Dump + gzip inside the container (binary-safe), copy out, clean up.
docker exec $container sh -c "pg_dump -U $dbUser -d $dbName | gzip -c > $tmp"
docker cp ($container + ':' + $tmp) $dest
docker exec $container rm -f $tmp

$sizeKb = [math]::Round((Get-Item $dest).Length / 1024)
Write-Output ("[{0}] backup written: {1} ({2} KB)" -f (Get-Date -Format s), $name, $sizeKb)

# Rotation: keep only the newest $keep dumps.
$pattern = 'local_' + $dbName + '_*.sql.gz'
Get-ChildItem -Path $backupDir -Filter $pattern |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $keep |
    ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Output ('pruned old backup: ' + $_.Name)
    }
