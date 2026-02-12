param(
    [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env")
)

$resolved = Resolve-Path -LiteralPath $EnvFile -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Host "[cleanup] No .env file found at: $EnvFile"
    exit 0
}

$envPath = $resolved.Path
$backupFile = "$envPath.bak.$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item -LiteralPath $envPath -Destination $backupFile -Force

$lines = Get-Content -LiteralPath $envPath
$filtered = $lines | Where-Object {
    $_ -notmatch '^\s*(export\s+)?GEMINI_OAUTH_CLIENT_ID\s*=' -and
    $_ -notmatch '^\s*(export\s+)?GEMINI_OAUTH_CLIENT_SECRET\s*='
}

Set-Content -LiteralPath $envPath -Value $filtered -Encoding UTF8

Write-Host "[cleanup] Removed GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET from: $envPath"
Write-Host "[cleanup] Backup saved at: $backupFile"
