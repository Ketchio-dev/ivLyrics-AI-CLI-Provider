<img width="1210" height="798" alt="image" src="https://github.com/user-attachments/assets/6c2dbd9d-97e3-47a8-ba75-87da30c75357" />


## People who are not familiar with this kind of projects. 

I strongly recommend to download Antigarivty to smooth download

If you finish to download the Antigravity you can just type 

[ https://github.com/Ketchio-dev/ivLyrics-AI-CLI-Provider    Download it for me. ]

And everything done





# ivLyrics AI CLI Provider Addons

AI CLI Provider addons for [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics).
Connects local AI CLI tools to ivLyrics translation/metadata/TMI features via a proxy server.

[ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics)용 AI CLI Provider 애드온 모음입니다.
로컬 AI CLI 도구를 프록시 서버를 통해 ivLyrics의 번역/메타데이터/TMI 기능에 연결합니다.

| Addon | CLI Tool |
|-------|----------|
| `Addon_AI_CLI_ClaudeCode.js` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (Anthropic) |
| `Addon_AI_CLI_CodexCLI.js` | [Codex CLI](https://github.com/openai/codex) (OpenAI) |
| `Addon_AI_CLI_GeminiCLI.js` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Google) |

## Quick Install / 빠른 설치

### Prerequisites / 사전 요구사항

- [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics) installed / 설치됨
- [Node.js](https://nodejs.org/) v18+
- At least one CLI tool installed / CLI 도구 최소 1개 설치: Claude Code, Codex CLI, or Gemini CLI

### macOS / Linux

```bash
git clone https://github.com/Ketchio-dev/ivLyrics-AI-CLI-Provider.git
cd ivLyrics-AI-CLI-Provider
bash install.sh --all
```

Or one-liner / 한 줄 설치:

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --all
```

### Windows (PowerShell)

```powershell
git clone https://github.com/Ketchio-dev/ivLyrics-AI-CLI-Provider.git
cd ivLyrics-AI-CLI-Provider
.\install.ps1 -All
```

### Start the proxy server / 프록시 서버 실행

```bash
# macOS / Linux
cd ~/.config/spicetify/cli-proxy && npm start

# Windows (PowerShell)
cd "$env:APPDATA\spicetify\cli-proxy"; npm start
```

You should see / 정상 실행 시:

```
🚀 ivLyrics CLI Proxy Server v2.1.0
   Running on http://localhost:19284
```

### Done! / 완료!

Open Spotify, go to ivLyrics settings, and enable your preferred CLI Provider.

Spotify를 실행하고, ivLyrics 설정에서 원하는 CLI Provider를 활성화하면 끝.

---

<details>
<summary>Advanced Installation / 상세 설치 가이드</summary>

### Install script options / 설치 스크립트 옵션

**macOS / Linux:**
```bash
bash install.sh          # Interactive menu / 대화형 선택 메뉴
bash install.sh --all    # Install all 3 addons / 3개 전부 설치
```

**Windows:**
```powershell
.\install.ps1            # Interactive menu / 대화형 선택 메뉴
.\install.ps1 -All       # Install all 3 addons / 3개 전부 설치
.\install.ps1 -ProxyOnly # Proxy server only / 프록시 서버만 설치
```

### Install individual addons / 개별 애드온 설치

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"
```

### Manual installation / 수동 설치

```bash
IVLYRICS_DIR="$HOME/.config/spicetify/CustomApps/ivLyrics"

# 1. Download addon files / 애드온 파일 다운로드
curl -fsSL -o "$IVLYRICS_DIR/Addon_AI_CLI_ClaudeCode.js" \
  "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"
curl -fsSL -o "$IVLYRICS_DIR/Addon_AI_CLI_CodexCLI.js" \
  "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"
curl -fsSL -o "$IVLYRICS_DIR/Addon_AI_CLI_GeminiCLI.js" \
  "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"

# 2. Add to manifest.json "subfiles_extension" array
# 3. Run: spicetify apply
```

### Proxy server manual setup / 프록시 서버 수동 설치

> **Note:** The proxy server must be installed under the spicetify config folder at `cli-proxy/`.
> - macOS/Linux: `~/.config/spicetify/cli-proxy/`
> - Windows: `%APPDATA%\spicetify\cli-proxy\`
>
> Do NOT place it inside the ivLyrics folder (`CustomApps/ivLyrics/`).

**macOS / Linux:**
```bash
mkdir -p ~/.config/spicetify/cli-proxy && cd ~/.config/spicetify/cli-proxy
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/server.js"
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/package.json"
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/spotify-with-proxy.sh"
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/.env.example"
chmod +x spotify-with-proxy.sh
npm install && npm start
```

**Windows (PowerShell):**
```powershell
$dir = "$env:APPDATA\spicetify\cli-proxy"
New-Item -ItemType Directory -Path $dir -Force | Out-Null; cd $dir
$base = "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy"
foreach ($f in @('server.js','package.json','spotify-with-proxy.ps1','.env.example')) {
    Invoke-WebRequest -Uri "$base/$f" -OutFile $f -UseBasicParsing
}
npm install; npm start
```

### Gemini CLI extra setup / Gemini CLI 추가 설정

Gemini CLI requires OAuth client credentials.

1. Run `gemini` CLI once to login / `gemini` CLI 한 번 실행하여 로그인
2. Create `.env` file / `.env` 파일 생성:
   ```bash
   cd ~/.config/spicetify/cli-proxy && cp .env.example .env
   ```
3. Edit `.env` with your Gemini OAuth Client ID and Secret / `.env`에 Gemini OAuth 정보 입력:
   ```
   GEMINI_OAUTH_CLIENT_ID=your_client_id_here
   GEMINI_OAUTH_CLIENT_SECRET=your_client_secret_here
   ```

### Auto-start with Spotify / Spotify와 함께 자동 시작

**macOS / Linux:**
```bash
~/.config/spicetify/cli-proxy/spotify-with-proxy.sh

# Or add alias / alias 등록:
echo 'alias spotify="~/.config/spicetify/cli-proxy/spotify-with-proxy.sh"' >> ~/.zshrc
```

**Windows (PowerShell):**
```powershell
& "$env:APPDATA\spicetify\cli-proxy\spotify-with-proxy.ps1"

# Or add to profile / profile에 등록:
Add-Content $PROFILE 'function spotify { & "$env:APPDATA\spicetify\cli-proxy\spotify-with-proxy.ps1" }'
```

</details>

<details>
<summary>Using official addon-manager / 공식 addon-manager 사용</summary>

**PowerShell:**
```powershell
# Claude Code
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"

# Codex CLI
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"

# Gemini CLI
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"
```

**Bash:**
```bash
# Claude Code
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"

# Codex CLI
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"

# Gemini CLI
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"
```

> **Note:** The official addon-manager does NOT install the proxy server. You must install it separately after installing addons.
>
> **참고:** 공식 addon-manager는 프록시 서버를 설치하지 않습니다. 애드온 설치 후 프록시 서버를 별도 설치해야 합니다.

> **macOS note:** The official `addon-manager.sh` uses `declare -A` (bash 4+), which may fail on macOS default bash (3.2). Use `install.sh` instead if you encounter issues.

</details>

<details>
<summary>API Endpoints (For Developers / 개발자용)</summary>

The proxy server provides the following endpoints. Regular users don't need this — addons handle everything automatically.

프록시 서버의 엔드포인트 목록입니다. 일반 사용자는 참고할 필요 없습니다 — 애드온이 자동으로 처리합니다.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server status & available tools / 서버 상태 및 도구 목록 |
| GET | `/tools` | List available CLI tools / CLI 도구 목록 |
| GET | `/models` | List available models per tool / 도구별 모델 목록 |
| POST | `/generate` | Generate text with SSE streaming support / AI 텍스트 생성 (SSE 스트리밍 지원) |
| GET | `/updates` | Check for updates / 업데이트 확인 |
| POST | `/update` | Download and apply updates / 업데이트 다운로드 및 적용 |
| POST | `/v1/chat/completions` | OpenAI-compatible endpoint / OpenAI API 호환 |

### SSE Streaming / SSE 스트리밍

The `/generate` endpoint supports SSE (Server-Sent Events) streaming. Add `stream: true` to the request body for progressive responses.

`/generate` 엔드포인트는 SSE 스트리밍을 지원합니다. `stream: true`를 요청 body에 추가하면 점진적 응답을 받을 수 있습니다.

```bash
# Streaming request / 스트리밍 요청
curl -N -X POST http://localhost:19284/generate \
  -H 'Content-Type: application/json' \
  -d '{"tool":"claude","prompt":"Say hello","stream":true}'

# Non-streaming request (backward compatible) / 일반 요청 (역호환)
curl -X POST http://localhost:19284/generate \
  -H 'Content-Type: application/json' \
  -d '{"tool":"claude","prompt":"Say hello"}'
```

SSE protocol / SSE 프로토콜:
```
data: {"chunk":"partial text"}\n\n     # Text chunk / 텍스트 청크
data: {"error":"message"}\n\n          # Error (if any) / 에러
data: [DONE]\n\n                       # End signal / 종료 신호
```

### Auto-Update / 자동 업데이트

The server automatically checks for updates on startup. You can also check manually.

서버 시작 시 GitHub에서 최신 버전을 자동으로 확인합니다. 수동으로도 확인할 수 있습니다.

```bash
# Check for updates / 업데이트 확인
curl http://localhost:19284/updates

# Force re-check (ignore cache) / 강제 재확인 (캐시 무시)
curl http://localhost:19284/updates?force=1

# Apply addon updates / 애드온 업데이트 적용
curl -X POST http://localhost:19284/update \
  -H 'Content-Type: application/json' \
  -d '{"target":"addons"}'
```

`target` options / 옵션: `addons`, `proxy`, `all`, or a specific filename / 또는 개별 파일명 (e.g., `Addon_AI_CLI_ClaudeCode.js`)

</details>

## License

MIT

