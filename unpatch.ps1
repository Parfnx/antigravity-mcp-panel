$ErrorActionPreference = 'Stop'
$resDir = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources'
$asar = Join-Path $resDir 'app.asar'
$backup = Join-Path $resDir 'app.asar.mcp-panel.backup'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'

if (-not (Test-Path $backup)) {
    throw "Backup not found: $backup"
}

Get-Process Antigravity -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process language_server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

Copy-Item -Path $backup -Destination $asar -Force
Write-Host 'Restored backup app.asar. Launching Antigravity...'
Start-Process -FilePath $exe
