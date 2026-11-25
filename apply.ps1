$ErrorActionPreference = 'Stop'
$resDir = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources'
$asar = Join-Path $resDir 'app.asar'
$staged = Join-Path $resDir 'app.asar.mcp-panel.staged'
$backup = Join-Path $resDir 'app.asar.mcp-panel.backup'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

python (Join-Path $here 'patch_asar.py') --stage

Write-Host 'Stopping Antigravity...'
Get-Process Antigravity -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process language_server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

if (-not (Test-Path $backup)) {
    Copy-Item -Path $asar -Destination $backup -Force
}

Move-Item -Path $staged -Destination $asar -Force
Write-Host 'Patched app.asar with MCP panel. Launching Antigravity...'
Start-Process -FilePath $exe
