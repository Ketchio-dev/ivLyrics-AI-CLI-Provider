#Requires -Version 5.1
<#
.SYNOPSIS
    ivLyrics CLI Proxy - Spotify Wrapper (Windows)
    Spotify와 함께 proxy 서버를 자동으로 시작/종료

.EXAMPLE
    .\spotify-with-proxy.ps1

    # PowerShell profile에 function 등록:
    Add-Content $PROFILE 'function spotify { & "$env:APPDATA\spicetify\cli-proxy\spotify-with-proxy.ps1" }'
#>

$ErrorActionPreference = 'Stop'

# ── Configuration ────────────────────────────────────────────────────────────

$SpicetifyAppData   = Join-Path $env:APPDATA 'spicetify'
$SpicetifyUserConfig = Join-Path $env:USERPROFILE '.config\spicetify'

if (Test-Path (Join-Path $SpicetifyAppData 'cli-proxy\server.js')) {
    $CliProxyDir = Join-Path $SpicetifyAppData 'cli-proxy'
} elseif (Test-Path (Join-Path $SpicetifyUserConfig 'cli-proxy\server.js')) {
    $CliProxyDir = Join-Path $SpicetifyUserConfig 'cli-proxy'
} else {
    Write-Host "[ERROR] server.js not found. Install the proxy server first." -ForegroundColor Red
    exit 1
}

$Port = 19284
$PollInterval = 3
$ProxyProcess = $null

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Log     { param($Msg) Write-Host "[ivLyrics Proxy] $Msg" -ForegroundColor Cyan }
function Write-LogOk   { param($Msg) Write-Host "[ivLyrics Proxy] $Msg" -ForegroundColor Green }
function Write-LogWarn { param($Msg) Write-Host "[ivLyrics Proxy] $Msg" -ForegroundColor Yellow }
function Write-LogErr  { param($Msg) Write-Host "[ivLyrics Proxy] $Msg" -ForegroundColor Red }

# ── Proxy status check ───────────────────────────────────────────────────────

function Test-ProxyRunning {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

# ── Start proxy ──────────────────────────────────────────────────────────────

function Start-Proxy {
    if (Test-ProxyRunning) {
        Write-LogOk "Proxy server already running (port $Port)"
        return
    }

    $serverJs = Join-Path $CliProxyDir 'server.js'
    if (-not (Test-Path $serverJs)) {
        Write-LogErr "server.js not found: $serverJs"
        return
    }

    $nodeModules = Join-Path $CliProxyDir 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        Write-Log "Installing dependencies..."
        Push-Location $CliProxyDir
        try { & npm install --silent 2>&1 | Out-Null } finally { Pop-Location }
    }

    Write-Log "Starting proxy server..."
    $logFile = Join-Path $CliProxyDir 'proxy.log'
    $errFile = Join-Path $CliProxyDir 'proxy-error.log'
    $script:ProxyProcess = Start-Process -FilePath 'node' `
        -ArgumentList @($serverJs) `
        -WorkingDirectory $CliProxyDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $errFile `
        -PassThru

    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-ProxyRunning) {
            Write-LogOk "Proxy server started (port $Port, PID: $($script:ProxyProcess.Id))"
            return
        }
    }
    Write-LogWarn "Proxy server may not be ready yet"
}

# ── Stop proxy ───────────────────────────────────────────────────────────────

function Stop-Proxy {
    if ($null -eq $script:ProxyProcess) { return }
    if ($script:ProxyProcess.HasExited) { $script:ProxyProcess = $null; return }

    Write-Log "Stopping proxy server (PID: $($script:ProxyProcess.Id))..."
    try {
        $script:ProxyProcess.Kill()
        $script:ProxyProcess.WaitForExit(3000) | Out-Null
    } catch {}
    Write-LogOk "Proxy server stopped"
    $script:ProxyProcess = $null
}

# ── Main ─────────────────────────────────────────────────────────────────────

try {
    Write-Host ""
    Write-Log "========================================="
    Write-Log "  ivLyrics CLI Proxy + Spotify Launcher"
    Write-Log "========================================="
    Write-Host ""

    Start-Proxy

    Write-Log "Starting Spotify..."
    $spotifyExe = Join-Path $env:APPDATA 'Spotify\Spotify.exe'
    if (Test-Path $spotifyExe) {
        Start-Process -FilePath $spotifyExe
    } else {
        Start-Process 'spotify:'
    }

    Start-Sleep -Seconds 3
    $spotifyProc = Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue
    if ($null -eq $spotifyProc) {
        Write-LogWarn "Spotify process not found, waiting..."
        Start-Sleep -Seconds 5
        $spotifyProc = Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue
    }

    if ($null -eq $spotifyProc) {
        Write-LogErr "Spotify does not appear to have started"
    } else {
        Write-Log "Spotify detected. Waiting for exit..."
        while ($null -ne (Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue)) {
            Start-Sleep -Seconds $PollInterval
        }
        Write-Log "Spotify has exited"
    }
} finally {
    Stop-Proxy
}
