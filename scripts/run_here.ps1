param(
  [int]$Port = 8509,
  [switch]$SetupOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$venvDir = Join-Path $env:LOCALAPPDATA 'lottery_stats_runtime\.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
    Write-Host "Setting up virtual environment at $venvDir ..."
    $basePython = Get-Command py -ErrorAction SilentlyContinue
    if (-not $basePython) { $basePython = Get-Command python -ErrorAction SilentlyContinue }
    if (-not $basePython) {
        Write-Host ""
        Write-Host "[ERROR] No system Python found. Install from https://www.python.org/downloads/"
        Write-Host ""
        exit 1
    }
    & $basePython.Source -m venv $venvDir
}

Write-Host "Installing/updating dependencies..."
& $venvPython -m pip install --upgrade pip *> $null
& $venvPython -m pip install -r (Join-Path $root 'requirements-api.txt')
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Failed to install dependencies."
    Write-Host ""
    exit 1
}

if ($SetupOnly) {
    Write-Host "Setup complete. Skipping server start (-SetupOnly)."
    exit 0
}

Write-Host ""
Write-Host "Thai Lottery Dashboard"
Write-Host "URL: http://localhost:$Port"
Write-Host "Browser will open once the local server responds."
Write-Host "Press Ctrl+C to stop"
Write-Host ""
$readinessScript = Join-Path $PSScriptRoot 'open_when_ready.ps1'
$readinessArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Port {1} -TimeoutSeconds 30' -f $readinessScript, $Port
$powerShellExe = if ($PSVersionTable.PSEdition -eq 'Core') {
    Join-Path $PSHOME 'pwsh.exe'
} else {
    Join-Path $PSHOME 'powershell.exe'
}
Start-Process -FilePath $powerShellExe -ArgumentList $readinessArgs -WindowStyle Hidden | Out-Null
& $venvPython -m uvicorn main:app --host 127.0.0.1 --port $Port --reload
