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

$SpicetifyConfig = Join-Path $env:APPDATA "spicetify"
$IvLyricsApp = Join-Path $SpicetifyConfig "CustomApps\ivLyrics"
$IvLyricsData = Join-Path $SpicetifyConfig "ivLyrics"
$Manifest = Join-Path $IvLyricsApp "manifest.json"
$AddonSources = Join-Path $IvLyricsData "addon_sources.json"
$CliProxyDir = Join-Path $SpicetifyConfig "cli-proxy"

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

function Remove-AddonSource([string]$Filename) {
    if (-not (Test-Path -LiteralPath $AddonSources)) {
        return
    }
    $sources = Read-JsonMap -Path $AddonSources
    if ($sources.ContainsKey($Filename)) {
        $sources.Remove($Filename)
        Write-JsonMap -Path $AddonSources -Map $sources
        Write-Ok "Removed source entry: $Filename"
    }
}

function Remove-ManifestEntry([string]$Entry) {
    if (-not (Test-Path -LiteralPath $Manifest)) {
        return
    }
    try {
        $manifestObj = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
    } catch {
        Write-Warn "Failed to parse manifest.json, skipping entry removal: $Entry"
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
    (($manifestObj | ConvertTo-Json -Depth 100) + "`n") | Set-Content -LiteralPath $Manifest -Encoding UTF8
    Write-Ok "Removed manifest entry: $Entry"
}

function Remove-Addon([string]$Filename) {
    $path = Join-Path $IvLyricsApp $Filename
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
        Write-Ok "Deleted addon file: $path"
    } else {
        Write-Info "Addon file not found, skipping: $path"
    }
    Remove-AddonSource -Filename $Filename
    Remove-ManifestEntry -Entry $Filename
}

if ($Addons) {
    foreach ($addon in $AddonsList) {
        Remove-Addon -Filename $addon
    }
}

if ($Proxy) {
    if (Test-Path -LiteralPath $CliProxyDir) {
        Remove-Item -LiteralPath $CliProxyDir -Recurse -Force
        Write-Ok "Deleted proxy directory: $CliProxyDir"
    } else {
        Write-Info "Proxy directory not found, skipping: $CliProxyDir"
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
