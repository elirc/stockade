$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item -LiteralPath '.env.example' -Destination '.env.local' }
docker compose up -d postgres mailpit
if ($LASTEXITCODE -ne 0) { throw 'Local database setup failed.' }
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 60; $taskAttempt++) {
    docker compose exec -T postgres pg_isready -U stockade -d stockade *> $null
    if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $taskReady) { throw 'PostgreSQL is not ready. Inspect docker compose logs postgres.' }
dotnet build services/Fulfil/Fulfil.csproj
if ($LASTEXITCODE -ne 0) { throw 'Fulfil build failed.' }
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$taskApi = Start-Process -FilePath 'dotnet' -ArgumentList @('run','--no-build','--project','services/Fulfil','--no-launch-profile') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'fulfil.log') -RedirectStandardError (Join-Path $taskRoot 'fulfil.error.log')
Write-Output ('Fulfil PID: ' + $taskApi.Id + '. Store: http://127.0.0.1:3000. Email: http://127.0.0.1:8025.')
npm.cmd run dev
