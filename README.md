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

**install.ps1 사용 (권장)**

```powershell
# 리포지토리 클론 후 설치 스크립트 실행
git clone https://github.com/Ketchio-dev/ivLyrics-AI-CLI-Provider.git
cd ivLyrics-AI-CLI-Provider
.\install.ps1          # 대화형 선택 메뉴
.\install.ps1 -All     # 3개 전부 설치
```

또는 프록시 서버만 별도 설치:

```powershell
.\install.ps1 -ProxyOnly
```

<details>
<summary>공식 addon-manager.ps1 사용</summary>

```powershell
# Claude Code
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"

# Codex CLI
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"

# Gemini CLI
& ([scriptblock]::Create((iwr -useb https://ivlis.kr/ivLyrics/addon-manager.ps1).Content)) -url "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"
```

> **참고:** 공식 `addon-manager.ps1`은 프록시 서버를 설치하지 않습니다. 애드온 설치 후 반드시 프록시 서버를 별도 설치해야 합니다.

</details>

### macOS / Linux (Terminal)

**install.sh 사용 (권장)**

```bash
# 리포지토리 클론 후 설치 스크립트 실행
git clone https://github.com/Ketchio-dev/ivLyrics-AI-CLI-Provider.git
cd ivLyrics-AI-CLI-Provider
bash install.sh          # 대화형 선택 메뉴
bash install.sh --all    # 3개 전부 설치
```

또는 원격으로 바로 실행:

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --all
```

개별 애드온만 설치:

```bash
curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"
```

<details>
<summary>공식 addon-manager.sh 사용</summary>

```bash
# Claude Code
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"

# Codex CLI
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"

# Gemini CLI
curl -fsSL https://ivlis.kr/ivLyrics/addon-manager.sh | bash -s -- "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"
```

> **참고:** 공식 `addon-manager.sh`는 `declare -A` (bash 4+)를 사용하므로 macOS 기본 bash (3.2)에서는 파일 다운로드 후 `addon_sources.json` 저장과 `manifest.json` 등록이 실패할 수 있습니다. macOS에서 문제가 발생하면 위의 `install.sh`를 사용하세요.

</details>

### 수동 설치

스크립트 없이 직접 설치하는 방법:

```bash
IVLYRICS_DIR="$HOME/.config/spicetify/CustomApps/ivLyrics"

# 1. JS 파일 다운로드
curl -fsSL -o "$IVLYRICS_DIR/Addon_AI_CLI_ClaudeCode.js" \
  "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_ClaudeCode.js"
curl -fsSL -o "$IVLYRICS_DIR/Addon_AI_CLI_CodexCLI.js" \
  "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_CodexCLI.js"
curl -fsSL -o "$IVLYRICS_DIR/Addon_AI_CLI_GeminiCLI.js" \
  "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/Addon_AI_CLI_GeminiCLI.js"

# 2. manifest.json의 "subfiles_extension" 배열에 추가 (이미 없는 경우)
#    에디터로 $IVLYRICS_DIR/manifest.json 을 열고
#    "subfiles_extension": [ 바로 아래에 다음 3줄 추가:
#        "Addon_AI_CLI_ClaudeCode.js",
#        "Addon_AI_CLI_CodexCLI.js",
#        "Addon_AI_CLI_GeminiCLI.js",

# 3. 적용
spicetify apply
```

## 사전 요구사항

- [ivLyrics](https://github.com/ivLis-STUDIO/ivLyrics)가 설치되어 있어야 합니다.
- [Node.js](https://nodejs.org/) v18 이상이 설치되어 있어야 합니다 (프록시 서버 실행에 필요).
- 사용하려는 CLI 도구가 최소 1개 이상 설치되어 있어야 합니다:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic 구독 필요
  - [Codex CLI](https://github.com/openai/codex) - OpenAI 구독 필요
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) - Google 계정 필요

## 프록시 서버 설치

애드온은 직접 AI CLI를 실행할 수 없기 때문에 로컬 프록시 서버가 중간에서 요청을 전달합니다. **애드온 설치 후 반드시 프록시 서버를 설치해야 합니다.**

> **주의:** 프록시 서버는 spicetify 설정 폴더 아래 `cli-proxy/`에 설치해야 합니다.
> - macOS/Linux: `~/.config/spicetify/cli-proxy/`
> - Windows: `%APPDATA%\spicetify\cli-proxy\`
>
> ivLyrics 폴더(`CustomApps/ivLyrics/`) 안에 넣으면 로딩 오류가 발생합니다.

### macOS / Linux

#### Step 1: 파일 복사

리포지토리를 클론했다면:

```bash
cp -r cli-proxy ~/.config/spicetify/cli-proxy
```

클론 없이 직접 다운로드:

```bash
mkdir -p ~/.config/spicetify/cli-proxy
cd ~/.config/spicetify/cli-proxy
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/server.js"
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/package.json"
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/spotify-with-proxy.sh"
curl -fsSLO "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy/.env.example"
chmod +x spotify-with-proxy.sh
```

#### Step 2: 의존성 설치

```bash
cd ~/.config/spicetify/cli-proxy
npm install
```

#### Step 3: 서버 실행

```bash
cd ~/.config/spicetify/cli-proxy
npm start
```

### Windows (PowerShell)

#### Step 1: 파일 복사

리포지토리를 클론했다면:

```powershell
Copy-Item -Recurse cli-proxy "$env:APPDATA\spicetify\cli-proxy"
```

클론 없이 직접 다운로드:

```powershell
$dir = "$env:APPDATA\spicetify\cli-proxy"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
cd $dir
$base = "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/cli-proxy"
foreach ($f in @('server.js','package.json','spotify-with-proxy.ps1','.env.example')) {
    Invoke-WebRequest -Uri "$base/$f" -OutFile $f -UseBasicParsing
}
```

#### Step 2: 의존성 설치

```powershell
cd "$env:APPDATA\spicetify\cli-proxy"
npm install
```

> Node.js가 설치되어 있지 않다면 먼저 [nodejs.org](https://nodejs.org/)에서 설치하세요.

#### Step 3: 서버 실행

```powershell
cd "$env:APPDATA\spicetify\cli-proxy"
npm start
```

정상적으로 실행되면 아래와 같은 출력이 나타납니다:

```
🚀 ivLyrics CLI Proxy Server v2.1.0
   Running on http://localhost:19284

🔧 Checking available tools...
   ✓ claude [CLI]: available
   ✓ gemini [SDK]: available
   ✓ codex [CLI]: available
```

### Step 4: 동작 확인

새 터미널을 열어서 다음 명령어로 서버 상태를 확인할 수 있습니다:

```bash
curl http://localhost:19284/health
```

### Gemini CLI 사용 시 추가 설정

Gemini CLI를 사용하려면 OAuth 클라이언트 정보가 필요합니다.

1. 먼저 `gemini` CLI를 한 번 실행하여 로그인합니다 (OAuth 자격증명 자동 생성):
   ```bash
   gemini
   ```

2. `.env` 파일을 생성합니다:
   ```bash
   cd ~/.config/spicetify/cli-proxy
   cp .env.example .env
   ```

3. `.env` 파일을 열어 Gemini CLI의 OAuth Client ID와 Secret을 입력합니다:
   ```
   GEMINI_OAUTH_CLIENT_ID=your_client_id_here
   GEMINI_OAUTH_CLIENT_SECRET=your_client_secret_here
   ```
   > Client ID와 Secret은 [Gemini CLI 소스코드](https://github.com/google-gemini/gemini-cli)에서 확인할 수 있습니다.

## 사용법

1. 위 설치 명령어로 애드온과 프록시 서버를 설치합니다.
2. 프록시 서버를 실행합니다:
   ```bash
   # macOS / Linux
   cd ~/.config/spicetify/cli-proxy && npm start

   # Windows (PowerShell)
   cd "$env:APPDATA\spicetify\cli-proxy"; npm start
   ```
3. Spotify를 실행하고 ivLyrics 설정에서 원하는 CLI Provider를 활성화합니다.

### Spotify와 함께 자동 시작/종료

매번 수동으로 서버를 실행하기 번거롭다면 래퍼 스크립트를 사용할 수 있습니다. Spotify를 시작할 때 프록시 서버를 자동으로 실행하고, Spotify를 종료하면 함께 종료됩니다.

**macOS / Linux:**

```bash
# 직접 실행
~/.config/spicetify/cli-proxy/spotify-with-proxy.sh

# 또는 alias 등록 (zshrc/bashrc)
echo 'alias spotify="~/.config/spicetify/cli-proxy/spotify-with-proxy.sh"' >> ~/.zshrc
source ~/.zshrc
spotify
```

**Windows (PowerShell):**

```powershell
# 직접 실행
& "$env:APPDATA\spicetify\cli-proxy\spotify-with-proxy.ps1"

# 또는 PowerShell profile에 function 등록
Add-Content $PROFILE 'function spotify { & "$env:APPDATA\spicetify\cli-proxy\spotify-with-proxy.ps1" }'
# 새 PowerShell 창에서:
spotify
```

## API Endpoints

프록시 서버는 다음 엔드포인트를 제공합니다:

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/health` | 서버 상태 및 사용 가능한 도구 목록 확인 |
| GET | `/tools` | 사용 가능한 CLI 도구 목록 |
| GET | `/models` | 도구별 사용 가능한 모델 목록 |
| POST | `/generate` | AI 텍스트 생성 (SSE 스트리밍 지원) |
| GET | `/updates` | 업데이트 확인 |
| POST | `/update` | 파일 업데이트 다운로드 및 적용 |
| POST | `/v1/chat/completions` | OpenAI API 호환 엔드포인트 |

### SSE 스트리밍

`/generate` 엔드포인트는 SSE(Server-Sent Events) 스트리밍을 지원합니다. `stream: true`를 요청 body에 추가하면 점진적 응답을 받을 수 있습니다:

```bash
# 스트리밍 요청
curl -N -X POST http://localhost:19284/generate \
  -H 'Content-Type: application/json' \
  -d '{"tool":"claude","prompt":"Say hello","stream":true}'

# 일반 요청 (역호환)
curl -X POST http://localhost:19284/generate \
  -H 'Content-Type: application/json' \
  -d '{"tool":"claude","prompt":"Say hello"}'
```

SSE 프로토콜:
```
data: {"chunk":"partial text"}\n\n     # 텍스트 청크
data: {"error":"message"}\n\n          # 에러 (발생 시)
data: [DONE]\n\n                       # 종료 신호
```

### 자동 업데이트

서버 시작 시 GitHub에서 최신 버전을 자동으로 확인합니다. 수동으로도 확인할 수 있습니다:

```bash
# 업데이트 확인
curl http://localhost:19284/updates

# 강제 재확인 (캐시 무시)
curl http://localhost:19284/updates?force=1

# 애드온 업데이트 적용
curl -X POST http://localhost:19284/update \
  -H 'Content-Type: application/json' \
  -d '{"target":"addons"}'
```

`target` 옵션: `addons`, `proxy`, `all`, 또는 개별 파일명 (예: `Addon_AI_CLI_ClaudeCode.js`)

## License

MIT
