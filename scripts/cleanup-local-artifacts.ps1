$ErrorActionPreference = 'Continue'

$artifacts = @(
  '.next',
  'coverage',
  'playwright-report',
  'test-results',
  'blob-report',
  'release',
  'releases',
  'test-screenshots',
  'test-screenshots-new',
  'output\playwright'
)

$patterns = @(
  '*.log',
  '*.out.log',
  '*.err.log',
  'tmp-*.json',
  'tmp-*.pdf',
  'tmp-*.txt',
  'tmp-*.log',
  'tmp-*.prisma',
  '*.zip'
)

foreach ($path in $artifacts) {
  if (Test-Path -LiteralPath $path) {
    try {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      Write-Host "Removed $path"
    } catch {
      Write-Warning "Skipped ${path}: $($_.Exception.Message)"
    }
  }
}

foreach ($pattern in $patterns) {
  Get-ChildItem -LiteralPath . -Filter $pattern -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      try {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
        Write-Host "Removed $($_.Name)"
      } catch {
        Write-Warning "Skipped $($_.Name): $($_.Exception.Message)"
      }
    }
}
