#Requires -Version 5.1
[CmdletBinding()]
param(
    [Alias('a')][switch]$All,
    [Alias('p')][switch]$Proxy,
    [Alias('f')][switch]$Full,
    [Alias('s')][switch]$StartProxy,
    [switch]$NoApply,
    [switch]$NoNpmInstall,
    [Alias('h')][switch]$Help,
    [Parameter(ValueFromRemainingArguments)][string[]]$Url,
    [string]$RepoBase = "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main"
)

$ErrorActionPreference = "Stop"

function Write-Info($Message) { Write-Host "[INFO]  $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "[OK]    $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "[WARN]  $Message" -ForegroundColor Yellow }
function Write-Err($Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

if ($Help) {
    Write-Host "Usage: .\install.ps1 [OPTIONS] [URL ...]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  (no args)         Full install (addons + proxy)"
    Write-Host "  -All, -a          Install all addons"
    Write-Host "  -Proxy, -p        Install proxy only"
    Write-Host "  -Full, -f         Install all addons + proxy"
    Write-Host "  -StartProxy, -s   Start proxy (auto-install if missing)"
    Write-Host "  -NoNpmInstall     Skip npm install in proxy directory"
    Write-Host "  -NoApply          Skip spicetify apply"
    Write-Host "  -Help, -h         Show this help"
    Write-Host "  URL               Install addon from URL (.js)"
    return
}

if (-not ($All -or $Proxy -or $Full -or $StartProxy) -and (-not $Url -or $Url.Count -eq 0)) {
    $Full = $true
}
if ($Full) {
    $All = $true
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
    $candidates = Get-SpicetifyConfigCandidates

    foreach ($path in $candidates) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        if (Test-Path -LiteralPath (Join-Path $path "CustomApps\ivLyrics")) {
            return $path
        }
    }

    foreach ($path in $candidates) {
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

function Resolve-ProxyDir([string]$DefaultRoot, [string]$IvLyricsRoot) {
    $roots = @($DefaultRoot, $IvLyricsRoot) + (Get-SpicetifyConfigCandidates)
    $unique = @()
    foreach ($r in $roots) {
        if (-not [string]::IsNullOrWhiteSpace($r) -and -not ($unique -contains $r)) {
            $unique += $r
        }
    }

    foreach ($r in $unique) {
        $candidate = Join-Path $r "cli-proxy"
        if (Test-Path -LiteralPath (Join-Path $candidate "server.js")) {
            return $candidate
        }
    }

    return (Join-Path $DefaultRoot "cli-proxy")
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
$CliProxyDir = Resolve-ProxyDir -DefaultRoot $SpicetifyConfig -IvLyricsRoot $IvLyricsRoot

Write-Info "Resolved ivLyrics app: $IvLyricsApp"
Write-Info "Resolved proxy dir: $CliProxyDir"

$Addons = @(
    "Addon_AI_CLI_Provider.js"
)

$ProxyFiles = @(
    "server.js",
    "package.json",
    "README.md",
    "spotify-with-proxy.sh",
    "spotify-with-proxy.ps1"
)

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Download-File([string]$RemoteUrl, [string]$Destination) {
    Ensure-Dir (Split-Path -Parent $Destination)
    Invoke-WebRequest -UseBasicParsing -Uri $RemoteUrl -OutFile $Destination
}

function Test-IvLyricsReady {
    if (-not (Test-Path -LiteralPath $IvLyricsApp)) {
        throw "ivLyrics not found at $IvLyricsApp`nInstall ivLyrics first: https://github.com/ivLis-STUDIO/ivLyrics"
    }
    if (-not (Test-Path -LiteralPath $Manifest)) {
        throw "manifest.json not found at $Manifest"
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
    $obj = ConvertFrom-Json -InputObject $raw
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

function Ensure-ManifestEntry([string]$Entry) {
    if (-not (Test-Path -LiteralPath $Manifest)) {
        throw "manifest.json not found at $Manifest"
    }
    $manifestObj = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
    if ($null -eq $manifestObj.subfiles_extension) {
        $manifestObj | Add-Member -NotePropertyName subfiles_extension -NotePropertyValue @()
    }
    $current = @($manifestObj.subfiles_extension)
    if ($current -contains $Entry) {
        Write-Info "`"$Entry`" already in manifest.json, skipping."
        return
    }
    $manifestObj.subfiles_extension = @($Entry) + $current
    (($manifestObj | ConvertTo-Json -Depth 100) + "`n") | Set-Content -LiteralPath $Manifest -Encoding UTF8
    Write-Ok "Registered `"$Entry`" in manifest.json"
}

function Update-AddonSource([string]$Filename, [string]$RemoteUrl) {
    $sources = Read-JsonMap -Path $AddonSources
    $sources[$Filename] = $RemoteUrl
    Write-JsonMap -Path $AddonSources -Map $sources
}

function Install-AddonFromUrl([string]$AddonUrl) {
    $filename = [System.IO.Path]::GetFileName($AddonUrl)
    if ([string]::IsNullOrWhiteSpace($filename) -or -not $filename.EndsWith(".js")) {
        Write-Err "URL must point to a .js file: $AddonUrl"
        return
    }

    $dest = Join-Path $IvLyricsApp $filename
    Write-Info "Downloading $filename ..."
    Download-File -RemoteUrl $AddonUrl -Destination $dest
    Write-Ok "Downloaded -> $dest"

    Update-AddonSource -Filename $filename -RemoteUrl $AddonUrl
    Write-Ok "Updated addon_sources.json"

    Ensure-ManifestEntry -Entry $filename
    $script:DidAddonInstall = $true
}

function Resolve-NpmCommand {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($null -ne $npm) {
        return $npm
    }
    return Get-Command npm -ErrorAction SilentlyContinue
}

function Get-LocalProxyVersion {
    try {
        $pkgPath = Join-Path $CliProxyDir "package.json"
        if (-not (Test-Path -LiteralPath $pkgPath)) {
            return $null
        }
        $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
        if ($pkg.version) {
            return $pkg.version.ToString().Trim()
        }
    } catch {}
    return $null
}

function Get-RemoteProxyVersion {
    try {
        $versionUrl = "$RepoBase/version.json"
        $raw = Invoke-WebRequest -UseBasicParsing -Uri $versionUrl
        $obj = $raw.Content | ConvertFrom-Json
        if ($obj.proxy.version) {
            return $obj.proxy.version.ToString().Trim()
        }
    } catch {}
    return $null
}

function Install-Proxy {
    Write-Info "Installing proxy to $CliProxyDir"
    Ensure-Dir $CliProxyDir

    foreach ($relative in $ProxyFiles) {
        $url = "$RepoBase/cli-proxy/$relative"
        $dest = Join-Path $CliProxyDir $relative
        Download-File -RemoteUrl $url -Destination $dest
        Write-Ok "Downloaded proxy file: $relative"
    }

    if ($NoNpmInstall) {
        Write-Warn "Skipped npm install (-NoNpmInstall)"
        return
    }

    $npm = Resolve-NpmCommand
    if ($null -eq $npm) {
        Write-Warn "npm not found. Run `cd $CliProxyDir; npm.cmd install` manually."
        return
    }

    Push-Location $CliProxyDir
    try {
        Write-Info "Running npm install in $CliProxyDir"
        & $npm.Source install
        Write-Ok "npm install completed"
    } finally {
        Pop-Location
    }
}

function Test-ProxyReady {
    $pkg = Join-Path $CliProxyDir "package.json"
    $srv = Join-Path $CliProxyDir "server.js"
    return (Test-Path -LiteralPath $pkg) -and (Test-Path -LiteralPath $srv)
}

function Ensure-ProxyReady {
    if (-not (Test-ProxyReady)) {
        Write-Info "cli-proxy not found. Installing..."
        Install-Proxy
        return
    }

    if ($NoNpmInstall) {
        Write-Warn "Skipped npm install (-NoNpmInstall)"
        return
    }

    $localVersion = Get-LocalProxyVersion
    $remoteVersion = Get-RemoteProxyVersion
    if ($localVersion -and $remoteVersion -and ($localVersion -ne $remoteVersion)) {
        Write-Info "Updating cli-proxy ($localVersion -> $remoteVersion) ..."
        Install-Proxy
        return
    }

    $nodeModules = Join-Path $CliProxyDir "node_modules"
    if (Test-Path -LiteralPath $nodeModules) {
        return
    }

    $npm = Resolve-NpmCommand
    if ($null -eq $npm) {
        Write-Warn "npm not found. Run `cd $CliProxyDir; npm.cmd install` manually."
        return
    }

    Push-Location $CliProxyDir
    try {
        Write-Info "Installing proxy dependencies ..."
        & $npm.Source install
        Write-Ok "npm install completed"
    } finally {
        Pop-Location
    }
}

function Start-ProxyServer {
    if (-not (Test-ProxyReady)) {
        throw "cli-proxy not found at $CliProxyDir`nRun with -Proxy first, or use -StartProxy only to auto-install."
    }

    $npm = Resolve-NpmCommand
    if ($null -eq $npm) {
        throw "npm not found in PATH. Install Node.js and retry."
    }

    Push-Location $CliProxyDir
    try {
        Write-Info "Starting proxy server ..."
        & $npm.Source start
    } finally {
        Pop-Location
    }
}

# Pre-flight: Node.js version check
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCmd) {
    try {
        $nodeVer = (node --version 2>$null) -replace '^v', ''
        $nodeMajor = [int]($nodeVer -split '\.')[0]
        if ($nodeMajor -lt 18) {
            Write-Warn "Node.js v$nodeVer detected. v18+ is required for the CLI proxy."
        }
    } catch {}
}

$needAddons = $All -or ($Url -and $Url.Count -gt 0)
if ($needAddons) {
    Test-IvLyricsReady
}
$DidAddonInstall = $false

if ($All) {
    foreach ($addon in $Addons) {
        Install-AddonFromUrl -AddonUrl "$RepoBase/$addon"
    }
}

if ($Url -and $Url.Count -gt 0) {
    foreach ($u in $Url) {
        Install-AddonFromUrl -AddonUrl $u
    }
}

if ($Proxy) {
    Install-Proxy
}

if ($StartProxy -and -not $Proxy) {
    Ensure-ProxyReady
}

if (-not $NoApply -and $DidAddonInstall) {
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

if ($StartProxy) {
    Start-ProxyServer
}

Write-Host ""
Write-Ok "Installation complete!"
