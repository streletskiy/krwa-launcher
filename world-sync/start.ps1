param([Parameter(Mandatory)][string]$Config)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Config -Encoding UTF8 -Raw | ConvertFrom-Json
$env:KRWA_SYNC_WORLD = (Resolve-Path -LiteralPath $settings.World).Path
$env:KRWA_SYNC_DATA = $settings.Data
$env:KRWA_SYNC_CRAFTY_ID = $settings.ServerId
$env:KRWA_SYNC_CRAFTY_HELPER = (Resolve-Path -LiteralPath $settings.CraftyHelper).Path
$env:KRWA_SYNC_DISTRIBUTION = (Resolve-Path -LiteralPath $settings.Distribution).Path
$env:PYTHONUTF8 = '1'
Set-Location -LiteralPath $PSScriptRoot
& $settings.Python -m uvicorn app:app --host 127.0.0.1 --port 18774 --workers 1 --no-access-log --limit-concurrency 32
exit $LASTEXITCODE
