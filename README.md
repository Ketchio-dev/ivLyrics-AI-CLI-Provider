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
3. If `oauth_creds.json` lacks `client_id`/`client_secret`, proxy auto-resolves them from your installed Gemini CLI runtime.


## License

MIT
