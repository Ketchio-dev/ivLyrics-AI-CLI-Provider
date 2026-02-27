param(
    [switch]$Addons,
    [switch]$Proxy,
    [switch]$Full,
    [switch]$NoApply
)

$ErrorActionPreference = "Stop"

function Write-Info($Message) { Write-Host "[INFO]  $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "[OK]    $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "[WARN]  $Message" -ForegroundColor Yellow }

if (-not ($Addons -or $Proxy -or $Full)) {
    $Full = $true
}
if ($Full) {
    $Addons = $true
    $Proxy = $true
}

function Get-SpicetifyConfigCandidates {
    $candidates = @()

    try {
        $spicetify = Get-Command spicetify -ErrorAction SilentlyContinue
        if ($null -ne $spicetify) {
            $configFile = (& $spicetify.Source -c 2>$null | Select-Object -First 1)
            if (-not [string]::IsNullOrWhiteSpace($configFile)) {
                $fromCmd = Split-Path -Parent $configFile.Trim()
                if (-not [string]::IsNullOrWhiteSpace($fromCmd)) {
                    $candidates += $fromCmd
                }
            }
        }
    } catch {}

    $candidates += @(
        (Join-Path $env:LOCALAPPDATA "spicetify"),
        (Join-Path $env:APPDATA "spicetify"),
        (Join-Path $env:USERPROFILE ".config\spicetify"),
        (Join-Path $env:USERPROFILE ".spicetify")
    )

    $unique = @()
    foreach ($path in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and -not ($unique -contains $path)) {
            $unique += $path
        }
    }

    return $unique
}

function Resolve-SpicetifyConfig {
    $unique = Get-SpicetifyConfigCandidates

    foreach ($path in $unique) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        if (Test-Path -LiteralPath (Join-Path $path "CustomApps\ivLyrics")) {
            return $path
        }
    }

    foreach ($path in $unique) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        return (Join-Path $env:LOCALAPPDATA "spicetify")
    }
    return (Join-Path $env:APPDATA "spicetify")
}

function Resolve-IvLyricsAppDir([string]$DefaultRoot) {
    foreach ($root in Get-SpicetifyConfigCandidates) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        $candidate = Join-Path $root "CustomApps\ivLyrics"
        if (Test-Path -LiteralPath (Join-Path $candidate "manifest.json")) {
            return $candidate
        }
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return (Join-Path $DefaultRoot "CustomApps\ivLyrics")
}

function Get-ProxyDirs([string]$PrimaryRoot) {
    $roots = @($PrimaryRoot) + (Get-SpicetifyConfigCandidates)
    $uniqueRoots = @()
    foreach ($r in $roots) {
        if (-not [string]::IsNullOrWhiteSpace($r) -and -not ($uniqueRoots -contains $r)) {
            $uniqueRoots += $r
        }
    }

    $dirs = @()
    foreach ($r in $uniqueRoots) {
        $candidate = Join-Path $r "cli-proxy"
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        if (-not ($dirs -contains $candidate)) {
            $dirs += $candidate
        }
    }

    if ($dirs.Count -eq 0) {
        return @(Join-Path $PrimaryRoot "cli-proxy")
    }
    return $dirs
}

function Get-IvLyricsAppDirs([string]$PrimaryRoot) {
    $roots = @($PrimaryRoot) + (Get-SpicetifyConfigCandidates)
    $uniqueRoots = @()
    foreach ($r in $roots) {
        if (-not [string]::IsNullOrWhiteSpace($r) -and -not ($uniqueRoots -contains $r)) {
            $uniqueRoots += $r
        }
    }

    $dirs = @()
    foreach ($r in $uniqueRoots) {
        $candidate = Join-Path $r "CustomApps\ivLyrics"
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        if (-not ($dirs -contains $candidate)) {
            $dirs += $candidate
        }
    }

    if ($dirs.Count -eq 0) {
        return @(Join-Path $PrimaryRoot "CustomApps\ivLyrics")
    }
    return $dirs
}

function Stop-ProxyProcessesForDir([string]$DirPath) {
    if (-not (Test-Path -LiteralPath $DirPath)) { return }

    $dirNorm = [System.IO.Path]::GetFullPath($DirPath).TrimEnd('\').ToLowerInvariant()
    $stopped = 0

    try {
        $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $cmd = $_.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
            $cmdNorm = $cmd.ToLowerInvariant()
            return $cmdNorm.Contains($dirNorm) -and ($cmdNorm.Contains("server.js") -or $cmdNorm.Contains("npm start") -or $cmdNorm.Contains("cli-proxy"))
        }
        foreach ($p in $procs) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                $stopped++
            } catch {}
        }
    } catch {}

    if ($stopped -gt 0) {
        Write-Info "Stopped $stopped proxy process(es) for: $DirPath"
        Start-Sleep -Milliseconds 700
    }
}

function Remove-ProxyDirSafe([string]$DirPath) {
    if (-not (Test-Path -LiteralPath $DirPath)) {
        Write-Info "Proxy directory not found, skipping: $DirPath"
        return
    }

    Stop-ProxyProcessesForDir -DirPath $DirPath

    try {
        Remove-Item -LiteralPath $DirPath -Recurse -Force
        Write-Ok "Deleted proxy directory: $DirPath"
    } catch {
        Write-Warn "Failed to delete proxy directory: $DirPath"
        Write-Warn $_.Exception.Message
    }
}

$SpicetifyConfig = Resolve-SpicetifyConfig
Write-Info "Using Spicetify config: $SpicetifyConfig"
$IvLyricsApp = Resolve-IvLyricsAppDir -DefaultRoot $SpicetifyConfig
$IvLyricsRoot = Split-Path -Parent (Split-Path -Parent $IvLyricsApp)
if ([string]::IsNullOrWhiteSpace($IvLyricsRoot)) {
    $IvLyricsRoot = $SpicetifyConfig
}
$IvLyricsData = Join-Path $IvLyricsRoot "ivLyrics"
$Manifest = Join-Path $IvLyricsApp "manifest.json"
$AddonSources = Join-Path $IvLyricsData "addon_sources.json"
$CliProxyDir = Join-Path $IvLyricsRoot "cli-proxy"
$IvLyricsApps = Get-IvLyricsAppDirs -PrimaryRoot $IvLyricsRoot
$CliProxyDirs = Get-ProxyDirs -PrimaryRoot $IvLyricsRoot

Write-Info "Resolved ivLyrics app: $IvLyricsApp"
Write-Info "Resolved proxy dir: $CliProxyDir"
Write-Info ("Discovered ivLyrics app dirs: " + ($IvLyricsApps -join ", "))
Write-Info ("Discovered proxy dirs: " + ($CliProxyDirs -join ", "))

$AddonsList = @(
    "Addon_AI_CLI_Provider.js",
    "Addon_AI_CLI_ClaudeCode.js",
    "Addon_AI_CLI_CodexCLI.js",
    "Addon_AI_CLI_GeminiCLI.js"
)

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Read-JsonMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return @{}
    }
    $raw = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @{}
    }
    try {
        $obj = ConvertFrom-Json -InputObject $raw
    } catch {
        Write-Warn "Failed to parse JSON: $Path"
        return @{}
    }
    $map = @{}
    foreach ($prop in $obj.PSObject.Properties) {
        $map[$prop.Name] = $prop.Value
    }
    return $map
}

function Write-JsonMap([string]$Path, [hashtable]$Map) {
    Ensure-Dir (Split-Path -Parent $Path)
    (($Map | ConvertTo-Json -Depth 20) + "`n") | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Remove-AddonSourceAt([string]$SourcesPath, [string]$Filename) {
    if (-not (Test-Path -LiteralPath $SourcesPath)) {
        return
    }
    $sources = Read-JsonMap -Path $SourcesPath
    if ($sources.ContainsKey($Filename)) {
        $sources.Remove($Filename)
        Write-JsonMap -Path $SourcesPath -Map $sources
        Write-Ok "Removed source entry: $Filename ($SourcesPath)"
    }
}

function Remove-ManifestEntryAt([string]$ManifestPath, [string]$Entry) {
    if (-not (Test-Path -LiteralPath $ManifestPath)) {
        return
    }
    try {
        $manifestObj = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    } catch {
        Write-Warn "Failed to parse manifest.json, skipping entry removal: $Entry ($ManifestPath)"
        return
    }
    if ($null -eq $manifestObj.subfiles_extension) {
        return
    }
    $current = @($manifestObj.subfiles_extension)
    $filtered = @($current | Where-Object { $_ -ne $Entry })
    if ($filtered.Count -eq $current.Count) {
        return
    }
    $manifestObj.subfiles_extension = $filtered
    (($manifestObj | ConvertTo-Json -Depth 100) + "`n") | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
    Write-Ok "Removed manifest entry: $Entry ($ManifestPath)"
}

function Remove-AddonFromApp([string]$AppDir, [string]$Filename) {
    $path = Join-Path $AppDir $Filename
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
        Write-Ok "Deleted addon file: $path"
    } else {
        Write-Info "Addon file not found, skipping: $path"
    }

    $manifestPath = Join-Path $AppDir "manifest.json"
    $root = Split-Path -Parent (Split-Path -Parent $AppDir)
    if ([string]::IsNullOrWhiteSpace($root)) {
        $root = $SpicetifyConfig
    }
    $sourcesPath = Join-Path $root "ivLyrics\addon_sources.json"

    Remove-AddonSourceAt -SourcesPath $sourcesPath -Filename $Filename
    Remove-ManifestEntryAt -ManifestPath $manifestPath -Entry $Filename
}

if ($Addons) {
    foreach ($appDir in $IvLyricsApps) {
        foreach ($addon in $AddonsList) {
            Remove-AddonFromApp -AppDir $appDir -Filename $addon
        }
    }
}

if ($Proxy) {
    foreach ($proxyDir in $CliProxyDirs) {
        Remove-ProxyDirSafe -DirPath $proxyDir
    }
}

if (-not $NoApply) {
    $spicetify = Get-Command spicetify -ErrorAction SilentlyContinue
    if ($null -eq $spicetify) {
        Write-Warn "spicetify not found in PATH. Run `spicetify apply` manually."
    } else {
        Write-Info "Running spicetify apply ..."
        try {
            spicetify apply
            Write-Ok "spicetify apply completed"
        } catch {
            Write-Warn "spicetify apply failed. Run it manually."
        }
    }
}

Write-Host ""
Write-Ok "Uninstall complete!"
