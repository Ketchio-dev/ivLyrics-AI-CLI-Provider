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
