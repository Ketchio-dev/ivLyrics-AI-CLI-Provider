# ivLyrics AI CLI Provider Addons

AI CLI Provider addons for [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics).
로컬 AI CLI 도구를 프록시 서버를 통해 ivLyrics 번역/메타데이터/TMI 기능에 연결합니다.

| Addon | CLI Tool |
|-------|----------|
| `Addon_AI_CLI_ClaudeCode.js` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| `Addon_AI_CLI_CodexCLI.js` | [Codex CLI](https://github.com/openai/codex) |
| `Addon_AI_CLI_GeminiCLI.js` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |

## Quick Install

### Windows (PowerShell, full install: addons + proxy)

```powershell
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -Full
```

### macOS / Linux (full install: addons + proxy)

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --full
```


## Uninstall

Windows:
```powershell
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/uninstall.ps1").Content)) -Full
```

macOS / Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/uninstall.sh | bash -s -- --full
```

## Prerequisites

- [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics) installed
- [Node.js](https://nodejs.org/) v18+
- At least one CLI tool installed (Claude Code / Codex CLI / Gemini CLI)

## Start proxy server

```bash
# macOS / Linux
cfg="$(spicetify -c 2>/dev/null || true)"; base="${cfg%/*}"; proxy=""; for d in "$base" "$HOME/.config/spicetify" "$HOME/.spicetify"; do [ -n "$d" ] || continue; p="$d/cli-proxy"; if [ -f "$p/package.json" ] && [ -f "$p/server.js" ]; then proxy="$p"; break; fi; done; if [ -z "$proxy" ]; then curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --proxy; for d in "$base" "$HOME/.config/spicetify" "$HOME/.spicetify"; do [ -n "$d" ] || continue; p="$d/cli-proxy"; if [ -f "$p/package.json" ] && [ -f "$p/server.js" ]; then proxy="$p"; break; fi; done; fi; [ -n "$proxy" ] || { echo "cli-proxy install failed."; exit 1; }; cd "$proxy" || exit 1; [ -d node_modules ] || npm install; npm start

# Windows PowerShell
$cfg = $null
if (Get-Command spicetify -ErrorAction SilentlyContinue) { $cfg = (spicetify -c 2>$null | Select-Object -First 1) }
$dirs = @()
if ($cfg) { $dirs += (Split-Path $cfg -Parent) }
$dirs += "$env:APPDATA\spicetify", "$env:USERPROFILE\.config\spicetify", "$env:USERPROFILE\.spicetify"
$proxyDir = $dirs | ForEach-Object { Join-Path $_ "cli-proxy" } | Where-Object { (Test-Path (Join-Path $_ "package.json")) -and (Test-Path (Join-Path $_ "server.js")) } | Select-Object -First 1
if (!$proxyDir) {
  & ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -Proxy
  $proxyDir = $dirs | ForEach-Object { Join-Path $_ "cli-proxy" } | Where-Object { (Test-Path (Join-Path $_ "package.json")) -and (Test-Path (Join-Path $_ "server.js")) } | Select-Object -First 1
}
if (!$proxyDir) { Write-Host "cli-proxy install failed." -ForegroundColor Red; exit 1 }
Set-Location $proxyDir
if (!(Test-Path (Join-Path $proxyDir "node_modules"))) { npm.cmd install }
npm.cmd start
```

Expected output:

```
🚀 ivLyrics CLI Proxy Server v2.1.1
   Running on http://localhost:19284
```

Then open Spotify and enable the provider in ivLyrics settings.

The command above auto-installs `cli-proxy` on first run (Addon Store install case).

## Gemini mode

Gemini runs in CLI spawn mode by default.

- Default: `IVLYRICS_GEMINI_MODE=cli`
- Optional SDK mode: `IVLYRICS_GEMINI_MODE=sdk`

SDK mode needs `~/.gemini/oauth_creds.json` from Gemini CLI login.


## License

MIT
