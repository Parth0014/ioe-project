# Usage: .\run_windows.ps1 (automatically finds the Wi-Fi board)
#        .\run_windows.ps1 -Port COM3
#        .\run_windows.ps1 -Demo
param(
    [string]$Port = "",
    [switch]$Demo,
    [string]$DeviceUrl = "",
    [int]$WebPort = 8765
)
$ErrorActionPreference = "Stop"
if (([int][bool]$Port + [int][bool]$Demo + [int][bool]$DeviceUrl) -gt 1) {
    throw "Choose only one of -Port, -Demo or -DeviceUrl"
}
Set-Location $PSScriptRoot
function Test-ProjectPython([string]$Candidate) {
    if (-not (Test-Path -LiteralPath $Candidate)) { return $false }
    try {
        & $Candidate -c "import sys" 2>$null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$cloudPython = Join-Path $PSScriptRoot ".venv-cloud\Scripts\python.exe"
if (-not (Test-ProjectPython $venvPython) -and (Test-ProjectPython $cloudPython)) {
    $venvPython = $cloudPython
}
if (-not (Test-ProjectPython $venvPython)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { py -m venv .venv }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { python -m venv .venv }
    else { throw "Install Python 3.10+ and enable Add Python to PATH, then reopen PowerShell." }
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Python environment" }
}
# Once installed, startup needs no package-index connection.
$dependenciesReady = $false
try {
    & $venvPython -c "import flask, serial, pymongo, dotenv" 2>$null
    $dependenciesReady = $LASTEXITCODE -eq 0
} catch { $dependenciesReady = $false }
if (-not $dependenciesReady) {
    & $venvPython -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare pip for the project environment" }
    & $venvPython -m pip install --disable-pip-version-check -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "Failed to install dependencies; first-time setup needs internet" }
}
$dashboardArgs = @("app.py", "--web-port", [string]$WebPort, "--open-browser")
if ($Demo) { $dashboardArgs += "--demo" }
elseif ($DeviceUrl) { $dashboardArgs += @("--device-url", $DeviceUrl) }
elseif ($Port) { $dashboardArgs += @("--port", $Port) }
Write-Host "Open http://127.0.0.1:$WebPort" -ForegroundColor Cyan
& $venvPython @dashboardArgs
