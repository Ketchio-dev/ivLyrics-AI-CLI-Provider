# ivLyrics CLI Proxy Server

로컬 CLI AI 도구들 (Claude Code, Codex, Gemini 등)을 ivLyrics에서 사용할 수 있게 해주는 프록시 서버입니다.

## 지원 CLI 도구

| Tool | Command | Mode | Description |
|------|---------|------|-------------|
| **Claude Code** | `claude` | CLI | Anthropic Claude 구독자용 CLI |
| **Codex** | `codex` | CLI | OpenAI Codex CLI |
| **Gemini** | `gemini` | SDK | Google Gemini CLI (Code Assist API 직접 호출) |

## 설치

```bash
cd ~/.config/spicetify/cli-proxy
npm install
```

Windows PowerShell:

```powershell
$proxyDir = "$env:APPDATA\spicetify\cli-proxy"
if (!(Test-Path $proxyDir)) { $proxyDir = "$env:USERPROFILE\.config\spicetify\cli-proxy" }
Set-Location $proxyDir
npm.cmd install
```

## 실행

```bash
npm start
```

Windows PowerShell:

```powershell
npm.cmd start
```

서버가 `http://localhost:19284`에서 시작됩니다.

## 사용법

1. 프록시 서버를 실행합니다
2. Spotify에서 ivLyrics 설정으로 이동
3. AI Providers에서 사용할 CLI 도구 애드온을 활성화

## API Endpoints

### GET /health
서버 상태 및 사용 가능한 도구 확인

```bash
curl http://localhost:19284/health
```

### GET /tools
사용 가능한 CLI 도구 목록

```bash
curl http://localhost:19284/tools
```

### GET /models
도구별 사용 가능한 모델 목록

```bash
curl http://localhost:19284/models?tool=claude
```

### POST /generate
텍스트 생성 요청

```bash
curl -X POST http://localhost:19284/generate \
  -H "Content-Type: application/json" \
  -d '{"tool": "claude", "prompt": "Hello, world!"}'
```

### POST /v1/chat/completions
OpenAI API 호환 엔드포인트

```bash
curl -X POST http://localhost:19284/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `19284` | 서버 포트 |

## Gemini SDK 인증

Gemini는 SDK 방식이라 `gemini login`으로 생성되는 `oauth_creds.json`이 필요합니다.
기본적으로 `oauth_creds.json`의 `client_id`/`client_secret`를 자동으로 사용합니다.
`oauth_creds.json`에 위 값이 없으면 설치된 Gemini CLI 런타임에서 자동으로 가져옵니다.

1. 최소 1회 로그인
```bash
gemini
```
2. `~/.gemini/oauth_creds.json` 파일이 생성되어 있는지 확인합니다.

## 문제 해결

### "Tool not found" 오류
해당 CLI 도구가 설치되어 있고 PATH에 있는지 확인하세요.

```bash
# 예: Claude Code 설치 확인
claude --version

# 예: Codex 설치 확인
codex --version

# 예: Gemini - OAuth 자격증명 확인
ls ~/.gemini/oauth_creds.json
```

### Windows에서 `npm.ps1` 실행 정책 오류

PowerShell에서 `npm` 대신 `npm.cmd`를 사용하세요.

```powershell
npm.cmd install
npm.cmd start
```

### 서버 연결 실패
프록시 서버가 실행 중인지 확인하세요.

```bash
curl http://localhost:19284/health
```

## 새로운 CLI 도구 추가

`server.js`의 `CLI_TOOLS` 객체에 새 도구를 추가할 수 있습니다:

```javascript
CLI_TOOLS.myTool = {
    mode: 'cli',
    command: 'mytool',
    checkCommand: 'mytool --version',
    defaultModel: '',
    buildArgs: (prompt) => ['--prompt', prompt],
    parseOutput: (stdout) => stdout.trim()
};
```
