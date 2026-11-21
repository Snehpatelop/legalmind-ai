# Run all automated tests (backend pytest + frontend vitest) on Windows.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Push-Location "$Root\backend"; & ".\.venv\Scripts\python.exe" -m pytest; $b = $LASTEXITCODE; Pop-Location
Push-Location "$Root\frontend"; npm test; $f = $LASTEXITCODE; Pop-Location
if ($b -ne 0 -or $f -ne 0) { Write-Host "Some tests failed" -ForegroundColor Red; exit 1 }
Write-Host "All tests passed" -ForegroundColor Green
