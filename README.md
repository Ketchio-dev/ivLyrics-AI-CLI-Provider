# ivLyrics AI CLI Provider Addons

AI CLI Provider addons for [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics).
로컬 AI CLI 도구를 프록시 서버를 통해 ivLyrics 번역/메타데이터/TMI 기능에 연결합니다.

| Addon | CLI Tool |
|-------|----------|
| `Addon_AI_CLI_ClaudeCode.js` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| `Addon_AI_CLI_CodexCLI.js` | [Codex CLI](https://github.com/openai/codex) |
| `Addon_AI_CLI_GeminiCLI.js` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |

## Quick Install (No git required)

### Windows (PowerShell, full install: addons + proxy)

```powershell
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -Full
```

### macOS / Linux (full install: addons + proxy)

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --full
```

### Install options

Windows:
```powershell
# Addons only
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -All

# Proxy only
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -Proxy
```

macOS / Linux:
```bash
# Addons only
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --all

# Proxy only
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --proxy
```

Install a single addon URL:

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"
```

## Uninstall (No git required)

Windows:
```powershell
# Full uninstall (addons + proxy)
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/uninstall.ps1").Content)) -Full
# Addons only: -Addons
# Proxy only: -Proxy
```

macOS / Linux:
```bash
# Full uninstall (addons + proxy)
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/uninstall.sh | bash -s -- --full
# Addons only: --addons
# Proxy only: --proxy
```

## Prerequisites

- [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics) installed
- [Node.js](https://nodejs.org/) v18+
- At least one CLI tool installed (Claude Code / Codex CLI / Gemini CLI)

## Start proxy server

```bash
# macOS / Linux
cd ~/.config/spicetify/cli-proxy && npm start

# Windows PowerShell
cd "$env:APPDATA\spicetify\cli-proxy"; npm start
```

Expected output:

```
🚀 ivLyrics CLI Proxy Server v2.1.0
   Running on http://localhost:19284
```

Then open Spotify and enable the provider in ivLyrics settings.

## Gemini SDK authentication

Gemini is handled in SDK mode and needs `oauth_creds.json` from Gemini CLI login.

1. Run `gemini` once and complete login.
2. Ensure `~/.gemini/oauth_creds.json` exists.
3. By default, client values are read from `oauth_creds.json`; `GEMINI_OAUTH_CLIENT_ID` / `GEMINI_OAUTH_CLIENT_SECRET` are optional overrides.

If old env keys are set and causing auth errors, use cleanup scripts:

```bash
# macOS / Linux
bash scripts/cleanup-gemini-oauth-env.sh
# or
npm run cleanup:gemini-oauth-env
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-gemini-oauth-env.ps1
# or
npm run cleanup:gemini-oauth-env:windows
```

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server status |
| GET | `/tools` | Available CLI tools |
| GET | `/models` | Models for each tool |
| POST | `/generate` | Text generation (supports SSE stream) |
| GET | `/updates` | Check updates |
| POST | `/update` | Apply updates |
| POST | `/v1/chat/completions` | OpenAI-compatible endpoint |

Example:

```bash
curl -N -X POST http://localhost:19284/generate \
  -H 'Content-Type: application/json' \
  -d '{"tool":"claude","prompt":"Say hello","stream":true}'
```

## Auto-update

```bash
# Check for updates
curl http://localhost:19284/updates

# Force re-check (ignore cache)
curl http://localhost:19284/updates?force=1

# Apply addon updates
curl -X POST http://localhost:19284/update \
  -H 'Content-Type: application/json' \
  -d '{"target":"addons"}'
```

`target`: `addons`, `proxy`, `all`, or a specific filename.

## License

MIT
