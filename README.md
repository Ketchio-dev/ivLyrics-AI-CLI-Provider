# ivLyrics AI CLI Provider Addons

[ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics)용 AI CLI Provider 애드온 모음입니다.
로컬에서 실행 중인 AI CLI 도구를 프록시 서버를 통해 ivLyrics의 번역/메타데이터/TMI 기능에 연결합니다.

## Addons

| 파일 | 설명 |
|------|------|
| `Addon_AI_CLI_ClaudeCode.js` | Anthropic Claude Code CLI |
| `Addon_AI_CLI_CodexCLI.js` | OpenAI Codex CLI |
| `Addon_AI_CLI_GeminiCLI.js` | Google Gemini CLI |

## 설치

### Windows (PowerShell)

```powershell
# Claude Code
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"

# Codex CLI
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"

# Gemini CLI
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"
```

### macOS / Linux (Terminal)

```bash
# Claude Code
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"

# Codex CLI
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"

# Gemini CLI
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"
```

## 사전 요구사항

- [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics)가 설치되어 있어야 합니다.
- 프록시 서버가 실행 중이어야 합니다 (기본: `http://localhost:19284`)
- 사용하려는 CLI 도구가 설치되어 있어야 합니다:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Codex CLI](https://github.com/openai/codex)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)

## 프록시 서버 설치

애드온이 동작하려면 프록시 서버가 필요합니다.

> **주의:** 프록시 서버는 반드시 `~/.config/spicetify/cli-proxy/`에 설치해야 합니다.
> ivLyrics 폴더(`CustomApps/ivLyrics/`) 안에 넣으면 로딩 오류가 발생합니다.

```bash
# 프록시 서버 파일 복사 (~/.config/spicetify/cli-proxy/ 에 설치)
cp -r cli-proxy ~/.config/spicetify/cli-proxy

# 의존성 설치
cd ~/.config/spicetify/cli-proxy
npm install
```

## 사용법

1. 위 설치 명령어로 애드온을 설치합니다.
2. 프록시 서버를 실행합니다:
   ```bash
   cd ~/.config/spicetify/cli-proxy && npm start
   ```
   또는 Spotify와 함께 자동 시작/종료:
   ```bash
   chmod +x ~/.config/spicetify/cli-proxy/spotify-with-proxy.sh
   ~/.config/spicetify/cli-proxy/spotify-with-proxy.sh
   ```
3. ivLyrics 설정에서 원하는 CLI Provider를 활성화합니다.

## License

MIT
