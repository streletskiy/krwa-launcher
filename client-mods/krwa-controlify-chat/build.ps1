param(
    [Parameter(Mandatory)] [string]$MinecraftClientJar,
    [Parameter(Mandatory)] [string]$MixinJar,
    [Parameter(Mandatory)] [string]$OutputJar
)

$ErrorActionPreference = 'Stop'
$classes = Join-Path ([IO.Path]::GetTempPath()) ('krwa-controlify-chat-' + [guid]::NewGuid())
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputJar)
$client = (Resolve-Path -LiteralPath $MinecraftClientJar).Path
$mixin = (Resolve-Path -LiteralPath $MixinJar).Path
New-Item -ItemType Directory -Path $classes | Out-Null
try {
    $source = Join-Path $PSScriptRoot 'src/ru/krwa/controlify/mixin/ChatScreenMixin.java'
    & javac --release 21 -encoding UTF-8 -proc:none -classpath "$client;$mixin" -d $classes $source
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
    & jar --create --file $output --date=2026-11-13T00:00:00Z -C $classes . -C "$PSScriptRoot/resources" .
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
    Get-FileHash -LiteralPath $output -Algorithm SHA256
} finally {
    $resolvedClasses = (Resolve-Path -LiteralPath $classes).Path
    if ($resolvedClasses -eq $classes -and $resolvedClasses.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedClasses -Recurse -Force
    }
}
