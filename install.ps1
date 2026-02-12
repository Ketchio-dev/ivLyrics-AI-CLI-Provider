#Requires -Version 5.1
[CmdletBinding()]
param(
    [Alias('a')][switch]$All,
    [Alias('p')][switch]$Proxy,
    [Alias('f')][switch]$Full,
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
    Write-Host "  -NoNpmInstall     Skip npm install in proxy directory"
    Write-Host "  -NoApply          Skip spicetify apply"
    Write-Host "  -Help, -h         Show this help"
    Write-Host "  URL               Install addon from URL (.js)"
    exit 0
}

if (-not ($All -or $Proxy -or $Full) -and (-not $Url -or $Url.Count -eq 0)) {
    $Full = $true
}
if ($Full) {
    $All = $true
    $Proxy = $true
}

$SpicetifyAppData = Join-Path $env:APPDATA "spicetify"
$SpicetifyUserConfig = Join-Path $env:USERPROFILE ".config\spicetify"
if (Test-Path $SpicetifyAppData) {
    $SpicetifyConfig = $SpicetifyAppData
} elseif (Test-Path $SpicetifyUserConfig) {
    $SpicetifyConfig = $SpicetifyUserConfig
} else {
    $SpicetifyConfig = $SpicetifyAppData
}

$IvLyricsApp = Join-Path $SpicetifyConfig "CustomApps\ivLyrics"
$IvLyricsData = Join-Path $SpicetifyConfig "ivLyrics"
$Manifest = Join-Path $IvLyricsApp "manifest.json"
$AddonSources = Join-Path $IvLyricsData "addon_sources.json"
$CliProxyDir = Join-Path $SpicetifyConfig "cli-proxy"

$Addons = @(
    "Addon_AI_CLI_ClaudeCode.js",
    "Addon_AI_CLI_CodexCLI.js",
    "Addon_AI_CLI_GeminiCLI.js"
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
        Write-Err "ivLyrics not found at $IvLyricsApp"
        Write-Err "Install ivLyrics first: https://github.com/ivLis-STUDIO/ivLyrics"
        exit 1
    }
    if (-not (Test-Path -LiteralPath $Manifest)) {
        Write-Err "manifest.json not found at $Manifest"
        exit 1
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

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($null -eq $npm) {
        Write-Warn "npm not found. Run `cd $CliProxyDir; npm install` manually."
        return
    }

    Push-Location $CliProxyDir
    try {
        Write-Info "Running npm install in $CliProxyDir"
        npm install
        Write-Ok "npm install completed"
    } finally {
        Pop-Location
    }
}

$needAddons = $All -or ($Url -and $Url.Count -gt 0)
if ($needAddons) {
    Test-IvLyricsReady
}

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
Write-Ok "Installation complete!"
