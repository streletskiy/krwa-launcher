param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$OverridesPath,

    [Parameter(Mandatory = $true)]
    [string]$NeoForgeInstallRoot,

    [Parameter(Mandatory = $true)]
    [string]$ProfilePath,

    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$CachePath,

    [string]$ServerModsPath
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$minecraftVersion = [string]$manifest.minecraft.version
$neoForgeId = [string]($manifest.minecraft.modLoaders | Where-Object id -like 'neoforge-*' | Select-Object -First 1).id
if (-not $neoForgeId) {
    throw 'The manifest does not declare a NeoForge loader.'
}
$neoForgeVersion = $neoForgeId.Substring('neoforge-'.Length)
$versionRoot = Join-Path $NeoForgeInstallRoot "versions\$neoForgeId"
$librariesRoot = Join-Path $NeoForgeInstallRoot 'libraries'
$versionJsonPath = Join-Path $versionRoot "$neoForgeId.json"

foreach ($requiredPath in @($ManifestPath, $OverridesPath, $versionJsonPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required input does not exist: $requiredPath"
    }
}

$profileRoot = [IO.Path]::GetFullPath($ProfilePath)
$filesRoot = Join-Path $profileRoot 'files'
$loaderRoot = Join-Path $profileRoot 'loader'
$sourceRoot = Join-Path $profileRoot 'source'
New-Item -ItemType Directory -Path $filesRoot, $loaderRoot, $sourceRoot, $CachePath -Force | Out-Null

Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $sourceRoot 'curseforge-manifest.json') -Force
Copy-Item -Path (Join-Path $OverridesPath '*') -Destination $filesRoot -Recurse -Force

function Get-Artifact([string]$Path, [string]$Url, [string]$RelativePath) {
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        size = $item.Length
        MD5 = (Get-FileHash -LiteralPath $Path -Algorithm MD5).Hash.ToLowerInvariant()
        url = $Url
        path = $RelativePath.Replace('\', '/')
    }
}

$profileUrl = $BaseUrl.TrimEnd('/') + '/servers/' + (Split-Path $profileRoot -Leaf) + '/'
$prismMetaUrl = "https://meta.prismlauncher.org/v1/net.neoforged/$neoForgeVersion.json"
$prismMetaResponse = Invoke-WebRequest -Uri $prismMetaUrl -MaximumRetryCount 4 -RetryIntervalSec 2
$prismMetaPath = Join-Path $sourceRoot "prism-neoforge-$neoForgeVersion.json"
[IO.File]::WriteAllText($prismMetaPath, $prismMetaResponse.Content, [Text.UTF8Encoding]::new($false))
$prismMeta = $prismMetaResponse.Content | ConvertFrom-Json
if ($prismMeta.uid -ne 'net.neoforged' -or $prismMeta.version -ne $neoForgeVersion) {
    throw "Unexpected Prism NeoForge metadata at $prismMetaUrl"
}

function Convert-MavenNameToPath([string]$Name) {
    if ($Name -notmatch '^([^:]+):([^:]+):([^:@]+)(?::([^@]+))?(?:@(.+))?$') {
        throw "Invalid Maven coordinate: $Name"
    }
    $group = $Matches[1].Replace('.', '/')
    $artifact = $Matches[2]
    $version = $Matches[3]
    $classifier = $Matches[4]
    $extension = if ($Matches[5]) { $Matches[5] } else { 'jar' }
    $suffix = if ($classifier) { "-$classifier" } else { '' }
    return "$group/$artifact/$version/$artifact-$version$suffix.$extension"
}

function Resolve-PrismArtifact($Entry) {
    $download = $Entry.downloads.artifact
    if (-not $download.url) {
        throw "Prism metadata has no download URL for $($Entry.name)"
    }
    $relativePath = if ($download.path) { [string]$download.path } else { Convert-MavenNameToPath ([string]$Entry.name) }
    $localPath = Join-Path $librariesRoot $relativePath.Replace('/', '\')
    if (-not (Test-Path -LiteralPath $localPath)) {
        $localPath = Join-Path $CachePath ("loader-" + ($relativePath -replace '[/\\]', '_'))
        if (-not (Test-Path -LiteralPath $localPath) -or (Get-Item -LiteralPath $localPath).Length -ne [long]$download.size) {
            Invoke-WebRequest -Uri ([string]$download.url) -OutFile $localPath -MaximumRetryCount 4 -RetryIntervalSec 2
        }
    }
    return Get-Artifact $localPath ([string]$download.url) $relativePath
}

$forgeWrapperEntry = $prismMeta.libraries | Where-Object name -like 'io.github.zekerzhayard:ForgeWrapper:*' | Select-Object -First 1
if (-not $forgeWrapperEntry) {
    throw 'Prism metadata does not include ForgeWrapper.'
}
$installerEntry = $prismMeta.mavenFiles | Where-Object name -eq "net.neoforged:neoforge:$neoForgeVersion`:installer" | Select-Object -First 1
if (-not $installerEntry) {
    throw 'Prism metadata does not include the NeoForge installer.'
}
$installerRelativePath = if ($installerEntry.downloads.artifact.path) {
    [string]$installerEntry.downloads.artifact.path
} else {
    Convert-MavenNameToPath ([string]$installerEntry.name)
}

$publishedVersionJsonPath = Join-Path $loaderRoot "$neoForgeId.json"
$publishedVersion = Get-Content -LiteralPath $versionJsonPath -Raw | ConvertFrom-Json
$publishedVersion.mainClass = [string]$prismMeta.mainClass
$publishedVersion.arguments.jvm = @(
    '-Dforgewrapper.librariesDir=${library_directory}',
    "-Dforgewrapper.installer=`${library_directory}/$installerRelativePath",
    '-Dforgewrapper.minecraft=${minecraft_jar}'
)
[IO.File]::WriteAllText($publishedVersionJsonPath, ($publishedVersion | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))

$versionManifestModule = [ordered]@{
    id = $neoForgeId
    name = "NeoForge $neoForgeVersion version manifest"
    type = 'VersionManifest'
    artifact = Get-Artifact $publishedVersionJsonPath ($profileUrl + "loader/$neoForgeId.json") "$neoForgeId.json"
}

$runtimeLibraryNames = @($prismMeta.libraries | ForEach-Object { [string]$_.name })
$loaderLibraries = foreach ($library in $prismMeta.libraries | Where-Object name -ne $forgeWrapperEntry.name) {
    [ordered]@{
        id = [string]$library.name
        name = [string]$library.name
        type = 'Library'
        artifact = Resolve-PrismArtifact $library
    }
}
$installerLibraries = foreach ($library in $prismMeta.mavenFiles | Where-Object { $_.name -notin $runtimeLibraryNames }) {
    [ordered]@{
        id = [string]$library.name
        name = [string]$library.name
        type = 'Library'
        classpath = $false
        artifact = Resolve-PrismArtifact $library
    }
}

$serverModLookup = @{}
if ($ServerModsPath -and (Test-Path -LiteralPath $ServerModsPath)) {
    foreach ($file in Get-ChildItem -LiteralPath $ServerModsPath -File) {
        $normalizedName = $file.Name -replace '\.disabled$', ''
        $serverModLookup[$normalizedName.ToLowerInvariant()] = $file.FullName
    }
}

$lookupSnapshot = $serverModLookup
$cacheSnapshot = [IO.Path]::GetFullPath($CachePath)
$modModules = $manifest.files | ForEach-Object -Parallel {
    $entry = $_
    $projectId = [string]$entry.projectID
    $fileId = [string]$entry.fileID
    $metadataUrl = "https://www.curseforge.com/api/v1/mods/$projectId/files/$fileId"
    $metadata = Invoke-RestMethod -Uri $metadataUrl -MaximumRetryCount 4 -RetryIntervalSec 2
    $fileName = [string]$metadata.data.fileName
    if (-not $fileName) {
        throw "CurseForge did not return a file name for $projectId/$fileId"
    }

    $lookup = $using:lookupSnapshot
    $cacheRoot = $using:cacheSnapshot
    $sourcePath = $lookup[$fileName.ToLowerInvariant()]
    if (-not $sourcePath) {
        $sourcePath = Join-Path $cacheRoot "$projectId-$fileId-$fileName"
        if (-not (Test-Path -LiteralPath $sourcePath) -or (Get-Item -LiteralPath $sourcePath).Length -ne [long]$metadata.data.fileLength) {
            Invoke-WebRequest -Uri "https://www.curseforge.com/api/v1/mods/$projectId/files/$fileId/download" -OutFile $sourcePath -MaximumRetryCount 4 -RetryIntervalSec 2
        }
    }

    $item = Get-Item -LiteralPath $sourcePath
    if ($metadata.data.fileLength -and $item.Length -ne [long]$metadata.data.fileLength) {
        throw "Unexpected size for $fileName"
    }

    $moduleType = 'ForgeMod'
    $artifactPath = "curseforge/$projectId/$fileId/$fileName"
    $moduleId = "curseforge.project-${projectId}:file:${fileId}@jar"
    if ([IO.Path]::GetExtension($fileName).Equals('.zip', [StringComparison]::OrdinalIgnoreCase)) {
        Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
        $archive = [IO.Compression.ZipFile]::OpenRead($sourcePath)
        try {
            $roots = @($archive.Entries | ForEach-Object { ($_.FullName -replace '\\', '/').Split('/')[0] } | Where-Object { $_ } | Sort-Object -Unique)
        }
        finally {
            $archive.Dispose()
        }

        $moduleType = 'File'
        $moduleId = "curseforge-$projectId-$fileId-$fileName"
        if ($roots -contains 'shaders') {
            $artifactPath = "shaderpacks/$fileName"
        }
        elseif (($roots -contains 'data') -and -not ($roots -contains 'assets')) {
            $artifactPath = "config/paxi/datapacks/$fileName"
        }
        else {
            $artifactPath = "resourcepacks/$fileName"
        }
    }

    [ordered]@{
        sortKey = [long]$entry.projectID
        module = [ordered]@{
            id = $moduleId
            name = if ($metadata.data.displayName) { [string]$metadata.data.displayName } else { $fileName }
            type = $moduleType
            artifact = [ordered]@{
                size = $item.Length
                MD5 = (Get-FileHash -LiteralPath $sourcePath -Algorithm MD5).Hash.ToLowerInvariant()
                url = "https://www.curseforge.com/api/v1/mods/$projectId/files/$fileId/download"
                path = $artifactPath
            }
        }
    }
} -ThrottleLimit 12

$loaderModule = [ordered]@{
    id = [string]$forgeWrapperEntry.name
    name = "NeoForge $neoForgeVersion via ForgeWrapper"
    type = 'ForgeHosted'
    artifact = Resolve-PrismArtifact $forgeWrapperEntry
    subModules = @($versionManifestModule) + @($loaderLibraries) + @($installerLibraries)
}

$lock = [ordered]@{
    formatVersion = 1
    minecraftVersion = $minecraftVersion
    neoforgeVersion = $neoForgeVersion
    source = [ordered]@{
        name = [string]$manifest.name
        version = [string]$manifest.version
        manifest = 'source/curseforge-manifest.json'
    }
    modules = @($loaderModule) + @($modModules | Sort-Object sortKey | ForEach-Object module)
}

$lockPath = Join-Path $profileRoot 'neoforge-lock.json'
[IO.File]::WriteAllText($lockPath, ($lock | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
Write-Host "Generated $lockPath with $($manifest.files.Count) CurseForge mods."
