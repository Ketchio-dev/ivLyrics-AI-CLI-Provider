# ivLyrics AI CLI Provider Addons

AI CLI Provider addons for [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics).
로컬 AI CLI 도구를 프록시 서버를 통해 ivLyrics 번역/메타데이터/TMI 기능에 연결합니다.

| Addon | CLI Tool |
|-------|----------|
| `Addon_AI_CLI_Provider.js` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) + [Codex CLI](https://github.com/openai/codex) + [Gemini CLI](https://github.com/google-gemini/gemini-cli) |

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
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --start-proxy --no-apply

# Windows PowerShell
& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -StartProxy -NoApply
```

Expected output:

```
🚀 ivLyrics CLI Proxy Server v2.1.5
   Running on http://localhost:19284
```

Then open Spotify and enable the provider in ivLyrics settings.

The command above auto-installs `cli-proxy` on first run (Addon Store install case) and starts it immediately.
When the addon loads, it also auto-checks proxy updates and applies proxy-only updates in the background (cooldown: 15 minutes).
When removed from Addon Marketplace, the addon also requests proxy self-cleanup (`/cleanup`) if the proxy is currently running.

## Gemini mode

Gemini is fixed to CLI spawn mode.


## License

MIT
