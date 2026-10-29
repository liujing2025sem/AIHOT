param([string]$NodePath = 'node')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw 'Missing .env. Read docs/local-pilot.md first.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps/web/build/server/index.js'))) { throw 'Build the web application first.' }
$localPorts = @(3001,3000)
$environmentLines = Get-Content -LiteralPath (Join-Path $projectRoot '.env')
foreach ($line in $environmentLines) {
  if ($line -match '^API_PORT=(\d+)$') { $localPorts[0] = [int]$Matches[1] }
  if ($line -match '^WEB_PORT=(\d+)$') { $localPorts[1] = [int]$Matches[1] }
}
foreach ($port in $localPorts) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use. Use the running preview or choose free ports in .env." }
}
$runtimePath = Join-Path $projectRoot '.data/local-runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$processes = @()
foreach ($part in @(@{Name='api'; Entry='apps/api/src/main.ts'}, @{Name='web'; Entry='apps/web/server.ts'})) {
  $p = Start-Process -FilePath $NodePath -ArgumentList @('--env-file=.env',$part.Entry) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath ($part.Name+'.log')) -RedirectStandardError (Join-Path $runtimePath ($part.Name+'.error.log'))
  $processes += @{ name=$part.Name; pid=$p.Id }
}
$processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'processes.json') -Encoding utf8
Start-Sleep -Seconds 2
foreach ($entry in $processes) {
  if (-not (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue)) { throw "The $($entry.name) process exited. Check .data/local-runtime logs." }
}
$null = Invoke-WebRequest -Uri "http://127.0.0.1:$($localPorts[0])/api/health" -TimeoutSec 10
$null = Invoke-WebRequest -Uri "http://127.0.0.1:$($localPorts[1])/" -TimeoutSec 10
Write-Output "Local preview responds at http://127.0.0.1:$($localPorts[1]) . The worker is not started."
