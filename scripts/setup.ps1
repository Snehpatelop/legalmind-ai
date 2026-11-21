# LegalMind AI - one-time local setup for Windows (no Docker needed).
# Run from the repo root:   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

Step "Checking the folder path length"
if ($Root.Length -gt 80) {
  Write-Host "WARNING: this folder path is $($Root.Length) characters long:" -ForegroundColor Yellow
  Write-Host "  $Root" -ForegroundColor Yellow
  Write-Host "  Windows limits paths to 260 characters and some Python packages (torch) have deep paths." -ForegroundColor Yellow
  Write-Host "  If installation fails, move the project to a short folder such as C:\dev\legalmind-ai" -ForegroundColor Yellow
}

Step "Finding Python 3.11 or 3.12"
$Py = $null
foreach ($v in @("3.11", "3.12")) {
  try { & py -$v -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { $Py = @("py", "-$v"); break } } catch {}
}
if (-not $Py) {
  try {
    $ver = & python -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"
    if ($ver -in @("3.11", "3.12")) { $Py = @("python") }
  } catch {}
}
if (-not $Py) { Fail "Python 3.11 or 3.12 is required. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH')." }
Write-Host "Using: $($Py -join ' ')"

Step "Checking Node.js (20 or newer)"
try { $nodeVer = (& node --version).TrimStart("v") } catch { Fail "Node.js 20+ is required. Install the LTS version from https://nodejs.org/" }
if ([int]($nodeVer.Split(".")[0]) -lt 20) { Fail "Node.js $nodeVer found, but 20+ is required." }
Write-Host "Node $nodeVer"

Step "Creating .env from .env.example"
if (-not (Test-Path ".env")) {
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  (Get-Content ".env.example") -replace "^JWT_SECRET=.*", "JWT_SECRET=$secret" | Set-Content ".env" -Encoding utf8
  Write-Host ".env created. Open it and paste your GEMINI_API_KEY (free: https://aistudio.google.com/apikey)." -ForegroundColor Yellow
} else { Write-Host ".env already exists - left unchanged." }

Step "Creating Python virtual environment (backend\.venv)"
if (-not (Test-Path "backend\.venv\Scripts\python.exe")) {
  $PyExe = $Py[0]; $PyArgs = @($Py | Select-Object -Skip 1)
  & $PyExe @PyArgs -m venv backend\.venv
  if ($LASTEXITCODE -ne 0) { Fail "Could not create the virtual environment." }
}
$VPy = Join-Path $Root "backend\.venv\Scripts\python.exe"
& $VPy -m pip install --upgrade pip --quiet

Step "Installing CPU-only PyTorch (about 200 MB, one time)"
& $VPy -m pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { Fail "PyTorch install failed. Check your internet connection or move the project to a shorter path." }

Step "Installing backend dependencies"
& $VPy -m pip install -r backend\requirements-dev.txt
if ($LASTEXITCODE -ne 0) { Fail "Backend dependency install failed." }

Step "Installing frontend dependencies"
Push-Location frontend
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm install failed." }
Pop-Location

Step "Downloading the embedding + reranker models (about 150 MB, one time)"
& $VPy -c "from sentence_transformers import SentenceTransformer, CrossEncoder; SentenceTransformer('BAAI/bge-small-en-v1.5'); CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2'); print('models ready')"

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Next: put your GEMINI_API_KEY in .env, then run:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1"
