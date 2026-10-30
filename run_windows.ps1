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
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { py -m venv .venv }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { python -m venv .venv }
    else { throw "Install Python 3.10+ and enable Add Python to PATH, then reopen PowerShell." }
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Python environment" }
}
& $venvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Failed to install dependencies" }
$args = @("server.py", "--web-port", [string]$WebPort, "--open-browser")
if ($Demo) { $args += "--demo" }
elseif ($DeviceUrl) { $args += @("--device-url", $DeviceUrl) }
elseif ($Port) { $args += @("--port", $Port) }
Write-Host "Open http://127.0.0.1:$WebPort" -ForegroundColor Cyan
& $venvPython @args
