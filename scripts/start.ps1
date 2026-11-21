# LegalMind AI - start backend + frontend locally on Windows (after scripts\setup.ps1).
# Run from the repo root:   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$VPy = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $VPy)) { Write-Host "Run scripts\setup.ps1 first." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $Root "frontend\node_modules"))) { Write-Host "Run scripts\setup.ps1 first." -ForegroundColor Red; exit 1 }

Write-Host "Starting backend on http://127.0.0.1:8000 (API docs: /docs) ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "`$host.UI.RawUI.WindowTitle='LegalMind backend'; Set-Location '$Root\backend'; & '$VPy' -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
)

Write-Host "Starting frontend on http://localhost:5173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "`$host.UI.RawUI.WindowTitle='LegalMind frontend'; Set-Location '$Root\frontend'; npm run dev"
)

Write-Host "Waiting for the backend to become healthy (first start loads the ML models)..."
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8000/api/health" -TimeoutSec 2).StatusCode -eq 200) { $ok = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if ($ok) {
  Write-Host "Ready! Opening http://localhost:5173" -ForegroundColor Green
  Start-Process "http://localhost:5173"
} else {
  Write-Host "Backend did not respond yet - check the 'LegalMind backend' window for errors." -ForegroundColor Yellow
}
Write-Host "Close the two PowerShell windows to stop LegalMind AI."
