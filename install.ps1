#Requires -Version 5.1
<#
.SYNOPSIS
    ivLyrics AI CLI Provider - Windows Installer

.EXAMPLE
    .\install.ps1            # Interactive menu
    .\install.ps1 -All       # Install all addons
    .\install.ps1 -ProxyOnly # Install proxy server only
#>
[CmdletBinding()]
param(
    [Alias('a')][switch]$All,
    [switch]$ProxyOnly,
    [Alias('h')][switch]$Help,
    [Parameter(ValueFromRemainingArguments)][string[]]$Url
)

$ErrorActionPreference = 'Stop'

# ── Configuration ────────────────────────────────────────────────────────────

$RepoBase = 'https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main'

$SpicetifyAppData   = Join-Path $env:APPDATA 'spicetify'
$SpicetifyUserConfig = Join-Path $env:USERPROFILE '.config\spicetify'

if (Test-Path $SpicetifyAppData) {
    $SpicetifyConfig = $SpicetifyAppData
} elseif (Test-Path $SpicetifyUserConfig) {
    $SpicetifyConfig = $SpicetifyUserConfig
} else {
    $SpicetifyConfig = $SpicetifyAppData
}

$IvLyricsApp  = Join-Path $SpicetifyConfig 'CustomApps\ivLyrics'
$IvLyricsData = Join-Path $SpicetifyConfig 'ivLyrics'
$CliProxyDir  = Join-Path $SpicetifyConfig 'cli-proxy'
$Manifest     = Join-Path $IvLyricsApp 'manifest.json'
$AddonSources = Join-Path $IvLyricsData 'addon_sources.json'

$Addons      = @('Addon_AI_CLI_ClaudeCode.js', 'Addon_AI_CLI_CodexCLI.js', 'Addon_AI_CLI_GeminiCLI.js')
$AddonLabels = @('Claude Code', 'Codex CLI', 'Gemini CLI')
$ProxyFiles  = @('server.js', 'package.json', 'spotify-with-proxy.ps1', '.env.example')

$HasSpicetify = $false

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Info { param($Msg) Write-Host "[INFO]  $Msg" -ForegroundColor Blue }
function Write-Ok   { param($Msg) Write-Host "[OK]    $Msg" -ForegroundColor Green }
function Write-Warn { param($Msg) Write-Host "[WARN]  $Msg" -ForegroundColor Yellow }
function Write-Err  { param($Msg) Write-Host "[ERROR] $Msg" -ForegroundColor Red }

# ── Preflight ────────────────────────────────────────────────────────────────

function Test-Preflight {
    if (-not (Get-Command 'spicetify' -ErrorAction SilentlyContinue)) {
        Write-Warn "spicetify not found in PATH. 'spicetify apply' will be skipped."
        $script:HasSpicetify = $false
    } else {
        $script:HasSpicetify = $true
    }
    if (-not (Test-Path $IvLyricsApp)) {
        Write-Err "ivLyrics not found at $IvLyricsApp"
        Write-Err "Please install ivLyrics first: https://github.com/ivLis-STUDIO/ivLyrics"
        exit 1
    }
    if (-not (Test-Path $Manifest)) {
        Write-Err "manifest.json not found at $Manifest"
        exit 1
    }
}

# ── addon_sources.json ───────────────────────────────────────────────────────

function Update-AddonSource {
    param([string]$Filename, [string]$SourceUrl)
    if (-not (Test-Path $IvLyricsData)) {
        New-Item -ItemType Directory -Path $IvLyricsData -Force | Out-Null
    }
    $json = @{}
    if (Test-Path $AddonSources) {
        try {
            $obj = Get-Content $AddonSources -Raw | ConvertFrom-Json
            $obj.PSObject.Properties | ForEach-Object { $json[$_.Name] = $_.Value }
        } catch { $json = @{} }
    }
    $json[$Filename] = $SourceUrl
    $json | ConvertTo-Json | Set-Content -Path $AddonSources -Encoding UTF8
}

# ── manifest.json ────────────────────────────────────────────────────────────

function Add-ManifestEntry {
    param([string]$Entry)
    $content = Get-Content $Manifest -Raw
    if ($content -match [regex]::Escape("`"$Entry`"")) {
        Write-Info "`"$Entry`" already in manifest.json, skipping."
        return
    }
    $content = $content -replace '("subfiles_extension"\s*:\s*\[)', "`$1`n        `"$Entry`","
    Set-Content -Path $Manifest -Value $content -Encoding UTF8
    Write-Ok "Registered `"$Entry`" in manifest.json"
}

# ── Install single addon ────────────────────────────────────────────────────

function Install-Addon {
    param([string]$AddonUrl)
    $filename = [System.IO.Path]::GetFileName($AddonUrl)
    if (-not $filename.EndsWith('.js')) {
        Write-Err "URL must point to a .js file: $AddonUrl"; return
    }
    $dest = Join-Path $IvLyricsApp $filename
    Write-Info "Downloading $filename ..."
    try {
        Invoke-WebRequest -Uri $AddonUrl -OutFile $dest -UseBasicParsing
    } catch {
        Write-Err "Failed to download ${filename}: $_"; return
    }
    Write-Ok "Downloaded -> $dest"
    Update-AddonSource $filename $AddonUrl
    Write-Ok "Updated addon_sources.json"
    Add-ManifestEntry $filename
}

# ── Install all ──────────────────────────────────────────────────────────────

function Install-AllAddons {
    foreach ($addon in $Addons) { Install-Addon "$RepoBase/$addon" }
}

# ── Selection menu ───────────────────────────────────────────────────────────

function Show-Menu {
    Write-Host ""
    Write-Host "================================================"
    Write-Host "   ivLyrics AI CLI Provider - Addon Installer"
    Write-Host "================================================"
    Write-Host ""
    Write-Host "Available addons:"
    Write-Host ""
    for ($i = 0; $i -lt $AddonLabels.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $AddonLabels[$i])
    }
    Write-Host "  a) Install all"
    Write-Host "  q) Quit"
    Write-Host ""
    $selection = Read-Host "Select addons to install (e.g. 1 3, a for all)"

    if ($selection -eq 'q' -or $selection -eq 'Q') { Write-Host "Cancelled."; exit 0 }
    if ($selection -eq 'a' -or $selection -eq 'A') { Install-AllAddons; return }

    foreach ($num in ($selection -split '\s+')) {
        $idx = 0
        if ([int]::TryParse($num, [ref]$idx) -and $idx -ge 1 -and $idx -le $Addons.Count) {
            Install-Addon "$RepoBase/$($Addons[$idx - 1])"
        } else {
            Write-Warn "Invalid selection: $num"
        }
    }
}

# ── Proxy server install ────────────────────────────────────────────────────

function Install-ProxyServer {
    if ((Test-Path (Join-Path $CliProxyDir 'server.js')) -and
        (Test-Path (Join-Path $CliProxyDir 'package.json'))) {
        Write-Info "Proxy server already installed at $CliProxyDir"
        $reinstall = Read-Host "  Reinstall / update? (y/N)"
        if ($reinstall -notmatch '^[yY]') {
            Write-Info "Skipping proxy server install."; return
        }
    }
    if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) {
        Write-Err "Node.js is required but not found."
        Write-Err "Install from: https://nodejs.org/"
        return
    }
    if (-not (Get-Command 'npm' -ErrorAction SilentlyContinue)) {
        Write-Err "npm is required but not found."; return
    }
    if (-not (Test-Path $CliProxyDir)) {
        New-Item -ItemType Directory -Path $CliProxyDir -Force | Out-Null
    }
    Write-Info "Downloading proxy server files..."
    foreach ($file in $ProxyFiles) {
        try {
            Invoke-WebRequest -Uri "$RepoBase/cli-proxy/$file" -OutFile (Join-Path $CliProxyDir $file) -UseBasicParsing
        } catch {
            Write-Err "Failed to download ${file}: $_"; return
        }
    }
    Write-Ok "Downloaded proxy server -> $CliProxyDir"

    Write-Info "Installing dependencies (npm install)..."
    Push-Location $CliProxyDir
    try {
        & npm install --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Ok "Dependencies installed" }
        else { Write-Err "npm install failed"; return }
    } finally { Pop-Location }

    Write-Host ""
    Write-Ok "Proxy server installed!"
    Write-Host ""
    Write-Info "To start the server:"
    Write-Host "  cd $CliProxyDir; npm start"
    Write-Host ""
    Write-Info "To auto-start with Spotify:"
    Write-Host "  & '$CliProxyDir\spotify-with-proxy.ps1'"
}

function Ask-InstallProxy {
    Write-Host ""
    Write-Host ('-' * 40)
    Write-Info "Proxy server is required for addons to work."
    if (Test-Path (Join-Path $CliProxyDir 'server.js')) {
        Write-Info "(Proxy server is already installed at $CliProxyDir)"
    }
    $answer = Read-Host "  Install proxy server? (Y/n)"
    if ($answer -match '^[nN]') {
        Write-Info "Skipping proxy server. You can install it later manually."
    } else {
        Install-ProxyServer
    }
}

# ── Main ─────────────────────────────────────────────────────────────────────

if ($Help) {
    Write-Host "Usage: .\install.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  (no args)       Interactive selection menu"
    Write-Host "  -All, -a        Install all addons"
    Write-Host "  -ProxyOnly      Install proxy server only (skip addons)"
    Write-Host "  -Help, -h       Show this help"
    Write-Host "  -Url <URL>      Install addon from URL"
    exit 0
}

if ($ProxyOnly) {
    Install-ProxyServer
    Write-Host ""
    Write-Ok "Installation complete!"
    exit 0
}

Test-Preflight

if ($All) {
    Install-AllAddons
} elseif ($Url -and $Url.Count -gt 0) {
    foreach ($u in $Url) { Install-Addon $u }
} else {
    Show-Menu
}

Write-Host ""
if ($HasSpicetify) {
    Write-Info "Running spicetify apply ..."
    & spicetify apply
    if ($LASTEXITCODE -eq 0) { Write-Ok "spicetify apply completed!" }
    else { Write-Warn "spicetify apply failed. You may need to run it manually." }
} else {
    Write-Warn "Run 'spicetify apply' manually to activate the addons."
}

Ask-InstallProxy

Write-Host ""
Write-Ok "Installation complete!"
